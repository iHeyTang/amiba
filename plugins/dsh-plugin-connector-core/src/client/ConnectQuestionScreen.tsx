import type { AmibaConversationQuestionOwner } from "@amiba/extension-sdk";
import { useEffect, useMemo, useState } from "react";

import { usePluginT } from "@amiba/ui/plugin";

import type { ConnectAdapter } from "./adapter.js";
import { describeError } from "./describe-error.js";
import { connectI18n } from "./i18n.js";
import { ProviderChooser } from "./ProviderChooser.js";
import { ProviderScreen } from "./ProviderScreen.js";
import type { ConnectWizardRegistry, PresetOption } from "./wizard-registry.js";
import { decodePrefill } from "../connect-wizard-question.js";
import type { ConnectorProviderView, ConnectView } from "../types.js";

export type ConnectQuestionScreenProps = AmibaConversationQuestionOwner & {
  adapter: ConnectAdapter;
  registry: ConnectWizardRegistry;
  loadPresets: () => Promise<PresetOption[]>;
};

/**
 * The `amiba.conversation.question` occupant for question id
 * `amiba.connect-wizard`: core's chooser when the tool passed no provider,
 * else the platform's own screen. The answer carries only the connect id —
 * never a credential, never the wizard's form state.
 *
 * Plainly typed on purpose (the owner share plus the three injected
 * dependencies) and registered DIRECTLY in `index.tsx` — there is no wrapper
 * around it. That typechecks because `slots.register` constrains its
 * component argument to `SlotComponent<ComposedProps<…>> = (props: P) =>
 * ReactNode`, and a function declaring only SOME of those props accepts the
 * full share the runtime hands it. This screen reads neither the session
 * standard kit (`sessionId`, `useSession`) nor the global seat, so leaving
 * them undeclared costs nothing and keeps the component renderable in a unit
 * test that supplies just these props. `settings.section` needs its
 * `ConnectSettingsSection`/`DshSettingsConnect` split only because that
 * registration types itself with the full `PropsRuntime` instead.
 *
 * The owner object and its `respond`/`cancel` closures are re-allocated on
 * every host render, so nothing here may depend on their identity — the one
 * effect below keys off `adapter`/`loadPresets`, which the inject fiber holds
 * as stable consts.
 */
export function ConnectQuestionScreen({
  request,
  inFlight,
  error,
  respond,
  cancel,
  adapter,
  registry,
  loadPresets,
}: ConnectQuestionScreenProps) {
  const { t } = usePluginT(connectI18n);
  const question = request.questions[0];
  const prefill = useMemo(() => decodePrefill(question?.detail), [question?.detail]);
  const [providerId, setProviderId] = useState(prefill.provider ?? "");
  const [providers, setProviders] = useState<ConnectorProviderView[]>([]);
  const [presets, setPresets] = useState<PresetOption[]>([]);
  // The raw failure CODE, not the translated sentence: `t` is re-allocated on
  // every render, so translating at render time keeps it out of the effect's
  // dependency list (which must stay `adapter`/`loadPresets` — see above) and
  // still re-renders in the right language when the locale changes.
  const [loadFailure, setLoadFailure] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all([adapter.listProviders(), loadPresets()]).then(
      ([list, options]) => {
        if (cancelled) return;
        setProviders(list);
        setPresets(options);
      },
      (cause: unknown) => {
        // Without this the seat renders an empty chooser forever and the
        // rejection escapes as an unhandled one.
        if (cancelled) return;
        setLoadFailure(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [adapter, loadPresets]);
  const finish = (connect: ConnectView) => {
    if (!question) return;
    respond([{ id: question.id, selected: [], custom: connect.id }]);
  };
  const hostPrefill =
    prefill.name || prefill.agentPreset
      ? {
          ...(prefill.name ? { name: prefill.name } : {}),
          ...(prefill.agentPreset ? { agentPreset: prefill.agentPreset } : {}),
        }
      : undefined;
  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-2xl border border-border bg-background shadow-[0_-18px_42px_-24px_rgb(0_0_0_/_0.18),0_8px_24px_-18px_rgb(0_0_0_/_0.17)]"
      data-connect-question-screen=""
    >
      {providerId ? (
        <ProviderScreen
          adapter={adapter}
          onBack={() => setProviderId("")}
          onCancel={cancel}
          onDone={finish}
          {...(hostPrefill ? { prefill: hostPrefill } : {})}
          presets={presets}
          providerId={providerId}
          registry={registry}
        />
      ) : (
        <ProviderChooser
          onCancel={cancel}
          onPick={setProviderId}
          providers={providers}
          registry={registry}
          subtitle={t("options.connect.dsh.wizard.pickSubtitle")}
          title={t("options.connect.dsh.add")}
        />
      )}
      {loadFailure ? (
        <p className="px-4 pb-3 text-xs text-destructive">
          {describeError(t, loadFailure)}
        </p>
      ) : null}
      {error ? <p className="px-4 pb-3 text-xs text-destructive">{error}</p> : null}
      {inFlight ? (
        <p className="px-4 pb-3 text-xs text-muted-foreground">
          {t("options.connect.dsh.loading")}
        </p>
      ) : null}
    </div>
  );
}
