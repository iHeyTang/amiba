import { useState } from "react";
import { useT } from "@amiba/i18n";
import {
  CompactArguments,
  recordOf,
  stringValue,
  type SemanticEvidenceContext,
} from "@amiba/ui/plugin";

const summaryClass =
  "cursor-pointer rounded-sm py-1 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

function Branch({ name, value }: { name: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const count = Array.isArray(value)
    ? value.length
    : Object.keys(recordOf(value) ?? {}).length;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className={summaryClass}>
        {name} <span className="text-muted-foreground/60">({count})</span>
      </summary>
      {open && (
        <div className="ml-1 border-l border-border/45 pl-3">
          <Value value={value} />
        </div>
      )}
    </details>
  );
}

/** Lazy branches and paged lists keep every field reachable without flooding the timeline. */
function Value({ value }: { value: unknown }) {
  const { t } = useT();
  const [visible, setVisible] = useState(20);
  if (Array.isArray(value)) {
    return value.length ? (
      <div className="divide-y divide-border/40">
        {value.slice(0, visible).map((item, index) => (
          <div key={index} className="py-2">
            <Record value={item} />
          </div>
        ))}
        {visible < value.length && (
          <button
            type="button"
            className={summaryClass}
            onClick={() => setVisible((n) => n + 20)}
          >
            {t("shell.inspect.more")} ({value.length - visible})
          </button>
        )}
      </div>
    ) : (
      <span className="text-muted-foreground">{t("shell.inspect.empty")}</span>
    );
  }
  const record = recordOf(value);
  if (record)
    return Object.keys(record).length ? (
      <div className="space-y-1">
        {Object.entries(record).map(([key, item]) =>
          item !== null && typeof item === "object" ? (
            <Branch key={key} name={key} value={item} />
          ) : (
            <div key={key} className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5">
              <span className="font-mono text-muted-foreground">{key}</span>
              <span className="min-w-0 whitespace-pre-wrap break-all">
                <Value value={item} />
              </span>
            </div>
          ),
        )}
      </div>
    ) : (
      <span className="text-muted-foreground">{"{}"}</span>
    );
  const color =
    typeof value === "string" &&
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)
      ? value
      : undefined;
  return (
    <span className="whitespace-pre-wrap break-all">
      {color && (
        <span
          aria-hidden
          className="mr-2 inline-block h-3 w-3 rounded-sm border border-border align-middle"
          style={{ backgroundColor: color }}
        />
      )}
      {String(value)}
    </span>
  );
}

function Record({ value }: { value: unknown }) {
  const { t } = useT();
  const record = recordOf(value);
  if (!record) return <Value value={value} />;
  const titleKey = ["key", "name", "id"].find(
    (key) => typeof record[key] === "string" && record[key],
  );
  if (!titleKey) return <Value value={record} />;
  const title = String(record[titleKey]);
  const description = stringValue(record, "description");
  const access = recordOf(record.access);
  const optional = recordOf(access?.optional);
  const expression = stringValue(optional ?? {}, "expression");
  const remaining = Object.fromEntries(
    Object.entries(record).filter(
      ([key]) =>
        key !== titleKey &&
        !(key === "description" && description) &&
        !(key === "access" && expression),
    ),
  );
  const extraAccess =
    access &&
    Object.fromEntries(
      Object.entries(access).filter(
        ([key]) => key !== "optional" && key !== "hardDependency",
      ),
    );
  const extraOptional =
    optional &&
    Object.fromEntries(
      Object.entries(optional).filter(
        ([key]) =>
          key !== "expression" &&
          !(
            key === "requiresUndefinedCheck" &&
            optional.requiresUndefinedCheck === true
          ),
      ),
    );
  return (
    <div className="space-y-2">
      <div className="break-all font-mono text-xs font-medium text-foreground">
        {title}
      </div>
      {description && (
        <p className="whitespace-pre-wrap break-words text-muted-foreground">
          {description}
        </p>
      )}
      {expression && (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-x-3">
            <span className="text-muted-foreground">
              {t("shell.inspect.access")}
            </span>
            <code className="break-all">{expression}</code>
          </div>
          {optional?.requiresUndefinedCheck === true && (
            <p className="text-muted-foreground">
              {t("shell.inspect.optional")}
            </p>
          )}
          {extraOptional && Object.keys(extraOptional).length > 0 && (
            <Branch name="optional" value={extraOptional} />
          )}
          {access?.hardDependency !== undefined && (
            <Branch
              name={t("shell.inspect.dependency")}
              value={access.hardDependency}
            />
          )}
          {extraAccess && Object.keys(extraAccess).length > 0 && (
            <Value value={extraAccess} />
          )}
        </div>
      )}
      {Object.keys(remaining).length > 0 && <Value value={remaining} />}
    </div>
  );
}

function InspectArguments({ args }: { args: Record<string, unknown> }) {
  const invocation = [args.provider, args.method]
    .filter((item) => typeof item === "string" && item)
    .join(".");
  const remaining = Object.fromEntries(
    Object.entries(args).filter(
      ([key, value]) =>
        !(
          ["platform", "provider", "method"].includes(key) &&
          typeof value === "string"
        ),
    ),
  );
  if (!invocation) return <CompactArguments value={args} />;
  return (
    <div className="space-y-1">
      <div className="break-all font-mono text-[11px] leading-relaxed text-muted-foreground">
        {typeof args.platform === "string" && args.platform
          ? `${args.platform} · `
          : ""}
        {invocation}
      </div>
      <CompactArguments value={remaining} />
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
  const envelope = recordOf(decoded);
  // Only unwrap the known inspect envelope; unfamiliar records retain every field.
  const wrapped =
    envelope &&
    typeof envelope.platform === "string" &&
    typeof envelope.provider === "string" &&
    typeof envelope.method === "string" &&
    "data" in envelope;
  const data = wrapped ? envelope.data : decoded;
  const record = recordOf(data);
  const service = record?.mode === "service" && recordOf(record.service);
  const otherData =
    service &&
    Object.fromEntries(
      Object.entries(record!).filter(
        ([key]) => key !== "mode" && key !== "service",
      ),
    );
  const envelopeExtras =
    wrapped &&
    Object.fromEntries(
      Object.entries(envelope).filter(
        ([key]) => !["platform", "provider", "method", "data"].includes(key),
      ),
    );
  return (
    <div className="space-y-2">
      <InspectArguments args={args} />
      {text.trim() && (
        <section
          data-runtime-result
          className="min-w-0 overflow-hidden rounded-md border border-border/45 bg-muted/10 text-[11px] leading-relaxed text-foreground/80"
        >
          <div className="max-h-80 space-y-3 overflow-auto p-3">
            <div className="text-[10px] text-muted-foreground">
              {service ? "Service" : t("shell.inspect.result")}
            </div>
            <Record value={service || data} />
            {otherData && Object.keys(otherData).length > 0 && (
              <Value value={otherData} />
            )}
            {envelopeExtras && Object.keys(envelopeExtras).length > 0 && (
              <Value value={envelopeExtras} />
            )}
          </div>
          {valid && (
            <details className="border-t border-border/40 px-3 py-1">
              <summary className={summaryClass}>
                {t("shell.inspect.raw")}
              </summary>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all py-2 font-mono text-[10.5px]">
                {text}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
