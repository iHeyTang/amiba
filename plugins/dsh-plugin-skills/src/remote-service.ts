import type { Context } from "@deepseek-ai/cordis";
import {
  Remote,
  TypertRemoteService,
} from "@deepseek-ai/dsh-typert-protocol";

import type { AmibaSkillStore } from "./skill-store.js";

class AmibaSkillsRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly store: AmibaSkillStore,
  ) {
    super(ctx, "amibaSkills");
  }

  @Remote
  list(sessionId: string | null) {
    return this.store.list(sessionId);
  }

  @Remote
  read(name: string, sessionId: string | null) {
    return this.store.read(name, sessionId);
  }

  @Remote
  listFiles(name: string, sessionId: string | null) {
    return this.store.listFiles(name, sessionId);
  }

  @Remote
  readFile(name: string, path: string, sessionId: string | null) {
    return this.store.readFile(name, path, sessionId);
  }

  @Remote
  save(name: string, document: string, sessionId: string | null) {
    return this.store.save(name, document, sessionId);
  }

  @Remote
  removeSkill(name: string, sessionId: string | null) {
    return this.store.remove(name, sessionId);
  }
}

export function applySkillsRemote(ctx: Context, store: AmibaSkillStore): void {
  new AmibaSkillsRemoteService(ctx, store);
}
