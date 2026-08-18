import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-agent";
import {
  isSkillName,
  type SkillDefinition,
  type SkillResourceBase,
  type SkillSummary,
  type SkillViewOptions,
} from "@deepseek-ai/dsh-skill";

const MAX_RESOURCE_FILES = 500;
const MAX_RESOURCE_DEPTH = 12;
const MAX_PREVIEW_BYTES = 1024 * 1024;

interface ObservedFsTarget {
  targetKey: string;
  displayPath: string;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    fs: {
      resolve(path: string): Promise<ObservedFsTarget>;
      stat(target: ObservedFsTarget): Promise<
        | { type: string; size?: number; version: string }
        | undefined
      >;
    };
    agentPresets: {
      standingKeyFor(
        id?: string,
      ): Promise<NonNullable<SkillViewOptions["scope"]>>;
    };
    sessionPersistence: {
      inspect(id: Parameters<Context["agents"]["get"]>[0]): Promise<{
        meta: { cwd?: string; agentPreset?: string };
        events: readonly unknown[];
      }>;
    };
  }

  interface Events {
    "fs/observed"(
      target: ObservedFsTarget,
      observation:
        | { kind: "present"; version: string }
        | { kind: "absent" },
      actor: object | undefined,
    ): void;
  }
}

function sessionPresetOf(session: {
  header: { agentPreset?: string };
  events: readonly unknown[];
}): string | undefined {
  let preset = session.header.agentPreset;
  for (const event of session.events) {
    if (!event || typeof event !== "object") continue;
    const candidate = event as {
      type?: unknown;
      data?: { agentPreset?: unknown };
    };
    if (
      candidate.type === "agent-preset/selected" &&
      typeof candidate.data?.agentPreset === "string"
    ) {
      preset = candidate.data.agentPreset;
    }
  }
  return preset;
}

export interface AmibaSkillEntry {
  name: string;
  description: string;
  whenToUse?: string;
  modelInvocable: boolean;
  userInvocable: boolean;
  source: string;
  provider: string;
  resourceBase?: SkillResourceBase;
  editable: boolean;
}

export interface AmibaSkillSnapshot {
  skills: AmibaSkillEntry[];
  userRoot: string;
}

export interface AmibaSkillDocument {
  name: string;
  document: string;
  editable: boolean;
  source: string;
  provider: string;
  resourceBase?: SkillResourceBase;
}

export interface AmibaSkillFileList {
  root: string;
  files: Array<{ path: string; size: number }>;
  truncated: boolean;
}

export interface AmibaSkillFileContent {
  path: string;
  size: number;
  encoding: "utf-8" | "binary" | "too-large";
  content?: string;
}

function validatedName(raw: string): string {
  const value = raw.trim();
  if (!isSkillName(value)) {
    throw new Error("Skill names must use lowercase kebab-case.");
  }
  return value;
}

function validateDocument(name: string, document: string): string {
  const normalized = document.replace(/\r\n?/gu, "\n").trim();
  if (!normalized.startsWith("---\n") || !normalized.includes("\n---\n")) {
    throw new Error("A DSH skill must contain YAML frontmatter.");
  }
  const frontmatter = normalized.slice(4, normalized.indexOf("\n---\n"));
  const declared = /^name:\s*["']?([^"'\n]+)["']?\s*$/mu.exec(frontmatter)?.[1]?.trim();
  if (declared !== name) {
    throw new Error(`Skill frontmatter name must be ${JSON.stringify(name)}.`);
  }
  if (!/^description:\s*.+$/mu.test(frontmatter)) {
    throw new Error("Skill frontmatter requires a description.");
  }
  return `${normalized}\n`;
}

function renderDocument(skill: SkillDefinition): string {
  const frontmatter = [
    "---",
    `name: ${JSON.stringify(skill.name)}`,
    `description: ${JSON.stringify(skill.description)}`,
    ...(skill.whenToUse
      ? [`when-to-use: ${JSON.stringify(skill.whenToUse)}`]
      : []),
    `user-invocable: ${skill.invocation.userInvocable}`,
    `disable-model-invocation: ${!skill.invocation.modelInvocable}`,
    "---",
  ];
  return `${frontmatter.join("\n")}\n\n${skill.content.trim()}\n`;
}

function safeRelativePath(raw: string): string {
  const normalized = raw.replaceAll("\\", "/").trim();
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.includes("\0") ||
    isAbsolute(normalized) ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Skill resource paths must be safe relative paths.");
  }
  return parts.join("/");
}

function isWithin(root: string, candidate: string): boolean {
  const offset = relative(root, candidate);
  return offset === "" || (!offset.startsWith(`..${sep}`) && offset !== ".." && !isAbsolute(offset));
}

/**
 * The authoring face for the official DSH skill registry.
 *
 * Discovery always comes from ctx.skills. This class only owns mutations in
 * the configured user root; dsh-skill-filesystem watches that same root and
 * invalidates the official catalog after writes.
 */
export class AmibaSkillStore {
  constructor(
    private readonly ctx: Context,
    readonly userRoot: string,
  ) {}

  private documentPath(name: string): string {
    return join(this.userRoot, validatedName(name), "SKILL.md");
  }

  private async view(
    requestedSessionId: string | null,
  ): Promise<SkillViewOptions> {
    if (!requestedSessionId) return {};
    const sessionId = requestedSessionId as Parameters<
      Context["agents"]["get"]
    >[0];

    const agent = this.ctx.agents.get(sessionId);
    if (agent) {
      const cwd = agent.session.header.cwd;
      return {
        scope: agent,
        ...(cwd ? { cwd } : {}),
      };
    }

    // A settings page often addresses the latest durable session while its
    // Agent is cold. DSH presets expose a standing scope precisely for this
    // kind of read: it composes the preset's providers without resuming an
    // Agent, starting a turn, or transferring ownership to the desktop host.
    const attached = this.ctx.sessions.get(sessionId);
    const persisted = attached
      ? undefined
      : await this.ctx.get("sessionPersistence")?.inspect(sessionId);
    const session = attached ??
      (persisted
        ? { header: persisted.meta, events: persisted.events }
        : undefined);
    if (!session) {
      throw new Error(`DSH session ${JSON.stringify(requestedSessionId)} was not found.`);
    }

    const cwd = session.header.cwd;
    const presets = this.ctx.get("agentPresets");
    const scope = presets
      ? await presets.standingKeyFor(sessionPresetOf(session))
      : undefined;
    return {
      ...(scope ? { scope } : {}),
      ...(cwd ? { cwd } : {}),
    };
  }

  private async get(
    name: string,
    requestedSessionId: string | null,
  ): Promise<SkillDefinition> {
    const normalized = validatedName(name);
    const skill = await this.ctx.skills.get(
      normalized,
      await this.view(requestedSessionId),
    );
    if (!skill) throw new Error(`DSH skill ${JSON.stringify(normalized)} was not found.`);
    return skill;
  }

  private editable(skill: SkillSummary): boolean {
    return (
      skill.source === "user-dsh" &&
      skill.resourceBase?.kind === "directory" &&
      resolve(skill.resourceBase.path) === resolve(this.userRoot, skill.name)
    );
  }

  private async waitForUserCatalog(
    name: string,
    requestedSessionId: string | null,
  ): Promise<void> {
    if (!requestedSessionId) return;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const skill = await this.ctx.skills.get(
        name,
        await this.view(requestedSessionId),
      );
      if (skill && this.editable(skill)) return;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
    }
  }

  private async present(path: string): Promise<void> {
    const target = await this.ctx.fs.resolve(path);
    const info = await this.ctx.fs.stat(target);
    if (!info) throw new Error(`Saved skill document ${JSON.stringify(path)} was not observable.`);
    this.ctx.root.emit(
      "fs/observed",
      { ...target, displayPath: path },
      { kind: "present", version: info.version },
      { name: "write" },
    );
  }

  private absent(target: ObservedFsTarget, displayPath: string): void {
    this.ctx.root.emit(
      "fs/observed",
      { ...target, displayPath },
      { kind: "absent" },
      { name: "write" },
    );
  }

  async list(requestedSessionId: string | null): Promise<AmibaSkillSnapshot> {
    const summaries = await this.ctx.skills.list(
      await this.view(requestedSessionId),
    );
    const skills = summaries.map((skill) => this.project(skill));
    return { skills, userRoot: this.userRoot };
  }

  async read(
    name: string,
    requestedSessionId: string | null = null,
  ): Promise<AmibaSkillDocument> {
    const skill = await this.get(name, requestedSessionId);
    const editable = this.editable(skill);
    return {
      name: skill.name,
      document: editable
        ? await readFile(this.documentPath(skill.name), "utf8")
        : renderDocument(skill),
      editable,
      source: skill.source,
      provider: skill.provider,
      ...(skill.resourceBase ? { resourceBase: skill.resourceBase } : {}),
    };
  }

  async listFiles(
    name: string,
    requestedSessionId: string | null,
  ): Promise<AmibaSkillFileList> {
    const skill = await this.get(name, requestedSessionId);
    if (skill.resourceBase?.kind !== "directory") {
      const document = renderDocument(skill);
      return {
        root:
          skill.resourceBase?.kind === "url"
            ? skill.resourceBase.url
            : skill.resourceBase?.kind === "opaque"
              ? skill.resourceBase.description
              : skill.provider,
        files: [{ path: "SKILL.md", size: Buffer.byteLength(document) }],
        truncated: false,
      };
    }

    const root = await realpath(skill.resourceBase.path);
    const files: Array<{ path: string; size: number }> = [];
    let truncated = false;
    const walk = async (directory: string, prefix: string, depth: number) => {
      if (depth > MAX_RESOURCE_DEPTH) {
        truncated = true;
        return;
      }
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (files.length >= MAX_RESOURCE_FILES) {
          truncated = true;
          return;
        }
        if (entry.isSymbolicLink()) continue;
        const path = join(directory, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(path, relativePath, depth + 1);
        else if (entry.isFile()) files.push({ path: relativePath, size: (await stat(path)).size });
      }
    };
    await walk(root, "", 0);
    return { root, files, truncated };
  }

  async readFile(
    name: string,
    rawPath: string,
    requestedSessionId: string | null,
  ): Promise<AmibaSkillFileContent> {
    const skill = await this.get(name, requestedSessionId);
    const path = safeRelativePath(rawPath);
    if (skill.resourceBase?.kind !== "directory") {
      if (path !== "SKILL.md") throw new Error("This skill provider exposes no file resources.");
      const content = renderDocument(skill);
      return { path, size: Buffer.byteLength(content), encoding: "utf-8", content };
    }

    const root = await realpath(skill.resourceBase.path);
    const lexicalTarget = resolve(root, path);
    if (!isWithin(root, lexicalTarget)) throw new Error("Skill resource path escapes its provider root.");
    let cursor = root;
    for (const part of path.split("/")) {
      cursor = join(cursor, part);
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw new Error("Symbolic links are not readable as skill resources.");
      }
    }
    const target = await realpath(lexicalTarget);
    if (!isWithin(root, target)) throw new Error("Skill resource path escapes its provider root.");
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Skill resource is not a regular file.");
    if (info.size > MAX_PREVIEW_BYTES) {
      return { path, size: info.size, encoding: "too-large" };
    }
    const bytes = await readFile(target);
    if (bytes.includes(0)) return { path, size: info.size, encoding: "binary" };
    return { path, size: info.size, encoding: "utf-8", content: bytes.toString("utf8") };
  }

  async save(
    name: string,
    document: string,
    requestedSessionId: string | null = null,
  ): Promise<{ name: string }> {
    const normalized = validatedName(name);
    const path = this.documentPath(normalized);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, validateDocument(normalized, document), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
    await this.present(path);
    // The filesystem provider invalidates ctx.skills asynchronously. Do not
    // report a completed save while an immediate DSH-native read can still
    // observe the previous catalog revision.
    await this.waitForUserCatalog(normalized, requestedSessionId);
    return { name: normalized };
  }

  async remove(
    name: string,
    _requestedSessionId: string | null = null,
  ): Promise<{ name: string; deleted: boolean }> {
    const normalized = validatedName(name);
    const path = this.documentPath(normalized);
    const target = await this.ctx.fs.resolve(path);
    await rm(dirname(this.documentPath(normalized)), {
      recursive: true,
      force: false,
    });
    this.absent(target, path);
    return { name: normalized, deleted: true };
  }

  private project(skill: SkillSummary): AmibaSkillEntry {
    return {
      name: skill.name,
      description: skill.description,
      ...(skill.whenToUse ? { whenToUse: skill.whenToUse } : {}),
      modelInvocable: skill.invocation.modelInvocable,
      userInvocable: skill.invocation.userInvocable,
      source: skill.source,
      provider: skill.provider,
      ...(skill.resourceBase ? { resourceBase: skill.resourceBase } : {}),
      editable: this.editable(skill),
    };
  }
}
