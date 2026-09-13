import { Check, ArrowUpRight, ChevronDown } from "lucide-react";
import { providerOnboardingI18n } from "./i18n-onboarding.js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GuideStepOwner } from "@amiba/dsh-plugin-onboarding/client";
import { Button, Input, ModelPickerDialog, usePluginT } from "@amiba/ui/plugin";
import type { ProviderSettingsController } from "./ModelProviderConfigTab.js";
import type { ModelPlaneSnapshotShape } from "./view-types.js";

// Public account pages, verified against each provider's own documentation.
export const PROVIDER_KEY_PAGES = {
  tokendance: "https://tokendance.space/keys",
  deepseek: "https://platform.deepseek.com/api_keys",
} as const;
type Page = "choose" | "key" | "model";
export function ProviderOnboarding({
  adapter,
  complete,
  say,
  openSection,
  renderActions,
  renderProgress,
  backToWelcome,
}: GuideStepOwner & { adapter: ProviderSettingsController }) {
  const { t } = usePluginT(providerOnboardingI18n);
  const [snapshot, setSnapshot] = useState<ModelPlaneSnapshotShape>();
  const [selected, setSelected] =
    useState<keyof typeof PROVIDER_KEY_PAGES>("tokendance");
  const [page, setPage] = useState<Page>("choose");
  const [model, setModel] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [key, setKey] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const saving = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback(async () => {
    const next = await adapter.snapshot();
    setSnapshot(next);
    return next;
  }, [adapter]);
  useEffect(() => {
    let live = true;
    let generation = 0;
    const refresh = async () => {
      const current = ++generation;
      try {
        const next = await adapter.snapshot();
        if (live && current === generation) setSnapshot(next);
      } catch {
        if (live && current === generation) setFailed(true);
      }
    };
    void refresh();
    const off = adapter.subscribe?.(() => {
      if (!saving.current) void refresh();
    });
    return () => {
      live = false;
      off?.();
    };
  }, [adapter]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const scrollArea = heading.current?.closest<HTMLElement>(
      "[data-guide-scroll]",
    );
    if (scrollArea) scrollArea.scrollTop = 0;
  }, [page]);
  useEffect(() => {
    say(
      t(
        pending
          ? "setup.saving"
          : failed
            ? "setup.failed"
            : page === "choose"
              ? "setup.choose"
              : page === "key"
                ? "setup.keyTalk"
                : "setup.modelTalk",
      ),
      pending ? "loading" : failed ? "failed" : "waiting",
    );
  }, [page, pending, failed, say, t]);
  const provider = snapshot?.providers.find((p) => p.id === selected);
  const config = provider?.configuration;
  const credential = config?.credentialFields[0];
  const stored =
    !!credential && snapshot?.credentials[credential.ref]?.configured === true;
  const writable =
    provider?.editable &&
    snapshot?.credentials[credential?.ref ?? ""]?.writable !== false;
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
  const providerName = selected === "tokendance" ? "TokenDance" : "DeepSeek";
  async function run(action: () => Promise<void>) {
    if (saving.current) return;
    saving.current = true;
    setPending(true);
    setFailed(false);
    try {
      await action();
    } catch {
      await load().catch(() => {});
      setFailed(true);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }
  function next() {
    return run(async () => {
      if (page === "choose") {
        const latest = await load();
        const current = latest.providers.find((p) => p.id === selected);
        if (!current?.configuration) throw new Error("Provider unavailable");
        // Materialize the dormant profile so DSH supplies its default
        // credential reference. Do not invent a ref or change endpoints.
        if (!current.official?.active) {
          if (!current.editable || !adapter.configure)
            throw new Error("Settings read-only");
          setSnapshot(
            await adapter.configure(selected, {
              expectedRevision: current.configuration.revision,
              ops: [
                { op: "set", path: [], value: current.configuration.value },
              ],
              credentials: [],
            }),
          );
        }
        setPage("key");
      } else if (page === "key") {
        const latest = await load();
        const current = latest.providers.find((p) => p.id === selected);
        const field = current?.configuration?.credentialFields[0];
        if (!current?.configuration || !field)
          throw new Error("Credential unavailable");
        if (key.trim()) {
          if (
            !adapter.configure ||
            !current.editable ||
            latest.credentials[field.ref]?.writable === false
          )
            throw new Error("Credential read-only");
          const next = await adapter.configure(selected, {
            expectedRevision: current.configuration.revision,
            ops: [],
            credentials: [{ ref: field.ref, value: key.trim() }],
          });
          setSnapshot(next);
          setKey("");
        } else if (!latest.credentials[field.ref]?.configured)
          throw new Error("Credential missing");
        setPage("model");
      } else {
        if (!chosen) return;
        setSnapshot(
          await adapter.setDefaultSelection(
            { provider: selected, model: chosen },
            snapshot?.revision,
          ),
        );
        await complete();
      }
    });
  }
  const disabled =
    pending ||
    (page === "choose"
      ? !config || (!provider?.official?.active && !writable)
      : page === "key"
        ? !credential || (!key.trim() && !stored) || (!!key.trim() && !writable)
        : !chosen);
  const stages: Page[] = ["choose", "key", "model"];
  const progressBar = (
    <ol className="flex items-start pb-3 pt-1" aria-label={t("setup.progress")}>
      {stages.map((stage, index) => {
        const current = stages.indexOf(page);
        const done = index < current;
        return (
          <li
            key={stage}
            aria-current={page === stage ? "step" : undefined}
            className="relative flex flex-1 flex-col items-center gap-2 text-center"
          >
            {index < stages.length - 1 && (
              <span
                aria-hidden="true"
                className={`absolute left-1/2 top-4 h-px w-full ${done ? "bg-primary" : "bg-border"}`}
              />
            )}
            <span
              aria-hidden="true"
              className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${done ? "border-primary bg-primary text-primary-foreground" : page === stage ? "border-primary bg-background text-primary ring-4 ring-primary/10" : "border-border bg-background text-muted-foreground"}`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span
              className={`text-xs ${page === stage ? "font-semibold text-foreground" : "text-muted-foreground"}`}
            >
              {t(`setup.stage.${stage}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
  return (
    <div className="space-y-6">
      {renderProgress ? renderProgress(progressBar) : progressBar}
      <h3 ref={heading} tabIndex={-1} className="sr-only">
        {page === "choose"
          ? t("setup.selectTitle")
          : page === "key"
            ? `${providerName} · ${t("setup.keyTitle")}`
            : t("setup.modelTitle")}
      </h3>
      {page === "choose" ? (
        <>
          <div
            className="grid gap-3 sm:grid-cols-2"
            role="group"
            aria-label={t("setup.selectTitle")}
          >
            {(
              [
                {
                  id: "tokendance",
                  name: "TokenDance",
                  description: "setup.token",
                },
                {
                  id: "deepseek",
                  name: "DeepSeek",
                  description: "setup.deepseek",
                },
              ] as const
            ).map((item) => (
              <div
                key={item.id}
                className={`relative flex flex-col gap-2 rounded-xl border p-2 transition-colors ${selected === item.id ? "border-primary bg-primary/5 hover:bg-primary/10" : "border-border bg-background hover:bg-muted/50"}`}
              >
                <button
                  type="button"
                  aria-pressed={selected === item.id}
                  disabled={pending}
                  onClick={() => {
                    setSelected(item.id);
                    setModel("");
                    setKey("");
                    setFailed(false);
                  }}
                  className="flex-1 rounded-lg p-2 text-left after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                >
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold">
                    {item.name}
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 items-center justify-center rounded-full border ${selected === item.id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
                    >
                      {selected === item.id && (
                        <Check className="h-2.5 w-2.5" />
                      )}
                    </span>
                  </span>
                  <span className="mt-2 block text-xs leading-relaxed text-muted-foreground">
                    {t(item.description)}
                  </span>
                </button>
                <a
                  href={
                    item.id === "tokendance"
                      ? "https://tokendance.space/"
                      : "https://www.deepseek.com/"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${item.name} ${t("setup.website")}`}
                  className="relative z-10 mx-2 mb-2 flex w-fit items-center gap-1 rounded py-1 text-xs text-muted-foreground underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("setup.website")}
                  <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
                </a>
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() => openSection("models")}
            className="text-xs text-muted-foreground underline underline-offset-4"
          >
            {t("setup.other")}
          </button>
          {!snapshot ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("setup.loading")}
            </p>
          ) : !provider ? (
            <p className="text-sm text-muted-foreground">
              {t("setup.missing")}
            </p>
          ) : null}
        </>
      ) : page === "key" ? (
        <>
          <form
            id="onboarding-provider-key"
            onSubmit={(e) => {
              e.preventDefault();
              if (!disabled) void next();
            }}
            className="space-y-2"
          >
            <label htmlFor="onboarding-api-key" className="text-sm font-medium">
              {providerName} API Key
            </label>
            <Input
              id="onboarding-api-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              value={key}
              disabled={pending || !writable}
              placeholder={t(
                stored ? "setup.storedPlaceholder" : "setup.keyPlaceholder",
              )}
              onChange={(e) => setKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t(stored ? "setup.stored" : "setup.keyPrivacy")}
            </p>
          </form>
          <div className="space-y-3 text-xs text-muted-foreground">
            <p className="leading-relaxed">{t("setup.keyExplain")}</p>
            <ol className="list-decimal space-y-2 pl-4 leading-relaxed">
              <li>
                <a
                  href={PROVIDER_KEY_PAGES[selected]}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-primary"
                >
                  {t(
                    selected === "tokendance"
                      ? "setup.token.open"
                      : "setup.deepseek.open",
                  )}{" "}
                  ↗
                </a>
                {t("setup.login")}
              </li>
              <li>
                {t(
                  selected === "tokendance"
                    ? "setup.token.create"
                    : "setup.deepseek.create",
                )}
              </li>
              <li>{t("setup.copy")}</li>
            </ol>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t("setup.billing")}
            </p>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {t("setup.modelHint")}
          </p>
          {models.length > 0 ? (
            <div className="space-y-2 text-sm">
              <span id="onboarding-model-label">{t("setup.model")}</span>
              <Button
                variant="outline"
                aria-labelledby="onboarding-model-label"
                aria-haspopup="dialog"
                aria-expanded={pickerOpen}
                disabled={pending}
                className="w-full justify-between"
                onClick={() => setPickerOpen(true)}
              >
                {models.find((m) => m.id === chosen)?.name ?? chosen}
                <ChevronDown
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-muted-foreground"
                />
              </Button>
              <ModelPickerDialog
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                title={t("setup.model")}
                groups={[
                  {
                    id: selected,
                    provider: selected,
                    label: providerName,
                    models: models.map((m) => ({ model: m.id, label: m.name })),
                  },
                ]}
                selected={{ provider: selected, model: chosen }}
                saving={pending}
                onSelect={(_provider, modelId) => {
                  setModel(modelId);
                  setPickerOpen(false);
                }}
              />
            </div>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              {t("setup.noModels")}
            </p>
          )}
        </>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {t("setup.failed")}
        </p>
      )}
      {(failed || (page === "model" && !models.length)) && (
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            void run(async () => {
              await load();
            })
          }
        >
          {t("setup.retry")}
        </Button>
      )}
      {renderActions(
        <>
          {(page !== "choose" || backToWelcome) && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                if (page === "choose") backToWelcome?.();
                else setPage(page === "model" ? "key" : "choose");
                setFailed(false);
              }}
            >
              {t("setup.back")}
            </Button>
          )}
          <Button
            disabled={disabled}
            type={page === "key" ? "submit" : "button"}
            form={page === "key" ? "onboarding-provider-key" : undefined}
            onClick={page === "key" ? undefined : () => void next()}
          >
            {t(
              pending
                ? "setup.saving"
                : page === "choose"
                  ? "setup.next"
                  : page === "key"
                    ? stored && !key.trim()
                      ? "setup.next"
                      : "setup.saveKey"
                    : "setup.finish",
            )}
          </Button>
        </>,
      )}
    </div>
  );
}
