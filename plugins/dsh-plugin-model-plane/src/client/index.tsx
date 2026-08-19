import type { ConnectionHandle } from "@deepseek-ai/dsh-api-remotes/client";
import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { PageContent, ScrollArea } from "@amiba/ui/plugin";
import { Bot } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { AMIBA_MODEL_PLANE_REMOTE } from "../remote.js";
import {
  DshComposerModelPicker,
  makeSessionModelEngine,
  type ComposerPickerCatalog,
  type SessionModelWire,
} from "./DshComposerModelPicker.js";
import {
  ModelProviderConfigTab,
  type ModelPlaneAdapter,
} from "./ModelProviderConfigTab.js";

export const name = "amiba-model-plane-client";
export const inject = ["slots", "remote", "connection"];

const SECTION_ID = "models";

type ModelPlaneRemote = ClientContext["remote"]["amibaModelPlane"];

type ModelPlaneSectionProps = PropsRuntime<"settings.section"> & {
  adapter: ModelPlaneAdapter;
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

function remoteError(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

async function valueOf<T>(
  result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
): Promise<T> {
  const settled = await result;
  if (!settled.ok) throw remoteError(settled.error);
  return settled.value;
}

/** Top-level Settings section: providers, models, credentials, defaults.
 *  No header actions — the host `SETTINGS_PAGES` entry had none either; the
 *  wrapper reproduces the scaffold's former `scroll="page"` layout. */
function ModelPlaneSettings({ adapter }: ModelPlaneSectionProps): ReactNode {
  return (
    <ScrollArea className="min-h-0 flex-1">
      <PageContent size="md">
        <ModelProviderConfigTab adapter={adapter} />
      </PageContent>
    </ScrollArea>
  );
}

/**
 * `amiba.composer.modelPicker` contribution: the session-less hero model
 * chip (home/draft composer). The catalog comes from the plugin's own typed
 * Remote; the surface-held draft selection and picker chrome ride the owner
 * share. No engine — there is no session to talk to yet.
 */
function DraftModelPickerContribution(
  props: DraftPickerSlotProps,
): ReactNode {
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

/** Publish the typed Model Plane Remote, the 模型与服务 ("Models & services")
 *  Settings section, and the two composer picker contributions (official
 *  session seat + vendor hero seat). */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_MODEL_PLANE_REMOTE);
  // The official session wire faces, captured once from the connection
  // service (the agent-preset plugin's ctx.get("connection").api precedent).
  const wire: SessionModelWire = (ctx.get("connection") as ConnectionHandle)
    .api.sessions;
  const sectionFiber = ctx.inject(
    ["slots", "remote.amibaModelPlane"],
    (injectedCtx) => {
      const remote: ModelPlaneRemote = injectedCtx.remote.amibaModelPlane;
      const adapter: ModelPlaneAdapter = {
        snapshot: () => valueOf(remote.snapshot()),
        setDefaultSelection: (selection, expectedRevision) =>
          valueOf(remote.setDefaultSelection(selection, expectedRevision)),
        upsert: (input) => valueOf(remote.upsert(input)),
        remove: (providerId, expectedRevision) =>
          valueOf(remote.removeProvider(providerId, expectedRevision)),
        discover: (input) => valueOf(remote.discover(input)),
        unsetCredential: (providerId, expectedRevision) =>
          valueOf(remote.unsetCredential(providerId, expectedRevision)),
      };
      return injectedCtx.slots.inject("settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "settings.section",
            id: SECTION_ID,
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
    ["slots", "remote.amibaModelPlane"],
    (injectedCtx) => {
      const remote: ModelPlaneRemote = injectedCtx.remote.amibaModelPlane;
      const catalog: ComposerPickerCatalog = {
        snapshot: () => valueOf(remote.snapshot()),
      };
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
    await pickerFiber.dispose();
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
