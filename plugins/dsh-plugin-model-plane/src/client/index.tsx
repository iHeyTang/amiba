import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { PageContent, ScrollArea } from "@amiba/ui/plugin";
import { type ReactNode } from "react";

import { AMIBA_MODEL_PLANE_REMOTE } from "../remote.js";
import {
  ModelProviderConfigTab,
  type ModelPlaneAdapter,
} from "./ModelProviderConfigTab.js";

export const name = "amiba-model-plane-client";
export const inject = ["slots", "remote"];

const SECTION_ID = "models";

type ModelPlaneRemote = ClientContext["remote"]["amibaModelPlane"];

type ModelPlaneSectionProps = PropsRuntime<"amiba.settings.section"> & {
  adapter: ModelPlaneAdapter;
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

/** Publish the typed Model Plane Remote to every DSH Client surface and
 *  register the 模型与服务 ("Models & services") Settings section. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(AMIBA_MODEL_PLANE_REMOTE);
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
          valueOf(remote.remove(providerId, expectedRevision)),
        discover: (input) => valueOf(remote.discover(input)),
        unsetCredential: (providerId, expectedRevision) =>
          valueOf(remote.unsetCredential(providerId, expectedRevision)),
      };
      return injectedCtx.slots.inject("amiba.settings.section", () =>
        injectedCtx.slots.register(
          {
            name: "amiba.settings.section",
            id: SECTION_ID,
            // Below every other plugin section (catalog/mcp start at 100)
            // so 模型与服务 stays directly after the built-in 行为与人设
            // entry, reproducing its old second-position registry slot.
            order: 50,
            label: () =>
              document.documentElement.lang.toLowerCase().startsWith("zh")
                ? "模型与服务"
                : "Models & services",
            inject: () => ({ adapter }),
          },
          ModelPlaneSettings,
        ),
      );
    },
  );
  await sectionFiber;
  return async () => {
    await sectionFiber.dispose();
    await disposeRemote();
  };
}
