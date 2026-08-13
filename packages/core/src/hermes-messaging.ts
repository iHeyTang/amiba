import { backplaneFetch } from "./backplane-client";

function profileUrl(path: string, profileId?: string): string {
  if (!profileId?.trim()) return path;
  return `${path}${path.includes("?") ? "&" : "?"}profile=${encodeURIComponent(profileId.trim())}`;
}

export interface HermesMessagingField {
  key: string;
  required: boolean;
  configured: boolean;
  label?: string;
  description?: string;
  secret?: boolean;
}

export interface HermesMessagingPlatform {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  state: string;
  error?: string;
  fields: HermesMessagingField[];
}

export interface HermesWebhookSubscription {
  name: string;
  description: string;
  events: string[];
  deliver: string;
  enabled: boolean;
  url: string;
  secret_set: boolean;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  profileId?: string,
): Promise<T & { ok: boolean; error?: string }> {
  try {
    const response = await backplaneFetch(profileUrl(path, profileId), init);
    const body = (await response.json().catch(() => null)) as
      | (T & { ok?: boolean; error?: string })
      | null;
    if (!response.ok || body?.ok === false)
      return {
        ...(body as T),
        ok: false,
        error: body?.error || `HTTP ${response.status}`,
      };
    return { ...(body as T), ok: true };
  } catch (error) {
    return {
      ok: false,
      error: String((error as Error)?.message || error),
    } as T & { ok: boolean; error?: string };
  }
}

export function getHermesMessagingPlatforms(profileId?: string) {
  return request<{ platforms: HermesMessagingPlatform[] }>(
    "/hermes/messaging/platforms",
    undefined,
    profileId,
  );
}

export function saveHermesMessagingPlatform(
  id: string,
  input: { enabled?: boolean; env?: Record<string, string> },
  profileId?: string,
) {
  return request<Record<string, never>>(
    `/hermes/messaging/platforms/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    profileId,
  );
}

export function testHermesMessagingPlatform(id: string, profileId?: string) {
  return request<{ state?: string; message?: string }>(
    `/hermes/messaging/platforms/${encodeURIComponent(id)}/test`,
    { method: "POST" },
    profileId,
  );
}

export function getHermesPairings(profileId?: string) {
  return request<{
    pending: Array<Record<string, unknown>>;
    approved: Array<Record<string, unknown>>;
  }>("/hermes/messaging/pairings", undefined, profileId);
}

export function approveHermesPairing(
  platform: string,
  target: string,
  profileId?: string,
) {
  return request<Record<string, never>>(
    "/hermes/messaging/pairings/approve",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, target }),
    },
    profileId,
  );
}

export function revokeHermesPairing(
  platform: string,
  userId: string,
  profileId?: string,
) {
  return request<Record<string, never>>(
    "/hermes/messaging/pairings/revoke",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ platform, user_id: userId }),
    },
    profileId,
  );
}

export function getHermesWebhooks(profileId?: string) {
  return request<{
    enabled: boolean;
    base_url: string;
    subscriptions: HermesWebhookSubscription[];
  }>("/hermes/messaging/webhooks", undefined, profileId);
}

export function createHermesWebhook(
  input: {
    name: string;
    description?: string;
    events?: string[];
    deliver?: string;
    prompt?: string;
    skills?: string[];
    secret?: string;
  },
  profileId?: string,
) {
  return request<{ name?: string; secret?: string; url?: string }>(
    "/hermes/messaging/webhooks",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    profileId,
  );
}

export function setHermesWebhookEnabled(
  name: string,
  enabled: boolean,
  profileId?: string,
) {
  return request<Record<string, never>>(
    `/hermes/messaging/webhooks/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    },
    profileId,
  );
}

export function updateHermesWebhook(
  name: string,
  input: {
    description?: string;
    events?: string[];
    deliver?: string;
    prompt?: string;
    skills?: string[];
    secret?: string;
    enabled?: boolean;
  },
  profileId?: string,
) {
  return request<Record<string, never>>(
    `/hermes/messaging/webhooks/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    profileId,
  );
}

export function deleteHermesWebhook(name: string, profileId?: string) {
  return request<Record<string, never>>(
    `/hermes/messaging/webhooks/${encodeURIComponent(name)}`,
    { method: "DELETE" },
    profileId,
  );
}
