import { randomUUID } from "node:crypto";

import type { Context } from "@deepseek-ai/cordis";
import type {
  ApprovalOutcomeNotice,
  ApprovalPrompt,
  ApprovalReply,
  InboundConversationRef,
  MessageChannelApproval,
  MessageChannelCenter,
  MessageChannelProvider,
  OutboundMessageEnvelope,
  StoredMessageChannel,
} from "@amiba/dsh-plugin-messaging-core";

import { ConnectorStore, type StoredConnect } from "./store.js";
import type {
  CapabilityDecl,
  ConnectorHandle,
  ConnectorInboundEnvelope,
  ConnectorProvider,
  ConnectorProviderView,
  ConnectorRuntime,
  ConnectorStatus,
  ConnectView,
  OnboardHandle,
  OnboardingState,
  OnboardingView,
  OnboardUpdate,
} from "./types.js";

interface CapabilityApplier {
  apply(connect: StoredConnect, decl: CapabilityDecl): Promise<() => void>;
}

interface LiveConnect {
  runtime: ConnectorRuntime;
  disposers: Array<() => void>;
  channelSecret: string;
}

interface GrantPayload {
  config: unknown;
  channelSecret: string;
}

interface OnboardingSession {
  readonly id: string;
  readonly provider: string;
  readonly controller: AbortController;
  readonly createdAt: number;
  state: OnboardingState;
  qrUrl?: string;
  qrExpireIn?: number;
  statusNote?: string;
  connect?: ConnectView;
  error?: string;
  /** Timestamp the session reached a terminal state; unset while pending. */
  terminalAt?: number;
}

/** No timers: sessions are swept lazily (on the next begin/poll/cancel call)
 * against these two independent age limits. */
const ONBOARDING_MAX_AGE_MS = 10 * 60 * 1000;
const ONBOARDING_TERMINAL_MAX_AGE_MS = 5 * 60 * 1000;

interface CredentialsSeam {
  readRecord(
    key: string,
  ): Promise<{ kind: string; payload?: unknown } | undefined>;
  modifyRecord(
    key: string,
    mutate: (current: unknown) => Promise<unknown>,
  ): Promise<unknown>;
  deleteRecord(key: string): Promise<void>;
}

const GRANT_SCOPE = "amiba-connector-core";
const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;

/**
 * Thrown by a capability applier's `apply()` to signal a soft, recoverable
 * "not available right now" condition (e.g. the mcp applier when
 * `amibaMcpManager` isn't wired into this runtime) rather than a genuine
 * application failure. `startConnect` recognizes this specific error and
 * records it as the connect's status without hard-failing the whole start
 * fiber — every other thrown error takes the normal hard-failure path
 * (dispose what's applied, stop the runtime, error status, rethrow).
 */
export class CapabilityUnavailableError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "CapabilityUnavailableError";
  }
}

/**
 * Bare failure text for an error-status `detail`. `String(error)` on a real
 * `Error` yields `"Error: <message>"` (via `Error.prototype.toString`) —
 * `DshSettingsConnect`'s status badge template already prepends its own
 * translated "Error: " prefix, so storing `String(error)` here doubles it up
 * in the UI. This mirrors the bare-message pattern already used for
 * `CapabilityUnavailableError` below (`error.message`, not `String(error)`).
 */
function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Registry, lifecycle owner and messaging bridge for connects. A connect is
 * one binding between the user and one external platform application; once
 * enabled it fans out into a messaging channel (via messaging-core) and tool
 * capabilities (via the injected capability applier table, e.g. mcp-manager).
 *
 * The center contains no platform knowledge of its own — platform adapters
 * register a `ConnectorProvider` and only ever see their `ConnectorHandle`.
 */
export class ConnectorCenter {
  private readonly providers = new Map<string, ConnectorProvider>();
  private readonly live = new Map<string, LiveConnect>();
  private readonly starting = new Map<string, Promise<void>>();
  private readonly statuses = new Map<string, ConnectorStatus>();
  /**
   * Connect ids whose current `statuses` entry was written by the center
   * itself (a capability applier's soft-skip, or a hard-failure catch) —
   * NOT by the provider through its `ConnectorHandle`. While locked, a
   * provider-originated `setStatus` (`providerSetStatus` below) is ignored:
   * a late-arriving "ready" from e.g. a ws reconnect callback must not
   * silently clobber a `degraded`/`error` the center just recorded for a
   * reason the provider knows nothing about. Cleared at the top of every
   * `performStart` (a fresh start earns a fresh chance for the provider's
   * own writes to land) and by `stopConnect` (alongside the status itself).
   */
  private readonly statusLocked = new Set<string>();
  private readonly droppedSenders = new Map<string, number>();
  /**
   * One in-flight teardown promise per provider id, tracked from the moment
   * a registration is disposed until its bridge is actually dropped from
   * messageCenter. `registerProvider` consults this to detect a reload
   * racing its own predecessor's teardown — see its comment for why that
   * race matters.
   */
  private readonly teardowns = new Map<string, Promise<void>>();
  private readonly onboardings = new Map<string, OnboardingSession>();

  constructor(
    private readonly ctx: Context,
    private readonly store: ConnectorStore,
    private readonly messageCenter: MessageChannelCenter,
    private readonly credentials: CredentialsSeam,
    private readonly appliers: Map<string, CapabilityApplier>,
    /** Injectable clock, test seam only — production always defaults to
     * `Date.now`. Onboarding session GC stamps and ages against this. */
    private readonly now: () => number = Date.now,
  ) {}

  registerProvider(provider: ConnectorProvider): () => void {
    if (!PROVIDER_ID_PATTERN.test(provider.id))
      throw new Error("invalid_provider_id");
    if (this.providers.has(provider.id))
      throw new Error(`duplicate_provider:${provider.id}`);
    this.providers.set(provider.id, provider);

    const bridge: MessageChannelProvider = {
      id: `connector-${provider.id}`,
      name: provider.name,
      description: provider.description,
      supportsInbound: true,
      supportsOutbound: true,
      deliver: async (channel, envelope) =>
        this.bridgeDeliver(channel, envelope),
      requestApproval: async (channel, conversation, request) =>
        this.bridgeRequestApproval(channel, conversation, request),
      announceApprovalOutcome: async (channel, conversation, notice) =>
        this.bridgeAnnounceApprovalOutcome(channel, conversation, notice),
    };

    let disposed = false;
    let disposeBridge: (() => void) | undefined;

    // A plugin reload can dispose a provider's registration and immediately
    // register a fresh instance under the SAME id before the old
    // registration's teardown has actually dropped its messaging bridge
    // entry (that teardown stops every live connect first, then disposes
    // the bridge — see the disposer below — and both steps are async).
    // messageCenter.registerProvider throws on a duplicate provider id, so
    // registering the new bridge synchronously here would crash on that
    // still-occupied "connector-<id>" slot. When a teardown for this
    // provider id is still pending, defer this registration's bridge setup
    // and connects reconciliation until that teardown actually settles;
    // otherwise register synchronously, exactly as before.
    const priorTeardown = this.teardowns.get(provider.id);
    const registered: Promise<void> = priorTeardown
      ? priorTeardown.then(() => {
          // This registration was disposed before its predecessor's
          // teardown even finished — nothing to set up.
          if (disposed) return;
          disposeBridge = this.messageCenter.registerProvider(bridge);
          void this.startProviderConnects(provider.id);
        })
      : (() => {
          disposeBridge = this.messageCenter.registerProvider(bridge);
          // A provider can (re)register while some of its connects are
          // already enabled-but-stranded in the store — its previous
          // registration was disposed while connects stayed enabled, or the
          // app booted before this provider registered at all. Reconcile
          // them now instead of waiting for an explicit setEnabled toggle to
          // notice.
          void this.startProviderConnects(provider.id);
          return Promise.resolve();
        })();

    return () => {
      if (disposed) return;
      disposed = true;
      if (this.providers.get(provider.id) === provider)
        this.providers.delete(provider.id);
      // A provider going away must not leave its own in-flight onboarding
      // sessions (e.g. a QR scan waiting on this provider's onboard()) dangling
      // forever — abort and settle them the same way an explicit
      // cancelOnboarding() would, scoped to this provider's own sessions only.
      for (const session of this.onboardings.values()) {
        if (session.provider === provider.id) this.cancelSession(session);
      }
      // Unregistering a provider must not leave its connects orphaned (live
      // sockets, live mcp registrations, deliveries that would fail forever
      // once the bridge is gone) — and dropping the bridge first opens a
      // worse window: messaging-core's delivery pump treats a missing
      // provider as already-delivered and silently discards queued replies.
      // So every connect's runtime must actually stop before the bridge
      // disposer runs. `registered` is awaited first too: a dispose racing
      // the deferred branch above must not start tearing down connects
      // before that branch has even decided whether it registered a bridge
      // to drop. The disposer contract here is synchronous, so this is
      // fire-and-forget — the same pattern mcp-manager's own
      // `registerManagedServer` disposer uses.
      const teardown = registered.then(() =>
        this.stopProviderConnects(provider.id).finally(() => disposeBridge?.()),
      );
      this.teardowns.set(provider.id, teardown);
      void teardown.finally(() => {
        if (this.teardowns.get(provider.id) === teardown)
          this.teardowns.delete(provider.id);
      });
    };
  }

  /**
   * Ids to join for teardown: every connect currently live, plus every
   * connect currently mid-start (in `starting`, not yet in `live`). A
   * teardown that only looked at `live` would miss a start still in flight
   * and leave it running unnoticed once it lands — `stopConnect` already
   * awaits the in-flight start before touching `live`, so joining
   * `starting` here is all that's needed to guarantee the eventual runtime
   * gets stopped.
   */
  private async teardownIds(providerId?: string): Promise<string[]> {
    const rows = await this.store.list();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const candidates = new Set([...this.live.keys(), ...this.starting.keys()]);
    return [...candidates].filter((id) => {
      const row = byId.get(id);
      return row ? providerId === undefined || row.provider === providerId : true;
    });
  }

  /** Stops every currently-live (or mid-start) connect owned by `providerId`, best-effort. */
  private async stopProviderConnects(providerId: string): Promise<void> {
    const ids = await this.teardownIds(providerId);
    await Promise.all(ids.map((id) => this.stopConnect(id)));
  }

  /** Stops every currently-live (or mid-start) connect, e.g. on plugin unload.
   * Also cancels every in-flight onboarding session so a provider's
   * `onboard()` sees its signal abort instead of dangling forever. */
  async stop(): Promise<void> {
    const ids = await this.teardownIds();
    for (const session of this.onboardings.values()) this.cancelSession(session);
    await Promise.all(ids.map((id) => this.stopConnect(id)));
  }

  /**
   * Starts every stored connect owned by `providerId` that's enabled but
   * not yet live — the same reconciliation `start()` performs at boot, run
   * again whenever a provider (re)registers. Per-connect start failures are
   * contained into that connect's own error status, exactly like `start()`:
   * one bad connect must never abort the loop over the rest.
   */
  private async startProviderConnects(providerId: string): Promise<void> {
    const rows = await this.store.list();
    for (const row of rows) {
      if (row.provider !== providerId || !row.enabled || this.live.has(row.id))
        continue;
      try {
        await this.startConnect(row);
      } catch (error) {
        this.lockStatus(row.id, { state: "error", detail: errorDetail(error) });
        this.ctx
          .logger("amiba-connector-core")
          .error(`Failed to start connect ${row.id}: ${String(error)}`);
      }
    }
  }

  listProviders(): ConnectorProviderView[] {
    return [...this.providers.values()]
      .map(({ id, name, description, icon, onboard }) => ({
        id,
        name,
        description,
        ...(icon ? { icon } : {}),
        supportsOnboarding: typeof onboard === "function",
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async listConnects(): Promise<ConnectView[]> {
    const rows = await this.store.list();
    return rows.map((row) => this.toView(row));
  }

  async createConnect(input: {
    provider: string;
    name: string;
    config: unknown;
    agentPreset: string;
    approval?: MessageChannelApproval;
  }): Promise<ConnectView> {
    const provider = this.providers.get(input.provider);
    if (!provider) throw new Error("provider_not_found");
    const agentPreset = input.agentPreset.trim();
    // The real MessageChannelCenter.createChannel requires a non-empty
    // sessionId or agentPreset; connects always route through agentPreset
    // (connects have no fixed session), so an empty one must fail fast here
    // instead of surfacing as an opaque `invalid_channel` from messaging-core.
    if (!agentPreset) throw new Error("agent_preset_required");
    // Reject before anything is persisted.
    await provider.validate(input.config);

    const row = await this.store.create({
      provider: input.provider,
      name: input.name,
      agentPreset,
      ...(input.approval ? { approval: input.approval } : {}),
    });

    let channelId: string | undefined;
    try {
      const created = await this.messageCenter.createChannel({
        provider: `connector-${provider.id}`,
        name: input.name,
        agentPreset,
        ...(input.approval ? { approval: input.approval } : {}),
      });
      channelId = created.channel.id;

      const payload: GrantPayload = {
        config: input.config,
        channelSecret: created.secret,
      };
      await this.credentials.modifyRecord(this.grantKey(row.id), async () => ({
        kind: "grant",
        payload,
      }));

      const updated = await this.store.update(row.id, { channelId });
      if (updated.enabled) {
        // A failure here is a runtime-start failure, not a provisioning
        // failure: it leaves the connect (channel + grant + row) in place,
        // surfaced through its status, so start() at boot behaves the same
        // way. startConnect already records the error status itself.
        await this.startConnect(updated).catch(() => undefined);
      }
    } catch (error) {
      if (channelId)
        await this.messageCenter.removeChannel(channelId).catch(() => undefined);
      await this.credentials.deleteRecord(this.grantKey(row.id)).catch(() => undefined);
      await this.store.remove(row.id).catch(() => undefined);
      throw error;
    }

    const rows = await this.store.list();
    const finalRow = rows.find((item) => item.id === row.id);
    if (!finalRow) throw new Error("connect_not_found");
    return this.toView(finalRow);
  }

  /**
   * Starts an interactive onboarding session against a provider's optional
   * `onboard()` hook (e.g. a scan-a-QR-code login). Returns the session's
   * initial (`"pending"`) view synchronously; the provider's flow runs in
   * the background and is observed via `pollOnboarding`.
   *
   * On success, `provider.onboard()`'s resolved config is handed to
   * `createConnect` verbatim — the exact same validate-persist-start path a
   * manually entered config goes through — so the session never sees or
   * stores credentials itself, only the resulting `ConnectView`.
   */
  beginOnboarding(input: {
    provider: string;
    name: string;
    agentPreset: string;
    /** Forwarded verbatim into `createConnect` when the flow completes, so a
     * scan-to-connect wizard's approval-wait choice lands on the connect and
     * its channel exactly as the manual form's does. Absent leaves
     * messaging-core's own default (10-minute timeout) in force. */
    approval?: MessageChannelApproval;
  }): OnboardingView {
    this.sweepOnboardings();

    const provider = this.providers.get(input.provider);
    if (!provider) throw new Error("provider_not_found");
    const onboard = provider.onboard;
    if (typeof onboard !== "function") throw new Error("onboarding_unsupported");
    const name = input.name.trim();
    if (!name) throw new Error("invalid_connect");
    const agentPreset = input.agentPreset.trim();
    if (!agentPreset) throw new Error("agent_preset_required");

    const controller = new AbortController();
    const id = `onboard-${randomUUID()}`;
    const session: OnboardingSession = {
      id,
      provider: input.provider,
      controller,
      createdAt: this.now(),
      state: "pending",
    };
    this.onboardings.set(id, session);

    const handle: OnboardHandle = {
      signal: controller.signal,
      emit: (update: OnboardUpdate) => {
        const current = this.onboardings.get(id);
        if (!current || current.state !== "pending") return;
        if (update.kind === "qr") {
          current.qrUrl = update.url;
          current.qrExpireIn = update.expireIn;
        } else {
          current.statusNote = update.note;
        }
      },
    };

    // The catch below makes every branch of this chain settle (never
    // reject), so the extra `.catch` is belt-and-suspenders against a throw
    // inside the catch handler itself (e.g. from `errorDetail`) — either
    // way, nothing here is left as an unhandled rejection. Attached
    // synchronously, in the same tick `onboard()` is kicked off.
    const run = (async () => {
      try {
        const result = await onboard(handle);

        // `onboard()` can resolve after this session was already
        // cancelled (or GC-swept away) while it was still in flight —
        // `controller.abort()` doesn't stop a provider that ignores the
        // signal, it only requests that it stop. Re-check right here,
        // before ever touching `createConnect`: a stale resolve must not
        // silently create and start a live connect nobody asked for
        // anymore.
        const pending = this.onboardings.get(id);
        if (!pending || pending.state !== "pending" || controller.signal.aborted) {
          if (pending && pending.state === "pending") {
            pending.state = "cancelled";
            pending.terminalAt = this.now();
          }
          return;
        }

        const connect = await this.createConnect({
          provider: input.provider,
          name,
          config: result.config,
          agentPreset,
          ...(input.approval ? { approval: input.approval } : {}),
        });
        const current = this.onboardings.get(id);
        if (!current) return;
        current.state = "completed";
        current.connect = connect;
        current.terminalAt = this.now();
      } catch (error) {
        const current = this.onboardings.get(id);
        if (!current) return;
        current.state = controller.signal.aborted ? "cancelled" : "error";
        if (current.state === "error") current.error = errorDetail(error);
        current.terminalAt = this.now();
      }
    })();
    run.catch(() => undefined);

    return this.toOnboardingView(session);
  }

  pollOnboarding(sessionId: string): OnboardingView {
    this.sweepOnboardings();
    const session = this.onboardings.get(sessionId);
    if (!session) throw new Error("onboarding_not_found");
    return this.toOnboardingView(session);
  }

  /** Idempotent: cancelling a session that isn't `"pending"` anymore is a
   * no-op (its controller is left alone, matching its already-settled
   * state) — a session already completed/errored/cancelled just returns
   * that terminal view unchanged. */
  cancelOnboarding(sessionId: string): OnboardingView {
    this.sweepOnboardings();
    const session = this.onboardings.get(sessionId);
    if (!session) throw new Error("onboarding_not_found");
    this.cancelSession(session);
    return this.toOnboardingView(session);
  }

  /**
   * Settles a still-`"pending"` session as `"cancelled"` synchronously and
   * aborts its controller — shared by `cancelOnboarding`, provider
   * unregistration, and `stop()` so every path that cancels a session
   * leaves it in the same immediately-observable state instead of waiting
   * on the run chain in `beginOnboarding` to notice the abort asynchronously
   * (that chain's own post-resolve/catch handling still guards against a
   * `pending` session it settles on its own — see its comments). A no-op on
   * a session that already reached a terminal state.
   */
  private cancelSession(session: OnboardingSession): void {
    if (session.state === "pending") {
      session.state = "cancelled";
      session.terminalAt = this.now();
    }
    if (!session.controller.signal.aborted) session.controller.abort();
  }

  /**
   * Lazy GC, run at the top of every begin/poll/cancel call — no timers.
   * Drops a session once it's more than 10 minutes old regardless of state
   * (a provider's `onboard()` that never settles must not leak forever),
   * and additionally drops a terminal (completed/error/cancelled) session 5
   * minutes after it reached that terminal state, freeing memory for
   * short-lived flows well before the 10 minute ceiling.
   *
   * Every session dropped here has its controller aborted first — same as
   * `stop()` — so a still-in-flight `onboard()` (e.g. holding a socket or
   * poll loop for the QR flow) is told to stop instead of being silently
   * orphaned once its session is gone from the map. Unconditional: a no-op
   * on a controller that's already aborted or whose session already
   * reached a terminal state on its own.
   */
  private sweepOnboardings(): void {
    const now = this.now();
    for (const [id, session] of this.onboardings) {
      const expired = now - session.createdAt > ONBOARDING_MAX_AGE_MS;
      const terminalExpired =
        session.terminalAt !== undefined &&
        now - session.terminalAt > ONBOARDING_TERMINAL_MAX_AGE_MS;
      if (expired || terminalExpired) {
        session.controller.abort();
        this.onboardings.delete(id);
      }
    }
  }

  private toOnboardingView(session: OnboardingSession): OnboardingView {
    return {
      sessionId: session.id,
      state: session.state,
      ...(session.qrUrl !== undefined ? { qrUrl: session.qrUrl } : {}),
      ...(session.qrExpireIn !== undefined ? { qrExpireIn: session.qrExpireIn } : {}),
      ...(session.statusNote !== undefined ? { statusNote: session.statusNote } : {}),
      ...(session.connect ? { connect: session.connect } : {}),
      ...(session.error !== undefined ? { error: session.error } : {}),
    };
  }

  async setEnabled(id: string, enabled: boolean): Promise<ConnectView> {
    const rows = await this.store.list();
    const before = rows.find((item) => item.id === id);
    if (!before) throw new Error("connect_not_found");

    // Nothing to reconcile when the row is already disabled (asked to
    // disable again), or already enabled AND live. An enabled-but-not-live
    // row — its provider dropped and hasn't reconciled yet, or a previous
    // start attempt failed — falls through below to attempt a (re)start
    // instead of silently no-op'ing.
    if (before.enabled === enabled && (!enabled || this.live.has(id))) {
      return this.toView(before);
    }

    const row =
      before.enabled === enabled ? before : await this.store.update(id, { enabled });
    if (enabled) {
      await this.startConnect(row).catch(() => undefined);
    } else {
      await this.stopConnect(id);
    }

    const after = await this.store.list();
    const finalRow = after.find((item) => item.id === id);
    if (!finalRow) throw new Error("connect_not_found");
    return this.toView(finalRow);
  }

  async setOwners(id: string, owners: string[]): Promise<ConnectView> {
    // Manual owner configuration supersedes pairing: once an operator has
    // set the owners list explicitly, pairing's own purpose (auto-admitting
    // whoever messages first) no longer applies — leaving `pairing: true`
    // here would let the very next inbound sender silently reclaim/replace
    // what was just configured (see store.ts's `claimOwner`).
    const updated = await this.store.update(id, { owners, pairing: false });
    return this.toView(updated);
  }

  /**
   * Updates the connect's approval-wait policy. The bound channel is the
   * behavioral source of truth — `messageCenter.updateChannel` is where the
   * mode enum and `MIN_APPROVAL_TIMEOUT_MS` floor are actually enforced
   * (`assertApproval`), so it runs first and a rejected value never reaches
   * this connect's own store mirror. A connect that has no bound channel yet
   * (mid-creation, never reached by a caller in practice since
   * `createConnect` rolls the whole connect back on any failure) just
   * updates the mirror.
   */
  async setApproval(
    id: string,
    approval: MessageChannelApproval,
  ): Promise<ConnectView> {
    const rows = await this.store.list();
    const row = rows.find((item) => item.id === id);
    if (!row) throw new Error("connect_not_found");
    if (row.channelId) {
      await this.messageCenter.updateChannel(row.channelId, { approval });
    }
    try {
      const updated = await this.store.update(id, { approval });
      return this.toView(updated);
    } catch (error) {
      // Same discipline as createConnect: a two-store write must not leave
      // the channel on the new policy while the connect's mirror (what the
      // settings UI shows) still carries the old one. `null` clears a mirror
      // that had no policy of its own, matching messaging-core's rollback.
      if (row.channelId) {
        await this.messageCenter
          .updateChannel(row.channelId, { approval: row.approval ?? null })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async removeConnect(id: string): Promise<boolean> {
    const rows = await this.store.list();
    const row = rows.find((item) => item.id === id);
    if (!row) return false;

    await this.stopConnect(id);
    await this.credentials.deleteRecord(this.grantKey(id));
    if (row.channelId) await this.messageCenter.removeChannel(row.channelId);
    const removed = await this.store.remove(id);
    this.droppedSenders.delete(id);
    return removed;
  }

  async start(): Promise<void> {
    const rows = await this.store.list();
    for (const row of rows) {
      if (!row.enabled) continue;
      try {
        await this.startConnect(row);
      } catch (error) {
        this.lockStatus(row.id, { state: "error", detail: errorDetail(error) });
        this.ctx
          .logger("amiba-connector-core")
          .error(`Failed to start connect ${row.id}: ${String(error)}`);
      }
    }
  }

  private toView(row: StoredConnect): ConnectView {
    return {
      id: row.id,
      provider: row.provider,
      name: row.name,
      enabled: row.enabled,
      pairing: row.pairing,
      owners: row.owners,
      ...(row.agentPreset ? { agentPreset: row.agentPreset } : {}),
      ...(row.channelId ? { channelId: row.channelId } : {}),
      ...(row.approval ? { approval: row.approval } : {}),
      status: this.computeStatus(row),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * A disabled connect has no live runtime — `stopConnect` deletes its
   * status entry — so it always reports the neutral `off` state, regardless
   * of whatever was last recorded (a disable racing a status write could in
   * principle leave a stale entry behind; `off` must win either way). An
   * enabled connect reports its recorded status, falling back to
   * `connecting` only when nothing has been recorded yet (e.g. observed
   * between store creation and the first `performStart` write, or before
   * boot recovery has run for a stranded-but-enabled row).
   */
  private computeStatus(row: StoredConnect): ConnectorStatus {
    if (!row.enabled) return { state: "off" };
    return this.statuses.get(row.id) ?? { state: "connecting" };
  }

  /**
   * Center-internal status write — a capability applier's soft-skip, or a
   * hard-failure catch — as opposed to a provider-originated write through
   * `ConnectorHandle#setStatus` (`providerSetStatus` below). Always wins,
   * and locks out any subsequent provider write until the next
   * `performStart` clears the lock.
   */
  private lockStatus(connectId: string, status: ConnectorStatus): void {
    this.statuses.set(connectId, status);
    this.statusLocked.add(connectId);
  }

  /**
   * Provider-originated status write, via the connect's `ConnectorHandle`.
   * A no-op while `statusLocked` — see the field's doc comment for why an
   * applier-recorded `degraded`/`error` must survive a late provider write
   * instead of being silently overwritten.
   */
  private providerSetStatus(connectId: string, status: ConnectorStatus): void {
    if (this.statusLocked.has(connectId)) return;
    this.statuses.set(connectId, status);
  }

  private grantKey(connectId: string): string {
    return `${GRANT_SCOPE}/${connectId}`;
  }

  private async readGrant(connectId: string): Promise<GrantPayload> {
    const record = await this.credentials.readRecord(this.grantKey(connectId));
    const payload =
      record?.kind === "grant"
        ? (record.payload as Partial<GrantPayload> | undefined)
        : undefined;
    if (!payload || typeof payload.channelSecret !== "string")
      throw new Error("grant_not_found");
    return { config: payload.config, channelSecret: payload.channelSecret };
  }

  /**
   * Idempotent start dispatcher: a connect that's already live is a no-op,
   * and a connect that's already mid-start is joined rather than started a
   * second time. Without this guard, two concurrent `setEnabled(id, true)`
   * calls (or a boot-time `start()` racing an admin `setEnabled`) would both
   * observe `enabled: false → true`, both call `provider.start(handle)`, and
   * the second `this.live.set(...)` would silently overwrite the first —
   * leaking the first runtime (never stopped) and risking duplicate delivery.
   */
  private startConnect(row: StoredConnect): Promise<void> {
    if (this.live.has(row.id)) return Promise.resolve();
    const inFlight = this.starting.get(row.id);
    if (inFlight) return inFlight;
    const promise = this.performStart(row).finally(() => {
      this.starting.delete(row.id);
    });
    this.starting.set(row.id, promise);
    return promise;
  }

  private async performStart(row: StoredConnect): Promise<void> {
    this.statuses.set(row.id, { state: "connecting" });
    // A fresh start earns a fresh chance for the provider's own status
    // writes to land — whatever locked a prior degraded/error out of a
    // stale provider write no longer applies to this attempt.
    this.statusLocked.delete(row.id);
    const provider = this.providers.get(row.provider);
    const disposers: Array<() => void> = [];
    let runtime: ConnectorRuntime | undefined;
    try {
      if (!provider) throw new Error("provider_not_found");
      if (!row.channelId) throw new Error("channel_missing");
      const grant = await this.readGrant(row.id);

      const handle: ConnectorHandle = {
        connectId: row.id,
        config: grant.config,
        onInbound: (envelope) => this.routeInbound(row.id, envelope),
        setStatus: (status) => this.providerSetStatus(row.id, status),
      };
      runtime = await provider.start(handle);

      for (const decl of provider.capabilities(grant.config)) {
        const applier = this.appliers.get(decl.kind);
        if (!applier) throw new Error(`unknown_capability_kind:${decl.kind}`);
        try {
          disposers.push(await applier.apply(row, decl));
        } catch (error) {
          if (!(error instanceof CapabilityUnavailableError)) throw error;
          // A soft, recoverable "not available right now" outcome (e.g. the
          // mcp applier finding amibaMcpManager isn't wired into this
          // runtime): record it and keep going instead of hard-failing the
          // whole connect over one optional capability. `degraded`, not
          // `error` — the connect is still live and doing useful work with
          // every OTHER capability applied, just missing this one.
          this.lockStatus(row.id, { state: "degraded", detail: error.message });
        }
      }

      this.live.set(row.id, {
        runtime,
        disposers,
        channelSecret: grant.channelSecret,
      });
    } catch (error) {
      for (const dispose of [...disposers].reverse()) {
        try {
          dispose();
        } catch {
          // Best-effort unwind; a broken disposer must not block teardown.
        }
      }
      if (runtime) await runtime.stop().catch(() => undefined);
      this.lockStatus(row.id, { state: "error", detail: errorDetail(error) });
      throw error;
    }
  }

  private async stopConnect(connectId: string): Promise<void> {
    // A connect mid-start (present in `this.starting`, not yet in `live`)
    // must be joined before inspecting/clearing `live`: otherwise a stop
    // racing an in-flight start sees nothing to stop, the start then
    // completes and lands its runtime in `live` *after* teardown — leaving a
    // disabled connect with a live runtime still relaying messages.
    await this.starting.get(connectId)?.catch(() => undefined);
    const live = this.live.get(connectId);
    if (live) {
      for (const dispose of [...live.disposers].reverse()) {
        try {
          dispose();
        } catch {
          // Best-effort unwind; a broken disposer must not block teardown.
        }
      }
      await live.runtime.stop().catch(() => undefined);
      this.live.delete(connectId);
    }
    this.statuses.delete(connectId);
    this.statusLocked.delete(connectId);
  }

  private recordDrop(connectId: string): void {
    this.droppedSenders.set(
      connectId,
      (this.droppedSenders.get(connectId) ?? 0) + 1,
    );
  }

  private async routeInbound(
    connectId: string,
    envelope: ConnectorInboundEnvelope,
  ): Promise<void> {
    const live = this.live.get(connectId);
    if (!live) return;

    const rows = await this.store.list();
    const row = rows.find((item) => item.id === connectId);
    if (!row || !row.channelId) return;
    if (!row.enabled) {
      // The connect was disabled (or is being disabled) but its runtime
      // hasn't finished tearing down yet — drop silently, same as the
      // sender-gate drops below, rather than relaying through a connect the
      // store already considers off.
      this.recordDrop(connectId);
      return;
    }

    const sender = envelope.sender;
    if (!sender) {
      this.recordDrop(connectId);
      return;
    }

    if (row.pairing) {
      // Compare-and-set inside the store's serialized mutation chain: two
      // concurrent first messages can both observe `pairing: true` here, but
      // only one `claimOwner` call wins — the loser sees `pairing: false`
      // already and is dropped, instead of a plain read-then-write letting
      // the second sender silently overwrite the first as owner.
      const claim = await this.store.claimOwner(connectId, sender);
      if (!claim.claimed) {
        this.recordDrop(connectId);
        return;
      }
    } else if (!row.owners.includes(sender)) {
      this.recordDrop(connectId);
      return;
    }

    await this.messageCenter.acceptInbound(
      row.channelId,
      live.channelSecret,
      envelope,
    );
  }

  private async bridgeDeliver(
    channel: StoredMessageChannel,
    envelope: OutboundMessageEnvelope,
  ): Promise<void> {
    const rows = await this.store.list();
    const row = rows.find((item) => item.channelId === channel.id);
    if (!row) throw new Error("connector_not_found");

    const live = this.live.get(row.id);
    if (!live) throw new Error("connector_not_live");

    const binding = await this.messageCenter.conversationForSession(
      channel.id,
      envelope.sessionId,
    );
    if (!binding) throw new Error("conversation_unknown");

    await live.runtime.deliver(
      {
        key: binding.conversationKey,
        kind: binding.kind,
        ...(binding.title ? { title: binding.title } : {}),
      },
      envelope,
    );
  }

  /**
   * Bridges messaging-core's `requestApproval` to the owning connect's live
   * runtime. Unlike `bridgeDeliver`, a structurally-normal "can't present
   * this one" state — the connect is disabled, its runtime hasn't started
   * (or finished stopping), or the runtime never implemented the capability
   * — resolves `null` rather than throwing: `null` is messaging-core's own
   * signal to fall back to its text protocol on the same channel (see
   * `MessageChannelProvider.requestApproval`'s contract), not an error.
   * `connector_not_found` (no connect owns this channel at all) still
   * throws, same as `bridgeDeliver`, since that is a genuine inconsistency
   * rather than an ordinary "not live right now".
   */
  private async bridgeRequestApproval(
    channel: StoredMessageChannel,
    conversation: InboundConversationRef,
    request: ApprovalPrompt,
  ): Promise<ApprovalReply | null> {
    const rows = await this.store.list();
    const row = rows.find((item) => item.channelId === channel.id);
    if (!row) throw new Error("connector_not_found");

    const live = this.live.get(row.id);
    if (!row.enabled || !live) return null;
    if (!live.runtime.requestApproval) return null;

    return live.runtime.requestApproval(
      conversation,
      this.narrowApproval(row.id, request),
    );
  }

  /**
   * Narrows a prompt's `canAnswer` with THIS layer's own sender rule — the
   * mirror of `routeInbound`'s `pairing` / `owners` gate — so a native
   * approval surface (a card everyone in a group chat can click) admits
   * exactly the senders whose text messages the same connect would relay
   * (plan §2/§5).
   *
   * Both rules are re-evaluated on every call, never snapshotted when the
   * card was sent: a card can sit unanswered for the whole approval window
   * while the operator edits owners, disables the connect, or removes it.
   * A row that is gone, disabled or still `pairing` (nobody admitted yet)
   * refuses everyone, and the channel-level rule the prompt arrived with is
   * only ever narrowed, never widened.
   */
  private narrowApproval(
    connectId: string,
    request: ApprovalPrompt,
  ): ApprovalPrompt {
    return {
      ...request,
      canAnswer: async (sender) => {
        if (sender === undefined) return false;
        if (!(await request.canAnswer(sender))) return false;
        const row = (await this.store.list()).find(
          (item) => item.id === connectId,
        );
        if (!row || !row.enabled || row.pairing) return false;
        return row.owners.includes(sender);
      },
    };
  }

  /**
   * Bridges messaging-core's `announceApprovalOutcome` the same way. This is
   * only ever called by messaging-core for a question this same runtime's
   * `requestApproval` presented natively, so a disabled/not-live connect or a
   * runtime without the capability is a no-op rather than an error — there is
   * no card left to update.
   */
  private async bridgeAnnounceApprovalOutcome(
    channel: StoredMessageChannel,
    conversation: InboundConversationRef,
    notice: ApprovalOutcomeNotice,
  ): Promise<void> {
    const rows = await this.store.list();
    const row = rows.find((item) => item.channelId === channel.id);
    if (!row) throw new Error("connector_not_found");

    const live = this.live.get(row.id);
    if (!row.enabled || !live) return;
    if (!live.runtime.announceApprovalOutcome) return;

    await live.runtime.announceApprovalOutcome(conversation, notice);
  }
}
