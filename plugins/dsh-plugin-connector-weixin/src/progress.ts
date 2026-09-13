import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { WeixinRuntime } from "./provider.js";
/** Best-effort native progress. Never sends arguments, results or model reasoning. */
export class WeixinProgress {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly names = new Map<string, string>();
  private disposed = false;
  constructor(
    private readonly resolve: (session: string) => Promise<WeixinRuntime>,
  ) {}
  accept(session: string, event: SessionEvent): void {
    if (
      this.disposed ||
      !["tool/call", "tool/result", "turn/end"].includes(event.type)
    )
      return;
    const operation = (this.chains.get(session) ?? Promise.resolve())
      .then(async () => {
        if (this.disposed) return;
        if (event.type === "turn/end") {
          for (const key of this.names.keys())
            if (key.startsWith(`${session}:`)) this.names.delete(key);
          return;
        }
        const runtime = await this.resolve(session);
        if (this.disposed) return;
        if (event.type === "tool/call") {
          const { callId, name } = event.data;
          if (!callId) return;
          this.names.set(`${session}:${callId}`, name || "tool");
          if (this.names.size > 2000)
            this.names.delete(this.names.keys().next().value!);
          await runtime.progress(
            {
              type: 11,
              create_time_ms: event.time,
              is_completed: false,
              tool_call_start_item: {
                tool_name: name || "tool",
                tool_call_id: callId,
              },
            },
            `${session}:${callId}:start`,
          );
        } else if (event.type === "tool/result") {
          const message = event.data.message;
          const callId =
            message.source?.callId ?? message.content[0]?.toolCallId;
          const key = `${session}:${callId}`;
          const name = this.names.get(key);
          if (!callId || !name) return;
          this.names.delete(key);
          await runtime.progress(
            {
              type: 12,
              create_time_ms: event.time,
              is_completed: true,
              tool_call_result_item: {
                tool_name: name,
                tool_call_id: callId,
                status: message.content.some((item) => item.isError)
                  ? "failed"
                  : "completed",
              },
            },
            `${session}:${callId}:end`,
          );
        }
      })
      .catch(() => {});
    this.chains.set(session, operation);
    void operation.then(() => {
      if (this.chains.get(session) === operation) this.chains.delete(session);
    });
  }
  async drain() {
    await Promise.all([...this.chains.values()]);
  }
  dispose() {
    this.disposed = true;
    this.names.clear();
  }
}
