import {
  getHermesPlugins,
  installPlugin,
  setPluginEnabled,
  testPlugin,
  uninstallPlugin,
  updatePlugin,
  type HermesPlugin,
} from "@amiba/core";
import {
  CheckCircle2,
  Plug,
  Plus,
  RefreshCw,
  Stethoscope,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useT } from "@amiba/i18n";
import { Button, CollectionState, Input, Switch, cn } from "../primitives";

type State =
  | { kind: "loading" }
  | { kind: "error"; error: string }
  | { kind: "loaded"; plugins: HermesPlugin[] };

export function PluginsTab({
  showAddAction = true,
  profileId,
}: { showAddAction?: boolean; profileId?: string } = {}) {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [restartHint, setRestartHint] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    void getHermesPlugins(profileId).then((res) => {
      if (cancelled) return;
      setState(
        res.ok
          ? { kind: "loaded", plugins: res.plugins }
          : { kind: "error", error: "backplane unreachable" },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  async function refresh() {
    const res = await getHermesPlugins(profileId);
    if (res.ok) setState({ kind: "loaded", plugins: res.plugins });
  }

  async function onToggle(p: HermesPlugin) {
    if (state.kind !== "loaded" || busy) return;
    setBusy(p.name);
    setToggleError(null);
    const next = !p.enabled;
    const res = await setPluginEnabled(p.name, next, profileId);
    setBusy(null);
    if (!res.ok) {
      setToggleError(
        t("options.plugins.toggleError", { error: res.error ?? "unknown" }),
      );
      return;
    }
    setState({
      kind: "loaded",
      plugins: state.plugins.map((x) =>
        x.name === p.name ? { ...x, enabled: next } : x,
      ),
    });
    setRestartHint(true);
  }

  async function onUninstall(p: HermesPlugin) {
    if (state.kind !== "loaded" || busy) return;
    if (!confirm(t("options.plugins.uninstallConfirm", { name: p.name })))
      return;
    setBusy(p.name);
    setToggleError(null);
    const res = await uninstallPlugin(p.name, profileId);
    setBusy(null);
    if (!res.ok) {
      setToggleError(
        t("options.plugins.uninstallError", { error: res.error ?? "unknown" }),
      );
      return;
    }
    setState({
      kind: "loaded",
      plugins: state.plugins.filter((x) => x.key !== p.key),
    });
    setRestartHint(true);
  }

  async function onInstall() {
    const value = identifier.trim();
    if (!value || busy) return;
    setBusy("__install__");
    setToggleError(null);
    setActionMessage(null);
    const res = await installPlugin(value, profileId);
    setBusy(null);
    if (!res.ok) {
      setToggleError(res.error || "Plugin installation failed");
      return;
    }
    setIdentifier("");
    setInstallOpen(false);
    const notes = [
      ...(res.warnings ?? []),
      ...(res.missingEnv?.length
        ? [`Missing environment: ${res.missingEnv.join(", ")}`]
        : []),
    ];
    setActionMessage(notes.join(" · ") || "Plugin installed and enabled");
    setRestartHint(true);
    await refresh();
  }

  async function onUpdate(p: HermesPlugin) {
    if (busy) return;
    setBusy(p.name);
    setToggleError(null);
    const res = await updatePlugin(p.key || p.name, profileId);
    setBusy(null);
    if (!res.ok) setToggleError(res.error || "Plugin update failed");
    else {
      setActionMessage(
        res.unchanged ? `${p.name} is already current` : `${p.name} updated`,
      );
      setRestartHint(true);
      await refresh();
    }
  }

  async function onTest(p: HermesPlugin) {
    if (busy) return;
    setBusy(p.name);
    setToggleError(null);
    const res = await testPlugin(p.key || p.name, profileId);
    setBusy(null);
    if (!res.ok) setToggleError(res.error || "Plugin test failed");
    else
      setActionMessage(
        `${p.name}: ${res.summary?.tools ?? 0} tools · ${res.summary?.hooks ?? 0} hooks · ${res.summary?.commands ?? 0} commands`,
      );
  }

  return (
    <div className="flex flex-col gap-5">
      {showAddAction ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            onClick={() => setInstallOpen((v) => !v)}
          >
            {installOpen ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {t("externalTools.plugin.add")}
          </Button>
        </div>
      ) : null}

      {installOpen ? (
        <form
          className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            void onInstall();
          }}
        >
          <Input
            autoFocus
            className="h-8 flex-1 font-mono text-xs"
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="Git URL, local path, or plugin identifier"
            value={identifier}
          />
          <Button
            disabled={!identifier.trim() || busy === "__install__"}
            size="sm"
            type="submit"
          >
            {busy === "__install__" ? (
              <RefreshCw className="animate-spin" />
            ) : (
              <Plus />
            )}
            Install
          </Button>
        </form>
      ) : null}

      {restartHint && (
        <p className="border-y border-amber-500/25 bg-amber-500/[0.04] px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
          {t("options.plugins.restartHint")}
        </p>
      )}
      {toggleError && <p className="text-sm text-destructive">{toggleError}</p>}
      {actionMessage && (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4" />
          {actionMessage}
        </p>
      )}

      {state.kind === "loading" && (
        <CollectionState role="status">
          {t("options.plugins.loading")}
        </CollectionState>
      )}
      {state.kind === "error" && (
        <p className="border-y border-destructive/25 bg-destructive/[0.035] px-3 py-3 text-sm text-destructive">
          {t("options.plugins.error", { error: state.error })}
        </p>
      )}
      {state.kind === "loaded" && (
        <PluginGroups
          plugins={state.plugins}
          busy={busy}
          onToggle={onToggle}
          onTest={onTest}
          onUpdate={onUpdate}
          onUninstall={onUninstall}
        />
      )}
    </div>
  );
}

function sortPlugins(list: HermesPlugin[]): HermesPlugin[] {
  return list
    .slice()
    .sort(
      (a, b) =>
        Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name),
    );
}

function PluginGroups({
  plugins,
  busy,
  onToggle,
  onTest,
  onUpdate,
  onUninstall,
}: {
  plugins: HermesPlugin[];
  busy: string | null;
  onToggle: (p: HermesPlugin) => void;
  onTest: (p: HermesPlugin) => void;
  onUpdate: (p: HermesPlugin) => void;
  onUninstall: (p: HermesPlugin) => void;
}) {
  const { t } = useT();
  const yours = sortPlugins(plugins.filter((p) => p.source !== "bundled"));

  return (
    <section>
      {yours.length === 0 ? (
        <CollectionState>{t("options.plugins.empty.title")}</CollectionState>
      ) : (
        <PluginList
          plugins={yours}
          busy={busy}
          onToggle={onToggle}
          onTest={onTest}
          onUpdate={onUpdate}
          onUninstall={onUninstall}
        />
      )}
    </section>
  );
}

function PluginList({
  plugins,
  busy,
  onToggle,
  onTest,
  onUpdate,
  onUninstall,
}: {
  plugins: HermesPlugin[];
  busy: string | null;
  onToggle: (p: HermesPlugin) => void;
  onTest: (p: HermesPlugin) => void;
  onUpdate: (p: HermesPlugin) => void;
  onUninstall: (p: HermesPlugin) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-x-8 gap-y-1 md:grid-cols-2">
      {plugins.map((p) => (
        <PluginRow
          key={p.key}
          p={p}
          busy={busy === p.name}
          onToggle={() => onToggle(p)}
          onTest={() => onTest(p)}
          onUpdate={() => onUpdate(p)}
          onUninstall={() => onUninstall(p)}
        />
      ))}
    </ul>
  );
}

function PluginRow({
  p,
  busy,
  onToggle,
  onTest,
  onUpdate,
  onUninstall,
}: {
  p: HermesPlugin;
  busy: boolean;
  onToggle: () => void;
  onTest: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
}) {
  const { t } = useT();
  const slash = p.key.indexOf("/");
  const category = slash > 0 ? p.key.slice(0, slash) : null;
  const canUninstall = p.source === "user" || p.source === "entrypoint";
  return (
    <li
      className="flex min-h-[76px] items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/35"
      title={`${p.key}${p.dist ? `\npip: ${p.dist}` : ""}`}
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-border/60 bg-background text-muted-foreground">
        <Plug className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-sm font-medium">{p.name}</span>
          {p.version ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              v{p.version}
            </span>
          ) : null}
          {category ? (
            <span className="shrink-0 text-xs text-muted-foreground">
              {category}
            </span>
          ) : null}
        </div>
        {p.description && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {p.description}
          </p>
        )}
        {p.error ? (
          <p className="mt-1 truncate text-xs text-destructive">{p.error}</p>
        ) : null}
      </div>
      <div
        className={cn("flex shrink-0 items-center gap-1", busy && "opacity-50")}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={onTest}
          title="Test discovery"
          disabled={busy}
        >
          <Stethoscope />
        </Button>
        {p.source === "user" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onUpdate}
            title="Update plugin"
            disabled={busy}
          >
            <RefreshCw className={cn(busy && "animate-spin")} />
          </Button>
        ) : null}
        {canUninstall && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onUninstall}
            title={t("options.plugins.uninstallAction")}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 />
          </Button>
        )}
        <Switch
          checked={p.enabled}
          disabled={busy}
          onCheckedChange={onToggle}
        />
      </div>
    </li>
  );
}
