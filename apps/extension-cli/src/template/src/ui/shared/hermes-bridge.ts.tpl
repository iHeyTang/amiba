// Re-export the host bridge with a typed shape.
// window.hermes is injected by the webview preload — see hermes-x docs.

interface HermesBridge {
  readonly extensionId: string
  readonly language: string
  readonly theme: "light" | "dark"
  ipc: {
    invoke<T = unknown>(channel: string, args?: unknown): Promise<T>
  }
  settings: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
  on(event: "language" | "theme", cb: (value: string) => void): () => void
}

export const hermes = (window as unknown as { hermes: HermesBridge }).hermes
