import type { Context } from "@deepseek-ai/cordis";
import type {
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
  private readonly droppedSenders = new Map<string, number>();

  constructor(
    private readonly ctx: Context,
    private readonly store: ConnectorStore,
    private readonly messageCenter: MessageChannelCenter,
    private readonly credentials: CredentialsSeam,
    private readonly appliers: Map<string, CapabilityApplier>,
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
    };
    const disposeBridge = this.messageCenter.registerProvider(bridge);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.providers.get(provider.id) === provider)
        this.providers.delete(provider.id);
      disposeBridge();
      // Unregistering a provider must not leave its connects orphaned
      // (live sockets, live mcp registrations, deliveries that would fail
      // forever once the bridge is gone). The disposer contract here is
      // synchronous, so this is fire-and-forget — the same pattern
      // mcp-manager's own `registerManagedServer` disposer uses.
      void this.stopProviderConnects(provider.id);
    };
  }

  /** Stops every currently-live connect owned by `providerId`, best-effort. */
  private async stopProviderConnects(providerId: string): Promise<void> {
    const rows = await this.store.list();
    const ids = rows
      .filter((row) => row.provider === providerId && this.live.has(row.id))
      .map((row) => row.id);
    await Promise.all(ids.map((id) => this.stopConnect(id)));
  }

  /** Stops every currently-live connect, e.g. on plugin unload. */
  async stop(): Promise<void> {
    const ids = [...this.live.keys()];
    await Promise.all(ids.map((id) => this.stopConnect(id)));
  }

  listProviders(): ConnectorProviderView[] {
    return [...this.providers.values()]
      .map(({ id, name, description, icon }) => ({
        id,
        name,
        description,
        ...(icon ? { icon } : {}),
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
    });

    let channelId: string | undefined;
    try {
      const created = await this.messageCenter.createChannel({
        provider: `connector-${provider.id}`,
        name: input.name,
        agentPreset,
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

  async setEnabled(id: string, enabled: boolean): Promise<ConnectView> {
    const rows = await this.store.list();
    const before = rows.find((item) => item.id === id);
    if (!before) throw new Error("connect_not_found");
    if (before.enabled === enabled) return this.toView(before);

    const updated = await this.store.update(id, { enabled });
    if (enabled) {
      await this.startConnect(updated).catch(() => undefined);
    } else {
      await this.stopConnect(id);
    }

    const after = await this.store.list();
    const finalRow = after.find((item) => item.id === id);
    if (!finalRow) throw new Error("connect_not_found");
    return this.toView(finalRow);
  }

  async setOwners(id: string, owners: string[]): Promise<ConnectView> {
    const updated = await this.store.update(id, { owners });
    return this.toView(updated);
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
        this.statuses.set(row.id, { state: "error", detail: String(error) });
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
      status: this.statuses.get(row.id) ?? { state: "connecting" },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
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
        setStatus: (status) => this.statuses.set(row.id, status),
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
          // whole connect over one optional capability.
          this.statuses.set(row.id, { state: "error", detail: error.message });
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
      this.statuses.set(row.id, { state: "error", detail: String(error) });
      throw error;
    }
  }

  private async stopConnect(connectId: string): Promise<void> {
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
}
