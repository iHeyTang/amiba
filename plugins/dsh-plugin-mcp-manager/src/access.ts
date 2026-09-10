import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { McpDependencies, McpOwner, McpLease } from "./dependencies.js";
import type { McpBindingState, McpDependencyBinding } from "./dependency-binding.js";

export interface McpRequirement {
  id: string;
  name: string;
  serviceId: string;
  version: string;
  tools: Array<{ name: string; title: string; description?: string }>;
  sharing?: "isolated" | "shared";
  /** Ordinary-agent access is a separate, visibly identified consumer. */
  audience?: "plugin" | "ordinary-agents";
  /** Provider-owned ordinary-agent entries are tied to their own connection. */
  connectionId?: string;
}
export interface McpAccessView {
  id: string;
  plugin: string;
  name: string;
  serviceId: string;
  version: string;
  audience: "plugin" | "ordinary-agents";
  tools: McpRequirement["tools"];
  connectionId?: string;
  connections: Array<{ id: string; name: string; provider: string; approvalToken: string; configuration?: { ownerId: string; recordId: string } }>;
  connectionName?: string;
  configuration?: { ownerId: string; recordId: string };
  state: "approval-required" | "waiting" | "connecting" | "ready" | "error" | "inactive";
  code?: string;
}
const requirementSchema = z.object({
  id: z.string(), name: z.string(), serviceId: z.string(), version: z.string(),
  tools: z.array(z.object({ name: z.string(), title: z.string(), description: z.string().optional() })),
  sharing: z.enum(["isolated", "shared"]).optional(),
  audience: z.enum(["plugin", "ordinary-agents"]).optional(), connectionId: z.string().optional(),
});
const configurationSchema = z.object({ ownerId: z.string(), recordId: z.string() });
const approvalSchema = z.object({
  id: z.string(), ownerId: z.string(), definition: z.string(),
  connectionId: z.string(), identity: z.string(),
  ownerName: z.string(), connectionName: z.string(), requirement: requirementSchema,
  configuration: configurationSchema.optional(),
});
const documentSchema = z.object({ schemaVersion: z.literal(1), approvals: z.array(approvalSchema) });
type Approval = z.infer<typeof approvalSchema>;

/** Reactive feature dependency selected through a persisted user approval. */
export class McpAccessBinding {
  private current?: McpDependencyBinding;
  private state: McpBindingState = { state: "error", code: "mcp_approval_required" };
  private listeners = new Set<() => void>();
  private unsubscribe = () => {};

  getState(): McpBindingState { return this.current?.getState() ?? this.state; }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private changed = () => {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* A view cannot block revocation. */ }
    }
  };
  async replace(binding?: McpDependencyBinding, state: McpBindingState = { state: "error", code: "mcp_approval_required" }) {
    this.unsubscribe();
    await this.current?.dispose();
    this.current = binding;
    this.state = state;
    this.unsubscribe = binding?.subscribe(this.changed) ?? (() => {});
    this.changed();
  }
  async retry() { await this.current?.retry(); }
  async dispose() {
    await this.replace(undefined, { state: "disposed" });
    this.listeners.clear();
  }
}

type Consumer = {
  owner: McpOwner;
  requirement: McpRequirement;
  binding: McpAccessBinding;
  selection?: string;
  feature?: { lease: McpLease; state: "connecting" | "ready" | "error" };
  retryFeature?: () => Promise<void>;
};
function key(owner: McpOwner, requirement: McpRequirement) {
  return JSON.stringify([owner.id, requirement.id]);
}
function definition(requirement: McpRequirement) {
  return createHash("sha256").update(JSON.stringify([
    requirement.serviceId, requirement.version, requirement.tools.map(tool => tool.name).sort(), requirement.audience ?? "plugin", requirement.connectionId,
  ])).digest("hex");
}
function approvalToken(requirement: McpRequirement, connectionId: string, identity: string) {
  return createHash("sha256").update(JSON.stringify([definition(requirement), connectionId, identity])).digest("hex");
}

/** Owns permission references only. Credentials stay with connection providers. */
export class McpAccess {
  private approvals = new Map<string, Approval>();
  private consumers = new Map<string, Consumer>();
  private pending: Promise<unknown>;
  private closed = false;

  constructor(private deps: McpDependencies, private root: string) {
    this.pending = this.read();
    // Suppress unhandled rejection; public operations still observe read failure.
    void this.pending.catch(() => undefined);
  }
  private async read() {
    let text: string;
    try { text = await readFile(join(this.root, "access.json"), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw new Error("mcp_approval_store_unavailable");
    }
    let document: z.infer<typeof documentSchema>;
    try { document = documentSchema.parse(JSON.parse(text)); }
    catch { throw new Error("mcp_approval_store_invalid"); }
    for (const approval of document.approvals) {
      if (this.approvals.has(approval.id)) throw new Error("mcp_approval_store_invalid");
      this.approvals.set(approval.id, approval);
    }
  }
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      if (this.closed) throw new Error("mcp_access_disposed");
      return operation();
    });
    // A corrupt/unreadable store must remain closed, whereas individual action
    // failures (e.g. choosing an unavailable connection) remain retryable.
    const preceding = this.pending;
    this.pending = preceding.then(() => result.catch(() => undefined));
    void this.pending.catch(() => undefined);
    return result;
  }
  private async save(next: Map<string, Approval>) {
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `.access-${randomUUID()}.tmp`);
    await writeFile(temporary, JSON.stringify({ schemaVersion: 1, approvals: [...next.values()] }), { mode: 0o600 });
    await rename(temporary, join(this.root, "access.json"));
    this.approvals = next;
  }

  register(owner: McpOwner, requirement: McpRequirement) {
    owner = structuredClone(owner); requirement = structuredClone(requirement);
    return this.run(async () => {
      if (!owner.id || !owner.name || !requirement.id || !requirement.name || !requirement.serviceId || !requirement.version ||
        !requirement.tools.length || requirement.tools.some(tool => !tool.name || !tool.title) ||
        new Set(requirement.tools.map(tool => tool.name)).size !== requirement.tools.length)
        throw new Error("invalid_mcp_requirement");
      const id = key(owner, requirement);
      if (this.consumers.has(id)) throw new Error("mcp_requirement_conflict");
      const consumer: Consumer = { owner, requirement, binding: new McpAccessBinding() };
      this.consumers.set(id, consumer);
      await this.apply(id, consumer);
      let disposed = false;
      return { id, binding: consumer.binding,
        reportFeature: (lease: McpLease, state: "connecting" | "ready" | "error") => { consumer.feature = { lease, state }; },
        onRetry: (retry: () => Promise<void>) => { consumer.retryFeature = retry; },
        dispose: async () => {
        if (disposed || this.closed) return;
        await this.run(async () => {
          if (disposed) return;
          await consumer.binding.dispose();
          this.consumers.delete(id);
          disposed = true;
        });
      } };
    });
  }

  private async apply(id: string, consumer: Consumer) {
    const approval = this.approvals.get(id);
    const valid = approval?.ownerId === consumer.owner.id && approval.definition === definition(consumer.requirement);
    const selection = valid ? JSON.stringify([approval.definition, approval.connectionId, approval.identity]) : undefined;
    if (consumer.selection === selection) return;
    // Revoke before constructing the replacement binding: the old selection may
    // be a different account even when it uses the same shared implementation.
    await consumer.binding.replace();
    consumer.selection = selection;
    if (!valid) return;
    await consumer.binding.replace(this.deps.bind({
      owner: consumer.owner, serviceId: consumer.requirement.serviceId, version: consumer.requirement.version,
      connectionId: approval.connectionId, identity: approval.identity,
      sharing: consumer.requirement.sharing, tools: consumer.requirement.tools.map(tool => tool.name),
      requireScope: consumer.requirement.audience !== "ordinary-agents",
    }));
  }

  /** Product action: selecting a connection grants exactly the displayed requirement. */
  approve(id: string, connectionId: string, reviewedToken: string): Promise<void> {
    return this.run(async () => {
      const consumer = this.consumers.get(id);
      if (!consumer) throw new Error("mcp_requirement_unavailable");
      const available = await this.deps.connectionsFor(consumer.requirement.serviceId, consumer.requirement.version);
      const connection = available.find(item => item.id === connectionId);
      if (!connection) throw new Error("mcp_connection_unavailable");
      if (consumer.requirement.connectionId && consumer.requirement.connectionId !== connectionId)
        throw new Error("mcp_connection_not_allowed");
      if (reviewedToken !== approvalToken(consumer.requirement, connection.id, connection.identity))
        throw new Error("mcp_approval_review_stale");
      const next = new Map(this.approvals);
      next.set(id, { id, ownerId: consumer.owner.id, ownerName: consumer.owner.name,
        definition: definition(consumer.requirement), requirement: structuredClone(consumer.requirement),
        connectionId, connectionName: connection.name, identity: connection.identity, configuration: connection.configuration });
      await this.save(next);
      await this.apply(id, consumer);
    });
  }

  revoke(id: string): Promise<void> {
    return this.run(async () => {
      const next = new Map(this.approvals);
      next.delete(id);
      await this.save(next);
      const consumer = this.consumers.get(id);
      if (consumer) await this.apply(id, consumer);
    });
  }

  retry(id: string): Promise<void> {
    return this.run(async () => {
      const consumer = this.consumers.get(id);
      if (!consumer) throw new Error("mcp_requirement_unavailable");
      await consumer.binding.retry();
      await consumer.retryFeature?.();
    });
  }

  renameRequirement(owner: McpOwner, requirementId: string, name: string): Promise<void> {
    return this.run(async () => {
      const id = JSON.stringify([owner.id, requirementId]);
      const consumer = this.consumers.get(id);
      if (consumer) consumer.requirement.name = name;
      const approval = this.approvals.get(id);
      if (approval) {
        const next = new Map(this.approvals);
        next.set(id, { ...approval, requirement: { ...approval.requirement, name } });
        await this.save(next);
      }
    });
  }

  /** Deletion/uninstallation cleanup, distinct from temporary runtime disposal. */
  forgetConnection(connectionId: string): Promise<void> {
    return this.forget(approval => approval.connectionId === connectionId);
  }
  forgetOwner(ownerId: string): Promise<void> {
    return this.forget(approval => approval.ownerId === ownerId);
  }
  forgetConfiguration(ownerId: string, recordId: string): Promise<void> {
    return this.forget(approval => approval.configuration?.ownerId === ownerId && approval.configuration.recordId === recordId);
  }
  /** Reconcile deletions made while this optional service was unloaded. */
  retainConfigurations(ownerId: string, records: string[] | (() => Promise<string[]>)): Promise<void> {
    return this.run(async () => {
      // Read inside the approval queue: a configuration created and approved
      // while this operation was waiting must not be pruned by an old snapshot.
      const live = new Set(typeof records === "function" ? await records() : records);
      await this.forgetMatching(approval => approval.configuration?.ownerId === ownerId && !live.has(approval.configuration.recordId));
    });
  }
  renameConnection(connectionId: string, name: string): Promise<void> {
    return this.run(async () => {
      const next = new Map(this.approvals);
      let changed = false;
      for (const [id, approval] of next) {
        if (approval.connectionId === connectionId && approval.connectionName !== name) {
          next.set(id, { ...approval, connectionName: name }); changed = true;
        }
      }
      if (changed) await this.save(next);
    });
  }
  private forget(matches: (approval: Approval) => boolean): Promise<void> {
    return this.run(() => this.forgetMatching(matches));
  }
  private async forgetMatching(matches: (approval: Approval) => boolean): Promise<void> {
      const removed = [...this.approvals.values()].filter(matches).map(approval => approval.id);
      if (!removed.length) return;
      const next = new Map(this.approvals);
      for (const id of removed) next.delete(id);
      await this.save(next);
      for (const id of removed) {
        const consumer = this.consumers.get(id);
        if (consumer) await this.apply(id, consumer);
      }
  }

  list(): Promise<McpAccessView[]> {
    return this.run(async () => {
      const live = await Promise.all([...this.consumers].map(async ([id, consumer]) => {
      const requirement = consumer.requirement;
      const connections = (await this.deps.connectionsFor(requirement.serviceId, requirement.version))
        .filter(connection => !requirement.connectionId || connection.id === requirement.connectionId);
      const state = consumer.binding.getState();
      const feature = state.state === "ready" && consumer.feature?.lease === state.lease ? consumer.feature : undefined;
      const approval = this.approvals.get(id);
      const approved = approval?.definition === definition(requirement);
      const needsApproval = !approved || (state.state === "error" && state.code === "mcp_dependency_identity_mismatch");
      return {
        id, plugin: consumer.owner.name, name: requirement.name, serviceId: requirement.serviceId, version: requirement.version,
        audience: requirement.audience ?? "plugin",
        tools: structuredClone(requirement.tools),
        ...(approved ? { connectionId: approval.connectionId,
          connectionName: connections.find(item => item.id === approval.connectionId)?.name ?? approval.connectionName,
          configuration: approval.configuration } : {}),
        connections: connections.map(({ id, name, provider, identity, configuration }) => ({ id, name, provider, configuration, approvalToken: approvalToken(requirement, id, identity) })),
        state: needsApproval ? "approval-required" : feature?.state ?? (state.state === "disposed" ? "waiting" : state.state),
        ...(state.state === "error" ? { code: state.code } : feature?.state === "error" ? { code: "mcp_feature_activation_failed" } : {}),
      } satisfies McpAccessView;
      }));
      const inactive: McpAccessView[] = [...this.approvals.values()]
        .filter(approval => !this.consumers.has(approval.id))
        .map(approval => ({ id: approval.id, plugin: approval.ownerName, name: approval.requirement.name,
          serviceId: approval.requirement.serviceId, version: approval.requirement.version,
          audience: approval.requirement.audience ?? "plugin", tools: structuredClone(approval.requirement.tools),
          connectionId: approval.connectionId, connectionName: approval.connectionName,
          configuration: approval.configuration,
          connections: [], state: "inactive" }));
      return [...live, ...inactive];
    });
  }

  async dispose() {
    await this.pending.catch(() => undefined);
    this.closed = true;
    const results = await Promise.allSettled([...this.consumers.values()].map(consumer => consumer.binding.dispose()));
    this.consumers.clear();
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
}
