import { providerOnboardingI18n } from "./i18n-onboarding.js";
import { useCallback, useEffect, useState } from "react";
import type { GuideStepOwner } from "@amiba/dsh-plugin-onboarding/client";
import { Button, usePluginT } from "@amiba/ui/plugin";
import type { ProviderSettingsController } from "./ModelProviderConfigTab.js";
import { OfficialProviderEditor } from "./OfficialProviderEditor.js";
import type { ModelPlaneSnapshotShape } from "./view-types.js";
export function ProviderOnboarding({
  adapter,
  complete,
  say,
  openSection,
}: GuideStepOwner & { adapter: ProviderSettingsController }) {
  const { t } = usePluginT(providerOnboardingI18n);
  const [snapshot, setSnapshot] = useState<ModelPlaneSnapshotShape>();
  const [selected, setSelected] = useState("tokendance");
  const [model, setModel] = useState("");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const next = await adapter.snapshot();
      setSnapshot(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [adapter]);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const next = await adapter.snapshot();
        if (live && current === generation) {
          setSnapshot(next);
          setFailed(false);
        }
      } catch {
        if (live && current === generation) setFailed(true);
      }
    };
    void refresh();
    const off = adapter.subscribe?.(() => void refresh());
    return () => {
      live = false;
      off?.();
    };
  }, [adapter]);
  // Keep copy stable: usePluginT returns a realm translation callback.
  useEffect(() => {
    say(t("setup.choose"), "waiting");
  }, [say, t]);
  const provider = snapshot?.providers.find((p) => p.id === selected);
  const models = provider?.enabled
    ? provider.models.filter((m) => m.enabled !== false)
    : [];
  const defaultModel =
    snapshot?.defaultSelection?.provider === selected
      ? snapshot.defaultSelection.model
      : "";
  const chosen = models.some((m) => m.id === model)
    ? model
    : models.some((m) => m.id === defaultModel)
      ? defaultModel
      : (models[0]?.id ?? "");
  async function configure() {
    if (!provider?.configuration || pending) return;
    setPending(true);
    setFailed(false);
    say(t("setup.loading"), "loading");
    try {
      // Dormant provider profiles must exist before the schema can expose
      // their default credential references (TokenDance ships undeclared).
      if (!provider.official?.active) {
        if (!adapter.configure)
          throw new Error("Provider configuration unavailable");
        setSnapshot(
          await adapter.configure(provider.id, {
            expectedRevision: provider.configuration.revision,
            ops: [{ op: "set", path: [], value: provider.configuration.value }],
            credentials: [],
          }),
        );
      }
      setEditing(true);
      say(t("setup.choose"), "waiting");
    } catch {
      setFailed(true);
      say(t("setup.failed"), "failed");
    } finally {
      setPending(false);
    }
  }
  async function proceed() {
    if (!chosen || pending) return;
    setPending(true);
    setFailed(false);
    say(t("setup.working"), "loading");
    try {
      const next = await adapter.setDefaultSelection(
        { provider: selected, model: chosen },
        snapshot?.revision,
      );
      setSnapshot(next);
      await complete();
      say(t("setup.saved"), "completed");
    } catch {
      await load();
      setFailed(true);
      say(t("setup.failed"), "failed");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="space-y-4">
      <div
        className="grid gap-3 sm:grid-cols-2"
        role="group"
        aria-label={t("setup.model")}
      >
        {[
          { id: "tokendance", name: "TokenDance", description: "setup.token" },
          { id: "deepseek", name: "DeepSeek", description: "setup.deepseek" },
        ].map((item) => (
          <button
            type="button"
            key={item.id}
            aria-pressed={selected === item.id}
            disabled={pending}
            onClick={() => {
              setSelected(item.id);
              setModel("");
              say(t(item.description), "waiting");
            }}
            className={`rounded-xl border p-4 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected === item.id ? "border-primary bg-muted" : "border-border"}`}
          >
            <span className="block text-sm font-semibold">{item.name}</span>
            <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
              {t(item.description)}
            </span>
          </button>
        ))}
      </div>
      {!snapshot ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t(failed ? "setup.failed" : "setup.loading")}
        </p>
      ) : !provider ? (
        <p className="text-sm text-muted-foreground">{t("setup.missing")}</p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("setup.hint")}
          </p>
          <Button
            variant="outline"
            disabled={pending || !provider.editable}
            onClick={() => void configure()}
          >
            {t("setup.configure")} · {provider.displayName}
          </Button>
          {models.length > 0 ? (
            <label className="block space-y-2 text-sm">
              <span>{t("setup.model")}</span>
              <select
                aria-label={t("setup.model")}
                disabled={pending}
                value={chosen}
                onChange={(e) => setModel(e.target.value)}
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-xs text-muted-foreground">{t("setup.fix")}</p>
          )}
        </>
      )}
      {failed && snapshot && (
        <p role="alert" className="text-sm text-destructive">
          {t("setup.failed")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!chosen || pending} onClick={() => void proceed()}>
          {t("setup.continue")}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => void load()}>
          {t("setup.retry")}
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => openSection("models")}
        >
          {t("setup.other")}
        </Button>
      </div>
      {editing && provider && snapshot && (
        <OfficialProviderEditor
          key={provider.id}
          provider={provider}
          snapshot={snapshot}
          adapter={adapter}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            setSnapshot(next);
            setEditing(false);
            say(t("setup.choose"), "waiting");
          }}
        />
      )}
    </div>
  );
}
