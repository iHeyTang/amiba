import { ChevronLeft, Loader2, Lock, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  Button,
  Input,
  Label,
  Switch,
  WizardFrame,
  usePluginT,
  type PluginTranslateFn,
} from "@amiba/ui/plugin";
import type { MessageChannelApproval } from "@amiba/dsh-plugin-connector-core";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";

import { DingtalkMark } from "./brand-mark.js";
import { dingtalkI18n } from "./i18n.js";

/**
 * Wraps `usePluginT` with this plugin's own i18n overlay (see `./i18n.ts`) —
 * same convention connector-core's own client files (and the lark wizard)
 * use, so overlay-covered keys resolve locally instead of depending on a host
 * `options.connect.*` bundle that no longer carries them.
 */
function useT() {
  return usePluginT(dingtalkI18n);
}

/**
 * Every failure code `ConnectorCenter#createConnect` can hand back, mapped to
 * this plugin's own translated copy (see `./i18n.ts`). All seven live here
 * rather than only the ones this manual-only wizard is likely to hit: a
 * provider body must be able to translate every failure its own submit path
 * can produce without reaching into another plugin's catalog. An
 * unrecognised message still falls back to the raw string — better a real
 * message than nothing.
 */
const KNOWN_CREATE_ERRORS: Record<string, string> = {
  agent_preset_required: "options.connect.dsh.error.agent_preset_required",
  provider_not_found: "options.connect.dsh.error.provider_not_found",
  connect_not_found: "options.connect.dsh.error.connect_not_found",
  invalid_channel: "options.connect.dsh.error.invalid_channel",
  grant_not_found: "options.connect.dsh.error.grant_not_found",
  onboarding_not_found: "options.connect.dsh.error.onboarding_not_found",
  onboarding_unsupported: "options.connect.dsh.error.onboarding_unsupported",
};

function describeError(t: PluginTranslateFn, cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  const key = KNOWN_CREATE_ERRORS[message];
  return key ? t(key) : message;
}

/**
 * The DingTalk connect screen, registered for the `"dingtalk"` provider and
 * mounted whole into whatever seat the host gives it (the settings dialog
 * today, the composer next). It draws its OWN header, form — connect name and
 * agent preset included, via `host.kit.BasicsFields` — and footer buttons;
 * nothing wraps it. DingTalk has no scan-to-connect flow — this is a manual
 * form only: Client ID, Client Secret, and an opt-in tools switch, submitted
 * through `host.adapter.create`.
 *
 * Depends on nothing from connector-core but the `host` prop (its type
 * aside), so the same screen works in the settings modal and, later, in the
 * composer.
 */
export function DingtalkWizard({ host }: { host: ConnectWizardHost }): ReactNode {
  const { t } = useT();
  // The seat rebuilds `host` on every render, so `submit` reads the adapter
  // and the `done`/`cancel` callbacks through this ref AT CALL TIME instead
  // of closing over the render's `host`.
  const hostRef = useRef(host);
  hostRef.current = host;

  // The screen owns its basics: `host.prefill` only SEEDS them (the chat
  // tool's suggested name/preset), it never keeps owning them.
  const [name, setName] = useState(host.prefill?.name ?? "");
  const [preset, setPreset] = useState(host.prefill?.agentPreset ?? "");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [enableTools, setEnableTools] = useState(false);
  // Seeded from the kit (`host.kit.defaultApproval`), the same place
  // `ApprovalField` itself comes from: each plugin client is its own bundle,
  // so parts travel on the host rather than through imports — which is what
  // keeps the `timeout`/10-minute literal in connector-core alone.
  const [approval, setApproval] = useState<MessageChannelApproval>(() =>
    host.kit.defaultApproval(),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientIdId = useId();
  const clientSecretId = useId();
  const toolsId = useId();

  // True while this component instance is mounted. `submit` awaits an
  // adapter call that can outlive the component (the modal closes, or the
  // whole settings page unmounts, mid-request); checking this ref after the
  // await stops that stale response from firing `host.done`/`setError` on a
  // component nobody is looking at.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function submit() {
    const current = hostRef.current;
    const trimmedName = name.trim();
    const trimmedClientId = clientId.trim();
    const trimmedClientSecret = clientSecret.trim();
    if (!trimmedName || !preset.trim() || !trimmedClientId || !trimmedClientSecret) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const connect = await current.adapter.create({
        provider: current.providerId,
        name: trimmedName,
        agentPreset: preset,
        // The secret leaves this component exactly here and nowhere else —
        // it is never logged, echoed into an error message, or put in the
        // DOM outside its own password input.
        config: {
          clientId: trimmedClientId,
          clientSecret: trimmedClientSecret,
          enableTools,
        },
        approval,
      });
      current.done(connect);
    } catch (cause) {
      if (mountedRef.current) setError(describeError(t, cause));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  // Inherits the retired per-provider dialog's gate: a connect name AND a
  // chosen agent preset. Without the preset check a submit fired before the
  // seat's preset list resolved would reach the center only to come back as
  // `agent_preset_required`.
  const canSubmit =
    Boolean(name.trim()) &&
    Boolean(preset.trim()) &&
    Boolean(clientId.trim()) &&
    Boolean(clientSecret.trim());

  // Handed over on the host rather than imported: each plugin client is its
  // own bundle, so the shared parts travel with the seat.
  const { BasicsFields, ApprovalField } = host.kit;

  return (
    <WizardFrame
      actions={
        <>
          <Button
            onClick={() => host.back()}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t("options.connect.dsh.wizard.changePlatform")}
          </Button>
          <Button
            onClick={() => host.cancel()}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("options.connect.dsh.cancel")}
          </Button>
          <Button
            disabled={saving || !canSubmit}
            onClick={() => void submit()}
            size="sm"
            type="button"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("options.connect.dsh.submit")}
            {saving ? (
              <span className="sr-only">
                {t("options.connect.dsh.loading")}
              </span>
            ) : null}
          </Button>
        </>
      }
      closeLabel={t("options.connect.dsh.cancel")}
      hint={
        <>
          <Lock className="h-3 w-3" />
          {t("options.connect.dsh.wizard.privacyHint")}
        </>
      }
      icon={<DingtalkMark size={20} />}
      onClose={() => host.cancel()}
      subtitle={t("options.connect.dsh.dingtalk.subtitle")}
      title={t("options.connect.dsh.dingtalk.title")}
    >
      <div className="space-y-4">
        <BasicsFields
          name={name}
          onNameChange={setName}
          onPresetChange={setPreset}
          preset={preset}
          presets={host.presets}
        />
        <div className="grid grid-cols-2 gap-4">
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
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/55 px-3 py-2.5">
          <Label htmlFor={toolsId}>
            {t("options.connect.dsh.dingtalk.enableTools")}
          </Label>
          <Switch
            checked={enableTools}
            id={toolsId}
            onCheckedChange={setEnableTools}
          />
        </div>
        <ApprovalField approval={approval} onApprovalChange={setApproval} />
      </div>
      {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
    </WizardFrame>
  );
}
