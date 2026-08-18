import type { ClientContext } from "@deepseek-ai/dsh-client-runtime/client";

import { AMIBA_MODEL_PLANE_REMOTE } from "../remote.js";

export const name = "amiba-model-plane-client";
export const inject = ["remote"];

/** Publish the typed Model Plane Remote to every DSH Client surface. */
export function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  return ctx.remote.$mount(AMIBA_MODEL_PLANE_REMOTE);
}
