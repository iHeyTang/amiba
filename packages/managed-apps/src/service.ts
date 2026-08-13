import { createHash, randomUUID } from "node:crypto"
import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path"
import { homedir, tmpdir } from "node:os"
import { promisify } from "node:util"

import chokidar, { type FSWatcher } from "chokidar"

import {
  checkoutStableCommit,
  commitDraft,
  createDraftWorktree,
  currentCommit,
  initializeRepository,
  removeDraftWorktree,
} from "./git"
import { readManagedAppManifest } from "./manifest"
import { MANAGED_APP_MANIFEST_SCHEMA } from "./schema"
import {
  appRoot,
  bundlePath,
  draftPath,
  listDirectories,
  listJsonFiles,
  outputPath,
  presetPath,
  readJson,
  revisionPath,
  statePath,
  writeJsonAtomic,
} from "./storage"
import type {
  ManagedAppAgentResultFile,
  ManagedAppCapabilitySnapshot,
  ManagedAppChangeListener,
  ManagedAppChangeResult,
  ManagedAppCreateRequest,
  ManagedAppCreateResult,
  ManagedAppDraft,
  ManagedAppManifest,
  ManagedAppMetadataPatch,
  ManagedAppOutputInput,
  ManagedAppOutputRecord,
  ManagedAppRevision,
  ManagedAppState,
  ManagedAppSummary,
  ManagedAppSurfaceDocument,
  ManagedAppToolPreset,
} from "./types"

const execFileAsync = promisify(execFile)
const AGENT_RESULT_PATH = join(".amiba", "result.json")
const MAX_COMMAND_MS = 5 * 60_000

export interface ManagedAppServiceHooks {
  /** Validate live MCP discovery and return the snapshot written into the Bundle. */
  discover?: (opts: {
    appId: string
    projectPath: string
    manifest: ManagedAppManifest
  }) => Promise<ManagedAppCapabilitySnapshot>
  /** Start candidate providers and validate UI resources before activation. */
  validateCandidate?: (opts: {
    appId: string
    revision: ManagedAppRevision
    bundlePath: string
  }) => Promise<void>
  /** Atomically switch runtime/catalog/surfaces to this revision. */
  activate?: (opts: {
    appId: string
    revision: ManagedAppRevision
    previous?: ManagedAppRevision
    bundlePath: string
  }) => Promise<void>
  deactivate?: (appId: string) => Promise<void>
  discardCandidate?: (appId: string, revisionId: string) => Promise<void>
}

export interface ManagedAppServiceOptions {
  root: string
  hooks?: ManagedAppServiceHooks
}

export interface ManagedAppService {
  init(): Promise<void>
  close(): Promise<void>
  list(options?: { includeArchived?: boolean }): Promise<ManagedAppSummary[]>
  get(appId: string): Promise<ManagedAppSummary | null>
  create(request: ManagedAppCreateRequest): Promise<ManagedAppCreateResult>
  requestChange(appId: string, request: string): Promise<ManagedAppChangeResult>
  attachSession(appId: string, draftId: string, sessionId: string): Promise<void>
  updateMetadata(appId: string, patch: ManagedAppMetadataPatch): Promise<ManagedAppSummary>
  archive(appId: string): Promise<ManagedAppSummary>
  restore(appId: string): Promise<ManagedAppSummary>
  exportProject(appId: string, destinationRoot: string): Promise<string>
  listOutputs(appId: string): Promise<ManagedAppOutputRecord[]>
  recordOutputs(appId: string, outputs: ManagedAppOutputInput[]): Promise<void>
  updateOutput(
    appId: string,
    outputId: string,
    patch: { pinned?: boolean; tags?: string[] },
  ): Promise<ManagedAppOutputRecord>
  listPresets(appId: string): Promise<ManagedAppToolPreset[]>
  savePreset(appId: string, input: {
    revisionId: string
    providerAlias: string
    toolName: string
    name: string
    arguments: Record<string, unknown>
  }): Promise<ManagedAppToolPreset>
  deletePreset(appId: string, presetId: string): Promise<void>
  buildDraft(appId: string, draftId: string): Promise<ManagedAppSummary>
  confirm(appId: string, revisionId: string): Promise<ManagedAppSummary>
  reject(appId: string, revisionId: string): Promise<ManagedAppSummary>
  rollback(appId: string): Promise<ManagedAppSummary>
  markUsed(appId: string): Promise<void>
  surface(
    appId: string,
    target?: "active" | "candidate",
    surfaceName?: "main" | "settings",
  ): Promise<ManagedAppSurfaceDocument | null>
  resolveAsset(appId: string, revisionId: string, relativePath: string): Promise<string | null>
  revisionDeployment(appId: string, revisionId: string): Promise<{
    revision: ManagedAppRevision
    bundlePath: string
  } | null>
  onChanged(listener: ManagedAppChangeListener): () => void
}

function now(): string {
  return new Date().toISOString()
}

function safeSlug(value: string): string {
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.slice(0, 36) || "applet"
}

function createAppId(name: string): string {
  return `io.amiba.personal.${safeSlug(name)}-${randomUUID().slice(0, 8)}`
}

function revisionId(): string {
  return `rev-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

function draftId(): string {
  return `draft-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

function recordId(prefix: "output" | "preset"): string {
  return `${prefix}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
}

function assertId(id: string, label: string): void {
  if (!/^[a-z0-9][a-z0-9._-]+$/.test(id)) throw new Error(`invalid ${label}`)
}

function buildEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "SystemRoot"]
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
}

function macBuildSandboxProfile(cwd: string, allowNetwork: boolean): string {
  const quote = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
  const readable = [cwd, tmpdir(), ...(process.env.PATH ?? "").split(delimiter)]
    .filter(Boolean)
    .map((path) => `(subpath "${quote(resolve(path))}")`)
    .join(" ")
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-read* (subpath "${quote(homedir())}"))`,
    `(allow file-read* ${readable})`,
    "(deny file-write*)",
    `(allow file-write* (subpath "${quote(cwd)}") (subpath "${quote(tmpdir())}"))`,
    allowNetwork ? "" : "(deny network*)",
  ].filter(Boolean).join(" ")
}

async function runCommands(
  commands: string[][],
  cwd: string,
  permissions: string[],
): Promise<void> {
  for (const command of commands) {
    const [file, ...args] = command
    if (!file) continue
    try {
      const executable = process.platform === "darwin" ? "sandbox-exec" : file
      const executableArgs = process.platform === "darwin"
        ? ["-p", macBuildSandboxProfile(cwd, permissions.includes("build:network")), file, ...args]
        : args
      await execFileAsync(executable, executableArgs, {
        cwd,
        encoding: "utf8",
        timeout: MAX_COMMAND_MS,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...buildEnvironment(), CI: "1", GIT_TERMINAL_PROMPT: "0" },
      })
    } catch (error) {
      const detail = error as Error & { stdout?: string; stderr?: string }
      throw new Error(
        `${command.join(" ")} failed: ${detail.stderr?.trim() || detail.stdout?.trim() || detail.message}`,
      )
    }
  }
}

function ignoredBundlePath(path: string): boolean {
  return path
    .split(sep)
    .some((part) =>
      part === ".git" ||
      part === ".amiba" ||
      part === "node_modules" ||
      part === ".env" ||
      part.startsWith(".env.") ||
      part === ".DS_Store",
    )
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256")
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const path = join(directory, entry.name)
      const rel = relative(root, path).split(sep).join("/")
      if (ignoredBundlePath(rel)) continue
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile()) {
        hash.update(`file:${rel}\0`)
        hash.update(await readFile(path))
        hash.update("\0")
      }
    }
  }
  await visit(root)
  return hash.digest("hex")
}

async function copyBundle(source: string, destination: string): Promise<void> {
  if (existsSync(destination)) return
  const temp = `${destination}.${process.pid}.${Date.now()}.tmp`
  await rm(temp, { recursive: true, force: true })
  await mkdir(dirname(temp), { recursive: true })
  await cp(source, temp, {
    recursive: true,
    filter: (path) => {
      const rel = relative(source, path)
      return !rel || !ignoredBundlePath(rel)
    },
  })
  await rename(temp, destination)
}

function hasSensitiveChange(
  previous: ManagedAppRevision | null,
  manifest: ManagedAppManifest,
): boolean {
  if (!previous) {
    return (manifest.permissions?.length ?? 0) > 0 ||
      (manifest.mcp?.providers ?? []).some((provider) => !!provider.url || provider.kind === "registered")
  }
  const oldPermissions = new Set(previous.permissions)
  if ((manifest.permissions ?? []).some((permission) => !oldPermissions.has(permission))) {
    return true
  }
  if ((manifest.dataSchemaVersion ?? 1) !== previous.dataSchemaVersion) return true
  return stableJson(manifest.mcp ?? null) !== stableJson(previous.manifest.mcp ?? null)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function declaredToolPermissions(snapshot: ManagedAppCapabilitySnapshot): string[] {
  return [...new Set(snapshot.tools.flatMap((tool) => {
    const value = tool._meta?.["com.amiba/permissions"]
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }))]
}

function validateMentionTools(
  manifest: ManagedAppManifest,
  snapshot: ManagedAppCapabilitySnapshot,
): void {
  for (const mention of manifest.mentions ?? []) {
    if (!mention.searchTool) continue
    const name = mention.searchTool.includes("/")
      ? mention.searchTool
      : `${mention.provider}/${mention.searchTool}`
    const tool = snapshot.tools.find((candidate) => candidate.name === name) as
      | (ManagedAppCapabilitySnapshot["tools"][number] & {
          annotations?: { readOnlyHint?: boolean }
        })
      | undefined
    if (!tool) throw new Error(`mention ${mention.id} search Tool was not discovered: ${name}`)
    if (tool.annotations?.readOnlyHint !== true) {
      throw new Error(`mention ${mention.id} search Tool must declare readOnlyHint`)
    }
  }
}

function scaffoldManifest(id: string, request: ManagedAppCreateRequest): ManagedAppManifest {
  return {
    $schema: "./manifest.schema.json",
    schemaVersion: 1,
    id,
    name: request.name.trim(),
    description: request.description?.trim() || request.request.trim(),
    kind: "interactive-ui",
    runtime: "static-mcp-app",
    surfaces: {
      main: {
        resourceUri: `ui://${id}/main`,
        entry: "ui/index.html",
      },
    },
    permissions: [],
    dataSchemaVersion: 1,
  }
}

function scaffoldHtml(name: string): string {
  const escaped = name.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character]!)
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escaped}</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
    main { max-width: 36rem; padding: 2rem; }
    h1 { margin: 0 0 .75rem; font-size: 1.5rem; font-weight: 520; }
    p { margin: 0; color: color-mix(in srgb, CanvasText 62%, transparent); line-height: 1.6; }
  </style>
</head>
<body><main><h1>${escaped}</h1><p>AI 正在完成这个小应用。完成后这里会显示可使用的界面。</p></main></body>
</html>
`
}

function agentInstructions(opts: {
  appId: string
  appName: string
  request: string
  existing: boolean
}): string {
  return [
    `你正在${opts.existing ? "改进" : "创建"} Amiba 小应用「${opts.appName}」。`,
    `用户需求：${opts.request}`,
    "",
    "当前工作区是该小应用的隔离草稿。直接检查并修改其中的源码、测试与 manifest.json。",
    "必须遵守：",
    `1. manifest.json 的 id 保持为 ${opts.appId}，schemaVersion 保持为 1。`,
    "2. 默认使用 React + TypeScript 构建界面，并使用官方 MCP Apps SDK；静态界面在 surfaces.main.entry 指定入口。不要依赖 window.amiba 私有业务 API。",
    "3. Agent 或无界面使用需要复用的业务操作，应实现成标准 MCP Tool；纯界面局部状态可以留在 View。Tool Schema 只在 MCP Server 中定义。",
    "4. 运行 Bundle 必须自包含，不得在运行时安装依赖。把测试和构建命令以参数数组写入 manifest.build，并提交依赖锁文件。",
    "5. 需要网络、文件、设备、外链或主动向 AI 发消息时，在 manifest.permissions 中最小化声明；不要把密钥写入源码、Manifest、日志或 Bundle。",
    "6. 不要改写 .git，不要删除 .amiba 目录，不要直接操作 Amiba 注册表或版本状态。",
    "7. 完成前运行项目中声明的测试或合理的本地验证。",
    "",
    "完成时必须写入 .amiba/result.json：",
    '{"status":"ready","summary":"面向用户的一句话修改摘要"}',
    "如果无法完成，写入：",
    '{"status":"failed","error":"面向用户的失败原因"}',
    "写入该文件表示把候选版本交给 Amiba 构建、验证并安全应用。",
  ].join("\n")
}

export function createManagedAppService(options: ManagedAppServiceOptions): ManagedAppService {
  const root = resolve(options.root)
  const listeners = new Set<ManagedAppChangeListener>()
  const processing = new Set<string>()
  let watcher: FSWatcher | null = null

  function emit(appId: string | null): void {
    for (const listener of listeners) listener(appId)
  }

  async function loadState(appId: string): Promise<ManagedAppState> {
    assertId(appId, "app id")
    const state = await readJson<ManagedAppState>(statePath(root, appId))
    if (!state) throw new Error(`managed Applet not found: ${appId}`)
    return state
  }

  async function saveState(state: ManagedAppState): Promise<void> {
    state.updatedAt = now()
    await writeJsonAtomic(statePath(root, state.id), state)
    emit(state.id)
  }

  async function loadDraft(appId: string, id: string): Promise<ManagedAppDraft> {
    assertId(id, "draft id")
    const draft = await readJson<ManagedAppDraft>(draftPath(root, appId, id))
    if (!draft) throw new Error(`draft not found: ${id}`)
    return draft
  }

  async function saveDraft(draft: ManagedAppDraft): Promise<void> {
    draft.updatedAt = now()
    await writeJsonAtomic(draftPath(root, draft.extensionId, draft.id), draft)
  }

  async function loadRevision(appId: string, id?: string): Promise<ManagedAppRevision | null> {
    if (!id) return null
    assertId(id, "revision id")
    return readJson<ManagedAppRevision>(revisionPath(root, appId, id))
  }

  async function summarize(state: ManagedAppState): Promise<ManagedAppSummary> {
    const pendingDraft = state.pendingDraftId
      ? await loadDraft(state.id, state.pendingDraftId).catch(() => null)
      : null
    const activeRevision = await loadRevision(state.id, state.activeRevisionId)
    const candidateRevision = pendingDraft?.candidateRevisionId
      ? await loadRevision(state.id, pendingDraft.candidateRevisionId)
      : null
    const latestRevision = candidateRevision ?? activeRevision
    return {
      id: state.id,
      name: state.name,
      description: state.description,
      icon: state.icon,
      kind: state.kind,
      source: state.source,
      tags: state.tags ?? [],
      collectionId: state.collectionId,
      sourceSessionIds: state.sourceSessionIds ?? [],
      pinned: state.pinned ?? false,
      archived: state.archived ?? false,
      deletedAt: state.deletedAt,
      userStatus: state.userStatus,
      activeRevisionId: state.activeRevisionId,
      pendingDraft: pendingDraft ?? undefined,
      activeRevision: activeRevision ?? undefined,
      candidateRevision: candidateRevision ?? undefined,
      latestChangeSummary: latestRevision?.changeSummary,
      lastError: state.lastError,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      lastUsedAt: state.lastUsedAt,
    }
  }

  async function createDraft(state: ManagedAppState, request: string): Promise<ManagedAppDraft> {
    if (state.pendingDraftId) {
      const existing = await loadDraft(state.id, state.pendingDraftId).catch(() => null)
      if (existing && existing.status !== "failed" && existing.status !== "discarded") {
        throw new Error("这个小应用已经在改进中")
      }
      if (existing) {
        await removeDraftWorktree({
          projectPath: state.projectPath,
          workspacePath: existing.workspacePath,
          branch: existing.branch,
        })
        existing.status = "discarded"
        await saveDraft(existing)
      }
    }
    const id = draftId()
    const workspacePath = join(appRoot(root, state.id), "worktrees", id)
    const baseRevision = await loadRevision(state.id, state.activeRevisionId)
    const baseCommit = baseRevision?.sourceCommit ?? (await currentCommit(state.projectPath))
    const { branch } = await createDraftWorktree({
      projectPath: state.projectPath,
      workspacePath,
      draftId: id,
      baseCommit,
    })
    await mkdir(join(workspacePath, ".amiba"), { recursive: true })
    const draft: ManagedAppDraft = {
      id,
      extensionId: state.id,
      baseRevisionId: state.activeRevisionId,
      workspacePath,
      branch,
      userRequest: request.trim(),
      status: "editing",
      createdAt: now(),
      updatedAt: now(),
    }
    await saveDraft(draft)
    state.pendingDraftId = draft.id
    state.userStatus = state.activeRevisionId ? "improving" : "creating"
    delete state.lastError
    await saveState(state)
    return draft
  }

  async function validateSurfaceEntries(
    workspacePath: string,
    manifest: ManagedAppManifest,
  ): Promise<void> {
    for (const [name, surface] of Object.entries(manifest.surfaces ?? {})) {
      if (!surface?.entry) continue
      const path = resolve(workspacePath, surface.entry)
      const safeRoot = workspacePath.endsWith(sep) ? workspacePath : `${workspacePath}${sep}`
      if (!path.startsWith(safeRoot) || !(await stat(path)).isFile()) {
        throw new Error(`surfaces.${name}.entry does not resolve to a file`)
      }
    }
  }

  async function resolveRevisionAsset(
    appId: string,
    id: string,
    relativePath: string,
  ): Promise<string | null> {
    const revision = await loadRevision(appId, id)
    if (!revision) return null
    const rootPath = resolve(bundlePath(root, appId, revision.bundleHash))
    const candidate = resolve(rootPath, relativePath)
    const safeRoot = rootPath.endsWith(sep) ? rootPath : `${rootPath}${sep}`
    if (!candidate.startsWith(safeRoot)) return null
    try {
      return (await stat(candidate)).isFile() ? candidate : null
    } catch {
      return null
    }
  }

  async function applyRevision(
    state: ManagedAppState,
    draft: ManagedAppDraft,
    revision: ManagedAppRevision,
  ): Promise<ManagedAppSummary> {
    const previous = await loadRevision(state.id, state.activeRevisionId)
    revision.status = "activating"
    await writeJsonAtomic(revisionPath(root, state.id, revision.id), revision)
    try {
      await options.hooks?.activate?.({
        appId: state.id,
        revision,
        previous: previous ?? undefined,
        bundlePath: bundlePath(root, state.id, revision.bundleHash),
      })
      revision.status = "healthy"
      revision.activatedAt = now()
      await writeJsonAtomic(revisionPath(root, state.id, revision.id), revision)
      state.activeRevisionId = revision.id
      state.name = revision.manifest.name
      state.description = revision.manifest.description
      state.icon = revision.manifest.icon
      state.kind = revision.manifest.kind
      state.userStatus = "ready"
      state.pendingDraftId = undefined
      state.lastError = undefined
      await checkoutStableCommit(state.projectPath, revision.sourceCommit)
      draft.status = "applied"
      await saveDraft(draft)
      await saveState(state)
      await removeDraftWorktree({
        projectPath: state.projectPath,
        workspacePath: draft.workspacePath,
        branch: draft.branch,
      })
      return summarize(state)
    } catch (error) {
      try {
        if (previous) {
          await options.hooks?.activate?.({
            appId: state.id,
            revision: previous,
            bundlePath: bundlePath(root, state.id, previous.bundleHash),
          })
        } else {
          await options.hooks?.deactivate?.(state.id)
        }
      } catch (rollbackError) {
        console.error("[managed-apps] failed to restore runtime after activation error:", rollbackError)
      }
      revision.status = "failed"
      revision.error = error instanceof Error ? error.message : String(error)
      await writeJsonAtomic(revisionPath(root, state.id, revision.id), revision)
      state.userStatus = state.activeRevisionId ? "update-failed" : "unavailable"
      state.lastError = revision.error
      draft.status = "failed"
      draft.error = revision.error
      await saveDraft(draft)
      await saveState(state)
      throw error
    }
  }

  async function buildDraft(appId: string, id: string): Promise<ManagedAppSummary> {
    const key = `${appId}:${id}`
    if (processing.has(key)) return summarize(await loadState(appId))
    processing.add(key)
    try {
      const state = await loadState(appId)
      const draft = await loadDraft(appId, id)
      if (draft.status === "applied" || draft.status === "discarded") return summarize(state)
      const result = await readJson<ManagedAppAgentResultFile>(
        join(draft.workspacePath, AGENT_RESULT_PATH),
      )
      if (!result) throw new Error("AI 尚未提交修改结果")
      if (result.status === "failed") {
        const message = result.error?.trim() || "AI 未能完成本次修改"
        draft.status = "failed"
        draft.error = message
        state.userStatus = state.activeRevisionId ? "update-failed" : "unavailable"
        state.lastError = message
        await saveDraft(draft)
        await saveState(state)
        return summarize(state)
      }

      draft.status = "building"
      await saveDraft(draft)
      state.userStatus = state.activeRevisionId ? "improving" : "creating"
      await saveState(state)

      let attemptedRevisionId: string | undefined
      try {
        let manifest = await readManagedAppManifest(draft.workspacePath)
        if (manifest.id !== state.id) throw new Error("manifest id cannot change")
        await runCommands(
          manifest.build?.testCommands ?? [],
          draft.workspacePath,
          manifest.permissions ?? [],
        )
        await runCommands(
          manifest.build?.commands ?? [],
          draft.workspacePath,
          manifest.permissions ?? [],
        )
        manifest = await readManagedAppManifest(draft.workspacePath)
        await validateSurfaceEntries(draft.workspacePath, manifest)

        const capabilitySnapshot = options.hooks?.discover
          ? await options.hooks.discover({
              appId,
              projectPath: draft.workspacePath,
              manifest,
            })
          : { tools: [], resources: [], resourceTemplates: [], prompts: [] }
        const manifestPermissions = new Set(manifest.permissions ?? [])
        validateMentionTools(manifest, capabilitySnapshot)
        const missingPermissions = declaredToolPermissions(capabilitySnapshot).filter(
          (permission) => !manifestPermissions.has(permission),
        )
        if (missingPermissions.length) {
          throw new Error(
            `MCP Tools require undeclared permissions: ${missingPermissions.join(", ")}`,
          )
        }
        await writeJsonAtomic(join(draft.workspacePath, "discovery-snapshot.json"), capabilitySnapshot)

        const id = revisionId()
        attemptedRevisionId = id
        const commit = await commitDraft({
          workspacePath: draft.workspacePath,
          revisionId: id,
          summary: result.summary?.trim() || draft.userRequest,
        })
        const hash = await hashTree(draft.workspacePath)
        const destination = bundlePath(root, appId, hash)
        await copyBundle(draft.workspacePath, destination)

        const previous = await loadRevision(appId, state.activeRevisionId)
        const sensitive = hasSensitiveChange(previous, manifest)
        const revision: ManagedAppRevision = {
          id,
          extensionId: appId,
          parentRevisionId: state.activeRevisionId,
          sourceCommit: commit,
          bundleHash: hash,
          manifest,
          capabilities: capabilitySnapshot,
          permissions: manifest.permissions ?? [],
          dataSchemaVersion: manifest.dataSchemaVersion ?? 1,
          userRequest: draft.userRequest,
          changeSummary: result.summary?.trim() || draft.userRequest,
          sourceSessionId: draft.sourceSessionId,
          risk: sensitive ? "sensitive" : "safe",
          status: "candidate",
          createdAt: now(),
        }
        await options.hooks?.validateCandidate?.({
          appId,
          revision,
          bundlePath: destination,
        })
        draft.candidateRevisionId = revision.id
        draft.status = "preview-ready"
        await saveDraft(draft)
        if (!state.revisionIds.includes(revision.id)) state.revisionIds.push(revision.id)
        if (sensitive) {
          revision.status = "awaiting-confirmation"
          await writeJsonAtomic(revisionPath(root, appId, revision.id), revision)
          state.userStatus = "needs-confirmation"
          await saveState(state)
          return summarize(state)
        }
        await writeJsonAtomic(revisionPath(root, appId, revision.id), revision)
        return applyRevision(state, draft, revision)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attemptedRevisionId) {
          await options.hooks?.discardCandidate?.(appId, attemptedRevisionId).catch(() => {})
        }
        draft.status = "failed"
        draft.error = message
        state.userStatus = state.activeRevisionId ? "update-failed" : "unavailable"
        state.lastError = message
        await saveDraft(draft)
        await saveState(state)
        return summarize(state)
      }
    } finally {
      processing.delete(key)
    }
  }

  async function handleResultFile(path: string): Promise<void> {
    const normalized = resolve(path)
    const marker = `${sep}worktrees${sep}`
    const markerIndex = normalized.lastIndexOf(marker)
    if (markerIndex < 0 || basename(normalized) !== "result.json") return
    const appPath = normalized.slice(0, markerIndex)
    const appId = basename(appPath)
    const rest = normalized.slice(markerIndex + marker.length).split(sep)
    const id = rest[0]
    if (!id || rest.slice(1).join(sep) !== AGENT_RESULT_PATH) return
    await buildDraft(appId, id).catch((error) => {
      console.error(`[managed-apps] failed to process ${appId}/${id}:`, error)
    })
  }

  return {
    async init() {
      await mkdir(root, { recursive: true })
      const states = await Promise.all(
        (await listDirectories(root)).map((id) => loadState(id).catch(() => null)),
      )
      for (const state of states) {
        if (!state?.activeRevisionId || state.archived) continue
        const revision = await loadRevision(state.id, state.activeRevisionId)
        if (!revision) continue
        try {
          await options.hooks?.activate?.({
            appId: state.id,
            revision,
            bundlePath: bundlePath(root, state.id, revision.bundleHash),
          })
        } catch (error) {
          state.userStatus = "unavailable"
          state.lastError = error instanceof Error ? error.message : String(error)
          await saveState(state)
        }
      }
      if (watcher) return
      watcher = chokidar.watch(join(root, "*", "worktrees", "*", ".amiba", "result.json"), {
        ignoreInitial: false,
        awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
      })
      watcher.on("add", (path) => void handleResultFile(path))
      watcher.on("change", (path) => void handleResultFile(path))
    },

    async close() {
      await watcher?.close()
      watcher = null
    },

    async list(listOptions = {}) {
      const ids = await listDirectories(root)
      const summaries = await Promise.all(
        ids.map(async (id) => {
          try {
            return await summarize(await loadState(id))
          } catch {
            return null
          }
        }),
      )
      return summaries
        .filter((summary): summary is ManagedAppSummary => summary !== null)
        .filter((summary) => listOptions.includeArchived || !summary.archived)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
    },

    async get(appId) {
      try {
        return await summarize(await loadState(appId))
      } catch {
        return null
      }
    },

    async create(request) {
      const name = request.name.trim()
      const userRequest = request.request.trim()
      if (!name) throw new Error("小应用名称不能为空")
      if (!userRequest) throw new Error("请描述这个小应用需要做什么")
      const id = createAppId(name)
      const rootPath = appRoot(root, id)
      const projectPath = join(rootPath, "project")
      await mkdir(join(projectPath, "ui"), { recursive: true })
      await writeFile(
        join(projectPath, "manifest.json"),
        `${JSON.stringify(scaffoldManifest(id, request), null, 2)}\n`,
        "utf8",
      )
      await writeFile(
        join(projectPath, "manifest.schema.json"),
        `${JSON.stringify(MANAGED_APP_MANIFEST_SCHEMA, null, 2)}\n`,
        "utf8",
      )
      await writeFile(join(projectPath, "ui", "index.html"), scaffoldHtml(name), "utf8")
      await writeFile(
        join(projectPath, ".gitignore"),
        ".amiba/\nnode_modules/\ndist/\n.env\n.env.*\n",
        "utf8",
      )
      await initializeRepository(projectPath)
      const createdAt = now()
      const state: ManagedAppState = {
        schemaVersion: 1,
        id,
        name,
        description: request.description?.trim() || userRequest,
        kind: "interactive-ui",
        source: "personal-managed",
        tags: [],
        sourceSessionIds: [],
        pinned: false,
        archived: false,
        projectPath,
        revisionIds: [],
        userStatus: "creating",
        createdAt,
        updatedAt: createdAt,
      }
      await saveState(state)
      const draft = await createDraft(state, userRequest)
      return {
        app: await summarize(state),
        draft,
        agentPrompt: agentInstructions({
          appId: id,
          appName: name,
          request: userRequest,
          existing: false,
        }),
      }
    },

    async requestChange(appId, request) {
      const userRequest = request.trim()
      if (!userRequest) throw new Error("请描述需要修改的地方")
      const state = await loadState(appId)
      if (state.archived) throw new Error("这个小应用已被删除，请先恢复")
      const draft = await createDraft(state, userRequest)
      return {
        draft,
        agentPrompt: agentInstructions({
          appId,
          appName: state.name,
          request: userRequest,
          existing: true,
        }),
      }
    },

    async attachSession(appId, id, sessionId) {
      const value = sessionId.trim()
      if (!value) return
      const draft = await loadDraft(appId, id)
      draft.sourceSessionId = value
      await saveDraft(draft)
      const state = await loadState(appId)
      state.sourceSessionIds = [...new Set([...(state.sourceSessionIds ?? []), value])]
      await saveState(state)
    },

    async updateMetadata(appId, patch: ManagedAppMetadataPatch) {
      const state = await loadState(appId)
      if (patch.tags) {
        state.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20)
      }
      if (patch.collectionId !== undefined) {
        state.collectionId = patch.collectionId?.trim() || undefined
      }
      if (patch.pinned !== undefined) state.pinned = patch.pinned
      await saveState(state)
      return summarize(state)
    },

    async archive(appId) {
      const state = await loadState(appId)
      if (state.pendingDraftId) {
        const draft = await loadDraft(appId, state.pendingDraftId).catch(() => null)
        if (draft) {
          if (draft.candidateRevisionId) {
            await options.hooks?.discardCandidate?.(appId, draft.candidateRevisionId)
          }
          draft.status = "discarded"
          await saveDraft(draft)
          await removeDraftWorktree({
            projectPath: state.projectPath,
            workspacePath: draft.workspacePath,
            branch: draft.branch,
          })
        }
        state.pendingDraftId = undefined
      }
      await options.hooks?.deactivate?.(appId)
      state.archived = true
      state.deletedAt = now()
      await saveState(state)
      return summarize(state)
    },

    async restore(appId) {
      const state = await loadState(appId)
      const revision = await loadRevision(appId, state.activeRevisionId)
      if (revision) {
        await options.hooks?.activate?.({
          appId,
          revision,
          bundlePath: bundlePath(root, appId, revision.bundleHash),
        })
      }
      state.archived = false
      state.deletedAt = undefined
      state.userStatus = revision ? "ready" : "unavailable"
      await saveState(state)
      return summarize(state)
    },

    async exportProject(appId, destinationRoot) {
      const state = await loadState(appId)
      const folder = `${safeSlug(state.name)}-${new Date().toISOString().slice(0, 10)}`
      let destination = resolve(destinationRoot, folder)
      let suffix = 2
      while (existsSync(destination)) destination = resolve(destinationRoot, `${folder}-${suffix++}`)
      await cp(state.projectPath, destination, {
        recursive: true,
        filter: (path) => {
          const rel = relative(state.projectPath, path)
          return !rel || !ignoredBundlePath(rel)
        },
      })
      await writeJsonAtomic(join(destination, "amiba-export.json"), {
        extensionId: state.id,
        activeRevisionId: state.activeRevisionId,
        exportedAt: now(),
      })
      return destination
    },

    async listOutputs(appId) {
      await loadState(appId)
      const directory = join(appRoot(root, appId), "outputs")
      const records = await Promise.all(
        (await listJsonFiles(directory)).map((name) =>
          readJson<ManagedAppOutputRecord>(join(directory, name)),
        ),
      )
      return records
        .filter((record): record is ManagedAppOutputRecord => !!record)
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt.localeCompare(left.createdAt))
    },

    async recordOutputs(appId, inputs) {
      if (!inputs.length) return
      const state = await loadState(appId)
      const directory = join(appRoot(root, appId), "outputs")
      const existing = new Set(
        (await Promise.all(
          (await listJsonFiles(directory)).map((name) =>
            readJson<ManagedAppOutputRecord>(join(directory, name)),
          ),
        ))
          .filter((record): record is ManagedAppOutputRecord => !!record)
          .map((record) => `${record.revisionId}\0${record.toolName ?? ""}\0${record.uri}`),
      )
      for (const input of inputs.slice(0, 100)) {
        if (!state.revisionIds.includes(input.revisionId) || !input.uri?.trim()) continue
        const key = `${input.revisionId}\0${input.toolName ?? ""}\0${input.uri}`
        if (existing.has(key)) continue
        const id = recordId("output")
        const record: ManagedAppOutputRecord = {
          id,
          extensionId: appId,
          revisionId: input.revisionId,
          kind: input.kind ?? "resource",
          uri: input.uri,
          name: input.name?.trim() || input.uri,
          mimeType: input.mimeType,
          toolName: input.toolName,
          tags: [],
          pinned: false,
          createdAt: now(),
        }
        await writeJsonAtomic(outputPath(root, appId, id), record)
        existing.add(key)
      }
      emit(appId)
    },

    async updateOutput(appId, outputId, patch) {
      await loadState(appId)
      assertId(outputId, "output id")
      const path = outputPath(root, appId, outputId)
      const record = await readJson<ManagedAppOutputRecord>(path)
      if (!record) throw new Error("output not found")
      if (patch.pinned !== undefined) record.pinned = patch.pinned
      if (patch.tags) {
        record.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20)
      }
      await writeJsonAtomic(path, record)
      emit(appId)
      return record
    },

    async listPresets(appId) {
      await loadState(appId)
      const directory = join(appRoot(root, appId), "presets")
      const records = await Promise.all(
        (await listJsonFiles(directory)).map((name) =>
          readJson<ManagedAppToolPreset>(join(directory, name)),
        ),
      )
      return records
        .filter((record): record is ManagedAppToolPreset => !!record)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    },

    async savePreset(appId, input) {
      const state = await loadState(appId)
      if (!state.revisionIds.includes(input.revisionId)) throw new Error("preset revision is unavailable")
      if (!input.name.trim()) throw new Error("preset name is required")
      const id = recordId("preset")
      const timestamp = now()
      const preset: ManagedAppToolPreset = {
        id,
        extensionId: appId,
        revisionId: input.revisionId,
        providerAlias: input.providerAlias,
        toolName: input.toolName,
        name: input.name.trim(),
        arguments: input.arguments,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await writeJsonAtomic(presetPath(root, appId, id), preset)
      emit(appId)
      return preset
    },

    async deletePreset(appId, presetId) {
      await loadState(appId)
      assertId(presetId, "preset id")
      await rm(presetPath(root, appId, presetId), { force: true })
      emit(appId)
    },

    buildDraft,

    async confirm(appId, id) {
      const state = await loadState(appId)
      if (!state.pendingDraftId) throw new Error("没有待确认的修改")
      const draft = await loadDraft(appId, state.pendingDraftId)
      if (draft.candidateRevisionId !== id) throw new Error("待确认版本已经变化")
      const revision = await loadRevision(appId, id)
      if (!revision || revision.status !== "awaiting-confirmation") {
        throw new Error("这个修改不再等待确认")
      }
      return applyRevision(state, draft, revision)
    },

    async reject(appId, id) {
      const state = await loadState(appId)
      if (!state.pendingDraftId) throw new Error("没有待处理的修改")
      const draft = await loadDraft(appId, state.pendingDraftId)
      const revision = await loadRevision(appId, id)
      if (revision) {
        await options.hooks?.discardCandidate?.(appId, revision.id)
        revision.status = "rolled-back"
        await writeJsonAtomic(revisionPath(root, appId, revision.id), revision)
      }
      draft.status = "discarded"
      await saveDraft(draft)
      state.pendingDraftId = undefined
      state.userStatus = state.activeRevisionId ? "ready" : "unavailable"
      await saveState(state)
      await removeDraftWorktree({
        projectPath: state.projectPath,
        workspacePath: draft.workspacePath,
        branch: draft.branch,
      })
      return summarize(state)
    },

    async rollback(appId) {
      const state = await loadState(appId)
      const current = await loadRevision(appId, state.activeRevisionId)
      const target = await loadRevision(appId, current?.parentRevisionId)
      if (!current || !target) throw new Error("没有可以撤销的上一次修改")
      await options.hooks?.activate?.({
        appId,
        revision: target,
        previous: current,
        bundlePath: bundlePath(root, appId, target.bundleHash),
      })
      current.status = "rolled-back"
      await writeJsonAtomic(revisionPath(root, appId, current.id), current)
      target.status = "healthy"
      target.activatedAt = now()
      await writeJsonAtomic(revisionPath(root, appId, target.id), target)
      state.activeRevisionId = target.id
      state.name = target.manifest.name
      state.description = target.manifest.description
      state.kind = target.manifest.kind
      state.userStatus = "ready"
      state.lastError = undefined
      await checkoutStableCommit(state.projectPath, target.sourceCommit)
      await saveState(state)
      return summarize(state)
    },

    async markUsed(appId) {
      const state = await loadState(appId)
      if (state.archived) return
      state.lastUsedAt = now()
      await saveState(state)
    },

    async surface(appId, target = "active", surfaceName = "main") {
      const state = await loadState(appId)
      if (state.archived) return null
      let revision = await loadRevision(appId, state.activeRevisionId)
      if (target === "candidate" && state.pendingDraftId) {
        const draft = await loadDraft(appId, state.pendingDraftId)
        revision = await loadRevision(appId, draft.candidateRevisionId)
      }
      const surface = revision?.manifest.surfaces?.[surfaceName]
      if (!revision || !surface) return null
      if (!surface.entry) {
        return {
          appId,
          revisionId: revision.id,
          resourceUri: surface.resourceUri,
          mimeType: "text/html;profile=mcp-app",
          metadata: { provider: surface.provider, surfaceName },
        }
      }
      const path = await resolveRevisionAsset(appId, revision.id, surface.entry)
      if (!path) return null
      return {
        appId,
        revisionId: revision.id,
        resourceUri: surface.resourceUri,
        mimeType: "text/html;profile=mcp-app",
        html: await readFile(path, "utf8"),
        metadata: { entry: surface.entry, surfaceName },
      }
    },

    async resolveAsset(appId, id, relativePath) {
      return resolveRevisionAsset(appId, id, relativePath)
    },

    async revisionDeployment(appId, id) {
      const state = await loadState(appId)
      if (state.archived || !state.revisionIds.includes(id)) return null
      const revision = await loadRevision(appId, id)
      return revision
        ? { revision, bundlePath: bundlePath(root, appId, revision.bundleHash) }
        : null
    },

    onChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
