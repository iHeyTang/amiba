import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import type { DshUsageReader } from "./reader.js";

class AmibaUsageRemoteService extends TypertRemoteService {
  constructor(ctx: Context, private readonly reader: DshUsageReader) {
    super(ctx, "amibaUsage");
  }

  @Remote
  list() {
    return this.reader.list();
  }
}

export function applyUsageRemote(ctx: Context, reader: DshUsageReader): void {
  new AmibaUsageRemoteService(ctx, reader);
}
