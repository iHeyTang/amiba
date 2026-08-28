import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";

import type { CronService } from "./service.js";
import type { CronTaskCreateInput, CronTaskPatch } from "./types.js";

class AmibaCronRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly service: CronService,
  ) {
    super(ctx, "amibaCron");
  }

  @Remote
  list() {
    return this.service.list();
  }

  @Remote
  createTask(input: CronTaskCreateInput) {
    return this.service.create(input);
  }

  @Remote
  updateTask(id: string, patch: CronTaskPatch) {
    return this.service.update(id, patch);
  }

  @Remote
  async removeTask(id: string) {
    await this.service.removeTask(id);
    return { id };
  }

  @Remote
  runNow(id: string) {
    return this.service.runNow(id);
  }
}

export function applyCronRemote(ctx: Context, service: CronService): void {
  new AmibaCronRemoteService(ctx, service);
}
