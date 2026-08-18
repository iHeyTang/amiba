import type { ToolProgress } from "@amiba/app-runtime/core";

export interface WorkspaceReviewEntry {
  toolCallId: string;
  diff: string;
  paths: string[];
}

export interface WorkspaceReviewResource {
  kind: "diff";
  reviewId: string;
  scope: "turn" | "tool";
  entries: WorkspaceReviewEntry[];
}

export type WorkspaceReviewLineKind =
  | "context"
  | "addition"
  | "deletion"
  | "meta";

export interface WorkspaceReviewLine {
  kind: WorkspaceReviewLineKind;
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface WorkspaceReviewGap {
  kind: "gap";
  oldStart: number;
  newStart: number;
  count: number;
}

export type WorkspaceReviewRow = WorkspaceReviewLine | WorkspaceReviewGap;

export interface WorkspaceReviewFile {
  path: string;
  rows: WorkspaceReviewRow[];
  additions: number;
  deletions: number;
}

export interface WorkspaceReviewDocument {
  files: WorkspaceReviewFile[];
  additions: number;
  deletions: number;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function decodeResult(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function firstString(
  record: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function workspaceFileTargets(event: ToolProgress): string[] {
  const args = event.args ?? {};
  const result = recordOf(decodeResult(event.result));
  const targets: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (!targets.includes(value.trim())) targets.push(value.trim());
  };

  if (result) {
    add(result.resolved_path);
    if (Array.isArray(result.files_modified)) {
      for (const path of result.files_modified) add(path);
    }
    add(result.path);
  }
  add(firstString(args, "path", "file", "filepath"));
  return targets;
}

export function workspaceReviewResourceFromEvents(
  events: ToolProgress[],
  reviewId: string,
): WorkspaceReviewResource | null {
  const latestByTool = new Map<string, ToolProgress>();
  for (const event of events) latestByTool.set(event.toolCallId, event);

  const entries = [...latestByTool.values()]
    .filter(
      (event) =>
        (event.tool === "write_file" || event.tool === "patch") &&
        event.status === "completed" &&
        !event.error,
    )
    .map((event) => ({
      toolCallId: event.toolCallId,
      diff: workspaceMutationDiff(event),
      paths: workspaceFileTargets(event),
    }))
    .filter((entry) => entry.diff.length > 0 || entry.paths.length > 0);

  return entries.length
    ? { kind: "diff", reviewId, scope: "turn", entries }
    : null;
}

function diffLikeText(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (
    text.includes("*** Begin Patch") ||
    text.includes("*** Update File:") ||
    text.includes("*** Add File:") ||
    text.includes("*** Delete File:") ||
    (/^@@/m.test(text) && /^[-+]/m.test(text)) ||
    (/^--- /m.test(text) && /^\+\+\+ /m.test(text))
  ) {
    return text;
  }
  return "";
}

function workspaceMutationDiff(event: ToolProgress): string {
  const direct = diffLikeText(event.inlineDiff);
  if (direct) return direct;
  if (event.tool !== "patch") return "";

  // The completed result is authoritative: apply-patch may normalize or
  // partially apply the submitted patch, so its resulting diff can differ
  // from the original argument.
  const result = recordOf(decodeResult(event.result));
  if (result) {
    for (const key of ["patch", "diff", "inline_diff", "content"]) {
      const candidate = diffLikeText(result[key]);
      if (candidate) return candidate;
    }
  }
  const args = event.args ?? {};
  for (const key of ["patch", "diff", "input", "content"]) {
    const candidate = diffLikeText(args[key]);
    if (candidate) return candidate;
  }
  return "";
}

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function stripWorkspaceAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function cleanDiffPath(value: string): string {
  const withoutTimestamp = value.trim().split("\t", 1)[0]!.trim();
  const unquoted = withoutTimestamp.replace(/^"(.*)"$/, "$1");
  if (unquoted === "/dev/null") return "";
  return unquoted.replace(/^[ab]\//, "");
}

function renderedPathPair(
  line: string,
): { oldPath: string; newPath: string } | null {
  // Unified-diff content lines carry a leading marker. An added comment such
  // as `+// amount (ten-thousands → yuan)` is code, never a rename header.
  if (/^[ +\-]/.test(line)) return null;
  const match = line.match(/^(.+?)\s+→\s+(.+)$/);
  if (!match) return null;
  const rawOldPath = match[1]!.trim();
  const rawNewPath = match[2]!.trim();
  if (
    !rawOldPath.includes("/") &&
    !rawNewPath.includes("/") &&
    !rawOldPath.startsWith("a/") &&
    !rawNewPath.startsWith("b/")
  ) {
    return null;
  }
  const oldPath = cleanDiffPath(rawOldPath);
  const newPath = cleanDiffPath(rawNewPath);
  return { oldPath, newPath };
}

interface FileAccumulator extends WorkspaceReviewFile {
  oldCursor: number;
  newCursor: number;
  sawHunk: boolean;
}

function createFile(path: string): FileAccumulator {
  return {
    path,
    rows: [],
    additions: 0,
    deletions: 0,
    oldCursor: 1,
    newCursor: 1,
    sawHunk: false,
  };
}

function parseEntry(entry: WorkspaceReviewEntry): WorkspaceReviewFile[] {
  const lines = stripWorkspaceAnsi(entry.diff)
    .replaceAll("\r\n", "\n")
    .split("\n");
  const files: FileAccumulator[] = [];
  let current: FileAccumulator | null = null;
  let pendingOldPath = "";
  let fallbackIndex = 0;

  const fallbackPath = () =>
    entry.paths[Math.min(fallbackIndex, entry.paths.length - 1)] ||
    "Untitled change";
  const beginFile = (path: string) => {
    const resolvedPath = path || fallbackPath();
    current = createFile(resolvedPath);
    files.push(current);
    fallbackIndex += 1;
    return current;
  };
  const ensureFile = () => current ?? beginFile(fallbackPath());

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (
      !line ||
      line.includes("┊ review diff") ||
      line === "*** Begin Patch" ||
      line === "*** End Patch" ||
      line === "*** End of File"
    )
      continue;

    const patchFile = line.match(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/);
    if (patchFile) {
      beginFile(patchFile[1]!.trim());
      pendingOldPath = patchFile[1]!.trim();
      continue;
    }
    const movedFile = line.match(/^\*\*\* Move to:\s*(.+)$/);
    if (movedFile) {
      ensureFile().path = movedFile[1]!.trim();
      continue;
    }

    const gitHeader = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (gitHeader) {
      current = null;
      pendingOldPath = cleanDiffPath(gitHeader[1]!);
      continue;
    }

    if (line.startsWith("--- ")) {
      pendingOldPath = cleanDiffPath(line.slice(4));
      continue;
    }
    if (line.startsWith("+++ ")) {
      beginFile(cleanDiffPath(line.slice(4)) || pendingOldPath);
      continue;
    }

    const pathPair = renderedPathPair(line);
    if (pathPair) {
      beginFile(pathPair.newPath || pathPair.oldPath);
      continue;
    }

    const hunk = line.match(/^@@(?: -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)?)? @@?/);
    if (hunk) {
      const file = ensureFile();
      const oldStart = hunk[1] ? Number(hunk[1]) : file.oldCursor;
      const newStart = hunk[2] ? Number(hunk[2]) : file.newCursor;
      const oldGap = oldStart - file.oldCursor;
      const newGap = newStart - file.newCursor;
      const gap = Math.max(0, Math.min(oldGap, newGap));
      if (gap > 0) {
        file.rows.push({
          kind: "gap",
          oldStart: file.oldCursor,
          newStart: file.newCursor,
          count: gap,
        });
      }
      file.oldCursor = oldStart;
      file.newCursor = newStart;
      file.sawHunk = true;
      continue;
    }

    if (
      line.startsWith("index ") ||
      line.startsWith("new file mode ") ||
      line.startsWith("deleted file mode ") ||
      line.startsWith("similarity index ") ||
      line.startsWith("rename from ") ||
      line.startsWith("rename to ")
    ) {
      continue;
    }

    const file = ensureFile();
    if (!file.sawHunk) {
      file.oldCursor = Math.max(1, file.oldCursor);
      file.newCursor = Math.max(1, file.newCursor);
    }

    if (line.startsWith("+")) {
      file.rows.push({
        kind: "addition",
        content: line.slice(1),
        oldLine: null,
        newLine: file.newCursor,
      });
      file.additions += 1;
      file.newCursor += 1;
      continue;
    }
    if (line.startsWith("-")) {
      file.rows.push({
        kind: "deletion",
        content: line.slice(1),
        oldLine: file.oldCursor,
        newLine: null,
      });
      file.deletions += 1;
      file.oldCursor += 1;
      continue;
    }
    if (line.startsWith(" ")) {
      file.rows.push({
        kind: "context",
        content: line.slice(1),
        oldLine: file.oldCursor,
        newLine: file.newCursor,
      });
      file.oldCursor += 1;
      file.newCursor += 1;
      continue;
    }

    file.rows.push({
      kind: "meta",
      content: line,
      oldLine: null,
      newLine: null,
    });
  }

  return files.map(
    ({ oldCursor: _old, newCursor: _new, sawHunk: _saw, ...file }) => file,
  );
}

export function parseWorkspaceReview(
  entries: WorkspaceReviewEntry[],
): WorkspaceReviewDocument {
  const filesByPath = new Map<string, WorkspaceReviewFile>();

  for (const entry of entries) {
    for (const parsed of parseEntry(entry)) {
      const existing = filesByPath.get(parsed.path);
      if (existing) {
        if (existing.rows.length && parsed.rows.length) {
          existing.rows.push({
            kind: "meta",
            content: "···",
            oldLine: null,
            newLine: null,
          });
        }
        existing.rows.push(...parsed.rows);
        existing.additions += parsed.additions;
        existing.deletions += parsed.deletions;
      } else {
        filesByPath.set(parsed.path, parsed);
      }
    }
  }

  const equivalentPath = (left: string, right: string) => {
    const a = left.replaceAll("\\", "/").replace(/^\.\//, "");
    const b = right.replaceAll("\\", "/").replace(/^\.\//, "");
    return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
  };
  for (const entry of entries) {
    for (const path of entry.paths) {
      if (
        [...filesByPath.keys()].some((current) => equivalentPath(current, path))
      ) {
        continue;
      }
      filesByPath.set(path, createFile(path));
    }
  }

  const files = [...filesByPath.values()];
  return {
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

export function compactWorkspacePath(path: string, segments = 4): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= segments) return normalized.replace(/^\//, "");
  return parts.slice(-segments).join("/");
}

export function workspaceTabLabel(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  const parts = normalized.split("/").filter(Boolean);
  const name = parts.at(-1) || path;
  const parent = parts.at(-2);
  return parent ? `${name} · ${parent}` : name;
}
