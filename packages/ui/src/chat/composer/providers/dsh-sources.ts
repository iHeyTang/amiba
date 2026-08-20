/**
 * Amiba's own trigger sources, written against the OFFICIAL
 * `InputTriggerSource` contract.
 *
 * These are the single definition of Amiba's built-in `/` and `@` behaviour.
 * They reach the user through two mounts and never through two
 * implementations:
 *
 *   - IN-SESSION: registered with the official service via
 *     `ctx.inputTriggers.registerSource(...)`, so the official
 *     `InputTriggerController` fetches their candidates, routes picks through
 *     `onPick`, polls `matchSpace`/`matchEnter`, prewarms them, and resolves
 *     their `codec` at submit time.
 *   - SESSION-LESS (home/draft composer, Quick-Ask, the browser extension):
 *     adapted to the surface-local `TriggerProvider` shape by
 *     `sourceToProvider`, whose pick path applies the SAME `PickOutcome`
 *     through the SAME editor verbs.
 *
 * POSITION POLICY. Both `/` sources answer only for `position === "leading"`.
 * Amiba's pre-adoption detector was line-anchored for `/` (a regex rooted at
 * the text run's start), so a mid-line slash never opened a menu; the
 * official detector is not line-anchored, and this filter is what keeps the
 * built-ins' user-visible behaviour identical across the change. The official
 * `ui-commands` source applies its own upstream policy (leading, or any
 * command without an input hint) — that is a newly enabled plugin's
 * behaviour, not a change to Amiba's built-ins.
 */

import { getPlatform } from "@amiba/app-runtime/platform";
import type {
  CandidateRequest,
  ClientSessionContext,
  InputTriggerCandidate,
  InputTriggerPick,
  InputTriggerSource,
  PickOutcome,
  ReferenceCodec,
} from "../triggers/contracts";

/** Source name of the `/`-invocable skills group. */
export const SKILL_SOURCE = "skill";
/** Source name of the `@`-referenced sessions group. */
export const SESSION_SOURCE = "session";
/**
 * Source name of the `/`-command group. Amiba only registers this on
 * SESSION-LESS surfaces: in-session the official `ui-commands` package owns
 * the same `('/', "command")` identity (registering both would throw on the
 * uniqueness rule) and supplies strictly more — argument claims, popup
 * shells, and detached execution.
 */
export const COMMAND_SOURCE = "command";

async function resolveSessionId(
  preferred: string | undefined,
): Promise<string | undefined> {
  if (preferred) return preferred;
  const sessions = getPlatform().agentSessions;
  if (!sessions) return undefined;
  return (await sessions.list()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  )[0]?.sessionId;
}

async function loadSkills(
  sessionId: string,
): Promise<readonly { name: string; description: string }[]> {
  const platform = getPlatform();
  if (!platform.agentSkills) return [];
  const resolved = await resolveSessionId(sessionId);
  if (!resolved) return [];
  // No user-invocable filter: `skill.list` returns only user-invocable rows
  // by contract (`AgentSkillMention.userInvocable` is the literal `true`).
  const result = await platform.agentSkills.list(resolved);
  return result.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
}

/** `/` skills. Picking one inserts a chip that serializes back to `/name`. */
export function makeSkillSource(): InputTriggerSource {
  const codec: ReferenceCodec = {
    clipboardText: (ref) => `/${ref}`,
    serialize: (ref) => Promise.resolve(`/${ref}`),
  };
  return {
    trigger: "/",
    name: SKILL_SOURCE,
    order: 0,
    codec,
    warm(session: ClientSessionContext): void {
      void loadSkills(String(session.sessionId)).catch(() => undefined);
    },
    async candidates(
      session: ClientSessionContext,
      req: CandidateRequest,
    ): Promise<readonly InputTriggerCandidate[]> {
      if (req.position !== "leading") return [];
      const query = req.query.toLowerCase();
      // A space means the user is entering arguments, not completing a name.
      if (req.query.includes(" ")) return [];
      const skills = await loadSkills(String(session.sessionId));
      return skills
        .filter((skill) => skill.name.toLowerCase().includes(query))
        .slice(0, 20)
        .map((skill) => ({ name: skill.name, description: skill.description }));
    },
    onPick(pick: InputTriggerPick): PickOutcome {
      const name = pick.candidate.name;
      return {
        insert: {
          source: SKILL_SOURCE,
          ref: name,
          label: name,
          clipboardText: codec.clipboardText(name),
        },
      };
    },
  };
}

function base64UrlJson(value: string): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

/**
 * `@` sessions. The model form is the DSH session-reference link Amiba has
 * always sent; the codec is where it now lives.
 */
export function makeSessionSource(): InputTriggerSource {
  // Deliberately STATELESS: `serialize` re-resolves the title from the
  // session list rather than caching what a pick happened to see. A cache
  // would make the model form depend on which component instance produced
  // the chip — and the two mount paths build their own source instances.
  const codec: ReferenceCodec = {
    clipboardText: (ref) => `@${ref}`,
    serialize: async (ref) => {
      const sessions = getPlatform().agentSessions;
      const row = sessions
        ? (await sessions.list()).find((entry) => entry.sessionId === ref)
        : undefined;
      const label = (row?.title ?? ref).replace(/([\\\]])/gu, "\\$1");
      return `@[${label}](dsh-session:${base64UrlJson(ref)})`;
    },
  };
  return {
    trigger: "@",
    name: SESSION_SOURCE,
    order: 0,
    codec,
    async candidates(
      _session: ClientSessionContext,
      req: CandidateRequest,
    ): Promise<readonly InputTriggerCandidate[]> {
      const sessions = getPlatform().agentSessions;
      if (!sessions) return [];
      const query = req.query.toLowerCase();
      return (await sessions.list())
        .map((row) => ({
          id: row.sessionId,
          title: row.title ?? row.sessionId,
        }))
        .filter((row) => row.title.toLowerCase().includes(query))
        .slice(0, 15)
        .map((row) => ({ name: row.title || row.id, hint: row.id }));
    },
    onPick(pick: InputTriggerPick): PickOutcome {
      const ref = pick.candidate.hint ?? pick.candidate.name;
      const label = pick.candidate.name;
      return {
        insert: {
          source: SESSION_SOURCE,
          ref,
          label,
          clipboardText: `@${label}`,
        },
      };
    },
  };
}

/**
 * `/` commands for SESSION-LESS surfaces only (see {@link COMMAND_SOURCE}).
 * Picking one replaces the trigger token with the literal command text — the
 * official plain-text reference path, and exactly what Amiba's composer did
 * before the adoption.
 */
export function makeCommandSource(
  fallbackSessionId?: string,
): InputTriggerSource {
  return {
    trigger: "/",
    name: COMMAND_SOURCE,
    order: 1,
    async candidates(
      session: ClientSessionContext,
      req: CandidateRequest,
    ): Promise<readonly InputTriggerCandidate[]> {
      if (req.position !== "leading") return [];
      if (req.query.includes(" ")) return [];
      const platform = getPlatform();
      if (!platform.agentCommands) return [];
      const resolved = await resolveSessionId(
        String(session.sessionId) || fallbackSessionId,
      );
      if (!resolved) return [];
      const query = req.query.toLowerCase();
      return (await platform.agentCommands.list(resolved))
        .filter((command) => command.name.toLowerCase().includes(query))
        .slice(0, 30)
        .map((command) => ({
          name: command.name,
          description: command.inputHint
            ? `${command.description} · ${command.inputHint}`
            : command.description,
        }));
    },
    onPick(pick: InputTriggerPick): PickOutcome {
      return { text: `/${pick.candidate.name} ` };
    },
  };
}

/**
 * The sources Amiba registers with the OFFICIAL service. `command` is absent
 * on purpose — `ui-commands` owns that identity in-session.
 */
export function officialTriggerSources(): InputTriggerSource[] {
  return [makeSkillSource(), makeSessionSource()];
}

/** The sources Amiba serves itself on surfaces with no plugin runtime. */
export function localTriggerSources(sessionId?: string): InputTriggerSource[] {
  return [makeSkillSource(), makeCommandSource(sessionId), makeSessionSource()];
}

/**
 * Resolve one reference occurrence to its model form through the owning
 * source's codec. Same shape and same failure rule as the official
 * `InputTriggerController.serializeReference`: a missing owner or a
 * codec-less source REJECTS, so the send blocks instead of silently
 * downgrading to the clipboard text.
 */
export function localReferenceResolver(sources: readonly InputTriggerSource[]): {
  serializeReference(
    source: string,
    ref: string,
    signal: AbortSignal,
  ): Promise<string>;
} {
  return {
    serializeReference(source, ref, signal) {
      const owner = sources.find((entry) => entry.name === source);
      if (owner?.codec === undefined) {
        return Promise.reject(
          new Error(`slash: no serializer for reference source "${source}"`),
        );
      }
      return owner.codec.serialize(ref, signal);
    },
  };
}
