import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";

import type { DshMcpManager, McpSaveInput } from "./manager.js";

class AmibaMcpRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly manager: DshMcpManager,
  ) {
    super(ctx, "amibaMcp");
  }

  @Remote
  list() {
    return this.manager.list();
  }

  @Remote
  save(input: McpSaveInput) {
    return this.manager.save(input);
  }

  @Remote
  removeServer(serverName: string) {
    return this.manager.remove(serverName);
  }
}

export function applyMcpRemote(ctx: Context, manager: DshMcpManager): void {
  new AmibaMcpRemoteService(ctx, manager);
}
