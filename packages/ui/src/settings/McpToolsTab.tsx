import {
  CheckCircle2,
  CircleAlert,
  Pencil,
  Plus,
  Server,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  getHermesInstalledMcps,
  removeHermesMcp,
  saveHermesMcp,
  testHermesMcp,
  type HermesInstalledMcp,
  type HermesMcpInput,
} from "@amiba/core";
import { useT } from "@amiba/i18n";

import { useRefetchOnFocus } from "../hooks/useRefetchOnFocus";
import { Button, Input, Switch, cn } from "../primitives";
import {
  MODEL_SETTINGS_SECTION_CLASS,
  MODEL_SETTINGS_SURFACE_CLASS,
  ModelSettingsSectionHeader,
} from "./ModelSettingsSectionChrome";

export function McpToolsTab({ profileId }: { profileId?: string }) {
  const { t } = useT();
  const [items, setItems] = useState<HermesInstalledMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<HermesInstalledMcp | "new" | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await getHermesInstalledMcps(profileId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error || t("externalTools.mcp.loadFailed"));
      return;
    }
    setItems(result.items);
  }, [profileId, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useRefetchOnFocus(() => void refresh());

  async function onRemove(item: HermesInstalledMcp) {
    if (!confirm(`Remove MCP server “${item.label}”?`)) return;
    setBusy(item.slug);
    setError(null);
    const result = await removeHermesMcp(item.slug, profileId);
    setBusy(null);
    if (!result.ok) setError(result.error || "Failed to remove MCP server");
    else
      setItems((current) =>
        current.filter((entry) => entry.slug !== item.slug),
      );
  }

  async function onTest(item: HermesInstalledMcp) {
    setBusy(item.slug);
    setError(null);
    setMessage(null);
    const result = await testHermesMcp(item.slug, profileId);
    setBusy(null);
    if (!result.ok) setError(result.error || "Connection test failed");
    else
      setMessage(
        `${item.label}: ${result.tools?.length ?? 0} tools · ${result.prompts ?? 0} prompts · ${result.resources ?? 0} resources`,
      );
  }

  async function onToggle(item: HermesInstalledMcp, enabled: boolean) {
    setBusy(item.slug);
    setError(null);
    const input: HermesMcpInput = {
      enabled,
      description: item.description,
      url: item.url || undefined,
      command: item.command || undefined,
      args: item.args,
      cwd: item.cwd || undefined,
    };
    const result = await saveHermesMcp(item.slug, input, profileId);
    setBusy(null);
    if (!result.ok) setError(result.error || "Failed to update MCP server");
    else
      setItems((current) =>
        current.map((entry) =>
          entry.slug === item.slug ? { ...entry, enabled } : entry,
        ),
      );
  }

  return (
    <section className={MODEL_SETTINGS_SECTION_CLASS}>
      <ModelSettingsSectionHeader
        title={t("externalTools.mcp.title")}
        description={t("externalTools.mcp.subtitle")}
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
        <McpEditor
          item={editing === "new" ? undefined : editing}
          profileId={profileId}
          onCancel={() => setEditing(null)}
          onError={setError}
          onSaved={async () => {
            setEditing(null);
            setMessage("MCP server saved");
            await refresh();
          }}
        />
      ) : null}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {message ? (
        <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <McpListSkeleton />
      ) : items.length === 0 ? (
        <div className={MODEL_SETTINGS_SURFACE_CLASS}>
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
              <Server className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {t("externalTools.mcp.emptyTitle")}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("externalTools.mcp.emptyDescription")}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <ul className={MODEL_SETTINGS_SURFACE_CLASS} data-mcp-tools-surface>
          {items.map((item) => (
            <li
              key={item.slug}
              className="border-b border-border/40 last:border-b-0"
            >
              <div className="group flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/55 text-muted-foreground">
                  <Server className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/75">
                      {[t("externalTools.mcp.source"), item.transport_kind]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  {item.description ? (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
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
                  disabled={busy === item.slug}
                  onClick={() => void onTest(item)}
                  size="icon"
                  title="Test connection"
                  variant="ghost"
                >
                  <Stethoscope />
                </Button>
                <Button
                  disabled={busy === item.slug}
                  onClick={() => setEditing(item)}
                  size="icon"
                  title="Edit server"
                  variant="ghost"
                >
                  <Pencil />
                </Button>
                <Button
                  className="text-destructive hover:text-destructive"
                  disabled={busy === item.slug}
                  onClick={() => void onRemove(item)}
                  size="icon"
                  title="Remove server"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
                <Switch
                  checked={item.enabled}
                  disabled={busy === item.slug}
                  onCheckedChange={(enabled) => void onToggle(item, enabled)}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function parseStringMap(value: string): Record<string, string> | undefined {
  const text = value.trim();
  if (!text) return undefined;
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Expected a JSON object");
  const entries = Object.entries(parsed);
  if (!entries.every(([key, item]) => key && typeof item === "string"))
    throw new Error("All values must be strings");
  return Object.fromEntries(entries) as Record<string, string>;
}

function McpEditor({
  item,
  profileId,
  onCancel,
  onError,
  onSaved,
}: {
  item?: HermesInstalledMcp;
  profileId?: string;
  onCancel: () => void;
  onError: (error: string | null) => void;
  onSaved: () => void | Promise<void>;
}) {
  const [slug, setSlug] = useState(item?.slug ?? "");
  const [transport, setTransport] = useState<"http" | "stdio">(
    item?.transport_kind === "stdio" ? "stdio" : "http",
  );
  const [target, setTarget] = useState(item?.url || item?.command || "");
  const [args, setArgs] = useState((item?.args ?? []).join("\n"));
  const [description, setDescription] = useState(item?.description ?? "");
  const [env, setEnv] = useState("");
  const [headers, setHeaders] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!slug.trim() || !target.trim()) return;
    setSaving(true);
    onError(null);
    try {
      const input: HermesMcpInput = {
        description,
        enabled: item?.enabled ?? true,
        args:
          transport === "stdio"
            ? args
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
            : undefined,
        env: parseStringMap(env),
        headers: parseStringMap(headers),
        ...(transport === "http"
          ? { url: target.trim() }
          : { command: target.trim() }),
      };
      const result = await saveHermesMcp(slug.trim(), input, profileId);
      if (!result.ok)
        throw new Error(result.error || "Failed to save MCP server");
      await onSaved();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3 rounded-xl border border-border/60 bg-muted/15 p-3"
      onSubmit={(event) => void submit(event)}
    >
      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <Input
          disabled={!!item}
          onChange={(event) => setSlug(event.target.value)}
          placeholder="Server ID"
          value={slug}
        />
        <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
          {(["http", "stdio"] as const).map((kind) => (
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
              {kind.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <Input
        onChange={(event) => setTarget(event.target.value)}
        placeholder={
          transport === "http"
            ? "https://server.example/mcp"
            : "Command (for example npx)"
        }
        value={target}
      />
      {transport === "stdio" ? (
        <textarea
          className="min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
          onChange={(event) => setArgs(event.target.value)}
          placeholder="One argument per line"
          value={args}
        />
      ) : null}
      <Input
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Description (optional)"
        value={description}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <textarea
          className="min-h-20 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
          onChange={(event) => setEnv(event.target.value)}
          placeholder={
            item?.env_keys?.length
              ? `Environment JSON (leave blank to preserve: ${item.env_keys.join(", ")})`
              : "Environment JSON (optional)"
          }
          value={env}
        />
        <textarea
          className="min-h-20 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs"
          onChange={(event) => setHeaders(event.target.value)}
          placeholder={
            item?.header_keys?.length
              ? `Headers JSON (leave blank to preserve: ${item.header_keys.join(", ")})`
              : "Headers JSON (optional)"
          }
          value={headers}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel} type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={saving || !slug.trim() || !target.trim()}
          type="submit"
        >
          {saving ? "Saving…" : "Save server"}
        </Button>
      </div>
    </form>
  );
}

function McpListSkeleton() {
  return (
    <div className={MODEL_SETTINGS_SURFACE_CLASS}>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex items-center gap-3 border-b border-border/40 px-4 py-3 last:border-b-0"
        >
          <div className="h-8 w-8 animate-pulse rounded-md bg-muted/70" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-28 animate-pulse rounded bg-muted/70" />
            <div className="h-2.5 w-48 animate-pulse rounded bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  );
}
