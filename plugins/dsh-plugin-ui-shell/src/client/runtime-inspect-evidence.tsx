import { useMemo, useState } from "react";
import { useT } from "@amiba/i18n";
import {
  CompactArguments,
  type SemanticEvidenceContext,
} from "@amiba/ui/plugin";

function JsonNode({
  value,
  name,
  depth = 0,
  comma = false,
  path = "$",
}: {
  value: unknown;
  name?: string;
  depth?: number;
  comma?: boolean;
  path?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(depth < 2);
  const collection = value !== null && typeof value === "object";
  const entries = collection ? Object.entries(value) : [];
  const array = Array.isArray(value);
  const start = array ? "[" : "{";
  const end = array ? "]" : "}";
  const indent = "  ".repeat(depth);
  const prefix = name === undefined ? "" : `${JSON.stringify(name)}: `;
  const suffix = comma ? "," : "";
  if (!entries.length) {
    return (
      <div>
        {indent}
        {prefix}
        {JSON.stringify(value)}
        {suffix}
        {"\n"}
      </div>
    );
  }
  return (
    <>
      <div className="relative">
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${t(open ? "shell.inspect.collapse" : "shell.inspect.expand")} ${path}`}
          onClick={() => setOpen(!open)}
          className="absolute top-0 h-5 w-4 cursor-pointer text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          style={{ left: `calc(${depth * 2}ch - 1.2rem)` }}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 12 12"
            className="h-3 w-3"
            style={{ transform: open ? "rotate(90deg)" : undefined }}
          >
            <path
              d="m4 2 4 4-4 4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
          </svg>
        </button>
        {indent}
        {prefix}
        {start}
        {!open && (
          <>
            {" "}
            … {end}
            {suffix}
          </>
        )}
        {"\n"}
      </div>
      {open && (
        <>
          {entries.map(([key, child], index) => (
            <JsonNode
              key={key}
              value={child}
              name={array ? undefined : key}
              depth={depth + 1}
              comma={index < entries.length - 1}
              path={
                array ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`
              }
            />
          ))}
          <div>
            {indent}
            {end}
            {suffix}
            {"\n"}
          </div>
        </>
      )}
    </>
  );
}

export function RuntimeInspectEvidence({
  args,
  text,
}: SemanticEvidenceContext) {
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, value: JSON.parse(text) };
    } catch {
      return { ok: false as const };
    }
  }, [text]);
  if (!text.trim()) return <CompactArguments value={args} />;
  return (
    <div
      className="min-w-0 overflow-x-auto rounded-md border border-border/50 bg-muted/20 px-6 py-3 font-mono text-xs leading-5 whitespace-pre"
      data-json-viewer
    >
      {parsed.ok ? <JsonNode key={text} value={parsed.value} /> : text}
    </div>
  );
}
