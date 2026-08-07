/**
 * The single execution-context contract between Amiba tasks and Hermes.
 *
 * A Hermes profile is not a visual persona: it selects an isolated runtime
 * home (config, credentials, SOUL, memory, skills and SessionDB).  Keeping the
 * profile and the optional response-mode overlay together prevents individual
 * UI surfaces from inventing their own routing rules.
 */
export interface AgentPersonalitySelection {
  /** Stable key from `agent.personalities`. */
  key: string;
  /** Resolved prompt captured when this response mode was selected. */
  prompt: string;
}

export interface AgentExecutionContext {
  /** Hermes profile id. `default` uses the unprefixed gateway routes. */
  profileId: string;
  /** Optional turn-switchable overlay applied on top of the profile's SOUL. */
  personality?: AgentPersonalitySelection;
}

export const DEFAULT_AGENT_PROFILE_ID = "default";

export function normalizeAgentProfileId(value: unknown): string {
  const normalized =
    typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
  return normalized || DEFAULT_AGENT_PROFILE_ID;
}

export function normalizeAgentContext(
  value: Partial<AgentExecutionContext> | null | undefined,
): AgentExecutionContext {
  const personality = value?.personality;
  const key = personality?.key?.trim() ?? "";
  const prompt = personality?.prompt?.trim() ?? "";
  return {
    profileId: normalizeAgentProfileId(value?.profileId),
    ...(key && prompt ? { personality: { key, prompt } } : {}),
  };
}

/**
 * Mirror a Hermes gateway path under `/p/<profile>` for named profiles.
 * The default profile deliberately stays unprefixed: that is Hermes's stable
 * single-profile contract and keeps non-multiplex callers compatible.
 */
export function hermesAgentPath(profileId: unknown, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const profile = normalizeAgentProfileId(profileId);
  return profile === DEFAULT_AGENT_PROFILE_ID
    ? normalizedPath
    : `/p/${encodeURIComponent(profile)}${normalizedPath}`;
}
