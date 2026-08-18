import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";

import type { AmibaMemoryStore, AmibaMemoryTarget } from "./memory-store.js";

class AmibaMemoryRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly store: AmibaMemoryStore,
  ) {
    super(ctx, "amibaMemory");
  }

  @Remote
  list(preset: string) {
    return this.store.read(preset);
  }

  @Remote
  reset(preset: string, target: AmibaMemoryTarget | "all") {
    return this.store.reset(preset, target);
  }
}

/** Install the official DSH Host Remote face owned by this feature plugin. */
export function applyMemoryRemote(
  ctx: Context,
  store: AmibaMemoryStore,
): void {
  new AmibaMemoryRemoteService(ctx, store);
}

