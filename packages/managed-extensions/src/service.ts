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
import { readManagedExtensionManifest } from "./manifest"
import { MANAGED_EXTENSION_MANIFEST_SCHEMA } from "./schema"
import {
  extensionRoot,
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
  ManagedExtensionAgentResultFile,
  ManagedExtensionCapabilitySnapshot,
  ManagedExtensionChangeListener,
  ManagedExtensionChangeResult,
  ManagedExtensionCreateRequest,
  ManagedExtensionCreateResult,
  ManagedExtensionDraft,
  ManagedExtensionManifest,
  ManagedExtensionMetadataPatch,
  ManagedExtensionOutputInput,
  ManagedExtensionOutputRecord,
  ManagedExtensionRevision,
  ManagedExtensionState,
  ManagedExtensionSummary,
  ManagedExtensionSurfaceDocument,
  ManagedExtensionToolPreset,
} from "./types"

const execFileAsync = promisify(execFile)
const AGENT_RESULT_PATH = join(".amiba", "result.json")
const MAX_COMMAND_MS = 5 * 60_000

export interface ManagedExtensionServiceHooks {
  /** Validate live MCP discovery and return the snapshot written into the Bundle. */
  discover?: (opts: {
    extensionId: string
    projectPath: string
    manifest: ManagedExtensionManifest
  }) => Promise<ManagedExtensionCapabilitySnapshot>
  /** Start candidate providers and validate UI resources before activation. */
  validateCandidate?: (opts: {
    extensionId: string
    revision: ManagedExtensionRevision
    bundlePath: string
  }) => Promise<void>
  /** Atomically switch runtime/catalog/surfaces to this revision. */
  activate?: (opts: {
    extensionId: string
    revision: ManagedExtensionRevision
    previous?: ManagedExtensionRevision
    bundlePath: string
  }) => Promise<void>
  deactivate?: (extensionId: string) => Promise<void>
  discardCandidate?: (extensionId: string, revisionId: string) => Promise<void>
}

export interface ManagedExtensionServiceOptions {
  root: string
  hooks?: ManagedExtensionServiceHooks
}

export interface ManagedExtensionDraftPreview {
  extensionId: string
  draftId: string
  workspacePath: string
  surfaceName: "main" | "settings"
  entry?: string
  manifest: ManagedExtensionManifest
  capabilities: ManagedExtensionCapabilitySnapshot
}

export interface ManagedExtensionService {
  init(): Promise<void>
  close(): Promise<void>
  list(options?: { includeArchived?: boolean }): Promise<ManagedExtensionSummary[]>
  get(extensionId: string): Promise<ManagedExtensionSummary | null>
  create(request: ManagedExtensionCreateRequest): Promise<ManagedExtensionCreateResult>
  requestChange(extensionId: string, request: string): Promise<ManagedExtensionChangeResult>
  abortDraft(extensionId: string, draftId: string, reason?: string): Promise<ManagedExtensionSummary | null>
  attachSession(extensionId: string, draftId: string, sessionId: string): Promise<void>
  updateMetadata(extensionId: string, patch: ManagedExtensionMetadataPatch): Promise<ManagedExtensionSummary>
  archive(extensionId: string): Promise<ManagedExtensionSummary>
  restore(extensionId: string): Promise<ManagedExtensionSummary>
  exportProject(extensionId: string, destinationRoot: string): Promise<string>
  listOutputs(extensionId: string): Promise<ManagedExtensionOutputRecord[]>
  recordOutputs(extensionId: string, outputs: ManagedExtensionOutputInput[]): Promise<void>
  updateOutput(
    extensionId: string,
    outputId: string,
    patch: { pinned?: boolean; tags?: string[] },
  ): Promise<ManagedExtensionOutputRecord>
  listPresets(extensionId: string): Promise<ManagedExtensionToolPreset[]>
  savePreset(extensionId: string, input: {
    revisionId: string
    providerAlias: string
    toolName: string
    name: string
    arguments: Record<string, unknown>
  }): Promise<ManagedExtensionToolPreset>
  deletePreset(extensionId: string, presetId: string): Promise<void>
  prepareDraftPreview(
    extensionId: string,
    draftId: string,
    options?: { surfaceName?: "main" | "settings"; runTests?: boolean },
  ): Promise<ManagedExtensionDraftPreview>
  buildDraft(extensionId: string, draftId: string): Promise<ManagedExtensionSummary>
  confirm(extensionId: string, revisionId: string): Promise<ManagedExtensionSummary>
  reject(extensionId: string, revisionId: string): Promise<ManagedExtensionSummary>
  rollback(extensionId: string): Promise<ManagedExtensionSummary>
  markUsed(extensionId: string): Promise<void>
  surface(
    extensionId: string,
    target?: "active" | "candidate",
    surfaceName?: "main" | "settings",
  ): Promise<ManagedExtensionSurfaceDocument | null>
  resolveAsset(extensionId: string, revisionId: string, relativePath: string): Promise<string | null>
  revisionDeployment(extensionId: string, revisionId: string): Promise<{
    revision: ManagedExtensionRevision
    bundlePath: string
  } | null>
  onChanged(listener: ManagedExtensionChangeListener): () => void
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
  return slug.slice(0, 36) || "extension"
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
  previous: ManagedExtensionRevision | null,
  manifest: ManagedExtensionManifest,
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

function declaredToolPermissions(snapshot: ManagedExtensionCapabilitySnapshot): string[] {
  return [...new Set(snapshot.tools.flatMap((tool) => {
    const value = tool._meta?.["com.amiba/permissions"]
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
  }))]
}

function validateMentionTools(
  manifest: ManagedExtensionManifest,
  snapshot: ManagedExtensionCapabilitySnapshot,
): void {
  for (const mention of manifest.mentions ?? []) {
    if (!mention.searchTool) continue
    const name = mention.searchTool.includes("/")
      ? mention.searchTool
      : `${mention.provider}/${mention.searchTool}`
    const tool = snapshot.tools.find((candidate) => candidate.name === name) as
      | (ManagedExtensionCapabilitySnapshot["tools"][number] & {
          annotations?: { readOnlyHint?: boolean }
        })
      | undefined
    if (!tool) throw new Error(`mention ${mention.id} search Tool was not discovered: ${name}`)
    if (tool.annotations?.readOnlyHint !== true) {
      throw new Error(`mention ${mention.id} search Tool must declare readOnlyHint`)
    }
  }
}

function scaffoldManifest(id: string, request: ManagedExtensionCreateRequest): ManagedExtensionManifest {
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
<body><main><h1>${escaped}</h1><p>AI 正在完成这个扩展。完成后这里会显示可使用的界面。</p></main></body>
</html>
`
}

function agentInstructions(opts: {
  extensionId: string
  extensionName: string
  draftId: string
  workspacePath: string
  request: string
  existing: boolean
}): string {
  return [
    `你正在${opts.existing ? "改进" : "创建"} Amiba 扩展「${opts.extensionName}」。`,
    `用户需求：${opts.request}`,
    "",
    `当前工作区 ${opts.workspacePath} 是该扩展的隔离草稿。直接检查并修改其中的源码、测试与 manifest.json。`,
    "必须遵守：",
    `1. manifest.json 的 id 保持为 ${opts.extensionId}，schemaVersion 保持为 1。`,
    "2. 根据用户需求选择贡献能力：需要可视交互时使用 React + TypeScript 与官方 MCP Apps SDK，并在 surfaces 中声明界面；仅需 @提及、MCP Tool、Resource 或 Hermes Plugin 时可以无界面。不要依赖 window.amiba 私有业务 API。",
    "3. Agent 或无界面使用需要复用的业务操作，应实现成标准 MCP Tool；纯界面局部状态可以留在 View。Tool Schema 只在 MCP Server 中定义。需要 Hermes Plugin 时在 hermesPlugins 中声明依赖。",
    "4. 运行 Bundle 必须自包含，不得在运行时安装依赖。把测试和构建命令以参数数组写入 manifest.build，并提交依赖锁文件。",
    "5. 需要网络、文件、设备、外链或主动向 AI 发消息时，在 manifest.permissions 中最小化声明；不要把密钥写入源码、Manifest、日志或 Bundle。",
    "6. 不要改写 .git，不要删除 .amiba 目录，不要直接操作 Amiba 注册表或版本状态。",
    "7. 完成前运行项目中声明的测试或合理的本地验证。",
    "8. 在提交结果前，必须调用 amiba_preview_extension_draft 构建草稿并用 Amiba 内建浏览器打开预览。调用参数固定为：",
    `   {"extension_id":"${opts.extensionId}","draft_id":"${opts.draftId}","surface":"main","run_tests":true}`,
    "9. 预览打开后，使用 amiba_browser_snapshot、amiba_browser_screenshot 和 amiba_browser_console 检查真实页面；再使用 amiba_browser_click、amiba_browser_type、amiba_browser_press、amiba_browser_scroll 验证关键交互。发现问题就修改源码并重复第 8-9 步。",
    "10. 只有在页面符合需求、关键交互可用且控制台没有未处理错误后，才能写入结果文件。若扩展没有可视 surface，预览工具会返回能力发现结果，此时以测试和 MCP 能力验证为准。",
    "",
    "完成时必须写入 .amiba/result.json：",
    '{"status":"ready","summary":"面向用户的一句话修改摘要"}',
    "如果无法完成，写入：",
    '{"status":"failed","error":"面向用户的失败原因"}',
    "写入该文件表示把候选版本交给 Amiba 构建、验证并安全应用。",
  ].join("\n")
}

export function createManagedExtensionService(options: ManagedExtensionServiceOptions): ManagedExtensionService {
  const root = resolve(options.root)
  const listeners = new Set<ManagedExtensionChangeListener>()
  const processing = new Set<string>()
  const createOperations = new Map<string, Promise<ManagedExtensionCreateResult>>()
  let watcher: FSWatcher | null = null

  function emit(extensionId: string | null): void {
    for (const listener of listeners) listener(extensionId)
  }

  async function loadState(extensionId: string): Promise<ManagedExtensionState> {
    assertId(extensionId, "extension id")
    const state = await readJson<ManagedExtensionState>(statePath(root, extensionId))
    if (!state) throw new Error(`managed Extension not found: ${extensionId}`)
    return state
  }

  async function saveState(state: ManagedExtensionState): Promise<void> {
    state.updatedAt = now()
    await writeJsonAtomic(statePath(root, state.id), state)
    emit(state.id)
  }

  async function loadDraft(extensionId: string, id: string): Promise<ManagedExtensionDraft> {
    assertId(id, "draft id")
    const draft = await readJson<ManagedExtensionDraft>(draftPath(root, extensionId, id))
    if (!draft) throw new Error(`draft not found: ${id}`)
    return draft
  }

  async function saveDraft(draft: ManagedExtensionDraft): Promise<void> {
    draft.updatedAt = now()
    await writeJsonAtomic(draftPath(root, draft.extensionId, draft.id), draft)
  }

  async function loadRevision(extensionId: string, id?: string): Promise<ManagedExtensionRevision | null> {
    if (!id) return null
    assertId(id, "revision id")
    return readJson<ManagedExtensionRevision>(revisionPath(root, extensionId, id))
  }

  async function summarize(state: ManagedExtensionState): Promise<ManagedExtensionSummary> {
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

  async function createDraft(
    state: ManagedExtensionState,
    request: string,
    operationId?: string,
  ): Promise<ManagedExtensionDraft> {
    if (state.pendingDraftId) {
      const existing = await loadDraft(state.id, state.pendingDraftId).catch(() => null)
      if (existing && existing.status !== "failed" && existing.status !== "discarded") {
        throw new Error("这个扩展已经在改进中")
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
    const workspacePath = join(extensionRoot(root, state.id), "worktrees", id)
    const baseRevision = await loadRevision(state.id, state.activeRevisionId)
    const baseCommit = baseRevision?.sourceCommit ?? (await currentCommit(state.projectPath))
    const { branch } = await createDraftWorktree({
      projectPath: state.projectPath,
      workspacePath,
      draftId: id,
      baseCommit,
    })
    await mkdir(join(workspacePath, ".amiba"), { recursive: true })
    const draft: ManagedExtensionDraft = {
      id,
      extensionId: state.id,
      baseRevisionId: state.activeRevisionId,
      workspacePath,
      branch,
      userRequest: request.trim(),
      operationId,
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

  async function cleanupBrokenDraft(state: ManagedExtensionState, id: string): Promise<void> {
    await removeDraftWorktree({
      projectPath: state.projectPath,
      workspacePath: join(extensionRoot(root, state.id), "worktrees", id),
      branch: `amiba/drafts/${id}`,
    })
  }

  async function abortDraft(
    extensionId: string,
    id: string,
    reason = "本次 AI 任务已取消",
  ): Promise<ManagedExtensionSummary | null> {
    const state = await loadState(extensionId)
    if (state.pendingDraftId !== id) throw new Error("这个草稿已不再是当前操作")
    const draft = await loadDraft(extensionId, id).catch(() => null)
    if (draft?.candidateRevisionId) {
      await options.hooks?.discardCandidate?.(extensionId, draft.candidateRevisionId).catch(() => {})
    }
    if (draft) {
      await removeDraftWorktree({
        projectPath: state.projectPath,
        workspacePath: draft.workspacePath,
        branch: draft.branch,
      })
      draft.status = "discarded"
      draft.error = reason
      await saveDraft(draft)
    } else {
      await cleanupBrokenDraft(state, id)
    }
    if (!state.activeRevisionId) {
      await options.hooks?.deactivate?.(extensionId).catch(() => {})
      await rm(extensionRoot(root, extensionId), { recursive: true, force: true })
      emit(extensionId)
      return null
    }
    state.pendingDraftId = undefined
    state.userStatus = "ready"
    state.lastError = undefined
    await saveState(state)
    return summarize(state)
  }

  async function reconcileInterruptedState(state: ManagedExtensionState): Promise<void> {
    const id = state.pendingDraftId
    if (!id) {
      if (state.userStatus === "creating") {
        state.userStatus = "unavailable"
        state.lastError = "上次创建未能生成完整草稿，可重试或删除这个扩展"
        await saveState(state)
      } else if (state.userStatus === "improving" && state.activeRevisionId) {
        state.userStatus = "ready"
        state.lastError = "上次改进未能生成完整草稿，当前可用版本未受影响"
        await saveState(state)
      }
      return
    }
    const draft = await loadDraft(state.id, id).catch(() => null)
    if (!draft) {
      await cleanupBrokenDraft(state, id)
      state.pendingDraftId = undefined
      state.userStatus = state.activeRevisionId ? "ready" : "unavailable"
      state.lastError = "上次 AI 操作的数据不完整，Amiba 已清理残留草稿"
      await saveState(state)
      return
    }
    if (draft.status === "applied" || draft.status === "discarded") {
      state.pendingDraftId = undefined
      state.userStatus = state.activeRevisionId ? "ready" : "unavailable"
      await saveState(state)
      return
    }
    if (draft.status === "failed" || draft.status === "preview-ready") return
    const resultPath = join(draft.workspacePath, AGENT_RESULT_PATH)
    if (existsSync(resultPath)) {
      await buildDraft(state.id, id)
      return
    }
    const message = "上次 AI 操作因 Amiba 退出而中断，可重试或删除这个扩展"
    draft.status = "failed"
    draft.error = message
    await saveDraft(draft)
    state.userStatus = state.activeRevisionId ? "update-failed" : "unavailable"
    state.lastError = message
    await saveState(state)
  }

  function normalizedOperationId(value?: string): string | undefined {
    const operationId = value?.trim()
    if (!operationId) return undefined
    if (operationId.length > 200) throw new Error("operationId 不能超过 200 个字符")
    return operationId
  }

  async function findCreationByOperationId(
    operationId: string,
  ): Promise<{ state: ManagedExtensionState; draft: ManagedExtensionDraft } | null> {
    for (const extensionId of await listDirectories(root)) {
      const state = await loadState(extensionId).catch(() => null)
      if (!state || state.creationOperationId !== operationId) continue
      const initialDraftId = state.initialDraftId ?? state.pendingDraftId
      const draft = initialDraftId
        ? await loadDraft(state.id, initialDraftId).catch(() => null)
        : null
      if (!draft && !state.activeRevisionId) {
        await rm(extensionRoot(root, state.id), { recursive: true, force: true })
        emit(state.id)
        return null
      }
      if (!draft) throw new Error("相同 operationId 的历史创建记录不完整")
      return { state, draft }
    }
    return null
  }

  function createResult(
    state: ManagedExtensionState,
    draft: ManagedExtensionDraft,
  ): Promise<ManagedExtensionCreateResult> {
    return summarize(state).then((extension) => ({
      extension,
      draft,
      agentPrompt: agentInstructions({
        extensionId: state.id,
        extensionName: state.name,
        draftId: draft.id,
        workspacePath: draft.workspacePath,
        request: draft.userRequest,
        existing: false,
      }),
    }))
  }

  async function performCreate(request: ManagedExtensionCreateRequest): Promise<ManagedExtensionCreateResult> {
    const name = request.name.trim()
    const userRequest = request.request.trim()
    const operationId = normalizedOperationId(request.operationId)
    if (!name) throw new Error("扩展名称不能为空")
    if (!userRequest) throw new Error("请描述这个扩展需要做什么")
    if (operationId) {
      const previous = await findCreationByOperationId(operationId)
      if (previous) {
        if (previous.state.name !== name || previous.draft.userRequest !== userRequest) {
          throw new Error("operationId 已用于另一个扩展创建请求")
        }
        return createResult(previous.state, previous.draft)
      }
    }

    const id = createAppId(name)
    const rootPath = extensionRoot(root, id)
    const projectPath = join(rootPath, "project")
    try {
      await mkdir(join(projectPath, "ui"), { recursive: true })
      await writeFile(
        join(projectPath, "manifest.json"),
        `${JSON.stringify(scaffoldManifest(id, request), null, 2)}\n`,
        "utf8",
      )
      await writeFile(
        join(projectPath, "manifest.schema.json"),
        `${JSON.stringify(MANAGED_EXTENSION_MANIFEST_SCHEMA, null, 2)}\n`,
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
      const state: ManagedExtensionState = {
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
        creationOperationId: operationId,
        revisionIds: [],
        userStatus: "creating",
        createdAt,
        updatedAt: createdAt,
      }
      const draft = await createDraft(state, userRequest, operationId)
      state.initialDraftId = draft.id
      await saveState(state)
      return createResult(state, draft)
    } catch (error) {
      await rm(rootPath, { recursive: true, force: true }).catch((cleanupError) => {
        console.error(`[managed-extensions] failed to roll back ${id}:`, cleanupError)
      })
      emit(id)
      throw error
    }
  }

  async function validateSurfaceEntries(
    workspacePath: string,
    manifest: ManagedExtensionManifest,
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
    extensionId: string,
    id: string,
    relativePath: string,
  ): Promise<string | null> {
    const revision = await loadRevision(extensionId, id)
    if (!revision) return null
    const rootPath = resolve(bundlePath(root, extensionId, revision.bundleHash))
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
    state: ManagedExtensionState,
    draft: ManagedExtensionDraft,
    revision: ManagedExtensionRevision,
  ): Promise<ManagedExtensionSummary> {
    const previous = await loadRevision(state.id, state.activeRevisionId)
    revision.status = "activating"
    await writeJsonAtomic(revisionPath(root, state.id, revision.id), revision)
    try {
      await options.hooks?.activate?.({
        extensionId: state.id,
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
            extensionId: state.id,
            revision: previous,
            bundlePath: bundlePath(root, state.id, previous.bundleHash),
          })
        } else {
          await options.hooks?.deactivate?.(state.id)
        }
      } catch (rollbackError) {
        console.error("[managed-extensions] failed to restore runtime after activation error:", rollbackError)
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

  async function prepareDraftPreview(
    extensionId: string,
    id: string,
    previewOptions: { surfaceName?: "main" | "settings"; runTests?: boolean } = {},
  ): Promise<ManagedExtensionDraftPreview> {
    const state = await loadState(extensionId)
    if (state.pendingDraftId !== id) throw new Error("这个草稿已不再是当前操作")
    const draft = await loadDraft(extensionId, id)
    if (draft.status === "applied" || draft.status === "discarded") {
      throw new Error("这个草稿已经结束，无法预览")
    }

    let manifest = await readManagedExtensionManifest(draft.workspacePath)
    if (manifest.id !== state.id) throw new Error("manifest id cannot change")
    if (previewOptions.runTests !== false) {
      await runCommands(
        manifest.build?.testCommands ?? [],
        draft.workspacePath,
        manifest.permissions ?? [],
      )
    }
    await runCommands(
      manifest.build?.commands ?? [],
      draft.workspacePath,
      manifest.permissions ?? [],
    )
    manifest = await readManagedExtensionManifest(draft.workspacePath)
    if (manifest.id !== state.id) throw new Error("manifest id cannot change")
    await validateSurfaceEntries(draft.workspacePath, manifest)

    const capabilities = options.hooks?.discover
      ? await options.hooks.discover({
          extensionId,
          projectPath: draft.workspacePath,
          manifest,
        })
      : { tools: [], resources: [], resourceTemplates: [], prompts: [] }
    validateMentionTools(manifest, capabilities)
    const manifestPermissions = new Set(manifest.permissions ?? [])
    const missingPermissions = declaredToolPermissions(capabilities).filter(
      (permission) => !manifestPermissions.has(permission),
    )
    if (missingPermissions.length) {
      throw new Error(
        `MCP Tools require undeclared permissions: ${missingPermissions.join(", ")}`,
      )
    }

    const surfaceName = previewOptions.surfaceName ?? "main"
    return {
      extensionId,
      draftId: id,
      workspacePath: draft.workspacePath,
      surfaceName,
      entry: manifest.surfaces?.[surfaceName]?.entry,
      manifest,
      capabilities,
    }
  }

  async function buildDraft(extensionId: string, id: string): Promise<ManagedExtensionSummary> {
    const key = `${extensionId}:${id}`
    if (processing.has(key)) return summarize(await loadState(extensionId))
    processing.add(key)
    try {
      const state = await loadState(extensionId)
      const draft = await loadDraft(extensionId, id)
      if (draft.status === "applied" || draft.status === "discarded") return summarize(state)
      const result = await readJson<ManagedExtensionAgentResultFile>(
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
        let manifest = await readManagedExtensionManifest(draft.workspacePath)
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
        manifest = await readManagedExtensionManifest(draft.workspacePath)
        await validateSurfaceEntries(draft.workspacePath, manifest)

        const capabilitySnapshot = options.hooks?.discover
          ? await options.hooks.discover({
              extensionId,
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
        const destination = bundlePath(root, extensionId, hash)
        await copyBundle(draft.workspacePath, destination)

        const previous = await loadRevision(extensionId, state.activeRevisionId)
        const sensitive = hasSensitiveChange(previous, manifest)
        const revision: ManagedExtensionRevision = {
          id,
          extensionId: extensionId,
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
          extensionId,
          revision,
          bundlePath: destination,
        })
        draft.candidateRevisionId = revision.id
        draft.status = "preview-ready"
        await saveDraft(draft)
        if (!state.revisionIds.includes(revision.id)) state.revisionIds.push(revision.id)
        if (sensitive) {
          revision.status = "awaiting-confirmation"
          await writeJsonAtomic(revisionPath(root, extensionId, revision.id), revision)
          state.userStatus = "needs-confirmation"
          await saveState(state)
          return summarize(state)
        }
        await writeJsonAtomic(revisionPath(root, extensionId, revision.id), revision)
        return applyRevision(state, draft, revision)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attemptedRevisionId) {
          await options.hooks?.discardCandidate?.(extensionId, attemptedRevisionId).catch(() => {})
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
    const extensionId = basename(appPath)
    const rest = normalized.slice(markerIndex + marker.length).split(sep)
    const id = rest[0]
    if (!id || rest.slice(1).join(sep) !== AGENT_RESULT_PATH) return
    await buildDraft(extensionId, id).catch((error) => {
      console.error(`[managed-extensions] failed to process ${extensionId}/${id}:`, error)
    })
  }

  return {
    async init() {
      await mkdir(root, { recursive: true })
      const states = await Promise.all(
        (await listDirectories(root)).map((id) => loadState(id).catch(() => null)),
      )
      for (const state of states) {
        if (!state || state.archived) continue
        await reconcileInterruptedState(state).catch((error) => {
          console.error(`[managed-extensions] failed to reconcile ${state.id}:`, error)
        })
        if (!state.activeRevisionId) continue
        const revision = await loadRevision(state.id, state.activeRevisionId)
        if (!revision) continue
        try {
          await options.hooks?.activate?.({
            extensionId: state.id,
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
        .filter((summary): summary is ManagedExtensionSummary => summary !== null)
        .filter((summary) => listOptions.includeArchived || !summary.archived)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))
    },

    async get(extensionId) {
      try {
        return await summarize(await loadState(extensionId))
      } catch {
        return null
      }
    },

    async create(request) {
      const operationId = normalizedOperationId(request.operationId)
      if (!operationId) return performCreate(request)
      const current = createOperations.get(operationId)
      if (current) return current
      const operation = performCreate({ ...request, operationId })
      createOperations.set(operationId, operation)
      try {
        return await operation
      } finally {
        if (createOperations.get(operationId) === operation) createOperations.delete(operationId)
      }
    },

    async requestChange(extensionId, request) {
      const userRequest = request.trim()
      if (!userRequest) throw new Error("请描述需要修改的地方")
      const state = await loadState(extensionId)
      if (state.archived) throw new Error("这个扩展已被删除，请先恢复")
      const draft = await createDraft(state, userRequest)
      return {
        draft,
        agentPrompt: agentInstructions({
          extensionId,
          extensionName: state.name,
          draftId: draft.id,
          workspacePath: draft.workspacePath,
          request: userRequest,
          existing: true,
        }),
      }
    },

    prepareDraftPreview,

    abortDraft,

    async attachSession(extensionId, id, sessionId) {
      const value = sessionId.trim()
      if (!value) return
      const draft = await loadDraft(extensionId, id)
      draft.sourceSessionId = value
      await saveDraft(draft)
      const state = await loadState(extensionId)
      state.sourceSessionIds = [...new Set([...(state.sourceSessionIds ?? []), value])]
      await saveState(state)
    },

    async updateMetadata(extensionId, patch: ManagedExtensionMetadataPatch) {
      const state = await loadState(extensionId)
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

    async archive(extensionId) {
      const state = await loadState(extensionId)
      if (state.pendingDraftId) {
        const draft = await loadDraft(extensionId, state.pendingDraftId).catch(() => null)
        if (draft) {
          if (draft.candidateRevisionId) {
            await options.hooks?.discardCandidate?.(extensionId, draft.candidateRevisionId)
          }
          draft.status = "discarded"
          await saveDraft(draft)
          await removeDraftWorktree({
            projectPath: state.projectPath,
            workspacePath: draft.workspacePath,
            branch: draft.branch,
          })
        } else {
          await cleanupBrokenDraft(state, state.pendingDraftId)
        }
        state.pendingDraftId = undefined
      }
      await options.hooks?.deactivate?.(extensionId)
      state.archived = true
      state.deletedAt = now()
      await saveState(state)
      return summarize(state)
    },

    async restore(extensionId) {
      const state = await loadState(extensionId)
      const revision = await loadRevision(extensionId, state.activeRevisionId)
      if (revision) {
        await options.hooks?.activate?.({
          extensionId,
          revision,
          bundlePath: bundlePath(root, extensionId, revision.bundleHash),
        })
      }
      state.archived = false
      state.deletedAt = undefined
      state.userStatus = revision ? "ready" : "unavailable"
      await saveState(state)
      return summarize(state)
    },

    async exportProject(extensionId, destinationRoot) {
      const state = await loadState(extensionId)
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

    async listOutputs(extensionId) {
      await loadState(extensionId)
      const directory = join(extensionRoot(root, extensionId), "outputs")
      const records = await Promise.all(
        (await listJsonFiles(directory)).map((name) =>
          readJson<ManagedExtensionOutputRecord>(join(directory, name)),
        ),
      )
      return records
        .filter((record): record is ManagedExtensionOutputRecord => !!record)
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt.localeCompare(left.createdAt))
    },

    async recordOutputs(extensionId, inputs) {
      if (!inputs.length) return
      const state = await loadState(extensionId)
      const directory = join(extensionRoot(root, extensionId), "outputs")
      const existing = new Set(
        (await Promise.all(
          (await listJsonFiles(directory)).map((name) =>
            readJson<ManagedExtensionOutputRecord>(join(directory, name)),
          ),
        ))
          .filter((record): record is ManagedExtensionOutputRecord => !!record)
          .map((record) => `${record.revisionId}\0${record.toolName ?? ""}\0${record.uri}`),
      )
      for (const input of inputs.slice(0, 100)) {
        if (!state.revisionIds.includes(input.revisionId) || !input.uri?.trim()) continue
        const key = `${input.revisionId}\0${input.toolName ?? ""}\0${input.uri}`
        if (existing.has(key)) continue
        const id = recordId("output")
        const record: ManagedExtensionOutputRecord = {
          id,
          extensionId: extensionId,
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
        await writeJsonAtomic(outputPath(root, extensionId, id), record)
        existing.add(key)
      }
      emit(extensionId)
    },

    async updateOutput(extensionId, outputId, patch) {
      await loadState(extensionId)
      assertId(outputId, "output id")
      const path = outputPath(root, extensionId, outputId)
      const record = await readJson<ManagedExtensionOutputRecord>(path)
      if (!record) throw new Error("output not found")
      if (patch.pinned !== undefined) record.pinned = patch.pinned
      if (patch.tags) {
        record.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20)
      }
      await writeJsonAtomic(path, record)
      emit(extensionId)
      return record
    },

    async listPresets(extensionId) {
      await loadState(extensionId)
      const directory = join(extensionRoot(root, extensionId), "presets")
      const records = await Promise.all(
        (await listJsonFiles(directory)).map((name) =>
          readJson<ManagedExtensionToolPreset>(join(directory, name)),
        ),
      )
      return records
        .filter((record): record is ManagedExtensionToolPreset => !!record)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    },

    async savePreset(extensionId, input) {
      const state = await loadState(extensionId)
      if (!state.revisionIds.includes(input.revisionId)) throw new Error("preset revision is unavailable")
      if (!input.name.trim()) throw new Error("preset name is required")
      const id = recordId("preset")
      const timestamp = now()
      const preset: ManagedExtensionToolPreset = {
        id,
        extensionId: extensionId,
        revisionId: input.revisionId,
        providerAlias: input.providerAlias,
        toolName: input.toolName,
        name: input.name.trim(),
        arguments: input.arguments,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      await writeJsonAtomic(presetPath(root, extensionId, id), preset)
      emit(extensionId)
      return preset
    },

    async deletePreset(extensionId, presetId) {
      await loadState(extensionId)
      assertId(presetId, "preset id")
      await rm(presetPath(root, extensionId, presetId), { force: true })
      emit(extensionId)
    },

    buildDraft,

    async confirm(extensionId, id) {
      const state = await loadState(extensionId)
      if (!state.pendingDraftId) throw new Error("没有待确认的修改")
      const draft = await loadDraft(extensionId, state.pendingDraftId)
      if (draft.candidateRevisionId !== id) throw new Error("待确认版本已经变化")
      const revision = await loadRevision(extensionId, id)
      if (!revision || revision.status !== "awaiting-confirmation") {
        throw new Error("这个修改不再等待确认")
      }
      return applyRevision(state, draft, revision)
    },

    async reject(extensionId, id) {
      const state = await loadState(extensionId)
      if (!state.pendingDraftId) throw new Error("没有待处理的修改")
      const draft = await loadDraft(extensionId, state.pendingDraftId)
      const revision = await loadRevision(extensionId, id)
      if (revision) {
        await options.hooks?.discardCandidate?.(extensionId, revision.id)
        revision.status = "rolled-back"
        await writeJsonAtomic(revisionPath(root, extensionId, revision.id), revision)
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

    async rollback(extensionId) {
      const state = await loadState(extensionId)
      const current = await loadRevision(extensionId, state.activeRevisionId)
      const target = await loadRevision(extensionId, current?.parentRevisionId)
      if (!current || !target) throw new Error("没有可以撤销的上一次修改")
      await options.hooks?.activate?.({
        extensionId,
        revision: target,
        previous: current,
        bundlePath: bundlePath(root, extensionId, target.bundleHash),
      })
      current.status = "rolled-back"
      await writeJsonAtomic(revisionPath(root, extensionId, current.id), current)
      target.status = "healthy"
      target.activatedAt = now()
      await writeJsonAtomic(revisionPath(root, extensionId, target.id), target)
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

    async markUsed(extensionId) {
      const state = await loadState(extensionId)
      if (state.archived) return
      state.lastUsedAt = now()
      await saveState(state)
    },

    async surface(extensionId, target = "active", surfaceName = "main") {
      const state = await loadState(extensionId)
      if (state.archived) return null
      let revision = await loadRevision(extensionId, state.activeRevisionId)
      if (target === "candidate" && state.pendingDraftId) {
        const draft = await loadDraft(extensionId, state.pendingDraftId)
        revision = await loadRevision(extensionId, draft.candidateRevisionId)
      }
      const surface = revision?.manifest.surfaces?.[surfaceName]
      if (!revision || !surface) return null
      if (!surface.entry) {
        return {
          extensionId,
          revisionId: revision.id,
          resourceUri: surface.resourceUri,
          mimeType: "text/html;profile=mcp-app",
          metadata: { provider: surface.provider, surfaceName },
        }
      }
      const path = await resolveRevisionAsset(extensionId, revision.id, surface.entry)
      if (!path) return null
      return {
        extensionId,
        revisionId: revision.id,
        resourceUri: surface.resourceUri,
        mimeType: "text/html;profile=mcp-app",
        html: await readFile(path, "utf8"),
        metadata: { entry: surface.entry, surfaceName },
      }
    },

    async resolveAsset(extensionId, id, relativePath) {
      return resolveRevisionAsset(extensionId, id, relativePath)
    },

    async revisionDeployment(extensionId, id) {
      const state = await loadState(extensionId)
      if (state.archived || !state.revisionIds.includes(id)) return null
      const revision = await loadRevision(extensionId, id)
      return revision
        ? { revision, bundlePath: bundlePath(root, extensionId, revision.bundleHash) }
        : null
    },

    onChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
