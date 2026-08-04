import { backplaneFetch } from "./backplane-client";

export interface HermesPersonality {
  key: string;
  /** User-editable label; `key` remains the stable task/config identifier. */
  name: string;
  builtin: boolean;
  overridden: boolean;
  /** This profile's default response mode for newly created tasks. */
  selected: boolean;
  preview: string;
  description: string;
  /** Resolved prompt exactly as Hermes applies it for this response mode. */
  prompt: string;
  system_prompt: string;
  tone: string;
  style: string;
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
  } | null;
  return typeof body?.error === "string" && body.error
    ? body.error
    : `HTTP ${response.status}`;
}

export interface HermesPersonalitiesResponse {
  ok: boolean;
  personalities: HermesPersonality[];
  error?: string;
}

export async function getHermesPersonalities(
  profileId?: string,
): Promise<HermesPersonalitiesResponse> {
  try {
    const query = new URLSearchParams({
      profile: profileId?.trim() || "default",
    });
    const res = await backplaneFetch(`/hermes/personalities?${query}`, {
      method: "GET",
    });
    if (!res.ok) {
      return { ok: false, personalities: [], error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as unknown;
    const personalities = Array.isArray(body)
      ? (body as HermesPersonality[])
      : [];
    return { ok: true, personalities };
  } catch (e) {
    return {
      ok: false,
      personalities: [],
      error: String((e as Error)?.message || e),
    };
  }
}

export async function saveHermesPersonality(
  profileId: string,
  personality: Pick<
    HermesPersonality,
    "key" | "name" | "system_prompt" | "description" | "tone" | "style"
  >,
  previousKey?: string,
): Promise<{ ok: boolean; key?: string; error?: string }> {
  try {
    const profile = profileId.trim() || "default";
    const key = personality.key.trim().toLowerCase();
    const res = await backplaneFetch(
      `/hermes/personalities/${encodeURIComponent(key)}?profile=${encodeURIComponent(profile)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: personality.name,
          system_prompt: personality.system_prompt,
          description: personality.description,
          tone: personality.tone,
          style: personality.style,
          ...(previousKey?.trim() && previousKey.trim() !== key
            ? { previous_key: previousKey.trim().toLowerCase() }
            : {}),
        }),
      },
    );
    if (!res.ok) return { ok: false, error: await readError(res) };
    return (await res.json()) as { ok: boolean; key: string };
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error),
    };
  }
}

export async function setSelectedHermesPersonality(
  profileId: string,
  key?: string,
): Promise<{ ok: boolean; key?: string; error?: string }> {
  try {
    const profile = profileId.trim() || "default";
    const res = await backplaneFetch(
      `/hermes/personalities/active?profile=${encodeURIComponent(profile)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key?.trim().toLowerCase() || "" }),
      },
    );
    if (!res.ok) return { ok: false, error: await readError(res) };
    return (await res.json()) as { ok: boolean; key: string };
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error),
    };
  }
}

export async function deleteHermesPersonality(
  profileId: string,
  key: string,
): Promise<{
  ok: boolean;
  reset?: boolean;
  existed?: boolean;
  error?: string;
}> {
  try {
    const profile = profileId.trim() || "default";
    const res = await backplaneFetch(
      `/hermes/personalities/${encodeURIComponent(key.trim().toLowerCase())}?profile=${encodeURIComponent(profile)}`,
      { method: "DELETE" },
    );
    if (!res.ok) return { ok: false, error: await readError(res) };
    return (await res.json()) as {
      ok: boolean;
      reset: boolean;
      existed: boolean;
    };
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error),
    };
  }
}
