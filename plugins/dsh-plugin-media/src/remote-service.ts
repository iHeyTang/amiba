import { dirname } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { MediaService } from "./service.js";
import type { MediaOperation } from "./contracts.js";
import type { MediaSelection } from "./preferences.js";
export class MediaRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly media: MediaService,
  ) {
    super(ctx, "amibaMediaUi");
  }
  @Remote async setConfirmationThreshold(value: number, revision: number) {
    if (!this.media.preferences) throw new Error('Media preferences unavailable');
    await this.media.preferences.setThreshold(value, revision);
    return true;
  }
  @Remote async catalog() {
    const providers = await Promise.all(
      this.media.list().map(async (id) => {
        try {
          return {
            id,
            available: true,
            description: await this.media.get(id).describe(),
          };
        } catch {
          return { id, available: false };
        }
      }),
    );
    return JSON.stringify({ providers, ...this.media.preferences?.snapshot() });
  }
  @Remote async setModelEnabled(
    provider: string,
    model: string,
    enabled: boolean,
    revision: number,
  ) {
    if (!this.media.preferences)
      throw new Error("Media preferences unavailable");
    if (enabled) {
      const description = await this.media.get(provider).describe();
      if (!description.models.some((row) => row.id === model))
        throw new Error("Model has no supported media route");
    }
    await this.media.preferences.setEnabled(provider, model, enabled, revision);
    return true;
  }
  @Remote async setDefault(
    operation: string,
    selectionJson: string,
    revision: number,
  ) {
    if (
      ![
        "image.generate",
        "video.generate",
        "speech.synthesize",
        "audio.generate",
      ].includes(operation)
    )
      throw new Error("Unknown media operation");
    if (!this.media.preferences)
      throw new Error("Media preferences unavailable");
    const selection = JSON.parse(selectionJson) as MediaSelection | null;
    if (selection)
      await this.media.validate(
        this.media.get(selection.provider),
        {
          model: selection.model,
          protocol: selection.protocol,
          operation: operation as MediaOperation,
          parameters: {},
        },
        AbortSignal.timeout(20000),
      );
    await this.media.preferences.set(
      operation as MediaOperation,
      selection,
      revision,
    );
    return true;
  }
  @Remote authorizeNewGeneration(sessionId: string, recordId: string) {
    return this.media.authorizeNewGeneration(sessionId, recordId);
  }
  @Remote inspect(sessionId: string, recordId: string) {
    return this.media.inspect(sessionId, recordId);
  }
  @Remote async artifact(
    sessionId: string,
    recordId: string,
    artifactId: string,
    offset: number,
  ) {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new Error("Invalid artifact offset");
    const record = await this.media.store.read(sessionId, recordId);
    const artifact = record.artifacts.find((row) => row.id === artifactId);
    if (
      !artifact ||
      dirname(artifact.path) !== this.media.store.directory(sessionId)
    )
      throw new Error("Artifact is not in this media session");
    if (offset > artifact.size) throw new Error("Offset exceeds artifact size");
    const buffer = await this.media.store.readArtifactChunk(
      sessionId,
      artifact,
      offset,
      1024 * 1024,
    );
    return {
      data: buffer.toString("base64"),
      nextOffset:
        offset + buffer.length < artifact.size ? offset + buffer.length : null,
      mimeType: artifact.mimeType,
      size: artifact.size,
    };
  }
}
