export interface WorkspaceReviewEntry {
  toolCallId: string;
  diff: string;
  paths: string[];
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
    if (!line || line.includes("┊ review diff")) continue;

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

    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      const file = ensureFile();
      const oldStart = Number(hunk[1]);
      const newStart = Number(hunk[2]);
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
