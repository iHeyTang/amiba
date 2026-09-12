import type { ToolProgress } from "../protocol";
import type { DshSessionEvent } from "./index";

/** The wire ceiling used by DSH's recursive tool consumers. */
const MAX_DEPTH = 256;
type Running = {
  callId: string;
  name: string;
  argsRaw: string;
  turn: number;
  step: number;
  time: number;
  callView: null;
};
type Settled = {
  kind: "tool-result";
  callId: string;
  seq: number;
  time: number;
  call: { name: string; argsRaw: string };
  callTime: number | null;
  content: readonly unknown[];
  isError: boolean;
  callView: null;
  resultView: null;
};
type Block = (Running | Settled) & { subCalls: readonly Block[] };

/** Presentation-only Code Mode pairing, shared by live and durable projections. */
export class CodeDispatchTree {
  private readonly children = new Map<string, Map<string, Block>>();
  private readonly parents = new Map<string, string>();
  private readonly revisions = new Map<string, number>();

  /** Returns the affected root, or null for unrelated/unsafe/stale wire data. */
  apply(
    event: Pick<DshSessionEvent, "type" | "seq" | "time" | "data">,
  ): string | null {
    if (
      event.type !== "tool/code-dispatch-start" &&
      event.type !== "tool/code-dispatch"
    )
      return null;
    const { parentCallId: parent, subCallId: id, name } = event.data;
    if (
      typeof parent !== "string" ||
      typeof id !== "string" ||
      typeof name !== "string" ||
      !parent ||
      !id
    )
      return null;
    if (event.seq <= (this.revisions.get(id) ?? -1)) return null;
    if (this.parents.has(id) && this.parents.get(id) !== parent) return null;
    let root = parent;
    const seen = new Set([id]);
    for (let depth = 0; ; depth++) {
      if (depth >= MAX_DEPTH || seen.has(root)) return null;
      seen.add(root);
      const next = this.parents.get(root);
      if (next === undefined) break;
      root = next;
    }
    const siblings = this.children.get(parent) ?? new Map<string, Block>();
    const prior = siblings.get(id);
    const argsRaw = JSON.stringify(event.data.arguments);
    if (argsRaw === undefined) return null;
    let block: Block;
    if (event.type === "tool/code-dispatch-start") {
      block = {
        callId: id,
        name,
        argsRaw,
        turn: 0,
        step: 0,
        time: event.time,
        callView: null,
        subCalls: [],
      };
    } else {
      if (
        !Array.isArray(event.data.content) ||
        typeof event.data.isError !== "boolean"
      )
        return null;
      block = {
        kind: "tool-result",
        callId: id,
        seq: event.seq,
        time: event.time,
        call: { name, argsRaw },
        callTime: prior
          ? "kind" in prior
            ? prior.callTime
            : prior.time
          : null,
        content: event.data.content,
        isError: event.data.isError,
        callView: null,
        resultView: null,
        subCalls: [],
      };
    }
    siblings.set(id, block);
    this.children.set(parent, siblings);
    this.parents.set(id, parent);
    this.revisions.set(id, event.seq);
    return root;
  }

  project(progress: ToolProgress): ToolProgress {
    if (!progress.wire || !this.children.has(progress.toolCallId))
      return progress;
    return {
      ...progress,
      wire: {
        ...progress.wire,
        subCalls: this.descendants(progress.toolCallId, 0),
      },
    };
  }

  private descendants(id: string, depth: number): readonly Block[] {
    if (depth >= MAX_DEPTH) return [];
    return [...(this.children.get(id)?.values() ?? [])].map((block) => ({
      ...block,
      subCalls: this.descendants(block.callId, depth + 1),
    }));
  }
}
