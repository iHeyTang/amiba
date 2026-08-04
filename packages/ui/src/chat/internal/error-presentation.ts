import type { ChatError } from "./types"

export type ChatErrorKind =
  | "credentials"
  | "model-service"
  | "connection"
  | "voice"
  | "runtime"

export type ChatErrorSettingsTarget =
  | "models"
  | "connection"
  | "voice"
  | "logs?source=errors"

export interface ChatErrorPresentation {
  kind: ChatErrorKind
  titleKey:
    | "sidepanel.runError.credentials.title"
    | "sidepanel.runError.modelService.title"
    | "sidepanel.runError.connection.title"
    | "sidepanel.runError.voice.title"
    | "sidepanel.runError.runtime.title"
  actionKey:
    | "sidepanel.runError.credentials.action"
    | "sidepanel.runError.modelService.action"
    | "sidepanel.runError.connection.action"
    | "sidepanel.runError.voice.action"
    | "sidepanel.runError.runtime.action"
  settingsTarget: ChatErrorSettingsTarget
  status?: number
  detail: string
}

const HTTP_PREFIX = /^\s*HTTP\s+(\d{3})\b\s*[:\-–—]?\s*/i

function statusOf(error: ChatError): number | undefined {
  if (Number.isInteger(error.status)) return error.status
  const match = error.message.match(HTTP_PREFIX)
  return match ? Number(match[1]) : undefined
}

function detailOf(error: ChatError): string {
  const stripped = error.message.replace(HTTP_PREFIX, "").trim()
  return stripped || error.message.trim()
}

/**
 * One classifier for every top-level chat/runtime error presentation.
 *
 * Prefer the structured status emitted by the engine, while retaining text
 * fallbacks for older bridges and restored snapshots that only carry a
 * message. The result owns both the wording category and the precise Settings
 * destination, so renderers cannot drift into generic "open Settings" CTAs.
 */
export function resolveChatErrorPresentation(
  error: ChatError,
): ChatErrorPresentation {
  const status = statusOf(error)
  const normalized = `${error.message}\n${error.hint ?? ""}`.toLowerCase()
  const detail = detailOf(error)

  if (error.source === "voice") {
    return {
      kind: "voice",
      titleKey: "sidepanel.runError.voice.title",
      actionKey: "sidepanel.runError.voice.action",
      settingsTarget: "voice",
      status,
      detail,
    }
  }

  if (
    status === 401 ||
    status === 403 ||
    /invalid[\s_-]*(?:api[\s_-]*)?key|api[\s_-]*key|credential|unauthori[sz]ed|authentication|forbidden/.test(
      normalized,
    )
  ) {
    return {
      kind: "credentials",
      titleKey: "sidepanel.runError.credentials.title",
      actionKey: "sidepanel.runError.credentials.action",
      settingsTarget: "models",
      status,
      detail,
    }
  }

  if (
    status === 429 ||
    /model[^\n]*(?:not found|unsupported|unavailable)|rate[\s_-]*limit|quota|billing/.test(
      normalized,
    )
  ) {
    return {
      kind: "model-service",
      titleKey: "sidepanel.runError.modelService.title",
      actionKey: "sidepanel.runError.modelService.action",
      settingsTarget: "models",
      status,
      detail,
    }
  }

  if (
    status === 408 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /timed?[\s_-]*out|timeout|connection (?:refused|failed|reset)|network error|bad gateway|gateway unavailable/.test(
      normalized,
    )
  ) {
    return {
      kind: "connection",
      titleKey: "sidepanel.runError.connection.title",
      actionKey: "sidepanel.runError.connection.action",
      settingsTarget: "connection",
      status,
      detail,
    }
  }

  return {
    kind: "runtime",
    titleKey: "sidepanel.runError.runtime.title",
    actionKey: "sidepanel.runError.runtime.action",
    settingsTarget: "logs?source=errors",
    status,
    detail,
  }
}
