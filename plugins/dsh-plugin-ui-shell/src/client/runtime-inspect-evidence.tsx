import { useState } from "react";
import { useT } from "@amiba/i18n";
import {
  recordOf,
  stringValue,
  type SemanticEvidenceContext,
} from "@amiba/ui/plugin";

const summaryClass =
  "cursor-pointer rounded-sm py-1 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring";

/** Only verified descriptions are localized; unfamiliar definitions stay in the raw result. */
function ServiceSummary({ service }: { service: Record<string, unknown> }) {
  const { t } = useT();
  const knownLayout =
    service.key === "layout" &&
    service.description ===
      "Panel navigation and geometry actions exposed through ctx.layout.";
  const methods = Array.isArray(service.methods) ? service.methods : [];
  const operations = knownLayout
    ? methods.flatMap((item) => {
        const method = recordOf(item);
        if (
          method?.name === "openPanel" &&
          method.description === "Open a panel in the workspace."
        )
          return [
            {
              name: t("shell.inspect.openPanel"),
              description: t("shell.inspect.openPanelDescription"),
            },
          ];
        if (
          method?.name === "closePanel" &&
          method.description === "Close a workspace panel."
        )
          return [
            {
              name: t("shell.inspect.closePanel"),
              description: t("shell.inspect.closePanelDescription"),
            },
          ];
        return [];
      })
    : [];
  return (
    <div className="space-y-4">
      <div>
        <p className="mb-1 text-[10px] text-muted-foreground">
          {t("shell.inspect.capabilityName")}
        </p>
        <h3 className="text-xs font-medium text-foreground">
          {knownLayout
            ? t("shell.inspect.layoutName")
            : stringValue(service, "key", "name", "id") ||
              t("shell.inspect.result")}
        </h3>
      </div>
      <div>
        <h4 className="mb-1 text-[10px] text-muted-foreground">
          {t("shell.inspect.purpose")}
        </h4>
        <p>
          {knownLayout
            ? t("shell.inspect.layoutDescription")
            : t("shell.inspect.unrecognized")}
        </p>
      </div>
      {operations.length > 0 && (
        <div>
          <h4 className="mb-1 text-[10px] text-muted-foreground">
            {t("shell.inspect.operations")}
          </h4>
          <ul className="divide-y divide-border/40">
            {operations.map((operation) => (
              <li
                key={operation.name}
                className="grid gap-1 py-2 sm:grid-cols-[6rem_minmax(0,1fr)] sm:gap-3"
              >
                <span className="font-medium text-foreground">
                  {operation.name}
                </span>
                <span className="text-muted-foreground">
                  {operation.description}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ThemeSummary({ items }: { items: unknown[] }) {
  const { t } = useT();
  const [visible, setVisible] = useState(20);
  const rows = items.flatMap((item) => {
    const record = recordOf(item);
    if (!record) return [];
    const name = stringValue(record, "name", "key");
    const value = record.value;
    if (!name || !["string", "number", "boolean"].includes(typeof value))
      return [];
    const label =
      name === "background"
        ? t("shell.inspect.background")
        : name === "foreground"
          ? t("shell.inspect.foreground")
          : name === "primary"
            ? t("shell.inspect.primary")
            : name;
    return [{ name, label, value: String(value) }];
  });
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium text-foreground">
        {t("shell.inspect.themeValues")}
      </h3>
      <div className="grid grid-cols-2 gap-3 border-b border-border/40 pb-2 text-[10px] text-muted-foreground">
        <span>{t("shell.inspect.variable")}</span>
        <span>{t("shell.inspect.value")}</span>
      </div>
      <ul className="divide-y divide-border/40">
        {rows.slice(0, visible).map((row, index) => (
          <li
            key={`${row.name}-${index}`}
            className="grid grid-cols-2 gap-3 py-2"
          >
            <span className="break-all">{row.label}</span>
            <span className="min-w-0 break-all font-mono">
              {/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(
                row.value,
              ) && (
                <span
                  aria-hidden
                  className="mr-2 inline-block h-3 w-3 rounded-sm border border-border align-middle"
                  style={{ backgroundColor: row.value }}
                />
              )}
              {row.value}
            </span>
          </li>
        ))}
      </ul>
      {visible < rows.length && (
        <button
          type="button"
          className={summaryClass}
          onClick={() => setVisible((n) => n + 20)}
        >
          {t("shell.inspect.more")} ({rows.length - visible})
        </button>
      )}
      {!rows.length && (
        <p className="pt-2 text-muted-foreground">
          {t(
            items.length ? "shell.inspect.unrecognized" : "shell.inspect.empty",
          )}
        </p>
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
  const envelope = recordOf(decoded);
  const wrapped =
    envelope &&
    typeof envelope.platform === "string" &&
    typeof envelope.provider === "string" &&
    typeof envelope.method === "string" &&
    "data" in envelope;
  const data = wrapped ? envelope.data : decoded;
  const record = recordOf(data);
  const service = record?.mode === "service" && recordOf(record.service);
  const themeQuery = args.provider === "Theme" && args.method === "listTokens";
  if (!text.trim())
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t(
          themeQuery
            ? "shell.inspect.themePurpose"
            : "shell.inspect.servicePurpose",
        )}
      </p>
    );
  return (
    <section
      data-runtime-result
      className="min-w-0 overflow-hidden rounded-md border border-border/45 bg-muted/10 text-[11px] leading-relaxed text-foreground/80"
    >
      <div className="max-h-96 overflow-auto p-3">
        {service ? (
          <ServiceSummary service={service} />
        ) : themeQuery && Array.isArray(data) ? (
          <ThemeSummary items={data} />
        ) : (
          <p className="whitespace-pre-wrap break-words">
            {valid ? t("shell.inspect.unrecognized") : text}
          </p>
        )}
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
