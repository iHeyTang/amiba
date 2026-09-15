import type {} from "@deepseek-ai/dsh-settings";
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";

/** One assigned vision route: the provider key and the exact model id. */
export interface VisionSelection {
  provider: string;
  model: string;
}

const NS = "amiba-vision";
const selection = z.object({
  provider: z.string().required(),
  model: z.string().required(),
});
/** The single assignment key this capability stores under. */
const KEY = "vision";

/**
 * The vision assignment lives in the settings seam, under its own namespace,
 * exactly like the media capability's per-operation defaults. `null` means the
 * Agent chooses on demand from the models that declare image input.
 */
export class VisionPreferences {
  constructor(private readonly ctx: Context) {
    ctx.settings.register(
      NS,
      z.object({ defaults: z.dict(selection).default({}) }),
      { base: { defaults: {} } },
    );
  }

  snapshot(): { selection: VisionSelection | null; revision: number } {
    const descriptor = this.ctx.settings
      .describe()
      .find((row) => row.ns === NS);
    if (!descriptor) throw new Error("Vision assignment is unavailable");
    const value = this.ctx.settings.get(NS) as {
      defaults?: Record<string, VisionSelection>;
    };
    return { selection: value.defaults?.[KEY] ?? null, revision: descriptor.revision };
  }

  async set(value: VisionSelection | null, revision: number) {
    await this.ctx.settings.mutate(
      NS,
      [
        value
          ? { op: "set", path: ["defaults", KEY], value }
          : { op: "unset", path: ["defaults", KEY] },
      ],
      revision,
    );
    return this.snapshot();
  }
}
