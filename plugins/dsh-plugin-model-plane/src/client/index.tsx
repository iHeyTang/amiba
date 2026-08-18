import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import type { ReactNode } from "react";

import { AMIBA_MODEL_PLANE_REMOTE } from "../remote.js";
import {
  DshComposerModelPicker,
  type ComposerPickerCatalog,
} from "./DshComposerModelPicker.js";

export const name = "amiba-model-plane-client";
export const inject = ["remote", "slots"];

type ModelPlaneRemote = ClientContext["remote"]["amibaModelPlane"];

type ComposerPickerSlotProps = PropsRuntime<"amiba.composer.modelPicker"> & {
  catalog: ComposerPickerCatalog;
};

/**
 * `amiba.composer.modelPicker` contribution: the composer's model chip. The
 * catalog comes from the plugin's own typed Remote; the engine-native
 * `agentModels` surface arrives host-wired through the slot's owner props.
 */
function ComposerModelPickerContribution(
  props: ComposerPickerSlotProps,
): ReactNode {
  return (
    <DshComposerModelPicker
      agentModels={props.agentModels}
      catalog={props.catalog}
      dialogSize={props.dialogSize}
      disabled={props.disabled}
      draftSelection={props.draftSelection}
      onDraftSelectionChange={props.onDraftSelectionChange}
      overlayVariant={props.overlayVariant}
      refreshKey={props.refreshKey}
      sessionId={props.sessionId}
    />
  );
}

function errorOf(value: unknown): Error {
  if (value && typeof value === "object") {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") return new Error(message);
  }
  return new Error(String(value));
}

async function valueOf<T>(
  promise: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
): Promise<T> {
  const result = await promise;
  if (!result.ok) throw errorOf(result.error);
  return result.value;
}

/** Publish the typed Model Plane Remote and the composer picker contribution. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_MODEL_PLANE_REMOTE);
  const pickerFiber = ctx.inject(
    ["slots", "remote.amibaModelPlane"],
    (injectedCtx) => {
      const remote: ModelPlaneRemote = injectedCtx.remote.amibaModelPlane;
      const catalog: ComposerPickerCatalog = {
        snapshot: () => valueOf(remote.snapshot()),
      };
      return injectedCtx.slots.inject("amiba.composer.modelPicker", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.composer.modelPicker",
            id: "model-plane",
            order: 100,
            inject: () => ({ catalog }),
          },
          ComposerModelPickerContribution,
        ),
      );
    },
  );
  await pickerFiber;
  return async () => {
    await pickerFiber.dispose();
    await disposeRemote();
  };
}
