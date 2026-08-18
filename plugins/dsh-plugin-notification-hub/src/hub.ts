import type { Context } from "@deepseek-ai/cordis";
import { z } from "zod";

/** Severity of a posted notification; sinks map it to their own presentation. */
export type AmibaNotificationKind = "info" | "success" | "warning" | "error";

/** What a posting plugin supplies. Content only — no delivery concerns. */
export interface AmibaNotificationInput {
  /** Required headline, 1..160 characters after trimming. */
  title: string;
  /** Optional supporting line, up to 600 characters after trimming. */
  body?: string;
  /** Defaults to `"info"`. */
  kind?: AmibaNotificationKind;
  /** When present, delivery surfaces may offer an "open session" action. */
  sessionId?: string;
  /** The posting plugin's name (e.g. `"schedule-adapter"`). Required. */
  source: string;
}

/** A hub-accepted notification: validated input plus hub-owned identity. */
export interface AmibaNotification {
  id: string;
  title: string;
  body?: string;
  kind: AmibaNotificationKind;
  sessionId?: string;
  source: string;
  timestamp: number;
}

/** Delivery surface callback. Sink failures are contained by the hub. */
export type AmibaNotificationSink = (notification: AmibaNotification) => void;

/** Bounded retention for future read surfaces; no persistence in v1. */
const RING_CAPACITY = 100;

const inputSchema = z.strictObject({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(600).optional(),
  kind: z.enum(["info", "success", "warning", "error"]).optional(),
  sessionId: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).max(64),
});

/**
 * Provider-neutral notification hub (`ctx.amibaNotifications`).
 *
 * Mechanism only: any plugin may `post()` content; delivery surfaces attach
 * with `registerSink()` (provider-registry pattern, like
 * `amibaMessageCenter.registerProvider` / `amibaBrowser.registerProvider`).
 * On headless runtimes no sink is registered and posts simply accumulate in
 * the bounded in-memory ring.
 */
export class AmibaNotificationHub {
  private readonly ring: AmibaNotification[] = [];
  private readonly sinks = new Set<AmibaNotificationSink>();
  private sequence = 0;

  constructor(private readonly ctx: Context) {}

  /** Validate and accept one notification, fanning it out to live sinks. */
  post(input: AmibaNotificationInput): { id: string } {
    const parsed = inputSchema.parse(input);
    this.sequence += 1;
    const notification: AmibaNotification = Object.freeze({
      id: `ntf_${Date.now().toString(36)}_${this.sequence.toString(36)}`,
      title: parsed.title,
      ...(parsed.body === undefined ? {} : { body: parsed.body }),
      kind: parsed.kind ?? "info",
      ...(parsed.sessionId === undefined ? {} : { sessionId: parsed.sessionId }),
      source: parsed.source,
      timestamp: Date.now(),
    });
    this.ring.push(notification);
    if (this.ring.length > RING_CAPACITY) {
      this.ring.splice(0, this.ring.length - RING_CAPACITY);
    }
    for (const sink of [...this.sinks]) {
      try {
        sink(notification);
      } catch (error) {
        this.ctx.logger.warn(
          `amiba-notification-hub: sink failed for ${notification.id}: ${String(error)}`,
        );
      }
    }
    return { id: notification.id };
  }

  /** Snapshot of the retained ring, oldest first (at most {@link RING_CAPACITY}). */
  list(): readonly AmibaNotification[] {
    return [...this.ring];
  }

  /**
   * Attach a delivery sink. Returns its disposer; callers wrap the
   * registration in `ctx.effect()` so it unwinds with their fiber.
   */
  registerSink(sink: AmibaNotificationSink): () => void {
    if (this.sinks.has(sink)) {
      throw new Error("duplicate notification sink registration");
    }
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }
}
