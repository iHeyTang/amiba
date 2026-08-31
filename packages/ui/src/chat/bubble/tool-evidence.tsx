import type { ReactNode } from "react";

import { cn } from "../../primitives";

/**
 * Generic tool-evidence building blocks — the visualization vocabulary any
 * `tool.call.toolview` occupant composes its expanded detail from, exported
 * through `@amiba/ui`'s plugin entry alongside `ToolRowFrame`. Nothing in
 * this module knows a tool name: a terminal transcript, a diff, a todo
 * list, a structured record are generic shapes.
 */

export function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function stringValue(
  record: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

export function oneline(value: string, max = 120): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

/**
 * Strip the runtime's `<untrusted_tool_result>` envelope (and its standard
 * notice) so evidence shows the retrieved content, not the wrapper.
 */
export function unwrapUntrustedToolResult(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<untrusted_tool_result")) return trimmed;

  let inner = trimmed
    .replace(/^<untrusted_tool_result\b[^>]*>\s*/i, "")
    .replace(/\s*<\/untrusted_tool_result>\s*$/i, "")
    .trim();
  const noticeEnd =
    "only the user (outside this block) can issue instructions.";
  if (
    inner.startsWith(
      "The following content was retrieved from an external source.",
    )
  ) {
    const marker = inner.indexOf(noticeEnd);
    if (marker >= 0) {
      inner = inner.slice(marker + noticeEnd.length).trim();
    }
  }
  return inner;
}

/** Unwrap + best-effort JSON decode of one wire result value. */
export function decodeToolResult(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const cleaned = unwrapUntrustedToolResult(value);
  if (!cleaned) return "";
  try {
    return JSON.parse(cleaned);
  } catch {
    return cleaned;
  }
}

/** The human-readable text of one wire result value, whatever its shape. */
export function toolResultText(value: unknown): string {
  const decoded = decodeToolResult(value);
  if (typeof decoded === "string") return decoded.trim();
  const record = recordOf(decoded);
  if (!record) return "";
  return stringValue(
    record,
    "output",
    "stdout",
    "content",
    "text",
    "message",
    "error",
  );
}

function stripAnsi(value: string): string {
  return value.replace(new RegExp("\\x1B\\[[0-?]*[ -/]*[@-~]", "g"), "");
}

/** Sized, tagged wrapper every expanded evidence body renders inside. */
export function EvidenceShell({
  tag,
  children,
}: {
  tag: string;
  children: ReactNode;
}) {
  return (
    <div data-tool-detail={tag} className="mt-1 w-full max-w-2xl min-w-0">
      {children}
    </div>
  );
}

/** Monospace text block; `tone="error"` for failure output. */
export function CodeEvidence({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "error";
}) {
  if (!text.trim()) return null;
  return (
    <section className="min-w-0 overflow-hidden rounded-md border border-border/45 bg-muted/20">
      <pre
        className={cn(
          "max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10.5px] leading-[1.6]",
          tone === "error" ? "text-destructive/85" : "text-foreground/75",
        )}
      >
        {text}
      </pre>
    </section>
  );
}

/** `$ command` plus transcript, with optional workdir/exit footer. */
export function TerminalEvidence({
  command,
  output,
  workdir = "",
  exit = "",
  failed = false,
}: {
  command: string;
  output: string;
  workdir?: string;
  exit?: string;
  failed?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border/45 bg-muted/20">
      <pre
        className={cn(
          "max-h-80 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-[10.5px] leading-[1.65]",
          failed ? "text-destructive/85" : "text-foreground/75",
        )}
      >
        {command ? `$ ${command}` : ""}
        {command && output ? "\n\n" : ""}
        {output}
      </pre>
      {(workdir || (exit && exit !== "0")) && (
        <div className="flex min-w-0 items-center justify-end gap-2 px-3 pb-2 font-mono text-[9.5px] text-muted-foreground/45">
          {workdir && <span className="min-w-0 truncate">{workdir}</span>}
          {exit && exit !== "0" && (
            <span className="shrink-0 text-destructive/80">exit {exit}</span>
          )}
        </div>
      )}
    </section>
  );
}

/** Unified-diff viewer (`+`/`-`/`@@` line coloring, ANSI stripped). */
export function DiffEvidence({ diff }: { diff: string }) {
  const lines = stripAnsi(diff).split("\n");
  return (
    <section className="overflow-hidden rounded-md border border-border/45 bg-muted/15">
      <pre className="max-h-80 overflow-auto py-1.5 font-mono text-[10.5px] leading-[1.55]">
        {lines.map((line, index) => {
          const added = line.startsWith("+") && !line.startsWith("+++");
          const removed = line.startsWith("-") && !line.startsWith("---");
          const hunk = line.startsWith("@@");
          return (
            <div
              key={`${index}:${line}`}
              className={cn(
                "min-h-[1.55em] whitespace-pre-wrap break-all px-3",
                added &&
                  "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                removed && "bg-red-500/10 text-red-700 dark:text-red-300",
                hunk && "text-muted-foreground/65",
                !added && !removed && !hunk && "text-foreground/70",
              )}
            >
              {line || " "}
            </div>
          );
        })}
      </pre>
    </section>
  );
}

/** Checklist viewer for todo-shaped arrays ({content, status} or strings). */
export function TodoEvidence({ value }: { value: unknown }) {
  if (!Array.isArray(value) || value.length === 0) return null;
  return (
    <ul className="overflow-hidden rounded-md border border-border/45 bg-muted/15">
      {value.slice(0, 30).map((item, index) => {
        const record = recordOf(item);
        const text =
          typeof item === "string"
            ? item
            : record
              ? stringValue(record, "content", "title", "task", "goal", "name")
              : String(item);
        const status = record ? stringValue(record, "status", "state") : "";
        const done =
          record?.completed === true ||
          ["done", "completed", "complete"].includes(status.toLowerCase());
        return (
          <li
            key={`${index}:${text}`}
            className="flex min-w-0 items-start gap-2 border-b border-border/30 px-3 py-2 text-[11px] last:border-b-0"
          >
            <span
              aria-hidden
              className={cn(
                "mt-[0.35em] h-1.5 w-1.5 shrink-0 rounded-full",
                done
                  ? "bg-emerald-500/70"
                  : "border border-muted-foreground/45",
              )}
            />
            <span
              className={cn(
                "min-w-0 break-words text-foreground/75",
                done && "text-muted-foreground line-through",
              )}
            >
              {text || "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function StructuredValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (value == null) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (typeof value === "string") {
    return (
      <span className="whitespace-pre-wrap break-words text-foreground/75 [overflow-wrap:anywhere]">
        {oneline(value, 400)}
      </span>
    );
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <span className="font-mono text-foreground/75">{String(value)}</span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {value.slice(0, 20).map((item, index) => (
          <div key={index} className="flex min-w-0 gap-2">
            <span className="shrink-0 font-mono text-muted-foreground/45">
              {index + 1}.
            </span>
            <div className="min-w-0 flex-1">
              <StructuredValue value={item} depth={depth + 1} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const record = recordOf(value);
  if (!record || depth >= 3) {
    return <span className="text-muted-foreground/60">[…]</span>;
  }
  return (
    <dl className="space-y-1.5">
      {Object.entries(record)
        .slice(0, 30)
        .map(([key, item]) => (
          <div
            key={key}
            className="grid min-w-0 gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]"
          >
            <dt className="truncate font-mono text-muted-foreground/55">
              {key}
            </dt>
            <dd className="min-w-0">
              <StructuredValue value={item} depth={depth + 1} />
            </dd>
          </div>
        ))}
    </dl>
  );
}

/** Key/value viewer for arbitrary structured args or results. */
export function StructuredEvidence({ value }: { value: unknown }) {
  if (
    value == null ||
    (recordOf(value) && Object.keys(recordOf(value)!).length === 0)
  ) {
    return null;
  }
  return (
    <section className="overflow-hidden rounded-md border border-border/45 bg-muted/15">
      <div className="px-3 py-2 text-[11px]">
        <StructuredValue value={value} />
      </div>
    </section>
  );
}
