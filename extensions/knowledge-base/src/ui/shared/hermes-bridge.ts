/**
 * Typed re-export of `window.hermes` for convenience.
 *
 * Extension UI pages import `hermes` from this module instead of
 * casting `window.hermes` everywhere.  The type definition mirrors
 * the shape exposed by the webview-bridge preload.
 */

declare global {
  interface Window {
    hermes: {
      readonly extensionId: string
      readonly language: string
      readonly theme: "light" | "dark"
      ipc: {
        invoke<T>(channel: string, args?: unknown): Promise<T>
      }
      settings: {
        get<T>(key: string, fallback: T): Promise<T>
        set(key: string, value: unknown): Promise<void>
      }
      shell: {
        openExternal(url: string): Promise<void>
      }
      on(event: "language" | "theme", cb: (value: string) => void): () => void
    }
  }
}

export const hermes = window.hermes
