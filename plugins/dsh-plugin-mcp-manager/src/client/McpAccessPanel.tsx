import { useCallback, useEffect, useState } from "react";
import { Button, usePluginT } from "@amiba/ui/plugin";
import type { McpAccessView } from "../access.js";

export interface McpAccessAdapter {
  list(): Promise<McpAccessView[]>;
  approve(
    id: string,
    connectionId: string,
    approvalToken: string,
  ): Promise<McpAccessView[]>;
  revoke(id: string): Promise<McpAccessView[]>;
  retry(id: string): Promise<McpAccessView[]>;
  openConnections(): void;
}
import { i18n } from "./i18n-access.js";

function AccessRow({
  item,
  items,
  adapter,
  onChanged,
  configuration,
}: {
  item: McpAccessView;
  items: McpAccessView[];
  adapter: McpAccessAdapter;
  onChanged(items: McpAccessView[]): void;
  configuration?: { ownerId: string; recordId: string };
}) {
  const { t } = usePluginT(i18n);
  const [selected, setSelected] = useState(item.connectionId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const scopedConnection = configuration
    ? item.connections.find(
        (c) =>
          c.configuration?.ownerId === configuration.ownerId &&
          c.configuration?.recordId === configuration.recordId,
      )
    : undefined;
  const boundHere =
    !configuration ||
    (item.configuration?.ownerId === configuration.ownerId &&
      item.configuration?.recordId === configuration.recordId);
  const displayState = boundHere ? item.state : "approval-required";
  const target = configuration ? (scopedConnection?.id ?? "") : selected;
  const pluginName =
    item.audience === "ordinary-agents" ? t("mcpAccess.ordinary") : item.plugin;
  const others = [
    ...new Set(
      items
        .filter(
          (other) =>
            other.id !== item.id &&
            other.connectionId === selected &&
            other.state !== "approval-required",
        )
        .map((other) =>
          other.audience === "ordinary-agents"
            ? t("mcpAccess.ordinary")
            : other.plugin,
        ),
    ),
  ];
  async function run(operation: () => Promise<McpAccessView[]>) {
    setBusy(true);
    setError(false);
    try {
      onChanged(await operation());
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-xl border border-border/60 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h4 className="text-sm font-medium">
            {configuration && item.audience === "ordinary-agents"
              ? t("mcpAccess.work")
              : pluginName}
          </h4>
          {!configuration && (
            <p className="text-xs text-muted-foreground">{item.name}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {t(
            `mcpAccess.${displayState === "error" ? (item.code === "mcp_feature_activation_failed" ? "featureFailed" : "failed") : displayState}`,
          )}
        </span>
      </div>
      {configuration && (
        <p className="text-sm leading-6 text-muted-foreground">
          {t("mcpAccess.workDescription")}
        </p>
      )}
      <details className="space-y-2" open={configuration ? undefined : true}>
        <summary className="cursor-pointer text-sm text-muted-foreground">
          {t(configuration ? "mcpAccess.operations" : "mcpAccess.required")}
        </summary>
        <ul className="space-y-1 text-sm">
          {item.tools.map((tool) => (
            <li key={tool.name}>
              {tool.title}
              {tool.description ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {tool.description}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
      {configuration && item.state === "inactive" && boundHere && (
        <p className="text-sm">{item.connectionName}</p>
      )}
      {!configuration &&
        (item.state === "inactive" ? (
          <p className="text-sm">{item.connectionName}</p>
        ) : (
          <label className="block space-y-1 text-xs text-muted-foreground">
            <span>{t("mcpAccess.choose")}</span>
            <select
              className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              value={selected}
              disabled={busy}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">{t("mcpAccess.choose")}</option>
              {item.connections.map((connection) => (
                <option key={connection.id} value={connection.id}>
                  {connection.name} · {connection.provider}
                </option>
              ))}
            </select>
          </label>
        ))}
      {!item.connections.length && item.state !== "inactive" ? (
        <p className="text-xs text-muted-foreground">{t("mcpAccess.empty")}</p>
      ) : null}
      {!configuration && others.length ? (
        <p className="text-xs text-muted-foreground">
          {t("mcpAccess.shared", { names: others.join("、") })}
        </p>
      ) : null}
      {!configuration && (
        <p className="text-xs text-muted-foreground">
          {t("mcpAccess.impact", { plugin: pluginName })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {displayState === "error" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => adapter.retry(item.id))}
          >
            {t("mcpAccess.retry")}
          </Button>
        ) : null}
        {displayState !== "inactive" &&
        (!configuration || displayState === "approval-required") ? (
          <Button
            variant={configuration ? "outline" : "default"}
            size="sm"
            disabled={
              busy ||
              !item.connections.some((connection) => connection.id === target)
            }
            onClick={() =>
              void run(() =>
                adapter.approve(
                  item.id,
                  target,
                  item.connections.find(
                    (connection) => connection.id === target,
                  )!.approvalToken,
                ),
              )
            }
          >
            {t(
              configuration
                ? "mcpAccess.enableWork"
                : item.state === "approval-required"
                  ? "mcpAccess.approve"
                  : "mcpAccess.save",
            )}
          </Button>
        ) : null}
        {item.connectionId && boundHere ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void run(() => adapter.revoke(item.id))}
          >
            {t("mcpAccess.revoke")}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t("mcpAccess.error")}
        </p>
      ) : null}
    </div>
  );
}

export function McpAccessPanel({
  adapter,
  configuration,
}: {
  adapter: McpAccessAdapter;
  configuration?: { ownerId: string; recordId: string };
}) {
  const { t } = usePluginT(i18n);
  const [items, setItems] = useState<McpAccessView[]>([]);
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setItems(await adapter.list());
      setError(false);
    } catch {
      setError(true);
    }
  }, [adapter]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!items.some((item) => item.state === "connecting")) return;
    const timer = setTimeout(() => void refresh(), 500);
    return () => clearTimeout(timer);
  }, [items, refresh]);
  if (!items.length && !error) return null;
  const matches = (value?: { ownerId: string; recordId: string }) =>
    value?.ownerId === configuration?.ownerId &&
    value?.recordId === configuration?.recordId;
  const visible = configuration
    ? items.filter(
        (item) =>
          matches(item.configuration) ||
          item.connections.some((connection) =>
            matches(connection.configuration),
          ),
      )
    : items;
  if (!visible.length && !error) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium">
          {t(configuration ? "mcpAccess.more" : "mcpAccess.title")}
        </h3>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void refresh()}>
            {t("mcpAccess.refresh")}
          </Button>
          {!configuration && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => adapter.openConnections()}
            >
              {t("mcpAccess.connections")}
            </Button>
          )}
        </div>
      </div>
      {!configuration && (
        <p className="text-xs text-muted-foreground">
          {t("mcpAccess.description")}
        </p>
      )}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t("mcpAccess.error")}
        </p>
      ) : null}
      {visible.map((item) => (
        <AccessRow
          key={item.id}
          item={item}
          items={items}
          adapter={adapter}
          onChanged={setItems}
          configuration={configuration}
        />
      ))}
    </section>
  );
}
