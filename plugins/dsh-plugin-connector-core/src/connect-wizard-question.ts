/** Question id the chat tool asks and the client seat claims. Free-form per dsh-user-questions; matched positionally AND by id on answer. */
export const CONNECT_WIZARD_QUESTION_ID = "amiba.connect-wizard";
export const CONNECT_ADD_TOOL_NAME = "amiba_connect_add";

export interface ConnectWizardPrefill {
  provider?: string;
  name?: string;
  agentPreset?: string;
}

/** `detail` is the only sanctioned free-text field on a question item, so the prefill rides there as compact JSON. */
export function encodePrefill(prefill: ConnectWizardPrefill): string {
  const entries = Object.entries(prefill).filter(([, value]) => typeof value === "string" && value.length > 0);
  return entries.length === 0 ? "" : JSON.stringify(Object.fromEntries(entries));
}

export function decodePrefill(detail: string | undefined): ConnectWizardPrefill {
  if (!detail) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(detail); } catch { return {}; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const row = parsed as Record<string, unknown>;
  const pick = (key: keyof ConnectWizardPrefill) => (typeof row[key] === "string" ? (row[key] as string) : undefined);
  const out: ConnectWizardPrefill = {};
  for (const key of ["provider", "name", "agentPreset"] as const) {
    const value = pick(key);
    if (value !== undefined) {
      if (typeof row[key] !== "string") return {};
      out[key] = value;
    } else if (key in row) {
      return {}; // a present-but-non-string field means the payload is not ours
    }
  }
  return out;
}
