import { durableContentImages } from "@amiba/app-runtime/dsh-client";
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
 * `subCalls` retains the Code Mode dispatch tree assembled by both the live
 * event bridge and durable history projection. Ordinary calls have no dispatch
 * children and keep the official empty array. The projection does not introduce
 * extra Amiba rows; an occupying toolview receives the nested official blocks.
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
      subCalls: wireValue<readonly ToolCallBlock[]>(event.wire?.subCalls ?? []),
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
    subCalls: wireValue<readonly ToolCallBlock[]>(event.wire?.subCalls ?? []),
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

// ---------------------------------------------------------------------------
// Occupant-side readers: a `tool.call.toolview` component receives the
// frozen block and reads the call through these — exported with the
// evidence components so a plugin never re-derives wire shapes itself.
// ---------------------------------------------------------------------------

/** The settled result node, or null while the call is still running. */
export function toolCallSettled(block: ToolCallBlock): ToolResultNode | null {
  return "kind" in block ? block : null;
}

/** Parsed call arguments; `{}` when the raw args are absent or malformed. */
export function toolCallArgs(block: ToolCallBlock): Record<string, unknown> {
  const raw = "kind" in block ? block.call?.argsRaw : block.argsRaw;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** Joined text content of a settled result; empty while running. */
export function toolCallResultText(block: ToolCallBlock): string {
  const settled = toolCallSettled(block);
  if (!settled) return "";
  return settled.content
    .map((item) => {
      const record =
        item && typeof item === "object"
          ? (item as { type?: unknown; text?: unknown })
          : null;
      return record?.type === "text" && typeof record.text === "string"
        ? record.text
        : "";
    })
    .join("");
}

export function toolCallFailed(block: ToolCallBlock): boolean {
  return toolCallSettled(block)?.isError === true;
}

export function toolCallErrorCode(block: ToolCallBlock): string {
  return toolCallSettled(block)?.error?.code ?? "";
}

/** Wall-clock duration of a settled call whose call frame is in-window. */
export function toolCallDurationMs(block: ToolCallBlock): number | undefined {
  const settled = toolCallSettled(block);
  if (!settled || settled.callTime == null) return undefined;
  return Math.max(0, settled.time - settled.callTime);
}

/** Epoch ms when a still-running call was logged (for live tickers). */
export function toolCallStartedAt(block: ToolCallBlock): number | undefined {
  return "kind" in block ? undefined : block.time;
}

/** Durable images owned by this call, without borrowing nested calls' results. */
export function toolCallResultImages(block: ToolCallBlock) {
  return durableContentImages(toolCallSettled(block)?.content);
}
