import { useState } from "react";
import { useT } from "@amiba/i18n";
import {
  CompactArguments,
  recordOf,
  type SemanticEvidenceContext,
} from "@amiba/ui/plugin";

const PAGE_SIZE = 20;
const summaryClass =
  "cursor-pointer rounded-sm py-1 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
// These are presentation defaults only: every field remains expandable and in the raw JSON.
const initiallyCollapsed = new Set([
  "access",
  "referencedTypes",
  "inputSchema",
  "outputSchema",
  "code",
  "parameters",
  "ownerProps",
  "standardProps",
]);

function Scalar({ value }: { value: unknown }) {
  const text = value === "" ? '""' : String(value);
  const color =
    typeof value === "string" &&
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
  return (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {color && (
        <span
          aria-hidden
          className="mr-2 inline-block h-3 w-3 rounded-sm border border-border align-middle"
          style={{ backgroundColor: value }}
        />
      )}
      {text}
    </span>
  );
}

function Group({
  name,
  value,
  depth,
}: {
  name: string;
  value: unknown;
  depth: number;
}) {
  const [open, setOpen] = useState(depth < 2 && !initiallyCollapsed.has(name));
  const count = Array.isArray(value)
    ? value.length
    : Object.keys(recordOf(value) ?? {}).length;
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="border-t border-border/35 pt-2"
    >
      <summary className={summaryClass}>
        <span className="break-all font-mono text-foreground/80">{name}</span>
        <span className="ml-2 text-[10px] text-muted-foreground">
          ({count})
        </span>
      </summary>
      {open && (
        <div className="mt-2 min-w-0 border-l border-border/40 pl-3">
          <InspectionValue value={value} depth={depth + 1} />
        </div>
      )}
    </details>
  );
}

/** Structural rendering, independent of provider/platform/method. No content translation or key loss. */
export function InspectionValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  const { t } = useT();
  const [visible, setVisible] = useState(PAGE_SIZE);
  if (value === null || typeof value !== "object")
    return <Scalar value={value} />;
  const array = Array.isArray(value);
  const entries: Array<[string, unknown]> = array
    ? value.map((item, index) => [String(index + 1), item])
    : Object.entries(value);
  if (!entries.length)
    return (
      <span className="font-mono text-muted-foreground">
        {array ? "[]" : "{}"}
      </span>
    );
  return (
    <div className="min-w-0">
      {array ? (
        <ol className="divide-y divide-border/40">
          {entries.slice(0, visible).map(([index, item]) => (
            <li key={index} className="flex min-w-0 gap-3 py-3 first:pt-0">
              <span className="w-4 shrink-0 pt-0.5 text-[10px] tabular-nums text-muted-foreground">
                {index}
              </span>
              <div className="min-w-0 flex-1">
                <InspectionValue value={item} depth={depth + 1} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-2.5">
          {entries.slice(0, visible).map(([name, item]) => {
            if (item !== null && typeof item === "object")
              return (
                <Group key={name} name={name} value={item} depth={depth} />
              );
            return (
              <dl
                key={name}
                className="grid min-w-0 gap-1 sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-4"
              >
                <dt className="break-all font-mono text-[10.5px] text-muted-foreground">
                  {name}
                </dt>
                <dd className="min-w-0 text-foreground/85">
                  <Scalar value={item} />
                </dd>
              </dl>
            );
          })}
        </div>
      )}
      {visible < entries.length && (
        <button
          type="button"
          className={`${summaryClass} mt-2 text-[11px]`}
          onClick={() => setVisible((n) => n + PAGE_SIZE)}
        >
          {t("shell.inspect.more")} ({entries.length - visible})
        </button>
      )}
    </div>
  );
}

export function RuntimeInspectEvidence({
  args,
  text,
}: SemanticEvidenceContext) {
  const { t } = useT();
  let decoded: unknown;
  let valid = false;
  try {
    decoded = JSON.parse(text);
    valid = true;
  } catch {
    decoded = text;
  }
  if (!text.trim()) return <CompactArguments value={args} />;
  const envelope = recordOf(decoded);
  const wrapped =
    envelope &&
    typeof envelope.platform === "string" &&
    typeof envelope.provider === "string" &&
    typeof envelope.method === "string" &&
    "data" in envelope;
  const metadata = wrapped
    ? Object.fromEntries(
        Object.entries(envelope).filter(([key]) => key !== "data"),
      )
    : null;
  return (
    <section
      data-runtime-result
      className="min-w-0 overflow-hidden rounded-md border border-border/45 bg-muted/10 text-[11px] leading-relaxed text-foreground/80"
    >
      {metadata && (
        <div className="border-b border-border/40 px-3 py-2">
          <CompactArguments value={metadata} />
        </div>
      )}
      <div className="max-h-96 overflow-auto p-3">
        <InspectionValue value={wrapped ? envelope.data : decoded} />
      </div>
      {valid && (
        <details className="border-t border-border/40 px-3 py-2">
          <summary className={summaryClass}>{t("shell.inspect.raw")}</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all py-2 font-mono text-[10.5px]">
            {text}
          </pre>
        </details>
      )}
    </section>
  );
}
