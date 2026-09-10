import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";

/** Populate DSH's official display field without changing Pi-AI request models. */
export class TokenDanceAdapter extends PiAiAdapter {
  constructor(
    options: ConstructorParameters<typeof PiAiAdapter>[0],
    private readonly description: (provider: string, model: string) => string | undefined,
  ) {
    super(options);
  }

  private describe<T extends { provider: string; id: string }>(model: T): T & { description?: string } {
    const description = this.description(model.provider, model.id);
    return description === undefined ? model : { ...model, description };
  }

  override async listModels(...args: Parameters<PiAiAdapter["listModels"]>) {
    return (await super.listModels(...args)).map(model => this.describe(model));
  }

  override async resolveModel(...args: Parameters<PiAiAdapter["resolveModel"]>) {
    return this.describe(await super.resolveModel(...args));
  }

  override async prepareCall(...args: Parameters<PiAiAdapter["prepareCall"]>) {
    const call = await super.prepareCall(...args);
    return { ...call, model: this.describe(call.model) };
  }
}
