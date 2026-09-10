import type { McpDependencyView } from "../dependencies.js";
import {
  CheckCircle2,
  CircleAlert,
  Pencil,
  Plus,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Input,
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
  Switch,
  cn,
  usePluginT,
} from "@amiba/ui/plugin";

import { mcpI18n } from "./i18n.js";

/**
 * Wraps `usePluginT` with this plugin's own i18n overlay (see `./i18n.ts`).
 * Every call site in this file should use this, not the bare `usePluginT`,
 * so overlay-covered keys resolve locally instead of depending on the host
 * `externalTools.mcp.*` bundle.
 */
function useT() {
  return usePluginT(mcpI18n);
}

/**
 * Server shape and CRUD adapter this view renders — the MCP manager
 * plugin's own configured-server directory. Deliberately local to the
 * plugin rather than the host platform contract: this view (and its host
 * wrapper `McpToolsTab`) used to reach `@amiba/app-runtime/platform`'s
 * `AgentMcpAdapter`/`AgentMcpSaveInput`/`AgentMcpServerView`, which in turn
 * only ever forwarded to this plugin's own `amibaMcp/*` Typert Remote (see
 * `../remote.js`) — never a genuine engine-native DSH RPC. Once this
 * component moved here those types had zero remaining consumers anywhere in
 * the repo, so they were deleted from the platform contract outright.
 * `client/index.tsx` builds an instance of this shape directly from the
 * plugin's own Remote face (`ctx.remote.amibaMcp`).
 */
export interface McpServerView {
  serverName: string;
  transport: "stdio" | "streamable-http";
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  envKeys: string[];
  headerKeys: string[];
}

export interface McpSaveInput {
  serverName: string;
  transport: "stdio" | "streamable-http";
  enabled: boolean;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  /** Undefined preserves existing secrets; an object replaces them. */
  env?: Record<string, string>;
  /** Undefined preserves existing secrets; an object replaces them. */
  headers?: Record<string, string>;
}

export interface McpToolsAdapter {
  list(): Promise<{
    servers: McpServerView[];
    toolsOnly: true;
    dependencies?: McpDependencyView[];
  }>;
  save(input: McpSaveInput): Promise<{ server: McpServerView }>;
  remove(serverName: string): Promise<void>;
}

function parseStringMap(value: string): Record<string, string> | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object.");
  }
  if (
    !Object.entries(parsed).every(
      ([key, item]) => key && typeof item === "string",
    )
  ) {
    throw new Error("Every secret value must be a string.");
  }
  return parsed as Record<string, string>;
}

function DshMcpEditor({
  adapter,
  item,
  onCancel,
  onError,
  onSaved,
}: {
  adapter: McpToolsAdapter;
  item?: McpServerView;
  onCancel(): void;
  onError(value: string | null): void;
  onSaved(): void | Promise<void>;
}) {
  const { t } = useT();
  const [serverName, setServerName] = useState(item?.serverName ?? "");
  const [transport, setTransport] = useState<"stdio" | "streamable-http">(
    item?.transport ?? "streamable-http",
  );
  const [target, setTarget] = useState(item?.url || item?.command || "");
  const [args, setArgs] = useState((item?.args ?? []).join("\n"));
  const [cwd, setCwd] = useState(item?.cwd ?? "");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    onError(null);
    try {
      const input: McpSaveInput = {
        serverName: serverName.trim(),
        transport,
        enabled: item?.enabled ?? true,
        ...(transport === "stdio"
          ? {
              command: target.trim(),
              args: args
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean),
              ...(cwd.trim() ? { cwd: cwd.trim() } : {}),
              env: parseStringMap(env),
            }
          : {
              url: target.trim(),
              headers: parseStringMap(headers),
            }),
      };
      await adapter.save(input);
      await onSaved();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="space-y-3 rounded-xl border border-border/60 bg-muted/15 p-3"
      onSubmit={(event) => void submit(event)}
    >
      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <Input
          disabled={Boolean(item)}
          onChange={(event) => setServerName(event.target.value)}
          placeholder={t("externalTools.mcp.dsh.serverName")}
          value={serverName}
        />
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          {(["streamable-http", "stdio"] as const).map((kind) => (
            <button
              className={cn(
                "flex-1 rounded-md px-2 py-1 text-xs",
                transport === kind
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
              key={kind}
              onClick={() => {
                setTransport(kind);
                setTarget("");
              }}
              type="button"
            >
              {kind === "streamable-http" ? "HTTP" : "STDIO"}
            </button>
          ))}
        </div>
      </div>
      <Input
        onChange={(event) => setTarget(event.target.value)}
        placeholder={
          transport === "streamable-http"
            ? "https://server.example/mcp"
            : "Command (for example npx)"
        }
        value={target}
      />
      {transport === "stdio" ? (
        <>
          <textarea
            className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
            onChange={(event) => setArgs(event.target.value)}
            placeholder={t("externalTools.mcp.dsh.args")}
            value={args}
          />
          <Input
            onChange={(event) => setCwd(event.target.value)}
            placeholder={t("externalTools.mcp.dsh.cwd")}
            value={cwd}
          />
          <textarea
            className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
            onChange={(event) => setEnv(event.target.value)}
            placeholder={
              item?.envKeys.length
                ? t("externalTools.mcp.dsh.preserveSecrets", {
                    keys: item.envKeys.join(", "),
                  })
                : t("externalTools.mcp.dsh.env")
            }
            value={env}
          />
        </>
      ) : (
        <textarea
          className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
          onChange={(event) => setHeaders(event.target.value)}
          placeholder={
            item?.headerKeys.length
              ? t("externalTools.mcp.dsh.preserveSecrets", {
                  keys: item.headerKeys.join(", "),
                })
              : t("externalTools.mcp.dsh.headers")
          }
          value={headers}
        />
      )}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t("externalTools.mcp.dsh.hotReload")}
      </p>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} type="button" variant="ghost">
          {t("common.cancel")}
        </Button>
        <Button
          disabled={saving || !serverName.trim() || !target.trim()}
          type="submit"
        >
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}

export function DshMcpToolsTab({ adapter }: { adapter: McpToolsAdapter }) {
  const { t } = useT();
  const [items, setItems] = useState<McpServerView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<McpServerView | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [dependencies, setDependencies] = useState<McpDependencyView[]>([]);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await adapter.list();
      setItems(snapshot.servers);
      setDependencies(snapshot.dependencies ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [adapter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = async (item: McpServerView, enabled: boolean) => {
    setBusy(item.serverName);
    setError(null);
    try {
      const saved = await adapter.save({ ...item, enabled });
      setItems((current) =>
        current.map((candidate) =>
          candidate.serverName === item.serverName ? saved.server : candidate,
        ),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: McpServerView) => {
    if (
      !confirm(
        t("externalTools.mcp.dsh.deleteConfirm", { name: item.serverName }),
      )
    )
      return;
    setBusy(item.serverName);
    setError(null);
    try {
      await adapter.remove(item.serverName);
      setItems((current) =>
        current.filter((candidate) => candidate.serverName !== item.serverName),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={MODEL_SETTINGS_SECTION_CLASS}>
      <ModelSettingsSectionHeader
        title={t("externalTools.mcp.title")}
        description={t("externalTools.mcp.dsh.subtitle")}
        accessory={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg px-2.5 shadow-none"
            onClick={() => setEditing((current) => (current ? null : "new"))}
          >
            {editing ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t("externalTools.mcp.add")}
          </Button>
        }
      />

      {editing ? (
        <DshMcpEditor
          adapter={adapter}
          item={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onError={setError}
          onSaved={async () => {
            setEditing(null);
            setMessage(t("externalTools.mcp.dsh.saved"));
            await refresh();
          }}
        />
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
      {message ? (
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </div>
      ) : null}

      {dependencies.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">
            {t("externalTools.mcp.dependencies")}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("externalTools.mcp.dependencies.config")}
          </p>
          <ul className={MODEL_SETTINGS_SURFACE_CLASS}>
            {dependencies.map((item) => (
              <li
                key={item.connectionId}
                className="space-y-1 border-b border-border/40 p-4 last:border-b-0"
              >
                <div className="text-sm font-medium">
                  {item.service} · {item.name}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("externalTools.mcp.dependencies.provider")}:{" "}
                  {item.provider}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("externalTools.mcp.dependencies.consumers")}:{" "}
                  {item.consumers.join("、") ||
                    t("externalTools.mcp.dependencies.none")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t(`externalTools.mcp.dependencies.${item.state}`)} ·{" "}
                  {item.instances}{" "}
                  {t("externalTools.mcp.dependencies.instances")}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loading && items.length === 0 ? (
        <div className={MODEL_SETTINGS_SURFACE_CLASS}>
          <div className="h-14 animate-pulse bg-muted/20" />
        </div>
      ) : items.length === 0 ? (
        <div className={MODEL_SETTINGS_SURFACE_CLASS}>
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
              <Server className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t("externalTools.mcp.emptyTitle")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("externalTools.mcp.dsh.emptyDescription")}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ul className={MODEL_SETTINGS_SURFACE_CLASS} data-mcp-tools-surface>
          {items.map((item) => (
            <li
              key={item.serverName}
              className="border-b border-border/40 last:border-b-0"
            >
              <div className="group flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
                  <Server className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">
                      {item.serverName}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/75">
                      MCP ·{" "}
                      {item.transport === "streamable-http" ? "HTTP" : "STDIO"}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {item.url ||
                      [item.command, ...(item.args ?? [])]
                        .filter(Boolean)
                        .join(" ")}
                  </span>
                </span>
                <span
                  className={
                    item.enabled
                      ? "flex shrink-0 items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-300"
                      : "flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
                  }
                >
                  <span
                    className={
                      item.enabled
                        ? "h-1.5 w-1.5 rounded-full bg-emerald-500"
                        : "h-1.5 w-1.5 rounded-full border border-muted-foreground/50"
                    }
                  />
                  {t(
                    item.enabled
                      ? "externalTools.status.enabled"
                      : "externalTools.status.disabled",
                  )}
                </span>
                <Button
                  disabled={busy === item.serverName}
                  onClick={() => setEditing(item)}
                  size="icon"
                  title={t("common.edit")}
                  variant="ghost"
                >
                  <Pencil />
                </Button>
                <Button
                  className="text-destructive hover:text-destructive"
                  disabled={busy === item.serverName}
                  onClick={() => void remove(item)}
                  size="icon"
                  title={t("common.delete")}
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
                <Switch
                  checked={item.enabled}
                  disabled={busy === item.serverName}
                  onCheckedChange={(enabled) => void toggle(item, enabled)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
