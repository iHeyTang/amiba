import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import type { ToolProvenanceRegistry } from "./provenance.js";
import { toolInventory } from "./tools-http.js";

class AmibaToolsRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly provenance: ToolProvenanceRegistry,
  ) {
    super(ctx, "amibaTools");
  }

  @Remote
  list() {
    return toolInventory(this.ctx, this.provenance);
  }
}

export function applyToolsRemote(
  ctx: Context,
  provenance: ToolProvenanceRegistry,
): void {
  new AmibaToolsRemoteService(ctx, provenance);
}
