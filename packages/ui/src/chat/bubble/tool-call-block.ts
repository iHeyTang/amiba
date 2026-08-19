import type { ToolProgress } from "@amiba/app-runtime/core";
import type {
  RunningToolCall,
  ToolCallBlock,
  ToolResultNode,
} from "@amiba/extension-sdk";

/**
 * Re-assert a type-erased wire payload at the boundary where its type IS
 * known.
 *
 * `@amiba/app-runtime/protocol` is runtime-neutral by contract and imports no
 * adapter types, so it carries these DSH members as `unknown`
 * (`ToolCallWireRecord.callView`, `ToolResultWireRecord.content` /
 * `resultView`). The values are the verbatim wire payloads — this module is
 * the first place that both holds them and can name their DSH types, so it is
 * where the erasure is undone.
 *
 * Deliberately NOT a validator. `ContentBlock` is an open, merge-extensible
 * union (a plugin may add a block type), and the render-intent unions are
 * host-computed per delivery; the runtime's own root-node builders pass all
 * three through with zero checks (`content: result.content`,
 * `callView: match.view.view`). Validating here would diverge from the
 * official semantics rather than improve on them — and a "safe" fallback
 * would silently substitute a value the wire never sent, which is exactly the
 * fabrication this seat's contract forbids.
 */
function wireValue<T>(value: unknown): T {
  return value as T;
}

/**
 * Rebuild the DSH runtime's own frozen call node from one Amiba tool row.
 *
 * Field-for-field the same projection as the client runtime's `rootCall` /
 * `rootResult`, reading the verbatim wire material both Amiba producers
 * retain (`ToolProgress.wire`). Returns `null` when a row carries no wire
 * material at all: the honest answer is "no faithful block", and the caller
 * renders its own row instead of dispatching a partly invented node.
 *
 * `subCalls` is `[]` because that is the runtime's value for every ROOT call.
 * Children come only from `tool/code-dispatch-start` / `tool/code-dispatch`,
 * which exist only under Code Mode's `run_code` transport, and no Amiba
 * bundle or plugin manifest composes a `ctx.codeRuntime` — so no session
 * Amiba itself assembles emits either event. The scope of that claim is
 * Amiba's own composition: the managed profile's `cordis.patch.yml` is
 * user-owned (seeded once, never overwritten), so an operator who mounts a
 * code runtime there and selects a code preset WOULD see those events flow.
 * Amiba's own tool row has never rendered sub-calls either, so that
 * configuration loses nothing relative to the pre-seat behaviour; it is
 * simply outside what this `[]` speaks for.
 *
 * @param event - one Amiba tool row.
 * @returns the running-or-settled call node, or null when unavailable.
 */
export function toolCallBlockFromProgress(
  event: ToolProgress,
): ToolCallBlock | null {
  const call = event.wire?.call;
  const result = event.wire?.result;
  if (result) {
    return {
      kind: "tool-result",
      seq: result.seq,
      time: result.time,
      callId: event.toolCallId,
      // Null when the call frame fell outside the window, exactly as the
      // runtime reports it — never Amiba's `"tool"` placeholder name.
      call: call ? { name: event.tool, argsRaw: call.argsRaw } : null,
      callTime: call?.time ?? null,
      content: wireValue<ToolResultNode["content"]>(result.content),
      isError: result.isError,
      ...(result.error ? { error: result.error } : {}),
      ...(result.meta === undefined ? {} : { meta: result.meta }),
      // The settled node carries the CALL's render intent forward.
      callView: wireValue<ToolResultNode["callView"]>(call?.callView ?? null),
      resultView: wireValue<ToolResultNode["resultView"]>(result.resultView),
      subCalls: [],
    };
  }
  if (!call) return null;
  return {
    callId: event.toolCallId,
    name: event.tool,
    argsRaw: call.argsRaw,
    turn: call.turn,
    step: call.step,
    time: call.time,
    callView: wireValue<RunningToolCall["callView"]>(call.callView),
    subCalls: [],
  };
}

/**
 * The block's wire tool name — the keyed dispatch value. Identical to the
 * runtime's own `callName`: the settled node's backfilled call head, the
 * running node's own name. An empty string when a settled result's call frame
 * is out of window; no registration can key on it, so the host row renders.
 *
 * @param block - the frozen call node.
 * @returns the wire tool name, or `""` when unknown.
 */
export function toolCallBlockName(block: ToolCallBlock): string {
  return "kind" in block ? (block.call?.name ?? "") : block.name;
}
