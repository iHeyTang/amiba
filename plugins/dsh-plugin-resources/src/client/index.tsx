import { TOOLVIEWS } from "./toolviews.js";
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type {} from "@amiba/dsh-plugin-ui-shell/client";
import { useEffect, useState } from "react";
import { REFERENCE_EVENT, type ReferenceRequest } from "@amiba/ui/plugin";
import { AMIBA_RESOURCES_REMOTE, type ResourcesRemote } from "../remote.js";
import {
  decodeResourceRef,
  encodeResourceRef,
  type ResourceRef,
} from "../protocol.js";
import { createResourceInputSource, RESOURCE_INPUT_SOURCE } from "./source.js";
import { ResourcePreview } from "./ResourcePreview.js";
export const name = "amiba-resources-ui";
export const inject = [
  "remote",
  "slots",
  "composerInputs",
  "layout",
  "inputTriggers",
];
export async function apply(ctx: ClientContext) {
  ctx.effect(() => {
    const disposers = TOOLVIEWS.map(({ key, component }) => ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({ name: "tool.call.toolview", key }, component)));
    return () => { for (const dispose of disposers) dispose(); };
  });
  const unmount = await ctx.remote.$mount(AMIBA_RESOURCES_REMOTE);
  const fiber = ctx.inject(["remote.amibaResources"], (ready) => {
    const remote: ResourcesRemote = ready.remote.amibaResources;
    const source = createResourceInputSource(remote);
    ready.effect(() => ready.composerInputs.registerSources([source], true));
    function PreviewHost() {
      const [reference, setReference] = useState<ResourceRef | null>(null);
      useEffect(() => {
        const open = (event: Event) => {
          const request = event as CustomEvent<ReferenceRequest>;
          if (request.detail?.source !== RESOURCE_INPUT_SOURCE) return;
          try {
            const ref = decodeResourceRef(request.detail.ref);
            request.preventDefault();
            setReference(ref);
          } catch {
            /* Invalid references remain unclaimed. */
          }
        };
        window.addEventListener(REFERENCE_EVENT, open);
        return () => window.removeEventListener(REFERENCE_EVENT, open);
      }, []);
      return (
        <ResourcePreview
          reference={reference}
          remote={remote}
          close={() => setReference(null)}
          send={async (ref) => {
            const prompt = await source.codec!.serialize(
              encodeResourceRef(ref),
              new AbortController().signal,
            );
            ready.layout.openNewChat(prompt);
            setReference(null);
          }}
        />
      );
    }
    ready.effect(() =>
      ready.slots.inject("shell.overlay", () =>
        ready.slots.register(
          { name: "shell.overlay", id: "amiba.resources.preview" },
          PreviewHost,
        ),
      ),
    );
  });
  return async () => {
    await fiber.dispose();
    await unmount();
  };
}
