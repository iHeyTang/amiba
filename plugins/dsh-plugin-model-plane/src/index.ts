import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { ModelPlaneService } from "@amiba/app-runtime/model-plane";

import { dshCredentialVault, dshModelProjection } from "./projection.js";
import { applyModelPlaneRemote } from "./remote-service.js";
import { DshModelPlaneStore } from "./store.js";

export * from "./remote.js";
export * from "./store.js";

export const name = "amiba-model-plane";
export const inject = ["settings", "credentials"];

export interface Config {
  root: string;
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
});

export async function apply(ctx: Context, config: Config): Promise<void> {
  const plane = new ModelPlaneService({
    store: new DshModelPlaneStore(config.root),
    vault: dshCredentialVault(ctx),
    projection: dshModelProjection(ctx),
  });
  applyModelPlaneRemote(ctx, plane);

  // Re-project durable providers at boot so CLI/Web/Electron all execute the
  // same canonical model definitions even after a DSH settings reset.
  const snapshot = await plane.snapshot();
  await Promise.allSettled(
    snapshot.providers
      .filter((provider) => provider.enabled)
      .map((provider) => plane.prepareProjection(provider.id)),
  );
}
