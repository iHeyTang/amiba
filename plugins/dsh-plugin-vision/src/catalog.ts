import type { Context } from "@deepseek-ai/cordis";
import type { VisionPreferences, VisionSelection } from "./preferences.js";

/** One model that accepts image input, as advertised by its provider route. */
export interface VisionModel {
  provider: string;
  providerName: string;
  model: string;
  name: string;
  description?: string;
}

/**
 * The candidate set is derived, never hand-maintained: a route qualifies only
 * when its own catalog declares `image` among its input modalities. A
 * text-only model can therefore never be assigned here, and a model that gains
 * vision upstream appears without an Amiba change.
 */
export class VisionCatalog {
  constructor(
    private readonly ctx: Context,
    private readonly preferences: VisionPreferences,
  ) {}

  async list(): Promise<VisionModel[]> {
    const rows: VisionModel[] = [];
    for (const provider of this.ctx.llm.listProviders()) {
      try {
        const models = await this.ctx.llm.listModels(provider.id);
        for (const model of models) {
          if (model.inputModalities?.includes("image") !== true) continue;
          rows.push({
            provider: provider.id,
            providerName: provider.name,
            model: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
          });
        }
      } catch {
        // An unconfigured or unreachable provider advertises nothing.
      }
    }
    return rows;
  }

  /** The assigned route, or the first advertised one when the Agent chooses on demand. */
  async resolve(): Promise<VisionModel | undefined> {
    const listed = await this.list();
    const assigned = this.preferences.snapshot().selection;
    if (assigned === null) return listed[0];
    return listed.find(
      (row) => row.provider === assigned.provider && row.model === assigned.model,
    );
  }

  /** Reject an assignment the provider no longer advertises as image-capable. */
  async validate(selection: VisionSelection): Promise<VisionModel> {
    const match = (await this.list()).find(
      (row) =>
        row.provider === selection.provider && row.model === selection.model,
    );
    if (match === undefined)
      throw new Error(
        `Model "${selection.model}" does not declare image input`,
      );
    return match;
  }
}
