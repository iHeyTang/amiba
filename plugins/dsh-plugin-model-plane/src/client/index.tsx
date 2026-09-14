import type {} from "@amiba/dsh-plugin-onboarding/client";
import { ProviderOnboarding } from "./ProviderOnboarding.js";
import type { ConnectionHandle } from "@deepseek-ai/dsh-api-remotes/client";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime, PropsRenderSlots } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { PageContent, ScrollArea } from "@amiba/ui/plugin";
import { Bot } from "lucide-react";
import { useMemo, useState, useCallback, type ReactNode } from "react";

import { NativeProviderSettings } from "./native-settings.js";
import {
  DshComposerModelPicker,
  makeSessionModelEngine,
  type ComposerPickerCatalog,
  type SessionModelWire,
} from "./DshComposerModelPicker.js";
import {
  ModelProviderConfigTab,
  type ProviderSettingsController,
} from "./ModelProviderConfigTab.js";

export const name = "amiba-model-plane-client";
export const inject = ["slots", "remote", "connection"];

const SECTION_ID = "models";


type ModelPlaneSectionProps = PropsRuntime<"settings.section"> & PropsRenderSlots<"amiba.models.extension" | "settings.models.footer" | "settings.models.provider-card"> & {
  adapter: ProviderSettingsController;
};

/** The session-less hero seat: draft plumbing rides the owner share. */
type DraftPickerSlotProps = PropsRuntime<"amiba.composer.modelPicker"> & {
  catalog: ComposerPickerCatalog;
};

/** The official seat: sessionId from the standard kit, locked from the owner. */
type SessionPickerSlotProps = PropsRuntime<"conversation.input.model"> & {
  catalog: ComposerPickerCatalog;
  wire: SessionModelWire;
};

/** Top-level Settings section: providers, models, credentials, defaults.
 *  No header actions — the host `SETTINGS_PAGES` entry had none either; the
 *  wrapper reproduces the scaffold's former `scroll="page"` layout. */
function ModelPlaneSettings({ adapter, renderSlot }: ModelPlaneSectionProps): ReactNode {
  const [inventories, setInventories] = useState<Record<string, AmibaProviderInventory[]>>({});
  const onModelsChange = useCallback((source: string, providers: AmibaProviderInventory[]) => {
    setInventories(current => ({...current, [source]: providers}));
  }, []);
  return (
    <ScrollArea className="min-h-0 flex-1">
      <PageContent size="md">
        <ModelProviderConfigTab
          adapter={adapter}
          inventory={Object.values(inventories).flat()}
          assignments={renderSlot("amiba.models.extension", {onModelsChange})}
          footer={renderSlot("settings.models.footer", {})}
          renderProviderCard={owner => renderSlot("settings.models.provider-card", owner, { entryKey: owner.provider.settingsNs })}
        />
      </PageContent>
    </ScrollArea>
  );
}

/**
 * `amiba.composer.modelPicker` contribution: the session-less hero model
 * chip (home/draft composer). The catalog comes directly from the official llm.models API; the surface-held draft selection and picker chrome ride the owner
 * share. No engine — there is no session to talk to yet.
 */
function DraftModelPickerContribution(props: DraftPickerSlotProps): ReactNode {
  return (
    <DshComposerModelPicker
      catalog={props.catalog}
      dialogSize={props.dialogSize}
      disabled={props.disabled}
      draftSelection={props.draftSelection}
      onDraftSelectionChange={props.onDraftSelectionChange}
      overlayVariant={props.overlayVariant}
      refreshKey={props.refreshKey}
    />
  );
}

/**
 * `conversation.input.model` contribution: the official session model seat.
 * `sessionId` arrives from the framework session kit, `locked` from the
 * owner share, and engine data over the official wire
 * (`session.models` / `session.selectModel`) — the same calls the official
 * ui-model-selection plugin makes. Dialog chrome is self-managed (defaults):
 * the constrained-host accommodations (dialogSize/overlayVariant/refreshKey)
 * were Quick-Ask concerns, and Quick-Ask has no DSH runtime — no dispatch
 * site of this seat passes them.
 */
function SessionModelPickerContribution(
  props: SessionPickerSlotProps,
): ReactNode {
  const engine = useMemo(
    () => makeSessionModelEngine(props.wire, props.sessionId),
    [props.wire, props.sessionId],
  );
  return (
    <DshComposerModelPicker
      catalog={props.catalog}
      disabled={props.locked}
      engine={engine}
    />
  );
}

/** Publish the 模型与服务 ("Models & services")
 *  Settings section, and the two composer picker contributions (official
 *  session seat + vendor hero seat). */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const api = (ctx.get("connection") as ConnectionHandle).api;
  // Official wire faces, captured once from the connection
  // service (the agent-preset plugin's ctx.get("connection").api precedent).
  const wire: SessionModelWire = (ctx.get("connection") as ConnectionHandle).api
    .sessions;
  const subscribe = (listener: () => void) => {
    const disposers = [
      ctx.remote.$on("llm/adapters-updated", listener),
      ctx.remote.$on("settings/document-updated", listener),
      ctx.remote.$on("credentials/reference-updated", listener),
      ctx.on("connection/reset", listener),
    ];
    return () => disposers.forEach((dispose) => dispose());
  };
  const controller = new NativeProviderSettings(api, subscribe);
  const disposeOnboarding = ctx.slots.inject("amiba.onboarding.step", () => ctx.slots.register({
    name: "amiba.onboarding.step", id: "models", order: 10,
    label: () => document.documentElement.lang.startsWith("zh") ? "模型服务" : "Model service",
    inject: () => ({adapter: controller}),
  }, ProviderOnboarding));
  const sectionFiber = ctx.inject(
    ["slots", "connection"],
    (injectedCtx) => {
      const adapter = controller;
      return injectedCtx.slots.inject("settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "settings.section",
            id: SECTION_ID,
            children: {
              "amiba.models.extension": { kind: "list", scope: "root" },
              "settings.models.footer": { kind: "list", scope: "root" },
              "settings.models.provider-card": { kind: "keyed", scope: "root" },
            },
            // Below every other plugin section (catalog/mcp start at 100)
            // so 模型与服务 stays directly after the agent-preset plugin's
            // 智能体预设 entry (5), keeping its old registry position.
            order: 50,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "模型与服务"
                : "Models & services",
            inject: () => ({ adapter, navIcon: () => <Bot /> }),
          },
          ModelPlaneSettings,
        ),
      );
    },
  );
  const pickerFiber = ctx.inject(
    ["slots", "connection"],
    (injectedCtx) => {
      const catalog: ComposerPickerCatalog = controller;
      const disposeDraftSeat = injectedCtx.slots.inject(
        "amiba.composer.modelPicker",
        () =>
          injectedCtx.slots.register(
            {
              name: "amiba.composer.modelPicker",
              id: "model-plane",
              order: 100,
              inject: () => ({ catalog }),
            },
            DraftModelPickerContribution,
          ),
      );
      const disposeSessionSeat = injectedCtx.slots.inject(
        "conversation.input.model",
        () =>
          injectedCtx.slots.register(
            {
              name: "conversation.input.model",
              inject: () => ({ catalog, wire }),
            },
            SessionModelPickerContribution,
          ),
      );
      return () => {
        disposeSessionSeat();
        disposeDraftSeat();
      };
    },
  );
  await sectionFiber;
  await pickerFiber;
  return async () => {
    disposeOnboarding();
    await pickerFiber.dispose();
    await sectionFiber.dispose();
  };
}

type AmibaProviderInventory = Parameters<NonNullable<PropsRuntime<"amiba.models.extension">["onModelsChange"]>>[1][number];
