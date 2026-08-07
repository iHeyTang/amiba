import { backplaneFetch } from "./backplane-client";

export type HermesApprovalMode = "manual" | "smart" | "off";

export type HermesApprovalModeResult =
  | {
      ok: true;
      mode: HermesApprovalMode;
      profile: string;
      changed?: boolean;
    }
  | { ok: false; error: string };

function normalizeProfileId(profileId?: string): string {
  return profileId?.trim().toLowerCase() || "default";
}

function profileUrl(profileId?: string): string {
  const profile = normalizeProfileId(profileId);
  return `/hermes/approvals/mode?profile=${encodeURIComponent(profile)}`;
}

async function readResult(
  response: Response,
  requestedProfile?: string,
): Promise<HermesApprovalModeResult> {
  let body: {
    error?: string;
    mode?: string;
    profile?: string;
    changed?: boolean;
  } = {};
  try {
    body = (await response.json()) as {
      error?: string;
      mode?: string;
      profile?: string;
      changed?: boolean;
    };
  } catch {
    // The status fallback below still gives the caller a useful error.
  }
  if (!response.ok) {
    return {
      ok: false,
      error: body.error || `${response.status} ${response.statusText}`,
    };
  }
  if (body.mode !== "manual" && body.mode !== "smart" && body.mode !== "off") {
    return { ok: false, error: "Hermes returned an invalid approval mode" };
  }
  const profile = body.profile?.trim().toLowerCase();
  return {
    ok: true,
    mode: body.mode,
    profile: profile || normalizeProfileId(requestedProfile),
    changed: body.changed,
  };
}

export async function getHermesApprovalMode(
  profileId?: string,
): Promise<HermesApprovalModeResult> {
  try {
    return readResult(
      await backplaneFetch(profileUrl(profileId), { method: "GET" }),
      profileId,
    );
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}

export async function setHermesApprovalMode(
  mode: HermesApprovalMode,
  profileId?: string,
): Promise<HermesApprovalModeResult> {
  try {
    return readResult(
      await backplaneFetch(profileUrl(profileId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      }),
      profileId,
    );
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error) };
  }
}
