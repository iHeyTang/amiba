import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { MemosStatus } from "./memos-status.js";

import { MemosDashboardService } from "./dashboard-service.js";
import type { MemoryQuery } from "./dashboard.js";

class AmibaMemoryRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly getStatus: () => MemosStatus,
  ) {
    super(ctx, "amibaMemory");
  }

  @Remote
  login(password: string) {
    return new MemosDashboardService(this.getStatus).login(password);
  }

  @Remote
  overview(session?: string) {
    return new MemosDashboardService(this.getStatus).overview(session);
  }

  @Remote
  browse(input: MemoryQuery) {
    return new MemosDashboardService(this.getStatus).browse(input);
  }

  @Remote
  status(): MemosStatus {
    return this.getStatus();
  }
}

/** MemOS owns storage and retrieval; Amiba exposes a typed management projection. */
export function applyMemoryRemote(
  ctx: Context,
  getStatus: () => MemosStatus,
): void {
  new AmibaMemoryRemoteService(ctx, getStatus);
}
