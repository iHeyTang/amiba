import { randomUUID } from "node:crypto";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";

import { app, BrowserWindow } from "electron";
import type {
  WorkspaceCheckpoint,
  WorkspaceGitFile,
  WorkspaceGitState,
  WorkspaceProject,
  WorkspaceTerminalSnapshot,
  WorkspaceTreeEntry,
  WorkspaceWorktree,
} from "@amiba/platform";

import { mainStore } from "./storage";
import { workspaceManager } from "./workspace";

const execFileAsync = promisify(execFile);
const PROJECTS_KEY = "workspace.projects.v1";
const PROJECT_SESSION_BINDINGS_KEY = "workspace.projectSessionBindings.v1";
const MAX_TERMINAL_BUFFER = 1024 * 1024;
const MAX_TREE_ENTRIES = 4_000;
const MAX_CHECKPOINT_FILE_BYTES = 20 * 1024 * 1024;
const MAX_CHECKPOINT_TOTAL_BYTES = 100 * 1024 * 1024;

const IGNORED_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "target",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "coverage",
  ".venv",
  "__pycache__",
]);
const OUTPUT_DIRECTORIES = new Set([
  "dist",
  "build",
  "out",
  "target",
  "coverage",
  "artifacts",
  "outputs",
  "exports",
  "reports",
]);
const OUTPUT_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".html",
  ".csv",
  ".xlsx",
  ".xls",
  ".docx",
  ".pptx",
  ".zip",
  ".tar",
  ".gz",
  ".mp3",
  ".wav",
  ".m4a",
  ".mp4",
  ".mov",
  ".webm",
  ".jsonl",
]);

interface TerminalRecord {
  sessionId: string;
  cwd: string;
  process: ChildProcessWithoutNullStreams;
  output: string;
  startedAt: number;
  exited: boolean;
  exitCode?: number;
}

interface CheckpointRecord extends WorkspaceCheckpoint {
  repoRoot: string;
  baseHead: string;
  stashCommit?: string;
  stagedPaths: string[];
  untrackedPaths: string[];
}

const terminals = new Map<string, TerminalRecord>();

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function appendTerminal(record: TerminalRecord, chunk: string): void {
  record.output = `${record.output}${chunk}`.slice(-MAX_TERMINAL_BUFFER);
  broadcast("workspace-terminal:data", {
    sessionId: record.sessionId,
    chunk,
    snapshot: terminalSnapshot(record),
  });
}

function terminalSnapshot(record: TerminalRecord): WorkspaceTerminalSnapshot {
  return {
    sessionId: record.sessionId,
    cwd: record.cwd,
    output: record.output,
    running: !record.exited,
    startedAt: record.startedAt,
    exitCode: record.exitCode,
  };
}

async function run(
  command: string,
  args: string[],
  cwd?: string,
  options: { allowFailure?: boolean; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
      env: process.env,
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (cause) {
    const error = cause as Error & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    if (options.allowFailure) {
      return {
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? error.message,
        code: typeof error.code === "number" ? error.code : 1,
      };
    }
    throw new Error((error.stderr || error.message).trim());
  }
}

async function repoRootForSession(sessionId: string): Promise<string> {
  const resolved = await workspaceManager.resolvePathForSession(sessionId, ".");
  const result = await run("git", [
    "-C",
    resolved.path,
    "rev-parse",
    "--show-toplevel",
  ]);
  const root = result.stdout.trim();
  if (!root) throw new Error("The current workspace is not a Git repository.");
  return root;
}

function safeRepoPath(root: string, candidate: string): string {
  const absolute = resolve(root, candidate);
  const rel = relative(root, absolute);
  if (!rel || rel === ".") return ".";
  if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith("/")) {
    throw new Error("The selected path is outside the repository.");
  }
  return rel.split(sep).join("/");
}

function parseStatusLine(line: string): WorkspaceGitFile | null {
  if (line.length < 3) return null;
  const indexStatus = line[0] ?? " ";
  const worktreeStatus = line[1] ?? " ";
  let path = line.slice(3).trim();
  const rename = path.lastIndexOf(" -> ");
  if (rename >= 0) path = path.slice(rename + 4);
  if (path.startsWith('"') && path.endsWith('"')) {
    try {
      path = JSON.parse(path);
    } catch {
      path = path.slice(1, -1);
    }
  }
  return {
    path,
    indexStatus,
    worktreeStatus,
    staged: indexStatus !== " " && indexStatus !== "?",
    untracked: indexStatus === "?" && worktreeStatus === "?",
    conflicted:
      indexStatus === "U" ||
      worktreeStatus === "U" ||
      `${indexStatus}${worktreeStatus}` === "AA" ||
      `${indexStatus}${worktreeStatus}` === "DD",
  };
}

export async function getWorkspaceGitState(
  sessionId: string,
): Promise<WorkspaceGitState> {
  const root = await repoRootForSession(sessionId);
  const [status, branch, upstream, divergence] = await Promise.all([
    run("git", [
      "-c",
      "core.quotepath=false",
      "-C",
      root,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
    run("git", ["-C", root, "branch", "--show-current"], undefined, {
      allowFailure: true,
    }),
    run(
      "git",
      [
        "-C",
        root,
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ],
      undefined,
      { allowFailure: true },
    ),
    run(
      "git",
      ["-C", root, "rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      undefined,
      { allowFailure: true },
    ),
  ]);
  const files = status.stdout
    .split(/\r?\n/)
    .map(parseStatusLine)
    .filter((item): item is WorkspaceGitFile => !!item);
  const [ahead = 0, behind = 0] =
    divergence.code === 0
      ? divergence.stdout
          .trim()
          .split(/\s+/)
          .map((value) => Number(value) || 0)
      : [0, 0];
  return {
    root,
    branch: branch.stdout.trim() || "HEAD",
    upstream: upstream.code === 0 ? upstream.stdout.trim() : undefined,
    ahead,
    behind,
    clean: files.length === 0,
    files,
  };
}

export async function getWorkspaceGitDiff(
  sessionId: string,
  options: { staged?: boolean; paths?: string[] } = {},
): Promise<string> {
  const root = await repoRootForSession(sessionId);
  const args = [
    "-c",
    "core.quotepath=false",
    "-C",
    root,
    "diff",
    "--no-ext-diff",
    "--binary",
  ];
  if (options.staged) args.push("--cached");
  if (options.paths?.length)
    args.push("--", ...options.paths.map((path) => safeRepoPath(root, path)));
  return (await run("git", args, undefined, { maxBuffer: 32 * 1024 * 1024 }))
    .stdout;
}

export async function mutateWorkspaceGit(
  sessionId: string,
  action: "stage" | "unstage" | "commit" | "ship",
  input: { paths?: string[]; message?: string; remote?: string } = {},
): Promise<WorkspaceGitState> {
  const root = await repoRootForSession(sessionId);
  if (action === "stage") {
    const paths = input.paths?.length
      ? input.paths.map((path) => safeRepoPath(root, path))
      : ["."];
    await run("git", ["-C", root, "add", "--", ...paths]);
  } else if (action === "unstage") {
    const paths = input.paths?.length
      ? input.paths.map((path) => safeRepoPath(root, path))
      : ["."];
    const restore = await run(
      "git",
      ["-C", root, "restore", "--staged", "--", ...paths],
      undefined,
      { allowFailure: true },
    );
    if (restore.code !== 0)
      await run("git", ["-C", root, "reset", "HEAD", "--", ...paths]);
  } else if (action === "commit") {
    const message = input.message?.trim();
    if (!message) throw new Error("A commit message is required.");
    await run("git", ["-C", root, "commit", "-m", message]);
  } else {
    const state = await getWorkspaceGitState(sessionId);
    if (!state.branch || state.branch === "HEAD")
      throw new Error("Check out a branch before shipping.");
    const remote = input.remote?.trim() || "origin";
    await run(
      "git",
      ["-C", root, "push", "--set-upstream", remote, state.branch],
      undefined,
      { maxBuffer: 32 * 1024 * 1024 },
    );
  }
  return getWorkspaceGitState(sessionId);
}

export async function listWorkspaceTree(
  sessionId: string,
  candidate = ".",
): Promise<WorkspaceTreeEntry[]> {
  const resolved = await workspaceManager.resolvePathForSession(
    sessionId,
    candidate,
  );
  const directory = await stat(resolved.path);
  if (!directory.isDirectory())
    throw new Error("The selected workspace path is not a directory.");
  const entries = await readdir(resolved.path, { withFileTypes: true });
  const rows = await Promise.all(
    entries
      .filter(
        (entry) => !IGNORED_NAMES.has(entry.name) && entry.name !== ".DS_Store",
      )
      .slice(0, 1_000)
      .map(async (entry): Promise<WorkspaceTreeEntry> => {
        const absolute = join(resolved.path, entry.name);
        let info: Awaited<ReturnType<typeof stat>> | null = null;
        try {
          info = await stat(absolute);
        } catch {
          /* disappearing entry */
        }
        const path = relative(resolved.root, absolute).split(sep).join("/");
        return {
          name: entry.name,
          path,
          isDirectory: entry.isDirectory(),
          isSymlink: entry.isSymbolicLink(),
          size: info?.isFile() ? info.size : undefined,
          modifiedAt: info?.mtimeMs,
        };
      }),
  );
  return rows.sort(
    (left, right) =>
      Number(right.isDirectory) - Number(left.isDirectory) ||
      left.name.localeCompare(right.name),
  );
}

export async function searchWorkspaceTree(
  sessionId: string,
  query: string,
): Promise<WorkspaceTreeEntry[]> {
  const root = await workspaceManager.resolvePathForSession(sessionId, ".");
  const needle = query.trim().toLocaleLowerCase();
  const outputsOnly = needle === "@outputs";
  const queue = [root.path];
  const matches: WorkspaceTreeEntry[] = [];
  let visited = 0;
  while (queue.length && matches.length < 100 && visited < MAX_TREE_ENTRIES) {
    const current = queue.shift()!;
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (visited++ >= MAX_TREE_ENTRIES) break;
      if (
        (IGNORED_NAMES.has(entry.name) &&
          !(outputsOnly && OUTPUT_DIRECTORIES.has(entry.name))) ||
        entry.name === ".DS_Store"
      )
        continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) queue.push(absolute);
      const rel = relative(root.path, absolute).split(sep).join("/");
      if (outputsOnly) {
        if (entry.isDirectory()) continue;
        const outputDir = rel
          .split("/")
          .some((part) => OUTPUT_DIRECTORIES.has(part));
        if (
          !outputDir &&
          !OUTPUT_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())
        )
          continue;
      } else if (needle && !rel.toLocaleLowerCase().includes(needle)) continue;
      let info: Awaited<ReturnType<typeof stat>> | null = null;
      try {
        info = await stat(absolute);
      } catch {
        /* disappearing entry */
      }
      matches.push({
        name: entry.name,
        path: rel,
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
        size: info?.isFile() ? info.size : undefined,
        modifiedAt: info?.mtimeMs,
      });
      if (matches.length >= 100) break;
    }
  }
  return matches;
}

async function readProjects(): Promise<WorkspaceProject[]> {
  const stored = await mainStore.get(PROJECTS_KEY);
  const value = stored[PROJECTS_KEY];
  return Array.isArray(value) ? (value as WorkspaceProject[]) : [];
}

async function writeProjects(projects: WorkspaceProject[]): Promise<void> {
  await mainStore.set({ [PROJECTS_KEY]: projects });
}

async function readProjectSessionBindings(): Promise<Record<string, string>> {
  const stored = await mainStore.get(PROJECT_SESSION_BINDINGS_KEY);
  const value = stored[PROJECT_SESSION_BINDINGS_KEY];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

async function bindSessionToProject(
  sessionId: string,
  projectId: string,
): Promise<void> {
  const bindings = await readProjectSessionBindings();
  if (bindings[sessionId] === projectId) return;
  await mainStore.set({
    [PROJECT_SESSION_BINDINGS_KEY]: { ...bindings, [sessionId]: projectId },
  });
}

async function normalizeProjectFolder(folder: string): Promise<string> {
  const absolute = resolve(folder);
  if (!(await stat(absolute)).isDirectory()) {
    throw new Error(`${absolute} is not a directory.`);
  }
  return realpath(absolute);
}

function containsPath(folder: string, candidate: string): boolean {
  const rel = relative(folder, candidate);
  return (
    !rel ||
    rel === "." ||
    (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("/"))
  );
}

async function gitCommonDirectory(folder: string): Promise<string | null> {
  const result = await run(
    "git",
    ["-C", folder, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    undefined,
    { allowFailure: true },
  );
  if (result.code !== 0 || !result.stdout.trim()) return null;
  try {
    return await realpath(result.stdout.trim());
  } catch {
    return resolve(folder, result.stdout.trim());
  }
}

async function projectContainsLocation(
  project: WorkspaceProject,
  candidate: string,
): Promise<boolean> {
  const canonical = await normalizeProjectFolder(candidate);
  const candidateGitDirectory = await gitCommonDirectory(canonical);
  for (const folder of project.folders) {
    let canonicalFolder: string;
    try {
      canonicalFolder = await normalizeProjectFolder(folder);
    } catch {
      continue;
    }
    if (containsPath(canonicalFolder, canonical)) return true;
    if (!candidateGitDirectory) continue;
    const folderGitDirectory = await gitCommonDirectory(canonicalFolder);
    if (folderGitDirectory === candidateGitDirectory) return true;
  }
  return false;
}

export async function ensureWorkspaceProject(
  sessionId: string,
): Promise<WorkspaceProject> {
  const resolved = await workspaceManager.resolvePathForSession(sessionId, ".");
  let canonical = await normalizeProjectFolder(resolved.path);
  try {
    canonical = await normalizeProjectFolder(
      await repoRootForSession(sessionId),
    );
  } catch {
    /* folder project */
  }
  const projects = await readProjects();
  const bindings = await readProjectSessionBindings();
  const bound = projects.find((project) => project.id === bindings[sessionId]);
  if (bound && (await projectContainsLocation(bound, canonical))) return bound;
  let existing: WorkspaceProject | undefined;
  for (const project of projects) {
    if (await projectContainsLocation(project, canonical)) {
      existing = project;
      break;
    }
  }
  if (existing) {
    await bindSessionToProject(sessionId, existing.id);
    return existing;
  }
  const now = Date.now();
  const project: WorkspaceProject = {
    id: randomUUID(),
    name: basename(canonical),
    folders: [canonical],
    createdAt: now,
    updatedAt: now,
  };
  await writeProjects([project, ...projects]);
  await bindSessionToProject(sessionId, project.id);
  return project;
}

export async function listWorkspaceProjects(): Promise<WorkspaceProject[]> {
  return readProjects();
}

export async function createWorkspaceProject(
  name: string,
  folders: string[],
): Promise<WorkspaceProject> {
  const unique: string[] = [];
  for (const folder of folders.slice(0, 20)) {
    const absolute = await normalizeProjectFolder(folder);
    if (!unique.includes(absolute)) unique.push(absolute);
  }
  if (!unique.length) throw new Error("Choose at least one project folder.");
  const now = Date.now();
  const project: WorkspaceProject = {
    id: randomUUID(),
    name: name.trim() || basename(unique[0]!),
    folders: unique,
    createdAt: now,
    updatedAt: now,
  };
  await writeProjects([project, ...(await readProjects())]);
  return project;
}

export async function addWorkspaceProjectFolder(
  projectId: string,
  folder: string,
): Promise<WorkspaceProject> {
  const projects = await readProjects();
  const index = projects.findIndex((project) => project.id === projectId);
  if (index < 0) throw new Error("Project not found.");
  const canonical = await normalizeProjectFolder(folder);
  const current = projects[index]!;
  if (current.folders.includes(canonical)) return current;
  if (current.folders.length >= 20) {
    throw new Error("A project can contain up to 20 folders.");
  }
  const updated: WorkspaceProject = {
    ...current,
    folders: [...current.folders, canonical],
    updatedAt: Date.now(),
  };
  projects[index] = updated;
  await writeProjects(projects);
  return updated;
}

export async function bindWorkspaceProjectLocation(
  sessionId: string,
  projectId: string,
  path: string,
): Promise<WorkspaceProject> {
  const project = (await readProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found.");
  const canonical = await normalizeProjectFolder(path);
  if (!(await projectContainsLocation(project, canonical))) {
    throw new Error(
      "The selected folder or worktree is not part of this project.",
    );
  }
  await workspaceManager.bind(sessionId, canonical);
  await bindSessionToProject(sessionId, project.id);
  return project;
}

export async function listWorkspaceWorktrees(
  sessionId: string,
): Promise<WorkspaceWorktree[]> {
  let root: string;
  try {
    root = await repoRootForSession(sessionId);
  } catch {
    return [];
  }
  const result = await run("git", [
    "-C",
    root,
    "worktree",
    "list",
    "--porcelain",
  ]);
  const records = result.stdout.trim().split(/\n\n+/).filter(Boolean);
  return records
    .map((record) => {
      const fields = Object.fromEntries(
        record.split(/\r?\n/).map((line) => {
          const space = line.indexOf(" ");
          return space < 0
            ? [line, "true"]
            : [line.slice(0, space), line.slice(space + 1)];
        }),
      );
      return {
        path: fields.worktree ?? "",
        head: fields.HEAD ?? "",
        branch: fields.branch?.replace(/^refs\/heads\//, ""),
        bare: fields.bare === "true",
        detached: fields.detached === "true",
        locked: fields.locked,
      };
    })
    .filter((item) => !!item.path);
}

export async function createWorkspaceWorktree(
  sessionId: string,
  branch: string,
  baseRef = "HEAD",
): Promise<WorkspaceWorktree> {
  const project = await ensureWorkspaceProject(sessionId);
  const root = await repoRootForSession(sessionId);
  const normalizedBranch = branch
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "");
  if (!normalizedBranch) throw new Error("A branch name is required.");
  const parent = join(dirname(root), ".amiba-worktrees");
  await mkdir(parent, { recursive: true });
  let destination = join(
    parent,
    `${basename(root)}-${normalizedBranch.replaceAll("/", "-")}`,
  );
  if (existsSync(destination)) destination = `${destination}-${Date.now()}`;
  const existingBranch = await run(
    "git",
    ["-C", root, "show-ref", "--verify", `refs/heads/${normalizedBranch}`],
    undefined,
    { allowFailure: true },
  );
  const args =
    existingBranch.code === 0
      ? ["-C", root, "worktree", "add", destination, normalizedBranch]
      : [
          "-C",
          root,
          "worktree",
          "add",
          "-b",
          normalizedBranch,
          destination,
          baseRef,
        ];
  await run("git", args);
  await bindWorkspaceProjectLocation(sessionId, project.id, destination);
  const worktrees = await listWorkspaceWorktrees(sessionId);
  return (
    worktrees.find((item) => item.path === destination) ?? {
      path: destination,
      head: "",
      branch: normalizedBranch,
    }
  );
}

function checkpointRoot(sessionId: string): string {
  return join(app.getPath("userData"), "workspace-checkpoints", sessionId);
}

async function readCheckpointRecord(
  sessionId: string,
  id: string,
): Promise<CheckpointRecord> {
  const path = join(checkpointRoot(sessionId), id, "checkpoint.json");
  const parsed = JSON.parse(await readFile(path, "utf8")) as CheckpointRecord;
  if (parsed.id !== id || parsed.sessionId !== sessionId)
    throw new Error("Invalid checkpoint record.");
  return parsed;
}

export async function listWorkspaceCheckpoints(
  sessionId: string,
): Promise<WorkspaceCheckpoint[]> {
  const root = checkpointRoot(sessionId);
  let names: string[] = [];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const records: WorkspaceCheckpoint[] = [];
  for (const name of names) {
    try {
      records.push(await readCheckpointRecord(sessionId, name));
    } catch {
      /* corrupt entry */
    }
  }
  return records.sort((left, right) => right.createdAt - left.createdAt);
}

export async function createWorkspaceCheckpoint(
  sessionId: string,
  label: string,
): Promise<WorkspaceCheckpoint> {
  const state = await getWorkspaceGitState(sessionId);
  const id = randomUUID();
  const directory = join(checkpointRoot(sessionId), id);
  const filesDirectory = join(directory, "untracked");
  await mkdir(filesDirectory, { recursive: true });
  const head = (
    await run("git", ["-C", state.root, "rev-parse", "HEAD"])
  ).stdout.trim();
  const stash = await run(
    "git",
    ["-C", state.root, "stash", "create", `Amiba checkpoint ${id}`],
    undefined,
    { allowFailure: true },
  );
  const untracked = state.files
    .filter((file) => file.untracked)
    .map((file) => file.path);
  let total = 0;
  const captured: string[] = [];
  for (const path of untracked) {
    const source = join(state.root, path);
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(source);
    } catch {
      continue;
    }
    if (
      !info.isFile() ||
      info.size > MAX_CHECKPOINT_FILE_BYTES ||
      total + info.size > MAX_CHECKPOINT_TOTAL_BYTES
    )
      continue;
    const destination = join(filesDirectory, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
    captured.push(path);
    total += info.size;
  }
  const record: CheckpointRecord = {
    id,
    sessionId,
    label: label.trim() || "Recovery point",
    createdAt: Date.now(),
    repoRoot: state.root,
    baseHead: head,
    stashCommit: stash.stdout.trim() || undefined,
    stagedPaths: state.files
      .filter((file) => file.staged)
      .map((file) => file.path),
    untrackedPaths: captured,
    changedFiles: state.files.length,
  };
  await writeFile(
    join(directory, "checkpoint.json"),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
  return record;
}

export async function restoreWorkspaceCheckpoint(
  sessionId: string,
  id: string,
): Promise<WorkspaceGitState> {
  const record = await readCheckpointRecord(sessionId, id);
  const currentRoot = await repoRootForSession(sessionId);
  if (resolve(currentRoot) !== resolve(record.repoRoot))
    throw new Error("This checkpoint belongs to a different repository.");
  await run("git", ["-C", currentRoot, "reset", "--hard", record.baseHead]);
  await run("git", ["-C", currentRoot, "clean", "-fd"]);
  if (record.stashCommit) {
    await run("git", [
      "-C",
      currentRoot,
      "stash",
      "apply",
      "--index",
      record.stashCommit,
    ]);
  }
  const sourceDirectory = join(checkpointRoot(sessionId), id, "untracked");
  for (const path of record.untrackedPaths) {
    const source = join(sourceDirectory, path);
    if (!existsSync(source)) continue;
    const destination = join(currentRoot, safeRepoPath(currentRoot, path));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  return getWorkspaceGitState(sessionId);
}

export async function deleteWorkspaceCheckpoint(
  sessionId: string,
  id: string,
): Promise<void> {
  await readCheckpointRecord(sessionId, id);
  await rm(join(checkpointRoot(sessionId), id), {
    recursive: true,
    force: true,
  });
}

export async function startWorkspaceTerminal(
  sessionId: string,
): Promise<WorkspaceTerminalSnapshot> {
  const existing = terminals.get(sessionId);
  if (existing && !existing.exited) return terminalSnapshot(existing);
  const cwd = (await workspaceManager.resolvePathForSession(sessionId, "."))
    .path;
  const shell = process.env.SHELL || "/bin/zsh";
  const child = spawn(shell, ["-l"], {
    cwd,
    env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
    stdio: "pipe",
  });
  const record: TerminalRecord = {
    sessionId,
    cwd,
    process: child,
    output: "",
    startedAt: Date.now(),
    exited: false,
  };
  terminals.set(sessionId, record);
  child.stdout.on("data", (value) => appendTerminal(record, String(value)));
  child.stderr.on("data", (value) => appendTerminal(record, String(value)));
  child.on("error", (error) => appendTerminal(record, `\n${error.message}\n`));
  child.on("exit", (code) => {
    record.exited = true;
    record.exitCode = code ?? undefined;
    appendTerminal(
      record,
      `\n[terminal exited${code == null ? "" : ` ${code}`}]\n`,
    );
  });
  appendTerminal(record, `${cwd}\n`);
  return terminalSnapshot(record);
}

export async function writeWorkspaceTerminal(
  sessionId: string,
  input: string,
): Promise<WorkspaceTerminalSnapshot> {
  const record = terminals.get(sessionId);
  if (!record || record.exited) throw new Error("The terminal is not running.");
  record.process.stdin.write(input);
  return terminalSnapshot(record);
}

export function getWorkspaceTerminal(
  sessionId: string,
): WorkspaceTerminalSnapshot | null {
  const record = terminals.get(sessionId);
  return record ? terminalSnapshot(record) : null;
}

export async function stopWorkspaceTerminal(sessionId: string): Promise<void> {
  const record = terminals.get(sessionId);
  if (!record) return;
  if (!record.exited) record.process.kill("SIGTERM");
  terminals.delete(sessionId);
}

export async function disposeWorkspaceDevelopment(): Promise<void> {
  for (const sessionId of [...terminals.keys()])
    await stopWorkspaceTerminal(sessionId);
}
