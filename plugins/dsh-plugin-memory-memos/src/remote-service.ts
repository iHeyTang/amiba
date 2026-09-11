import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type { MemosStatus } from "./memos-status.js";

import { MemosDashboardService } from "./dashboard-service.js";
import type {
  MemoryCorrectionRequest,
  MemoryQuery,
  MemoryDetailQuery,
  MemoryUpdate,
} from "./dashboard.js";

import { MemoryCorrections } from "./correction.js";

class AmibaMemoryRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly getStatus: () => MemosStatus,
    private readonly corrections: MemoryCorrections,
  ) {
    super(ctx, "amibaMemory");
  }

  @Remote
  beginCorrection(input: MemoryCorrectionRequest) {
    return this.corrections.begin(input);
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
  detail(input: MemoryDetailQuery) {
    return new MemosDashboardService(this.getStatus).detail(input);
  }

  @Remote
  update(input: MemoryUpdate) {
    return new MemosDashboardService(this.getStatus).update(input);
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
  corrections = new MemoryCorrections(new MemosDashboardService(getStatus)),
): void {
  new AmibaMemoryRemoteService(ctx, getStatus, corrections);
}
