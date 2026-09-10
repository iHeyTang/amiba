import {
  MediaError,
  type MediaProvider,
  type MediaRequest,
} from "./contracts.js";

/** Registration is owned by the provider lifecycle, never by provider-specific imports. */
export class MediaRegistry {
  private readonly providers = new Map<string, MediaProvider>();
  registerProvider(provider: MediaProvider): () => void {
    if (typeof provider.prepare !== "function")
      throw new Error(
        "Media providers must implement preflight parameter validation",
      );
    if (!provider.id || this.providers.has(provider.id)) {
      throw new Error(
        `Media provider already registered or invalid: ${provider.id}`,
      );
    }
    this.providers.set(provider.id, provider);
    return () => {
      if (this.providers.get(provider.id) === provider)
        this.providers.delete(provider.id);
    };
  }
  list(): string[] {
    return [...this.providers.keys()];
  }
  get(id: string): MediaProvider {
    const provider = this.providers.get(id);
    if (!provider)
      throw new MediaError(
        "UNAVAILABLE",
        `Media provider is not configured: ${id}`,
      );
    return provider;
  }
  async validate(
    provider: MediaProvider,
    request: MediaRequest,
    signal: AbortSignal,
  ): Promise<void> {
    const description = await provider.describe(signal);
    const model = description.models.find((row) => row.id === request.model);
    const protocol = description.protocols.find(
      (row) => row.id === request.protocol,
    );
    if (
      !model ||
      !protocol ||
      !model.protocols.includes(request.protocol) ||
      !protocol.operations.includes(request.operation) ||
      !model.operations.includes(request.operation)
    ) {
      throw new MediaError(
        "INVALID_REQUEST",
        "Model, protocol and operation are not an available media route. Use media_describe first.",
      );
    }
    if (
      !request.parameters ||
      typeof request.parameters !== "object" ||
      Array.isArray(request.parameters)
    ) {
      throw new MediaError(
        "INVALID_REQUEST",
        "parameters must be a native JSON object.",
      );
    }
    if (
      request.parameters.model !== undefined &&
      request.parameters.model !== request.model
    ) {
      throw new MediaError(
        "INVALID_REQUEST",
        "parameters.model must match the selected model.",
      );
    }
  }
}
