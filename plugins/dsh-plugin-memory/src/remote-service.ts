import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { MemosStatus } from "./memos-status.js";

class AmibaMemoryRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly getStatus: () => MemosStatus,
  ) {
    super(ctx, "amibaMemory");
  }

  @Remote
  status(): MemosStatus {
    return this.getStatus();
  }
}

/** MemOS owns memory management; Amiba exposes only its lifecycle status. */
export function applyMemoryRemote(
  ctx: Context,
  getStatus: () => MemosStatus,
): void {
  new AmibaMemoryRemoteService(ctx, getStatus);
}
