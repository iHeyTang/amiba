import { ArrowLeft, Loader2, Lock, Plus, QrCode } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import qrcode from "qrcode-generator";

import {
  Button,
  Input,
  Label,
  WizardFrame,
  usePluginT,
  type PluginTranslateFn,
} from "@amiba/ui/plugin";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";

import { DingtalkMark } from "./brand-mark.js";
import { dingtalkI18n } from "./i18n.js";

type OnboardingView = Awaited<
  ReturnType<ConnectWizardHost["adapter"]["pollOnboarding"]>
>;

const ONBOARD_POLL_INTERVAL_MS = 1500;

function useT() {
  return usePluginT(dingtalkI18n);
}

const KNOWN_CREATE_ERRORS: Record<string, string> = {
  agent_preset_required: "options.connect.dsh.error.agent_preset_required",
  provider_not_found: "options.connect.dsh.error.provider_not_found",
  connect_not_found: "options.connect.dsh.error.connect_not_found",
  invalid_channel: "options.connect.dsh.error.invalid_channel",
  grant_not_found: "options.connect.dsh.error.grant_not_found",
  onboarding_not_found: "options.connect.dsh.error.onboarding_not_found",
  onboarding_unsupported: "options.connect.dsh.error.onboarding_unsupported",
  dingtalk_registration_expired: "options.connect.dsh.onboard.error.expired",
  dingtalk_registration_failed: "options.connect.dsh.onboard.error.failed",
  dingtalk_registration_network: "options.connect.dsh.onboard.error.network",
  dingtalk_registration_invalid: "options.connect.dsh.onboard.error.invalid",
  dingtalk_registration_api: "options.connect.dsh.onboard.error.api",
};

function describeError(t: PluginTranslateFn, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const key = KNOWN_CREATE_ERRORS[message];
  return key ? t(key) : message;
}

const KNOWN_STATUS_NOTES: Record<string, string> = {
  polling: "options.connect.dsh.onboard.note.polling",
  retrying: "options.connect.dsh.onboard.note.retrying",
};

function describeStatusNote(t: PluginTranslateFn, note: string): string {
  const key = KNOWN_STATUS_NOTES[note];
  return key ? t(key) : note;
}

export function DingtalkWizard({
  host,
}: {
  host: ConnectWizardHost;
}): ReactNode {
  const { t } = useT();
  const hostRef = useRef(host);
  hostRef.current = host;
  const [name, setName] = useState(host.prefill?.name ?? "钉钉");
  const [preset, setPreset] = useState(host.prefill?.agentPreset ?? "");
  const [mode, setMode] = useState<"scan" | "manual">("scan");
  const [onboarding, setOnboarding] = useState<OnboardingView | null>(null);
  const [beginning, setBeginning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  const clientIdId = useId();
  const clientSecretId = useId();
  const sessionIdRef = useRef<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = useRef(false);
  const sessionContextRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const clearPollInterval = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const cancelCurrentSession = useCallback(() => {
    clearPollInterval();
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    sessionContextRef.current += 1;
    if (sessionId) {
      void Promise.resolve()
        .then(() => hostRef.current.adapter.cancelOnboarding(sessionId))
        .catch(() => {});
    }
    if (mountedRef.current) {
      setOnboarding(null);
      setBeginning(false);
    }
  }, [clearPollInterval]);
  useEffect(() => {
    return () => {
      cancelCurrentSession();
    };
  }, [cancelCurrentSession]);

  function handleModeChange(next: "scan" | "manual") {
    if (next === mode) return;
    setMode(next);
    setError(null);
    cancelCurrentSession();
  }

  const poll = useCallback(async () => {
    if (pollingRef.current) return;
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    pollingRef.current = true;
    try {
      const view = await hostRef.current.adapter.pollOnboarding(sessionId);
      if (!mountedRef.current || sessionIdRef.current !== sessionId) return;
      setOnboarding(view);
      if (view.state === "pending") return;
      sessionIdRef.current = null;
      clearPollInterval();
      if (view.state === "completed") {
        if (view.connect) {
          hostRef.current.done(view.connect);
          return;
        }
        setError(t("options.connect.dsh.onboard.error.generic"));
        setOnboarding(null);
      } else {
        setError(
          view.error
            ? describeError(t, new Error(view.error))
            : t("options.connect.dsh.onboard.error.generic"),
        );
        setOnboarding(null);
      }
    } catch (cause) {
      if (!mountedRef.current || sessionIdRef.current !== sessionId) return;
      cancelCurrentSession();
      setError(describeError(t, cause));
    } finally {
      pollingRef.current = false;
    }
  }, [clearPollInterval, cancelCurrentSession, t]);

  async function beginScan() {
    const current = hostRef.current;
    const trimmedName = name.trim();
    if (!trimmedName || !preset.trim()) return;
    setError(null);
    setBeginning(true);
    const sessionContextAtStart = sessionContextRef.current;
    try {
      const view = await current.adapter.beginOnboarding({
        provider: current.providerId,
        name: trimmedName,
        agentPreset: preset,
      });
      const stale =
        !mountedRef.current ||
        sessionContextRef.current !== sessionContextAtStart;
      if (stale) {
        if (view.state === "pending") {
          void Promise.resolve()
            .then(() => current.adapter.cancelOnboarding(view.sessionId))
            .catch(() => {});
        }
        return;
      }
      setOnboarding(view);
      if (view.state === "pending") {
        sessionIdRef.current = view.sessionId;
        clearPollInterval();
        pollRef.current = setInterval(() => {
          void poll();
        }, ONBOARD_POLL_INTERVAL_MS);
        return;
      }
      if (view.state === "completed") {
        if (view.connect) {
          current.done(view.connect);
          return;
        }
        setError(t("options.connect.dsh.onboard.error.generic"));
        setOnboarding(null);
        return;
      }
      if (view.state === "error" || view.state === "cancelled") {
        setError(
          view.error
            ? describeError(t, new Error(view.error))
            : t("options.connect.dsh.onboard.error.generic"),
        );
        setOnboarding(null);
      }
    } catch (cause) {
      if (
        !mountedRef.current ||
        sessionContextRef.current !== sessionContextAtStart
      )
        return;
      setError(describeError(t, cause));
    } finally {
      if (
        mountedRef.current &&
        sessionContextRef.current === sessionContextAtStart
      )
        setBeginning(false);
    }
  }

  async function submit() {
    const current = hostRef.current;
    const trimmedName = name.trim();
    const trimmedClientId = clientId.trim();
    const trimmedClientSecret = clientSecret.trim();
    if (
      !trimmedName ||
      !preset.trim() ||
      !trimmedClientId ||
      !trimmedClientSecret
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const connect = await current.adapter.create({
        provider: current.providerId,
        name: trimmedName,
        agentPreset: preset,
        config: {
          clientId: trimmedClientId,
          clientSecret: trimmedClientSecret,
        },
      });
      if (mountedRef.current) current.done(connect);
    } catch (cause) {
      if (mountedRef.current) setError(describeError(t, cause));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }
  const basicsReady = Boolean(name.trim()) && Boolean(preset.trim());
  const canBeginScan = basicsReady;
  const canSubmit =
    basicsReady && Boolean(clientId.trim()) && Boolean(clientSecret.trim());
  const { BasicsFields } = host.kit;

  return (
    <WizardFrame
      actions={
        mode === "manual" ? (
          <Button
            disabled={saving || !canSubmit}
            onClick={() => void submit()}
            type="button"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("options.connect.dsh.submit")}
          </Button>
        ) : null
      }
      backLabel={t("options.connect.dsh.wizard.changePlatform")}
      closeLabel={t("options.connect.dsh.close")}
      hint={
        <>
          <Lock className="h-3 w-3" />
          {t("options.connect.dsh.wizard.privacyHint")}
        </>
      }
      icon={<DingtalkMark size={20} />}
      iconAppearance="bare"
      onBack={host.back}
      onClose={() => host.cancel()}
      subtitle={
        mode === "scan"
          ? t("options.connect.dsh.dingtalk.subtitleScan")
          : t("options.connect.dsh.dingtalk.subtitleManual")
      }
      title={t("options.connect.dsh.dingtalk.title")}
    >
      <div className="space-y-6">
        <details className="space-y-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t("options.connect.dsh.onboard.customize")}
          </summary>
          <BasicsFields
            name={name}
            onNameChange={setName}
            onPresetChange={setPreset}
            preset={preset}
            presets={host.presets}
          />
        </details>
        {mode === "scan" ? (
          <section
            className="space-y-2"
            aria-label={t("options.connect.dsh.dingtalk.scan.title")}
          >
            <div className="flex min-h-44 items-center justify-center rounded-xl bg-muted/20 px-5 py-5">
              {onboarding ? (
                <OnboardingScanPane onboarding={onboarding} t={t} />
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <QrCode
                    className="h-9 w-9 text-muted-foreground/60"
                    aria-hidden="true"
                  />
                  <p className="max-w-sm text-center text-[13px] text-muted-foreground">
                    {t("options.connect.dsh.onboard.intro")}
                  </p>
                  <Button
                    disabled={beginning || !canBeginScan}
                    onClick={() => void beginScan()}
                    type="button"
                  >
                    {beginning ? <Loader2 className="animate-spin" /> : null}
                    {t("options.connect.dsh.onboard.begin")}
                  </Button>
                </div>
              )}
            </div>
            <div className="text-center">
              <Button
                className="text-muted-foreground"
                onClick={() => handleModeChange("manual")}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t("options.connect.dsh.onboard.modeManual")}
              </Button>
            </div>
          </section>
        ) : (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">
                {t("options.connect.dsh.dingtalk.credentials.title")}
              </h3>
              <Button
                className="text-muted-foreground"
                disabled={saving}
                onClick={() => handleModeChange("scan")}
                size="sm"
                type="button"
                variant="ghost"
              >
                <ArrowLeft />
                {t("options.connect.dsh.onboard.modeScan")}
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={clientIdId}>
                  {t("options.connect.dsh.dingtalk.clientId")}
                </Label>
                <Input
                  id={clientIdId}
                  onChange={(event) => setClientId(event.target.value)}
                  value={clientId}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={clientSecretId}>
                  {t("options.connect.dsh.dingtalk.clientSecret")}
                </Label>
                <Input
                  id={clientSecretId}
                  onChange={(event) => setClientSecret(event.target.value)}
                  type="password"
                  value={clientSecret}
                />
              </div>
            </div>
          </section>
        )}
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-destructive/5 px-3 py-2.5 text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
    </WizardFrame>
  );
}

function OnboardingScanPane({
  onboarding,
  t,
}: {
  onboarding: OnboardingView;
  t: PluginTranslateFn;
}) {
  if (onboarding.state === "error") return null;

  if (onboarding.qrUrl) {
    const qr = qrcode(0, "M");
    qr.addData(onboarding.qrUrl);
    qr.make();
    const svg = qr.createSvgTag({ cellSize: 4, margin: 2 });
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    return (
      <div className="space-y-3 text-center">
        <img
          alt={t("options.connect.dsh.onboard.qrAlt")}
          className="mx-auto h-40 w-40 rounded bg-white p-2"
          src={dataUrl}
        />
        {onboarding.statusNote ? (
          <p className="text-[13px] text-muted-foreground">
            {describeStatusNote(t, onboarding.statusNote)}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-center gap-2 px-2 py-6 text-center text-[13px] text-muted-foreground">
      <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      <span>
        {onboarding.statusNote
          ? describeStatusNote(t, onboarding.statusNote)
          : t("options.connect.dsh.onboard.waiting")}
      </span>
    </div>
  );
}
