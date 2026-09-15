import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { VisionCatalog } from "./catalog.js";
import type { VisionPreferences, VisionSelection } from "./preferences.js";

export class VisionRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly vision: VisionCatalog,
    private readonly preferences: VisionPreferences,
  ) {
    super(ctx, "amibaVisionUi");
  }

  @Remote async catalog() {
    const models = await this.vision.list();
    return JSON.stringify({ models, ...this.preferences.snapshot() });
  }

  @Remote async setDefault(selectionJson: string, revision: number) {
    const selection = JSON.parse(selectionJson) as VisionSelection | null;
    if (selection)
      await this.vision.validate({
        provider: selection.provider,
        model: selection.model,
      });
    await this.preferences.set(selection, revision);
    return true;
  }
}
