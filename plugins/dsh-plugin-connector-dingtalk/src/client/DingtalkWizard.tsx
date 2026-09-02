import { Loader2, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  Button,
  Input,
  Label,
  Switch,
  usePluginT,
  type PluginTranslateFn,
} from "@amiba/ui/plugin";
import type { ConnectWizardHost } from "@amiba/dsh-plugin-connector-core/client";

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
 * The DingTalk connect wizard body, mounted by connector-core's
 * `ConnectWizardChrome` for the `"dingtalk"` provider. DingTalk has no
 * scan-to-connect flow — this is a manual form only: Client ID, Client
 * Secret, and an opt-in tools switch, submitted through `host.adapter.create`.
 *
 * Depends on nothing from connector-core but the `host` prop (its type
 * aside), so the same body works in the settings modal and, later, in the
 * composer.
 */
export function DingtalkWizard({ host }: { host: ConnectWizardHost }): ReactNode {
  const { t } = useT();
  // The chrome rebuilds `host` on every render and the user can still be
  // typing the connect name / switching the preset while a submit is in
  // flight, so `submit` reads through this ref AT CALL TIME instead of
  // closing over the render's `host`.
  const hostRef = useRef(host);
  hostRef.current = host;

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [enableTools, setEnableTools] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const name = current.connectName.trim();
    const trimmedClientId = clientId.trim();
    const trimmedClientSecret = clientSecret.trim();
    if (!name || !trimmedClientId || !trimmedClientSecret) return;
    setSaving(true);
    setError(null);
    try {
      const connect = await current.adapter.create({
        provider: current.providerId,
        name,
        agentPreset: current.agentPreset,
        // The secret leaves this component exactly here and nowhere else —
        // it is never logged, echoed into an error message, or put in the
        // DOM outside its own password input.
        config: {
          clientId: trimmedClientId,
          clientSecret: trimmedClientSecret,
          enableTools,
        },
      });
      current.done(connect);
    } catch (cause) {
      if (mountedRef.current) setError(describeError(t, cause));
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  const canSubmit =
    Boolean(host.connectName.trim()) &&
    Boolean(clientId.trim()) &&
    Boolean(clientSecret.trim());

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="dsh-connect-dingtalk-client-id">
            {t("options.connect.dsh.dingtalk.clientId")}
          </Label>
          <Input
            id="dsh-connect-dingtalk-client-id"
            onChange={(event) => setClientId(event.target.value)}
            value={clientId}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dsh-connect-dingtalk-client-secret">
            {t("options.connect.dsh.dingtalk.clientSecret")}
          </Label>
          <Input
            id="dsh-connect-dingtalk-client-secret"
            onChange={(event) => setClientSecret(event.target.value)}
            type="password"
            value={clientSecret}
          />
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border/55 p-3">
          <div className="space-y-0.5">
            <Label htmlFor="dsh-connect-dingtalk-enable-tools">
              {t("options.connect.dsh.dingtalk.enableTools")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("options.connect.dsh.dingtalk.enableToolsHint")}
            </p>
          </div>
          <Switch
            checked={enableTools}
            id="dsh-connect-dingtalk-enable-tools"
            onCheckedChange={setEnableTools}
          />
        </div>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button onClick={() => host.cancel()} type="button" variant="ghost">
          {t("options.connect.dsh.cancel")}
        </Button>
        <Button disabled={saving || !canSubmit} onClick={() => void submit()} type="button">
          {saving ? <Loader2 className="animate-spin" /> : <Plus />}
          {t("options.connect.dsh.submit")}
          {saving ? (
            <span className="sr-only">{t("options.connect.dsh.loading")}</span>
          ) : null}
        </Button>
      </div>
    </div>
  );
}
