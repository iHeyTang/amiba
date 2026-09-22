import { useMemo, useState } from "react";
import { useT } from "@amiba/i18n";
import {
  CompactArguments,
  recordOf,
  type SemanticEvidenceContext,
} from "@amiba/ui/plugin";
import {
  PAGE_SIZE,
  collectionColumns,
  isEmpty,
  isScalar,
  searchInspection,
} from "./inspection-model";

const control =
  "cursor-pointer rounded-sm py-1 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";
const secondary = new Set([
  "access",
  "referencedTypes",
  "inputSchema",
  "outputSchema",
  "code",
  "parameters",
  "ownerProps",
  "standardProps",
  "stack",
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
function More({ count, onClick }: { count: number; onClick: () => void }) {
  const { t } = useT();
  return count > 0 ? (
    <button type="button" className={`${control} mt-2`} onClick={onClick}>
      {t("shell.inspect.more")} ({count})
    </button>
  ) : null;
}
function Disclosure({
  label,
  value,
  depth = 0,
  initial = false,
}: {
  label: string;
  value: unknown;
  depth?: number;
  initial?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className={control}>{label}</summary>
      {open && (
        <div className="mt-1 min-w-0 border-l border-border/40 pl-3">
          <InspectionValue value={value} depth={depth + 1} />
        </div>
      )}
    </details>
  );
}

/** Comparable records share column labels instead of repeating them in every item. */
function Records({
  items,
  columns,
  depth,
}: {
  items: Record<string, unknown>[];
  columns: string[];
  depth: number;
}) {
  const { t } = useT();
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const hasDetails = items.some((row) =>
    Object.keys(row).some((key) => !columns.includes(key)),
  );
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] text-muted-foreground sm:hidden">
        {t("shell.inspect.swipe")}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] table-fixed border-collapse sm:min-w-0 text-left text-[11px]">
          <thead>
            <tr className="border-b border-border/50">
              {columns.map((key) => (
                <th
                  key={key}
                  scope="col"
                  className="px-2 py-2 align-top font-mono text-[10px] font-normal text-muted-foreground [overflow-wrap:anywhere]"
                >
                  {key}
                </th>
              ))}
              {hasDetails && (
                <th
                  scope="col"
                  className="w-14 px-1 py-2 font-normal text-muted-foreground"
                >
                  {t("shell.inspect.details")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.slice(0, visible).map((row, index) => {
              const extra = Object.fromEntries(
                Object.entries(row).filter(([key]) => !columns.includes(key)),
              );
              const open = expanded.has(index);
              return (
                <RecordRows
                  key={index}
                  row={row}
                  columns={columns}
                  hasDetails={hasDetails}
                  extra={extra}
                  open={open}
                  depth={depth}
                  onToggle={() =>
                    setExpanded((previous) => {
                      const next = new Set(previous);
                      if (next.has(index)) next.delete(index);
                      else next.add(index);
                      return next;
                    })
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
      <More
        count={items.length - visible}
        onClick={() => setVisible((n) => n + PAGE_SIZE)}
      />
    </div>
  );
}
function RecordRows({
  row,
  columns,
  hasDetails,
  extra,
  open,
  onToggle,
  depth,
}: {
  row: Record<string, unknown>;
  columns: string[];
  hasDetails: boolean;
  extra: Record<string, unknown>;
  open: boolean;
  onToggle: () => void;
  depth: number;
}) {
  const { t } = useT();
  return (
    <>
      <tr className="border-b border-border/35">
        {columns.map((key, index) => (
          <td
            key={key}
            className={`px-2 py-2 align-top ${index === 0 ? "font-mono text-foreground" : "text-foreground/80"}`}
          >
            {key in row ? (
              <Scalar value={row[key]} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </td>
        ))}
        {hasDetails && (
          <td className="px-1 py-2 align-top">
            {Object.keys(extra).length > 0 && (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${t("shell.inspect.details")}: ${String(row[columns[0]])}`}
                className={control}
                onClick={onToggle}
              >
                {open ? "−" : "+"}
              </button>
            )}
          </td>
        )}
      </tr>
      {open && (
        <tr>
          <td
            colSpan={columns.length + (hasDetails ? 1 : 0)}
            className="border-b border-border/40 bg-muted/15 p-3"
          >
            <InspectionValue value={extra} depth={depth + 1} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Tree topology is navigated by node names, not by children/array-index wrapper levels. */
function Tree({
  nodes,
  depth = 0,
}: {
  nodes: Record<string, unknown>[];
  depth?: number;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  return (
    <div className="min-w-0 space-y-1">
      {nodes.slice(0, visible).map((node, index) => (
        <TreeNode key={index} node={node} depth={depth} />
      ))}
      <More
        count={nodes.length - visible}
        onClick={() => setVisible((n) => n + PAGE_SIZE)}
      />
    </div>
  );
}
function TreeNode({
  node,
  depth,
}: {
  node: Record<string, unknown>;
  depth: number;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(depth === 0);
  const children = node.children as Record<string, unknown>[];
  const extra = Object.fromEntries(
    Object.entries(node).filter(([key]) => !["name", "children"].includes(key)),
  );
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-start gap-2 py-1">
        {children.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            className={`${control} min-w-0 break-all text-left font-mono text-foreground`}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "▾" : "▸"} {String(node.name)}{" "}
            <span className="text-muted-foreground">({children.length})</span>
          </button>
        ) : (
          <span className="min-w-0 break-all py-1 pl-3 font-mono text-foreground">
            {String(node.name)}
          </span>
        )}
        {Object.keys(extra).length > 0 && (
          <div className="min-w-0 flex-1">
            <Disclosure
              label={t("shell.inspect.details")}
              value={extra}
              depth={depth}
            />
          </div>
        )}
      </div>
      {open && children.length > 0 && (
        <div className="ml-2 border-l border-border/40 pl-3">
          {isTree(children) ? (
            <Tree nodes={children} depth={depth + 1} />
          ) : (
            <InspectionValue value={children} depth={depth + 1} />
          )}
        </div>
      )}
    </div>
  );
}
function isTree(items: unknown[]): items is Record<string, unknown>[] {
  return (
    items.length > 0 &&
    items.every((item) => {
      const row = recordOf(item);
      return (
        row &&
        typeof row.name === "string" &&
        Array.isArray(row.children) &&
        row.children.every((child) => {
          const nested = recordOf(child);
          return (
            nested &&
            typeof nested.name === "string" &&
            Array.isArray(nested.children)
          );
        })
      );
    })
  );
}

/** Status and errors precede package identity, version pointers and source. */
function Diagnostics({ value }: { value: Record<string, unknown> }) {
  const { t } = useT();
  const runtime = recordOf(value.runtime)!;
  const rest = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "runtime"),
  );
  const platforms = Object.entries(runtime).filter(([, item]) =>
    recordOf(item),
  );
  const scalars = Object.fromEntries(
    Object.entries(runtime).filter(([, item]) => !recordOf(item)),
  );
  return (
    <div data-inspection-diagnostics className="space-y-3">
      <InspectionValue value={scalars} depth={1} />
      {platforms.map(([platform, item]) => {
        const row = recordOf(item)!;
        const primaryKeys = [
          "status",
          "error",
          "renderFailure",
          "waitingFor",
        ].filter((key) => key in row && !isEmpty(row[key]));
        const ordered = Object.fromEntries(
          primaryKeys.map((key) => [key, row[key]]),
        );
        const extra = Object.fromEntries(
          Object.entries(row).filter(([key]) => !primaryKeys.includes(key)),
        );
        return (
          <div key={platform} className="border-t border-border/40 pt-2">
            <h3 className="mb-2 font-mono font-medium">{platform}</h3>
            <InspectionValue value={ordered} depth={0} />
            {Object.keys(extra).length > 0 && (
              <Disclosure label={t("shell.inspect.details")} value={extra} />
            )}
          </div>
        );
      })}
      <Disclosure label={t("shell.inspect.packageDetails")} value={rest} />
    </div>
  );
}

/** Structural fallback for fields that don't benefit from comparison or tree views. */
export function InspectionValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  const [visible, setVisible] = useState(PAGE_SIZE);
  if (isScalar(value)) return <Scalar value={value} />;
  if (isEmpty(value))
    return (
      <span className="font-mono text-muted-foreground">
        {Array.isArray(value) ? "[]" : "{}"}
      </span>
    );
  if (Array.isArray(value)) {
    if (isTree(value)) return <Tree nodes={value} />;
    const columns = collectionColumns(value);
    if (columns)
      return (
        <Records
          items={value as Record<string, unknown>[]}
          columns={columns}
          depth={depth}
        />
      );
    return (
      <div>
        <ol className="space-y-1">
          {value.slice(0, visible).map((item, index) => (
            <li key={index} className="flex min-w-0 gap-2 py-1">
              <span className="shrink-0 text-muted-foreground">
                {index + 1}.
              </span>
              <div className="min-w-0 flex-1">
                <InspectionValue value={item} depth={depth + 1} />
              </div>
            </li>
          ))}
        </ol>
        <More
          count={value.length - visible}
          onClick={() => setVisible((n) => n + PAGE_SIZE)}
        />
      </div>
    );
  }
  const record = value as Record<string, unknown>;
  const runtime = recordOf(record.runtime);
  if (
    depth === 0 &&
    runtime &&
    (recordOf(runtime.host) || recordOf(runtime.client))
  )
    return <Diagnostics value={record} />;
  const entries = Object.entries(record);
  return (
    <div className="space-y-2">
      {entries.slice(0, visible).map(([name, item]) => {
        if (!isScalar(item) && !isEmpty(item)) {
          const count = Object.keys(item as object).length;
          return (
            <Disclosure
              key={name}
              label={`${name} (${count})`}
              value={item}
              depth={depth}
              initial={
                (depth < 2 && !secondary.has(name)) ||
                name === "error" ||
                name === "renderFailure"
              }
            />
          );
        }
        if (name === "stack" || (name === "code" && typeof item === "string"))
          return (
            <Disclosure key={name} label={name} value={item} depth={depth} />
          );
        return (
          <dl
            key={name}
            className="grid min-w-0 gap-0.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"
          >
            <dt className="break-all font-mono text-[10px] text-muted-foreground">
              {name}
            </dt>
            <dd className="min-w-0">
              {isEmpty(item) ? (
                <span className="font-mono text-muted-foreground">
                  {Array.isArray(item) ? "[]" : "{}"}
                </span>
              ) : (
                <Scalar value={item} />
              )}
            </dd>
          </dl>
        );
      })}
      <More
        count={entries.length - visible}
        onClick={() => setVisible((n) => n + PAGE_SIZE)}
      />
    </div>
  );
}

function SearchableResult({
  value,
  searchValue,
}: {
  value: unknown;
  searchValue: unknown;
}) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const hits = useMemo(
    () => searchInspection(searchValue, query),
    [searchValue, query],
  );
  const searching = !!query.trim();
  return (
    <div data-inspection-browser>
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <input
          type="search"
          aria-label={t("shell.inspect.search")}
          placeholder={t("shell.inspect.search")}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisible(PAGE_SIZE);
          }}
          className="min-w-0 flex-1 rounded border border-border/50 bg-background px-2 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        />
        {searching && (
          <>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {hits.length}
            </span>
            <button
              type="button"
              onClick={() => setQuery("")}
              className={control}
            >
              {t("shell.inspect.clear")}
            </button>
          </>
        )}
      </div>
      <div data-inspection-content className="max-h-[32rem] overflow-auto p-3">
        {searching ? (
          <div className="space-y-4">
            {hits.slice(0, visible).map((hit) => (
              <section key={hit.path}>
                <h4 className="mb-2 break-all font-mono text-[10px] text-muted-foreground">
                  {hit.path}
                </h4>
                <InspectionValue value={hit.value} depth={2} />
              </section>
            ))}
            {!hits.length && (
              <p role="status" className="text-muted-foreground">
                {t("shell.inspect.noMatches")}
              </p>
            )}
            <More
              count={hits.length - visible}
              onClick={() => setVisible((n) => n + PAGE_SIZE)}
            />
          </div>
        ) : (
          <InspectionValue value={value} />
        )}
      </div>
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
      {valid && decoded !== null && typeof decoded === "object" ? (
        <SearchableResult
          value={wrapped ? envelope.data : decoded}
          searchValue={decoded}
        />
      ) : (
        <div data-inspection-content className="max-h-96 overflow-auto p-3">
          <Scalar value={decoded} />
        </div>
      )}
      {valid && (
        <details className="border-t border-border/40 px-3 py-2">
          <summary className={control}>{t("shell.inspect.raw")}</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all py-2 font-mono text-[10.5px]">
            {text}
          </pre>
        </details>
      )}
    </section>
  );
}
