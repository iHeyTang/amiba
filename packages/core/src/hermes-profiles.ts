import { backplaneFetch } from "./backplane-client";

export interface HermesProfile {
  name: string;
  path: string;
  is_default: boolean;
  model: string | null;
  provider: string | null;
  has_env: boolean;
  skill_count: number;
  gateway_running: boolean;
  description: string;
  description_auto: boolean;
  distribution_name: string | null;
  distribution_version: string | null;
  distribution_source: string | null;
  soul_exists: boolean;
}

export interface HermesProfilesResponse {
  ok: boolean;
  profiles: HermesProfile[];
  active: string;
  current: string;
  error?: string;
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    detail?: unknown;
  } | null;
  const message = body?.error ?? body?.detail;
  return typeof message === "string" && message
    ? message
    : `HTTP ${response.status}`;
}

async function mutate(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await backplaneFetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return response.ok
      ? { ok: true }
      : { ok: false, error: await readError(response) };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}

export async function getHermesProfiles(): Promise<HermesProfilesResponse> {
  try {
    const response = await backplaneFetch("/hermes/profiles");
    if (!response.ok) {
      return {
        ok: false,
        profiles: [],
        active: "default",
        current: "default",
        error: await readError(response),
      };
    }
    return (await response.json()) as HermesProfilesResponse;
  } catch (error) {
    return {
      ok: false,
      profiles: [],
      active: "default",
      current: "default",
      error: String((error as Error)?.message || error),
    };
  }
}

export function createHermesProfile(input: {
  name: string;
  clone_from?: string;
  description?: string;
}) {
  return mutate("/hermes/profiles", "POST", input);
}

export function renameHermesProfile(name: string, newName: string) {
  return mutate(`/hermes/profiles/${encodeURIComponent(name)}`, "PATCH", {
    new_name: newName,
  });
}

export function deleteHermesProfile(name: string) {
  return mutate(`/hermes/profiles/${encodeURIComponent(name)}`, "DELETE");
}

export function setActiveHermesProfile(name: string) {
  return mutate("/hermes/profiles/active", "PUT", { name });
}

export async function getHermesProfileSoul(
  name: string,
): Promise<{ ok: boolean; content: string; exists: boolean; error?: string }> {
  try {
    const response = await backplaneFetch(
      `/hermes/profiles/${encodeURIComponent(name)}/soul`,
    );
    if (!response.ok) {
      return {
        ok: false,
        content: "",
        exists: false,
        error: await readError(response),
      };
    }
    return (await response.json()) as {
      ok: boolean;
      content: string;
      exists: boolean;
    };
  } catch (error) {
    return {
      ok: false,
      content: "",
      exists: false,
      error: String((error as Error)?.message || error),
    };
  }
}

export function updateHermesProfileSoul(name: string, content: string) {
  return mutate(`/hermes/profiles/${encodeURIComponent(name)}/soul`, "PUT", {
    content,
  });
}

export function updateHermesProfileDescription(
  name: string,
  description: string,
) {
  return mutate(
    `/hermes/profiles/${encodeURIComponent(name)}/description`,
    "PUT",
    { description },
  );
}
