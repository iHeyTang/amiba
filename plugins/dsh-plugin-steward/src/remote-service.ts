import type { Context } from "@deepseek-ai/cordis";
import type { ConversationCadence } from "@amiba/dsh-plugin-session-features";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import type { StewardRegistryService } from "./registry.js";
import type { StewardProfileInput } from "./registry-store.js";

class AmibaStewardRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly service: StewardRegistryService,
  ) {
    super(ctx, "amibaSteward");
  }

  @Remote
  instances() {
    return this.service.list();
  }

  @Remote
  saveInstance(input: StewardProfileInput & { id?: string }) {
    return input.id
      ? this.service.update(input.id, input)
      : this.service.create(input);
  }

  @Remote
  deleteInstance(id: string) {
    return this.service.remove(id);
  }

  @Remote
  async ensureStewardSession(stewardId: string) {
    const engine = this.service.engine(stewardId);
    const sessionId = await engine.ensureStewardSessionId();
    return { sessionId, sessionIds: await engine.stewardConversationIds() };
  }

  @Remote
  conversationSettings(input: {
    stewardId: string;
    action: "status" | "configure" | "new";
    cadence?: ConversationCadence;
  }) {
    return this.service
      .engine(input.stewardId)
      .conversationSettings(input.action, input.cadence);
  }

  @Remote
  listTasks(input: { stewardId: string; includeDone: boolean }) {
    return this.service.engine(input.stewardId).listTasks(input.includeDone);
  }

  @Remote
  adopt(input: { stewardId: string; sessionId: string; title?: string }) {
    return this.service.engine(input.stewardId).adopt(input);
  }

  @Remote
  closeTask(input: { stewardId: string; id: string }) {
    return this.service.engine(input.stewardId).closeTask(input.id);
  }
}

export function applyStewardRemote(
  ctx: Context,
  service: StewardRegistryService,
): void {
  new AmibaStewardRemoteService(ctx, service);
}
