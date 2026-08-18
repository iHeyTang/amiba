import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";
import type { AgentScheduleCreateInput } from "@amiba/app-runtime/platform";

import type { DshScheduleManager } from "./manager.js";

class AmibaSchedulesRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly manager: DshScheduleManager,
  ) {
    super(ctx, "amibaSchedules");
  }

  @Remote
  list(sessionId: string) {
    return this.manager.list(sessionId);
  }

  @Remote
  create(sessionId: string, input: AgentScheduleCreateInput) {
    return this.manager.create(sessionId, input);
  }

  @Remote
  removeSchedule(sessionId: string, id: string) {
    return this.manager.remove(sessionId, id);
  }
}

export function applySchedulesRemote(
  ctx: Context,
  manager: DshScheduleManager,
): void {
  new AmibaSchedulesRemoteService(ctx, manager);
}
