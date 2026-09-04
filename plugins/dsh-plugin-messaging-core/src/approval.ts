import type { Context } from "@deepseek-ai/cordis";
import { randomUUID } from "node:crypto";

import type {
  InboundConversationRef,
  MessageChannelProvider,
  OutboundMessageEnvelope,
} from "./center.js";
import {
  resolveChannelApproval,
  type MessageCenterStore,
  type StoredMessageChannel,
} from "./store.js";

/**
 * The four closed outcomes of `@deepseek-ai/dsh-user-approval`. Mirrored
 * structurally rather than imported: the package is composed by dsh-base at
 * runtime (so `ctx.approval` and the `approval/request` waterfall always
 * exist in the product) but it is not a workspace dependency of this plugin,
 * and messaging-core only ever reads the request and returns a verdict.
 */
export type ApprovalOutcome =
  | "allowed-once"
  | "rejected"
  | "cancelled"
  | "unavailable";

/** The subset a human can actually choose in an IM. */
export type ApprovalDecision = "allowed-once" | "rejected";

/** Why a relayed approval stopped waiting — drives the IM outcome copy. */
export type ApprovalSettlementReason =
  | "answered"
  | "timeout"
  | "desktop"
  | "cancelled";

/**
 * One approval question handed to a channel provider. `signal` aborts when the
 * asking turn is withdrawn (cancelled run, desktop-side settle), so a native
 * surface can retract its card; `deadlineAt` is the epoch millisecond the
 * relay will auto-reject at, absent under the `wait` policy.
 */
export interface ApprovalPrompt {
  readonly approvalId: string;
  readonly seq: number;
  readonly toolName: string;
  readonly reason?: string;
  readonly sessionId: string;
  readonly signal: AbortSignal;
  readonly deadlineAt?: number;
}

/** A human's answer collected by a provider's own surface. */
export interface ApprovalReply {
  readonly outcome: ApprovalDecision;
  readonly by?: string;
}

/**
 * Sent to a provider that presented natively, once the question is settled by
 * whichever path won, so it can flip its card to the result state.
 */
export interface ApprovalOutcomeNotice {
  readonly approvalId: string;
  readonly seq: number;
  readonly toolName: string;
  readonly outcome: ApprovalOutcome;
  readonly reason: ApprovalSettlementReason;
}

/**
 * Structural mirror of dsh-user-approval's `ApprovalRequest`. Only the fields
 * the relay reads are declared; the real request carries a full `Agent`.
 */
export interface RelayApprovalRequest {
  readonly agent: {
    readonly session: { readonly id: string; readonly events: readonly unknown[] };
  };
  readonly toolName: string;
  readonly callId?: string;
  readonly reason?: string;
  readonly signal?: AbortSignal;
}

/** The waterfall listener shape of the `approval/request` event. */
export type ApprovalAnswerer = (
  req: RelayApprovalRequest,
  next: () => Promise<ApprovalOutcome>,
) => Promise<ApprovalOutcome>;

/** The slice of `MessageChannelCenter` the relay drives. */
export interface ApprovalRelayHost {
  readonly store: MessageCenterStore;
  providerFor(channel: StoredMessageChannel): MessageChannelProvider | undefined;
  queueOutbound(envelope: OutboundMessageEnvelope): Promise<void>;
  cancelOutbound(envelopeId: string): Promise<void>;
  warn(message: string): void;
}

interface Settlement {
  outcome: ApprovalOutcome;
  reason: ApprovalSettlementReason;
  by?: string;
  /** Post nothing to the IM — teardown, or a channel that cannot carry it. */
  silent?: boolean;
  /**
   * The relay gave up on this question: the answerer must resolve it with
   * `next()` (the desktop backstop of plan §0/§5) instead of returning
   * `outcome`. Only the permanent-delivery-failure path sets it.
   */
  delegate?: boolean;
}

interface PendingApproval {
  readonly approvalId: string;
  readonly seq: number;
  readonly channelId: string;
  readonly conversationKey: string;
  readonly sessionId: string;
  readonly toolName: string;
  readonly reason?: string;
  readonly createdAt: number;
  readonly deadlineAt?: number;
  presentation: "native" | "text";
  promptEnvelopeId?: string;
  settled: boolean;
  settle(settlement: Settlement): void;
}

/**
 * `同意 #2` / `reject` / `ok` … — the text protocol of plan §0. Case
 * insensitive, `#` and the number both optional; anything else is an ordinary
 * user message and must reach the model untouched.
 */
const APPROVAL_REPLY =
  /^(同意|拒绝|yes|no|ok|approve|reject)\s*(?:#?\s*(\d+))?$/iu;

const ALLOW_WORDS = new Set(["同意", "yes", "ok", "approve"]);

export interface ParsedApprovalReply {
  outcome: ApprovalDecision;
  /**
   * The number the reply named, `undefined` when it named none (meaning "the
   * oldest question"), and `null` when it named one we cannot use — a digit
   * run past `Number.MAX_SAFE_INTEGER`. A named-but-unusable target must NOT
   * silently degrade to "oldest": the sender pointed at something specific,
   * so it matches nothing and travels on as an ordinary message.
   */
  seq?: number | null;
}

/** Parse one inbound message as an approval answer, or `null` if it is not. */
export function parseApprovalReply(text: string): ParsedApprovalReply | null {
  const match = APPROVAL_REPLY.exec(text.trim());
  if (!match) return null;
  const word = match[1]!.toLowerCase();
  const outcome: ApprovalDecision = ALLOW_WORDS.has(word)
    ? "allowed-once"
    : "rejected";
  if (match[2] === undefined) return { outcome };
  const seq = Number.parseInt(match[2], 10);
  return { outcome, seq: Number.isSafeInteger(seq) ? seq : null };
}

function promptText(pending: PendingApproval): string {
  const head = `需要审批 #${pending.seq}：${pending.toolName}`;
  const body = pending.reason ? `${head} — ${pending.reason}` : head;
  return `${body}。回复「同意 #${pending.seq}」或「拒绝 #${pending.seq}」`;
}

function noticeText(
  pending: PendingApproval,
  settlement: Settlement,
): string | undefined {
  switch (settlement.reason) {
    case "timeout":
      return `审批 #${pending.seq}（${pending.toolName}）已超时拒绝。`;
    case "desktop":
      return `审批 #${pending.seq}（${pending.toolName}）已在桌面处理。`;
    case "cancelled":
      return `审批 #${pending.seq}（${pending.toolName}）已取消（本次运行已结束或已在桌面处理）。`;
    // A text answer is its own receipt in the conversation that carried it —
    // echoing "已同意" back would only add noise. Native surfaces still get an
    // `announceApprovalOutcome` for every reason, including this one.
    case "answered":
      return undefined;
  }
}

/**
 * Reads the audit id DSH already appended for THIS question. The service
 * appends `approval/asked` before dispatching the waterfall, but dispatch
 * rides a microtask, so parallel tool calls can stack several asks before any
 * answerer runs: this request's event is the newest asked event that is still
 * undecided, not already claimed by another pending relay entry, and — when
 * the ask names a call — carries the same `callId`. Same pairing rule as
 * dsh-host-apiproxy, so both answerers agree on ids.
 */
export function readApprovalId(
  req: RelayApprovalRequest,
  claimed: ReadonlySet<string>,
): string | undefined {
  const events = req.agent.session.events;
  const decided = new Set<string>();
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as
      | { type?: string; data?: Record<string, unknown> }
      | undefined;
    if (!event || typeof event.type !== "string") continue;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const id = typeof data.id === "string" ? data.id : undefined;
    if (event.type === "approval/decided") {
      if (id) decided.add(id);
      continue;
    }
    if (event.type !== "approval/asked" || !id) continue;
    if (decided.has(id) || claimed.has(id)) continue;
    const callId = typeof data.callId === "string" ? data.callId : null;
    if ((req.callId ?? null) !== callId) continue;
    return id;
  }
  return undefined;
}

/**
 * Answers DSH tool-approval questions for sessions bound to an IM channel.
 *
 * Registered with `prepend` so it runs BEFORE dsh-host-apiproxy's desktop
 * answerer, which claims every request it can pair with an `approval/asked`
 * event and never delegates. Everything this relay cannot handle — a session
 * with no conversation binding, a disabled channel, a provider that can
 * neither present natively nor deliver text — falls through `next()`, which is
 * exactly the "IM first, desktop as the backstop" decision of plan §0.
 */
export class ApprovalRelay {
  private readonly pending = new Map<string, PendingApproval>();
  /**
   * Next short number per conversation. Monotonic for the lifetime of the
   * relay and never reset: recycling `#1` once the queue drains would let a
   * late "同意 #1" — typed while question #1 was still on screen, delivered
   * after it timed out — silently grant a DIFFERENT tool call that happens to
   * have been numbered #1 in turn.
   */
  private readonly sequences = new Map<string, number>();
  private registered = false;
  private disposed = false;

  constructor(
    private readonly ctx: Context,
    private readonly host: ApprovalRelayHost,
  ) {}

  /**
   * Attach to the `approval/request` waterfall. A runtime without the approval
   * service composed (headless tools, unit harnesses) simply gets no relay.
   */
  register(): void {
    if (this.registered) return;
    const reflect = (
      this.ctx as unknown as { reflect?: { get?(name: string): unknown } }
    ).reflect;
    if (reflect?.get?.("approval") === undefined) return;
    this.registered = true;
    const on = this.ctx.on as unknown as (
      name: string,
      listener: ApprovalAnswerer,
      options?: boolean,
    ) => () => boolean;
    on.call(this.ctx, "approval/request", this.answer, true);
    this.ctx.effect(
      () => () => this.dispose(),
      "amiba-messaging-core.approval",
    );
  }

  /** Settle everything still in flight — plugin unload mirrors apiproxy. */
  dispose(): void {
    this.disposed = true;
    for (const pending of [...this.pending.values()])
      pending.settle({ outcome: "cancelled", reason: "cancelled", silent: true });
  }

  /** Pending questions of one conversation, oldest first. */
  private pendingFor(channelId: string, sessionId: string): PendingApproval[] {
    return [...this.pending.values()]
      .filter(
        (item) =>
          item.channelId === channelId &&
          item.sessionId === sessionId &&
          !item.settled,
      )
      .sort((left, right) => left.seq - right.seq);
  }

  /**
   * The pending question an inbound message would answer, if any. Split out
   * of `answerFromText` so the caller can claim the message's receipt BEFORE
   * anything is settled — a redelivered answer must not settle whatever is
   * pending now.
   */
  private textTarget(
    channelId: string,
    sessionId: string,
    text: string,
  ): { target: PendingApproval; outcome: ApprovalDecision } | undefined {
    const parsed = parseApprovalReply(text);
    if (!parsed || parsed.seq === null) return undefined;
    const waiting = this.pendingFor(channelId, sessionId);
    const target =
      parsed.seq === undefined
        ? waiting[0]
        : waiting.find((item) => item.seq === parsed.seq);
    return target ? { target, outcome: parsed.outcome } : undefined;
  }

  /**
   * True when this inbound message would be consumed as an approval answer.
   * The caller uses it to decide whether to claim the message's receipt on
   * the approval path instead of the ordinary inbound path.
   */
  matchesPending(channelId: string, sessionId: string, text: string): boolean {
    return this.textTarget(channelId, sessionId, text) !== undefined;
  }

  /**
   * Consume an inbound message as an answer to a pending approval. Returns
   * true when it was consumed — the caller must then NOT turn it into a user
   * turn (plan §3). Anything unparseable, or aimed at a number nobody is
   * waiting on, returns false and travels the normal inbound path.
   */
  answerFromText(
    channelId: string,
    sessionId: string,
    text: string,
    by?: string,
  ): boolean {
    const match = this.textTarget(channelId, sessionId, text);
    if (!match) return false;
    match.target.settle({
      outcome: match.outcome,
      reason: "answered",
      ...(by ? { by } : {}),
    });
    return true;
  }

  private nextSeq(conversation: string): number {
    const seq = this.sequences.get(conversation) ?? 1;
    this.sequences.set(conversation, seq + 1);
    return seq;
  }

  /** Drop a settled record. The conversation's counter deliberately stays. */
  private forget(pending: PendingApproval): void {
    this.pending.delete(pending.approvalId);
  }

  private readonly answer: ApprovalAnswerer = async (req, next) => {
    if (this.disposed) return next();
    // The service settles an already-aborted ask itself; claiming it here
    // would only race its own signal check.
    if (req.signal?.aborted === true) return next();
    let pending: PendingApproval | undefined;
    try {
      const sessionId = req.agent.session.id;
      const binding = await this.host.store.findConversationBySession(sessionId);
      if (!binding) return next();
      const channel = (await this.host.store.list()).find(
        (item) => item.id === binding.channelId,
      );
      if (!channel?.enabled) return next();
      const provider = this.host.providerFor(channel);
      if (!provider) return next();

      const conversation: InboundConversationRef = {
        key: binding.conversationKey,
        kind: binding.kind,
        ...(binding.title ? { title: binding.title } : {}),
      };
      const policy = resolveChannelApproval(channel);
      const approvalId =
        readApprovalId(req, new Set(this.pending.keys())) ??
        `amiba-approval-${randomUUID()}`;
      if (this.pending.has(approvalId)) return next();

      const controller = new AbortController();
      let settlement: Settlement | undefined;
      let resolveSettled!: (value: Settlement) => void;
      const settled = new Promise<Settlement>((resolve) => {
        resolveSettled = resolve;
      });
      const deadlineAt =
        policy.mode === "timeout" ? Date.now() + policy.timeoutMs : undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () =>
        entry.settle({ outcome: "cancelled", reason: "cancelled" });
      const entry: PendingApproval = {
        approvalId,
        seq: this.nextSeq(`${channel.id}:${binding.conversationKey}`),
        channelId: channel.id,
        conversationKey: binding.conversationKey,
        sessionId,
        toolName: req.toolName,
        ...(req.reason ? { reason: req.reason } : {}),
        createdAt: Date.now(),
        ...(deadlineAt === undefined ? {} : { deadlineAt }),
        presentation: "text",
        settled: false,
        settle: (value) => {
          if (entry.settled) return;
          entry.settled = true;
          settlement = value;
          if (timer) clearTimeout(timer);
          req.signal?.removeEventListener("abort", onAbort);
          controller.abort();
          resolveSettled(value);
        },
      };
      pending = entry;
      this.pending.set(approvalId, entry);
      if (deadlineAt !== undefined) {
        timer = setTimeout(
          () => entry.settle({ outcome: "rejected", reason: "timeout" }),
          Math.max(0, deadlineAt - Date.now()),
        );
        timer.unref?.();
      }
      req.signal?.addEventListener("abort", onAbort, { once: true });

      const prompt: ApprovalPrompt = {
        approvalId,
        seq: entry.seq,
        toolName: entry.toolName,
        ...(entry.reason ? { reason: entry.reason } : {}),
        sessionId,
        signal: controller.signal,
        ...(deadlineAt === undefined ? {} : { deadlineAt }),
      };

      if (provider.requestApproval) {
        entry.presentation = "native";
        const native = Promise.resolve()
          .then(() => provider.requestApproval!(channel, conversation, prompt))
          .then(
            (reply) => ({ kind: "reply" as const, reply }),
            (error: unknown) => ({ kind: "error" as const, error }),
          );
        const raced = await Promise.race([
          native,
          settled.then(() => ({ kind: "settled" as const })),
        ]);
        if (raced.kind === "error") {
          entry.presentation = "text";
          this.host.warn(
            `Channel ${channel.id} could not present approval ${approvalId} natively; falling back to text: ${String(raced.error)}`,
          );
        } else if (raced.kind === "reply") {
          if (raced.reply) {
            entry.settle({
              outcome: raced.reply.outcome,
              reason: "answered",
              ...(raced.reply.by ? { by: raced.reply.by } : {}),
            });
          } else {
            // `null` is the provider saying "I cannot present this one" —
            // the text protocol is the fallback, not an error.
            entry.presentation = "text";
          }
        }
      }

      if (!entry.settled && entry.presentation === "text") {
        const queued = await this.deliverPrompt(channel, entry);
        if (!queued) {
          // Settle before forgetting: the record is going away, but its
          // deadline timer and abort listener would otherwise stay armed and
          // fire against a question nobody is tracking any more.
          entry.settle({
            outcome: "unavailable",
            reason: "cancelled",
            silent: true,
          });
          this.forget(entry);
          return next();
        }
      }

      const result = settlement ?? (await settled);
      // The prompt exhausted the outbox's retry budget: this channel cannot
      // reach the human at all, so hand the question to the next answerer
      // (the desktop) exactly as an undeliverable channel does — plan §5's
      // "再失败则 next()". `next()` only exists inside this callback, which is
      // why the promise is held open until the outbox gives up rather than
      // settled as `unavailable` from the delivery loop.
      if (result.delegate) {
        this.forget(entry);
        return next();
      }
      await this.settleSideEffects(channel, conversation, entry, result);
      this.forget(entry);
      return result.outcome;
    } catch (error) {
      if (pending) {
        pending.settle({
          outcome: "cancelled",
          reason: "cancelled",
          silent: true,
        });
        this.forget(pending);
      }
      this.host.warn(
        `Could not relay a tool approval to its IM channel; leaving it to the desktop: ${String(error)}`,
      );
      return next();
    }
  };

  /**
   * The outbox has permanently given up on `envelopeId`. When it carried a
   * pending question's prompt, that question can never reach the IM: settle
   * it so the answerer wakes up and delegates to the desktop backstop.
   */
  abandonPrompt(envelopeId: string): void {
    for (const entry of this.pending.values()) {
      if (entry.settled || entry.promptEnvelopeId !== envelopeId) continue;
      this.host.warn(
        `Approval prompt ${envelopeId} could not be delivered; handing approval ${entry.approvalId} to the next answerer.`,
      );
      entry.settle({
        outcome: "unavailable",
        reason: "cancelled",
        silent: true,
        delegate: true,
      });
    }
  }

  /**
   * Queue the text prompt on the same durable outbox as turn replies, so the
   * existing pump, retry budget and backoff apply. Returns false when the
   * channel structurally cannot carry it (no outbound support, no `deliver`,
   * or the queue write failed) — the caller then delegates to the desktop,
   * which is plan §5's "delivery impossible" row.
   */
  private async deliverPrompt(
    channel: StoredMessageChannel,
    pending: PendingApproval,
  ): Promise<boolean> {
    const provider = this.host.providerFor(channel);
    if (!provider?.supportsOutbound || !provider.deliver) return false;
    const envelopeId = `approval:${pending.approvalId}:prompt`;
    try {
      await this.host.queueOutbound({
        id: envelopeId,
        channelId: channel.id,
        sessionId: pending.sessionId,
        // Synthetic correlation: nothing inbound triggered this message, and
        // providers route by `sessionId`, treating `inReplyTo` as an optional
        // thread hint only.
        inReplyTo: `approval:${pending.approvalId}`,
        text: promptText(pending),
        createdAt: new Date().toISOString(),
      });
      pending.promptEnvelopeId = envelopeId;
      return true;
    } catch (error) {
      this.host.warn(
        `Could not queue the approval prompt for channel ${channel.id}: ${String(error)}`,
      );
      return false;
    }
  }

  /** Update the IM once the question is closed (plan §4/§5). */
  private async settleSideEffects(
    channel: StoredMessageChannel,
    conversation: InboundConversationRef,
    pending: PendingApproval,
    settlement: Settlement,
  ): Promise<void> {
    if (settlement.silent) return;
    // A prompt that never made it out of the outbox must not surface later.
    // Note the outcome notice below is still queued in that case (e.g. a
    // timeout notice for a prompt whose first delivery attempt had not run
    // yet): it is the same conversation and the same transport, so if the
    // notice lands the human learns the question expired, and if it does not
    // it fails the same way the prompt did. Deliberate — do not gate the
    // notice on the prompt having been delivered.
    if (pending.promptEnvelopeId) {
      await this.host
        .cancelOutbound(pending.promptEnvelopeId)
        .catch(() => undefined);
    }
    const provider = this.host.providerFor(channel);
    if (pending.presentation === "native" && provider?.announceApprovalOutcome) {
      try {
        await provider.announceApprovalOutcome(channel, conversation, {
          approvalId: pending.approvalId,
          seq: pending.seq,
          toolName: pending.toolName,
          outcome: settlement.outcome,
          reason: settlement.reason,
        });
        return;
      } catch (error) {
        this.host.warn(
          `Channel ${channel.id} could not update its approval card for ${pending.approvalId}: ${String(error)}`,
        );
      }
    }
    const text = noticeText(pending, settlement);
    if (!text || !provider?.supportsOutbound || !provider.deliver) return;
    try {
      await this.host.queueOutbound({
        id: `approval:${pending.approvalId}:notice`,
        channelId: channel.id,
        sessionId: pending.sessionId,
        inReplyTo: `approval:${pending.approvalId}`,
        text,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      this.host.warn(
        `Could not queue the approval outcome notice for channel ${channel.id}: ${String(error)}`,
      );
    }
  }
}
