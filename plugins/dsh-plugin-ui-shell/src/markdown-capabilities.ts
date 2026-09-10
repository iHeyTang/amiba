import { Service, type Context } from "@deepseek-ai/cordis";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import type {
  SkillProvider,
  SkillProviderControl,
  SkillCandidate,
  SkillViewOptions,
} from "@deepseek-ai/dsh-skill";
import type { MarkdownCapabilities } from "@amiba/markdown";

export interface MarkdownRequirement {
  id: string;
  version: string;
  /** Every required language must be owned by this contribution. */
  languages?: readonly string[];
}

/** Ephemeral capability state, never model-facing instructions. */
export class MarkdownCapabilityStore {
  private sessions = new Map<
    string,
    { expires: number; capabilities: MarkdownCapabilities[] }
  >();
  set(
    sessionId: string,
    capabilities: MarkdownCapabilities[],
    now = Date.now(),
  ) {
    if (
      typeof sessionId !== "string" ||
      !sessionId ||
      !Array.isArray(capabilities) ||
      capabilities.length > 64
    )
      throw new Error("Invalid Markdown capability report");
    const clean = capabilities.map((c) => {
      if (
        typeof c.id !== "string" ||
        typeof c.version !== "string" ||
        !Array.isArray(c.languages) ||
        c.languages.length > 64 ||
        c.languages.some(
          (l) => typeof l !== "string" || !/^[\w.-]{1,80}$/.test(l),
        )
      )
        throw new Error("Invalid Markdown capability");
      return { id: c.id, version: c.version, languages: [...c.languages] };
    });
    for (const [id, entry] of this.sessions)
      if (entry.expires <= now) this.sessions.delete(id);
    this.sessions.set(sessionId, {
      expires: now + 10 * 60_000,
      capabilities: clean,
    });
  }
  supports(
    sessionId: string,
    requirement: MarkdownRequirement,
    now = Date.now(),
  ) {
    const entry = this.sessions.get(sessionId);
    return (
      !!entry &&
      entry.expires > now &&
      entry.capabilities.some(
        (c) =>
          c.id === requirement.id &&
          c.version === requirement.version &&
          (requirement.languages ?? []).every((language) =>
            c.languages.includes(language),
          ),
      )
    );
  }
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    markdownCapabilities: MarkdownCapabilitiesService;
  }
}
export class MarkdownCapabilitiesService extends Service {
  private store = new MarkdownCapabilityStore();
  private listeners = new Set<() => void>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(ctx: Context) {
    super(ctx, "markdownCapabilities");
    ctx.effect(() => () => {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      this.listeners.clear();
    });
  }
  observe(control: SkillProviderControl) {
    if (control.signal.aborted) return;
    this.listeners.add(control.invalidate);
    control.signal.addEventListener(
      "abort",
      () => this.listeners.delete(control.invalidate),
      { once: true },
    );
  }
  report(sessionId: string, capabilities: MarkdownCapabilities[]) {
    this.store.set(sessionId, capabilities);
    clearTimeout(this.timers.get(sessionId));
    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      for (const invalidate of this.listeners) invalidate();
    }, 10 * 60_000);
    timer.unref();
    this.timers.set(sessionId, timer);
    for (const invalidate of this.listeners) invalidate();
  }
  supports(scope: SkillViewOptions["scope"], requirement: MarkdownRequirement) {
    // DSH passes the original SkillViewOptions to providers. Agent scopes carry
    // session identity; global and standing-preset views cannot confirm a client.
    const sessionId = (scope as { session?: { id?: unknown } } | undefined)
      ?.session?.id;
    return (
      typeof sessionId === "string" &&
      this.store.supports(sessionId, requirement)
    );
  }
}

/** Only explicitly associated skills are gated; other provider entries pass through. */
export function withMarkdownCapability(
  ctx: Context,
  requirements: Readonly<Record<string, MarkdownRequirement>>,
  provider: SkillProvider,
  control: SkillProviderControl,
): SkillProvider {
  ctx.markdownCapabilities.observe(control);
  const available = (name: string, options: SkillViewOptions) => {
    const requirement = Object.hasOwn(requirements, name)
      ? requirements[name]
      : undefined;
    return (
      !requirement ||
      ctx.markdownCapabilities.supports(options.scope, requirement)
    );
  };
  return {
    name: provider.name,
    async list(options) {
      const result = await provider.list(options);
      const observation = Array.isArray(result)
        ? { candidates: result as readonly SkillCandidate[], complete: true }
        : (result as {
            candidates: readonly SkillCandidate[];
            complete: boolean;
          });
      return {
        ...observation,
        candidates: observation.candidates.filter((candidate) =>
          available(candidate.name, options),
        ),
      };
    },
    async get(candidate, options) {
      if (!available(candidate.name, options)) return undefined;
      const definition = await provider.get(candidate, options);
      return available(candidate.name, options) ? definition : undefined;
    },
  };
}
class MarkdownCapabilitiesRemote extends TypertRemoteService {
  constructor(ctx: Context) {
    super(ctx, "amibaMarkdown");
  }
  @Remote
  report(sessionId: string, capabilities: MarkdownCapabilities[]) {
    this.ctx.markdownCapabilities.report(sessionId, capabilities);
  }
}
export function applyMarkdownCapabilities(ctx: Context) {
  new MarkdownCapabilitiesService(ctx);
  new MarkdownCapabilitiesRemote(ctx);
}
