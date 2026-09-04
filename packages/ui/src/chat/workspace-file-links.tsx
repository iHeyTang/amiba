import { useT } from "@amiba/i18n";
import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { Components } from "streamdown";

/**
 * A file the conversation named that the user can jump to: an inline `code`
 * span in the assistant's markdown, or a row on the turn-level "files
 * changed" card. `line` is the optional `:42` suffix on a code span.
 */
export interface WorkspaceFileLink {
  path: string;
  line?: number;
}

export type WorkspaceFileOpener = (
  link: WorkspaceFileLink,
) => void | Promise<void>;

/**
 * How the conversation opens a file the agent named. Supplied by the shell
 * that owns the workspace pane (ChatSurface); a bubble rendered without a
 * provider — Quick Ask, embedded previews — keeps plain inline code.
 */
export const WorkspaceFileOpenerContext = createContext<
  WorkspaceFileOpener | undefined
>(undefined);

export function useWorkspaceFileOpener(): WorkspaceFileOpener | undefined {
  return useContext(WorkspaceFileOpenerContext);
}

const TRAILING_LINE = /:(\d+)(?::\d+)?$/;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const WINDOWS_DRIVE = /^[A-Za-z]:\//;
const FILE_NAME = /^\.?[^./][^/]*\.[A-Za-z][A-Za-z0-9]{0,9}$/;
const DOT_FILE = /^\.[A-Za-z0-9_-]+$/;
const FORBIDDEN = /[<>"'|*?`\s]/;

/**
 * Decides whether an inline code span names a workspace file. Deliberately
 * conservative: prose is full of slashes (`km/h`, `feature/login`, `/api/users`)
 * and a false link opens a "file unavailable" tab, so the last segment must
 * read as a file name (an extension or a dotfile) and the span must be an
 * absolute, home, or explicitly relative path — or a bare `dir/file.ext`.
 */
export function parseWorkspaceFileLink(raw: string): WorkspaceFileLink | null {
  const text = raw.trim();
  if (!text || text.length > 512 || FORBIDDEN.test(text)) return null;
  if (URL_SCHEME.test(text)) return null;

  let path = text;
  let line: number | undefined;
  const lineMatch = text.match(TRAILING_LINE);
  if (lineMatch && lineMatch.index !== undefined) {
    line = Number(lineMatch[1]);
    path = text.slice(0, lineMatch.index);
  }

  const normalized = path.replaceAll("\\", "/");
  if (!normalized || normalized.endsWith("/")) return null;
  const isAbsolute =
    normalized.startsWith("/") || WINDOWS_DRIVE.test(normalized);
  const isHome = normalized.startsWith("~/");
  const isRelative = /^\.\.?\//.test(normalized);
  if (!isAbsolute && !isHome && !isRelative && !normalized.includes("/")) {
    return null;
  }

  const segments = normalized.split("/").filter(Boolean);
  const last = segments.at(-1);
  if (!last || (!FILE_NAME.test(last) && !DOT_FILE.test(last))) return null;
  if (!isAbsolute && !isHome && !isRelative && /^\d+$/.test(segments[0]!)) {
    return null;
  }
  return line === undefined ? { path } : { path, line };
}

export function isHtmlPreviewPath(path: string): boolean {
  return /\.html?$/i.test(path.trim());
}

/**
 * Resolves a conversation path against the session's workspace so a
 * relative `dist/index.html` can be handed to the embedded browser, which
 * only understands absolute locations. Home-relative paths cannot be
 * resolved in the renderer and come back `null`.
 */
export function resolveWorkspaceFilePath(
  path: string,
  workspacePath?: string | null,
): string | null {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("/") || WINDOWS_DRIVE.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("~/")) return null;
  const base = workspacePath?.replaceAll("\\", "/").replace(/\/+$/, "");
  if (!base) return null;
  const parts = base.split("/");
  for (const segment of normalized.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length > 1) parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

/** `file://` URL for an absolute path, one segment at a time so CJK names
 *  and spaces survive. */
export function workspaceFileUrl(absolutePath: string): string {
  const normalized = absolutePath.replaceAll("\\", "/");
  const rooted = WINDOWS_DRIVE.test(normalized) ? `/${normalized}` : normalized;
  return `file://${rooted
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function textOf(children: ReactNode): string | null {
  if (typeof children === "string") return children;
  if (Array.isArray(children) && children.every((c) => typeof c === "string")) {
    return children.join("");
  }
  return null;
}

type InlineCodeProps = ComponentProps<"code"> & { node?: unknown };

/**
 * Streamdown's inline-code renderer with one addition: a span that names a
 * workspace file becomes a button that opens it in the workbench (or, for an
 * HTML page, previews it in the embedded browser). Everything else renders
 * exactly as Streamdown would.
 */
export function WorkspaceInlineCode({
  node: _node,
  children,
  className,
  ...props
}: InlineCodeProps) {
  const open = useWorkspaceFileOpener();
  const { t } = useT();
  const text = open ? textOf(children) : null;
  const link = text ? parseWorkspaceFileLink(text) : null;
  const code = (
    <code data-streamdown="inline-code" className={className} {...props}>
      {children}
    </code>
  );
  if (!open || !link) return code;
  return (
    <button
      type="button"
      className="chat-md-file-link"
      data-workspace-file={link.path}
      title={
        isHtmlPreviewPath(link.path)
          ? t("workspacePane.previewInBrowser")
          : t("sidepanel.trace.searchResults.openFile")
      }
      onClick={() => void open(link)}
    >
      {code}
    </button>
  );
}

/** Pass to every chat `<Streamdown components>` so paths link uniformly. */
export const chatMarkdownComponents: Components = {
  inlineCode: WorkspaceInlineCode,
};
