import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type ConversationCadence = "daily" | "weekly" | "manual";
export interface ConversationPolicy {
  cadence: ConversationCadence;
  timeZone: string;
}
export interface ConversationOrigin {
  /** Owning plugin, stable account/entry, and privacy boundary. Never model supplied. */
  plugin: string;
  entry: string;
  scope: string;
}
export interface ConversationSegment extends ConversationOrigin {
  sessionId: string;
  period: string;
  createdAt: number;
}
export interface SharedResourceGrant { reference: string; title: string }
/** Owner-facing snapshot; no storage internals or cross-entry identifiers. */
export interface ConversationView {
  policy: ConversationPolicy;
  currentSessionId?: string;
  pendingNewConversation: boolean;
  history: Array<{ sessionId: string; createdAt: number }>;
  sharedResources: SharedResourceGrant[];
}
interface Entry extends ConversationOrigin {
  sharedResources?: SharedResourceGrant[];
  policy: ConversationPolicy;
  generation: number;
  current?: string;
  segments: ConversationSegment[];
}
interface Document { version: 1; entries: Entry[] }
export interface ConversationSessionFactory {
  create(): Promise<{ sessionId: string; dispose(): Promise<void> }>;
  isClosed(sessionId: string): boolean | Promise<boolean>;
}
export const defaultConversationPolicy = (): ConversationPolicy => ({
  cadence: "daily",
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
});

/** Calendar boundaries in the declared zone, including DST; weeks start Monday. */
export function conversationPeriod(at: number, policy: ConversationPolicy): string {
  if (!["daily", "weekly", "manual"].includes(policy.cadence)) throw new Error("Invalid conversation cadence");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: policy.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const value = (name: string) => Number(parts.find((part) => part.type === name)!.value);
  if (policy.cadence === "manual") return "manual";
  const date = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  if (policy.cadence === "weekly") date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return `${policy.cadence}:${policy.timeZone}:${date.toISOString().slice(0, 10)}`;
}
const sameOrigin = (a: ConversationOrigin, b: ConversationOrigin) =>
  a.plugin === b.plugin && a.entry === b.entry && a.scope === b.scope;
function validateOrigin(origin: ConversationOrigin): void {
  if (![origin.plugin, origin.entry, origin.scope].every((value) => typeof value === "string" && value.trim()))
    throw new Error("Invalid conversation origin");
}
function validateDocument(value: unknown): asserts value is Document {
  const doc = value as Document;
  if (!doc || doc.version !== 1 || !Array.isArray(doc.entries)) throw new Error("Invalid conversation registry");
  const sessions = new Set<string>();
  const origins = new Set<string>();
  for (const entry of doc.entries) {
    validateOrigin(entry);
    conversationPeriod(0, entry.policy);
    const key = JSON.stringify([entry.plugin, entry.entry, entry.scope]);
    if (origins.has(key) || !Number.isSafeInteger(entry.generation) || entry.generation < 0 || !Array.isArray(entry.segments))
      throw new Error("Invalid conversation entry");
    origins.add(key);
    if (entry.sharedResources && (!Array.isArray(entry.sharedResources) || entry.sharedResources.length > 100 || entry.sharedResources.some(grant => typeof grant.reference !== "string" || !grant.reference || grant.reference.length > 25000 || typeof grant.title !== "string" || grant.title.length > 500)))
      throw new Error("Invalid shared resource grant");
    for (const segment of entry.segments) {
      if (!sameOrigin(entry, segment) || !segment.sessionId || typeof segment.period !== "string" || !Number.isFinite(segment.createdAt) || sessions.has(segment.sessionId))
        throw new Error("Invalid conversation segment");
      sessions.add(segment.sessionId);
    }
    if (entry.current && !entry.segments.some((segment) => segment.sessionId === entry.current))
      throw new Error("Unknown current conversation segment");
  }
}

/** Shared durable ownership and rotation. DSH still owns session contents and agents.
 * A rollover never closes a previous agent or deletes its route/history. */
export class ConversationLifecycle {
  private readonly submitHandlers = new Map<string, (origin: ConversationOrigin, sessionId: string) => Promise<string>>();
  registerSubmitHandler(plugin: string, handler: (origin: ConversationOrigin, sessionId: string) => Promise<string>): () => void {
    if (this.submitHandlers.has(plugin)) throw new Error(`Conversation owner already registered: ${plugin}`);
    this.submitHandlers.set(plugin, handler);
    return () => { if (this.submitHandlers.get(plugin) === handler) this.submitHandlers.delete(plugin); };
  }
  async prepareSubmit(sessionId: string): Promise<string> {
    const origin = await this.originForSession(sessionId);
    if (!origin) return sessionId;
    const handler = this.submitHandlers.get(origin.plugin);
    if (!handler) throw new Error("conversation_owner_unavailable");
    const target = await handler(origin, sessionId);
    if (this.submitHandlers.get(origin.plugin) !== handler) throw new Error("conversation_owner_unavailable");
    const targetOrigin = await this.originForSession(target);
    if (!targetOrigin || !sameOrigin(origin, targetOrigin)) throw new Error("Conversation ownership mismatch");
    return target;
  }
  readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();
  constructor(root: string, private readonly now: () => number = Date.now) {
    this.path = join(root, "conversations.json");
  }
  private async read(): Promise<Document> {
    let raw: string;
    try { raw = await readFile(this.path, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, entries: [] };
      throw error;
    }
    const value: unknown = JSON.parse(raw);
    // Fail closed: resetting corrupt ownership could expose unrelated history.
    validateDocument(value);
    return value;
  }
  private async write(doc: Document): Promise<void> {
    validateDocument(doc);
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(doc)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
    } finally { await rm(temporary, { force: true }); }
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.chain.then(work);
    this.chain = result.catch(() => undefined);
    return result;
  }
  private entry(doc: Document, origin: ConversationOrigin, policy: ConversationPolicy): Entry {
    validateOrigin(origin);
    conversationPeriod(this.now(), policy);
    let entry = doc.entries.find((item) => sameOrigin(item, origin));
    if (!entry) {
      entry = { ...origin, policy: { ...policy }, generation: 0, segments: [] };
      doc.entries.push(entry);
    }
    return entry;
  }
  /** Migrate an existing binding once; never transfer a session between scopes. */
  adopt(origin: ConversationOrigin, sessionId: string, createdAt: number,
    policy = defaultConversationPolicy()): Promise<void> {
    return this.serial(async () => {
      const doc = await this.read();
      const previous = doc.entries.find((item) => item.segments.some((segment) => segment.sessionId === sessionId));
      if (previous) {
        if (!sameOrigin(previous, origin)) throw new Error("Conversation ownership mismatch");
        return;
      }
      const entry = this.entry(doc, origin, policy);
      const segment = { ...origin, sessionId, createdAt, period: `${conversationPeriod(createdAt, entry.policy)}:${entry.generation}` };
      entry.segments.push(segment);
      entry.current ??= sessionId;
      await this.write(doc);
    });
  }
  resolve(origin: ConversationOrigin, factory: ConversationSessionFactory,
    policy = defaultConversationPolicy(), advance = true): Promise<ConversationSegment> {
    return this.serial(async () => {
      const doc = await this.read();
      const entry = this.entry(doc, origin, policy);
      const period = `${conversationPeriod(this.now(), entry.policy)}:${entry.generation}`;
      const current = entry.segments.find((segment) => segment.sessionId === entry.current);
      if (current && (!advance || current.period === period) && !await factory.isClosed(current.sessionId)) return { ...current };
      const handle = await factory.create();
      const segment = { ...origin, sessionId: handle.sessionId, period, createdAt: this.now() };
      entry.segments.push(segment);
      entry.current = segment.sessionId;
      try { await this.write(doc); }
      catch (error) { await handle.dispose(); throw error; }
      return { ...segment };
    });
  }
  /** Takes effect on the next incoming message; no empty sessions are created. */
  view(origin: ConversationOrigin): Promise<ConversationView> {
    return this.serial(async () => {
      validateOrigin(origin);
      const entry = (await this.read()).entries.find(item => sameOrigin(item, origin));
      const policy = { ...(entry?.policy ?? defaultConversationPolicy()) };
      const current = entry?.segments.find(segment => segment.sessionId === entry.current);
      return {
        policy,
        ...(entry?.current ? { currentSessionId: entry.current } : {}),
        pendingNewConversation: !!current && current.period !== `${conversationPeriod(this.now(), policy)}:${entry!.generation}`,
        history: (entry?.segments ?? []).map(({ sessionId, createdAt }) => ({ sessionId, createdAt })).sort((a, b) => b.createdAt - a.createdAt),
        sharedResources: (entry?.sharedResources ?? []).map(grant => ({ ...grant })),
      };
    });
  }
  /** Preserve the entry's persisted calendar zone when changing its cadence. */
  configureCadence(origin: ConversationOrigin, cadence: ConversationCadence): Promise<void> {
    return this.serial(async () => {
      const doc = await this.read();
      const entry = this.entry(doc, origin, defaultConversationPolicy());
      const policy = { ...entry.policy, cadence };
      conversationPeriod(this.now(), policy);
      entry.policy = policy;
      await this.write(doc);
    });
  }
  configure(origin: ConversationOrigin, policy: ConversationPolicy): Promise<void> {
    return this.serial(async () => {
      const doc = await this.read();
      const entry = this.entry(doc, origin, policy);
      entry.policy = { ...policy };
      await this.write(doc);
    });
  }
  newConversation(origin: ConversationOrigin): Promise<void> {
    return this.serial(async () => {
      const doc = await this.read();
      this.entry(doc, origin, defaultConversationPolicy()).generation += 1;
      await this.write(doc);
    });
  }
  sharedResources(origin: ConversationOrigin): Promise<SharedResourceGrant[]> {
    return this.serial(async () => (await this.read()).entries.find(entry => sameOrigin(entry, origin))?.sharedResources?.map(grant => ({ ...grant })) ?? []);
  }
  /** Host/user action only. No agent tool is allowed to grant its own access. */
  setSharedResources(origin: ConversationOrigin, grants: readonly SharedResourceGrant[]): Promise<void> {
    return this.serial(async () => {
      const doc = await this.read();
      const entry = doc.entries.find(item => sameOrigin(item, origin));
      if (!entry) throw new Error("conversation_not_found");
      entry.sharedResources = grants.map(grant => ({ ...grant }));
      await this.write(doc);
    });
  }
  history(origin: ConversationOrigin): Promise<ConversationSegment[]> {
    return this.serial(async () => {
      validateOrigin(origin);
      return (await this.read()).entries.find((entry) => sameOrigin(entry, origin))?.segments.map((segment) => ({ ...segment })) ?? [];
    });
  }
  originForSession(sessionId: string): Promise<ConversationOrigin | undefined> {
    return this.serial(async () => {
      const entry = (await this.read()).entries.find((item) => item.segments.some((segment) => segment.sessionId === sessionId));
      return entry ? { plugin: entry.plugin, entry: entry.entry, scope: entry.scope } : undefined;
    });
  }
}
