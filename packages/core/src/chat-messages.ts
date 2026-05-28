/**
 * Shared chat message shape. The wire protocol (when calling the LLM gateway)
 * follows OpenAI Chat Completions; this is the local domain type used by both
 * the engine layer and the UI layer.
 */

export type ChatRole = "system" | "user" | "assistant" | "tool"

export interface ChatMessage {
  role: ChatRole
  content: string
  name?: string
  /** Local-only id for React keying. */
  uiId?: string
}
