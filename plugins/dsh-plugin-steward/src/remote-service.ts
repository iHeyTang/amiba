import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import type { StewardService } from "./service.js";

class AmibaStewardRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly service: StewardService,
  ) {
    super(ctx, "amibaSteward");
  }

  @Remote
  async ensureStewardSession() {
    return { sessionId: await this.service.ensureStewardSessionId() };
  }

  @Remote
  listTasks(includeDone: boolean) {
    return this.service.listTasks(includeDone);
  }

  @Remote
  adopt(input: { sessionId: string; title?: string }) {
    return this.service.adopt(input);
  }

  @Remote
  closeTask(id: string) {
    return this.service.closeTask(id);
  }
}

export function applyStewardRemote(ctx: Context, service: StewardService): void {
  new AmibaStewardRemoteService(ctx, service);
}
