import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";

import type { MessageChannelCenter } from "./center.js";
import type { MessageChannelInput, MessageChannelPatch } from "./remote.js";

class AmibaMessagingRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly center: MessageChannelCenter,
  ) {
    super(ctx, "amibaMessaging");
  }

  @Remote
  async list() {
    const [providers, channels] = await Promise.all([
      Promise.resolve(this.center.listProviders()),
      this.center.listChannels(),
    ]);
    return {
      providers,
      channels,
      inboundEndpoint:
        providers.find((provider) => provider.inboundPath)?.inboundPath ?? "",
    };
  }

  @Remote
  create(input: MessageChannelInput) {
    return this.center.createChannel(input);
  }

  @Remote
  update(id: string, patch: MessageChannelPatch) {
    return this.center.updateChannel(id, patch);
  }

  @Remote
  async removeChannel(id: string) {
    return { id, deleted: await this.center.removeChannel(id) };
  }

  @Remote
  rotate(id: string) {
    return this.center.rotateSecret(id);
  }
}

/** Install the official DSH Host Remote face owned by messaging-core. */
export function applyMessagingRemote(
  ctx: Context,
  center: MessageChannelCenter,
): void {
  new AmibaMessagingRemoteService(ctx, center);
}
