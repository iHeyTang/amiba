/**
 * Brain-install prompt helpers — extension-local copy stripped of
 * platform/storage dependencies.
 *
 * Kept:
 *   - buildBrainInstallPrompt — verbatim, no platform deps.
 *
 * Dropped (relied on global storage keys / window.hermes bridge):
 *   - buildBrainInstallStoragePatch — callers use host.settings.set directly.
 *   - ensureBrainDefaultUrl — same.
 *   - hasGBrainBridge — extension only loads when host is present.
 */

type ResolvedLanguage = "en" | "zh-CN"

/**
 * Human-readable label per supported UI language. The agent sees this
 * string verbatim in the prompt's "Respond in X" line — `Simplified
 * Chinese` is clearer than the raw `zh-CN` code, which sometimes gets
 * misinterpreted as a region rather than a language directive.
 */
const LANGUAGE_LABELS: Record<ResolvedLanguage, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese (简体中文)",
}

/**
 * Build the one-click install prompt for the agent.
 *
 * Anchored on gbrain's official agent-install entry — the upstream doc
 * owns install steps, transport mode, and platform quirks; we do NOT
 * try to second-guess any of that. The additions are post-install
 * behavioural asks specific to the hermes-x desktop experience.
 */
export function buildBrainInstallPrompt(language: ResolvedLanguage): string {
  const langLabel = LANGUAGE_LABELS[language]
  return [
    "Retrieve and follow the instructions at:",
    "https://raw.githubusercontent.com/garrytan/gbrain/master/INSTALL_FOR_AGENTS.md",
    "",
    "After installation, walk me through post-install configuration progressively — cheapest / simplest first, then mid-tier paid, then premium:",
    "- Lead with a free / local option I can try without any API key or spend (e.g. local embedding model + local LLM).",
    "- For each subsequent tier, name the providers, rough cost (per 1M tokens or per month for typical personal use), and what to expect for quality / latency.",
    "- Recommend a sensible default for a first-time user so I don't have to pick blind.",
    "- Use a Markdown table when comparing options within a tier.",
    "",
    `Respond in ${langLabel}.`,
  ].join("\n")
}
