import type { Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

import type { DshUsageReader } from "./reader.js";
import type { ToolActivityRecorder } from "./tool-activity-recorder.js";

class AmibaUsageRemoteService extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly reader: DshUsageReader,
    private readonly toolActivity: ToolActivityRecorder,
  ) {
    super(ctx, "amibaUsage");
  }

  @Remote
  list() {
    return this.reader.list();
  }

  @Remote
  readToolActivity(days: number) {
    return this.toolActivity.read(days);
  }
}

export function applyUsageRemote(
  ctx: Context,
  reader: DshUsageReader,
  toolActivity: ToolActivityRecorder,
): void {
  new AmibaUsageRemoteService(ctx, reader, toolActivity);
}
