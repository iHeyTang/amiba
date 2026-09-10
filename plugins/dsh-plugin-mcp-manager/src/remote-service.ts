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
  listAccess() { return this.manager.access.list(); }

  @Remote
  async approveAccess(id: string, connectionId: string, approvalToken: string) {
    await this.manager.access.approve(id, connectionId, approvalToken);
    return this.manager.access.list();
  }

  @Remote
  async revokeAccess(id: string) {
    await this.manager.access.revoke(id);
    return this.manager.access.list();
  }

  @Remote
  async retryAccess(id: string) {
    await this.manager.access.retry(id);
    return this.manager.access.list();
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
