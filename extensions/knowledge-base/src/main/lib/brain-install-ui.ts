/**
 * Brain-install prompt helpers — shared between main process and UI pages.
 *
 * No platform or IPC dependencies; pure string building.
 */

type ResolvedLanguage = "en" | "zh-CN"

const LANGUAGE_LABELS: Record<ResolvedLanguage, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese (简体中文)",
}

/**
 * Build the one-click install prompt for the agent.
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
