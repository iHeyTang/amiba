/**
 * Brain-install-specific glue for the chat-session-request abstraction.
 *
 * The transport mechanics (writing `HOME_PENDING_PROMPT_KEY`, minting
 * a fresh session) live in `chat-session-request.ts`. This module owns
 * only what's specific to the GBrain install flow:
 *
 *   - The prompt text we hand the agent (with our identity / port
 *     clarifications around upstream's official doc).
 *   - The platform-availability check (`hasGBrainBridge`) so HomeView
 *     / Settings hide the install affordance where it can't run.
 *   - The "set BRAIN_URL only when the user hasn't customized it"
 *     defaulting logic — surfaced as a helper that builds the
 *     `storagePatch` so the SettingsBrain caller can pass it straight
 *     into `useChatSessionRequester()`.
 */
import {
  BRAIN_DEFAULT_URL,
  BRAIN_URL_STORAGE_KEY,
} from "@hermes-x/core"
import type { ResolvedLanguage } from "@hermes-x/i18n"
import { getPlatform } from "@hermes-x/platform"

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
 * **behavioural** asks specific to the hermes-x desktop experience:
 *
 *   - Tier the configuration walkthrough from cheap → expensive. Agents
 *     left to their own devices tend to lead with whatever provider is
 *     listed first in the doc, which can mean a Claude / OpenAI plug
 *     before the user has any sense of cost. We want first-time users
 *     to see a free / local option first and only step up the spend
 *     ladder once they understand what each tier buys.
 *   - Respond in the user's UI language. Upstream is English-only, but
 *     the prompt is shown to mixed-locale users. The language is
 *     templated in from the resolved app locale rather than asked
 *     ("match this message") so we don't rely on the agent inferring.
 *
 * Keep additions to "what to do after install completes" — anything
 * earlier risks tangling with the upstream install logic.
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

/**
 * Build the `storagePatch` companion for the brain-install prompt. We
 * only seed the default URL when the user hasn't already configured
 * one — overwriting a custom URL would be a footgun (think: user
 * pointed at a remote brain over ngrok, we'd clobber it).
 *
 * Returns `undefined` when no patch is needed so the caller can skip
 * the merge entirely.
 */
export async function buildBrainInstallStoragePatch(): Promise<
  Record<string, unknown> | undefined
> {
  const existing = await getPlatform().storage.get(BRAIN_URL_STORAGE_KEY)
  const currentUrl =
    typeof existing[BRAIN_URL_STORAGE_KEY] === "string"
      ? (existing[BRAIN_URL_STORAGE_KEY] as string).trim()
      : ""
  if (currentUrl) return undefined
  return { [BRAIN_URL_STORAGE_KEY]: BRAIN_DEFAULT_URL }
}

/**
 * Apply the default-URL patch directly. Convenience for surfaces that
 * don't go through the chat-session helper (e.g. HomeView's brain hint,
 * which only prefills the composer rather than submitting). Skips the
 * write when the user already has a custom URL configured.
 */
export async function ensureBrainDefaultUrl(): Promise<void> {
  const patch = await buildBrainInstallStoragePatch()
  if (patch) await getPlatform().storage.set(patch)
}

/**
 * True when the desktop's gbrain IPC bridge is available. Extension and
 * web contexts don't have it — the one-click button is meaningless there
 * (no local server to install onto), so callers should hide their UI.
 */
export function hasGBrainBridge(): boolean {
  if (typeof window === "undefined") return false
  const bridge = (
    window as unknown as { hermes?: { gbrain?: unknown } }
  ).hermes?.gbrain
  return typeof bridge !== "undefined"
}
