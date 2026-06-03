import { contextBridge, ipcRenderer, webUtils } from "electron"

// Node EventEmitter defaults `maxListeners` to 10. Each Hermes window
// stacks more than that on a few high-fan-out IPC channels (storage,
// workspace, chat, notifier, quick-ask) because every React hook that
// observes state — `useQuickActions`, `useCronRuns`, `useWallpaper`,
// `useResume`, the platform adapter's `storage.watch`, … — adds its
// own listener on top of the shared `ipcRenderer`. Without bumping
// the cap Electron logs "MaxListenersExceededWarning" on every fresh
// mount of the main window, and the warnings drown out real bugs.
// `0` = unlimited; we'd rather chase real leaks via the cleanup
// effects than treat the 10-listener line as load-bearing.
ipcRenderer.setMaxListeners(0)

type StorageChange = { oldValue?: unknown; newValue?: unknown }
type StorageChangeMap = Record<string, StorageChange>

type WorkspaceChange =
  | { kind: "bound"; sessionId: string; path: string }
  | { kind: "unbound"; sessionId: string }

// Mirrors @hermes-x/core protocol types — kept loose here so preload
// stays runtime-only without pulling the core package into the browser
// context's preload classpath.
type ChatClientMessage = unknown
type ChatEngineMessage = unknown

const api = {
  storage: {
    get: (keys?: string | string[]) => ipcRenderer.invoke("storage:get", keys),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("storage:set", patch),
    remove: (keys: string | string[]) => ipcRenderer.invoke("storage:remove", keys),
    onChanged: (cb: (changes: StorageChangeMap) => void) => {
      const handler = (_e: unknown, changes: StorageChangeMap) => cb(changes)
      ipcRenderer.on("storage:changed", handler)
      return () => ipcRenderer.off("storage:changed", handler)
    }
  },

  chat: {
    /** Send any ClientToEngineMessage to the main-process chat engine. */
    send: (msg: ChatClientMessage) => ipcRenderer.invoke("chat:client-to-engine", msg),
    /** Subscribe to engine → client frames (events + snapshots). */
    onMessage: (cb: (msg: ChatEngineMessage) => void) => {
      const handler = (_e: unknown, msg: ChatEngineMessage) => cb(msg)
      ipcRenderer.on("chat:engine-to-client", handler)
      return () => ipcRenderer.off("chat:engine-to-client", handler)
    }
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke("shell:open-external", url)
  },

  /**
   * Workspace binding bridge. A bound directory gives the chat session
   * filesystem context; changes inside that tree are pushed back via
   * `onChanged` so the renderer can re-render the indicator and (later)
   * surface a "files changed" cue. `getPathForFile` exposes Electron 33's
   * webUtils so the renderer can resolve a dropped folder's absolute path
   * (the legacy `File.path` field is gone).
   */
  workspaces: {
    bind: (sessionId: string, p: string): Promise<void> =>
      ipcRenderer.invoke("workspace:bind", { sessionId, path: p }),
    unbind: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke("workspace:unbind", sessionId),
    getCurrent: (sessionId: string): Promise<string | null> =>
      ipcRenderer.invoke("workspace:get-current", sessionId),
    onChanged: (cb: (change: WorkspaceChange) => void) => {
      const handler = (_e: unknown, change: WorkspaceChange) => cb(change)
      ipcRenderer.on("workspace:changed", handler)
      return () => ipcRenderer.off("workspace:changed", handler)
    },
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },

  /**
   * Heads-up Notifier bridge. The notifier renderer (bottom-right floating
   * window) listens for `notifier:message` pushes from main and sends
   * approve/deny/activate-main back over their own channels.
   */
  /**
   * Spotlight-style Quick-Ask popup bridge. Main fires `prefill` after
   * summon (with the captured selection + source app name); renderer
   * sends `dismiss` / `resize` back. `submit` / `abort` go through the
   * existing `chat.*` channel — the popup uses the same chat engine as
   * the main window, just with its own session id.
   */
  quickAsk: {
    onPrefill: (
      cb: (payload: { text: string; sourceApp: string }) => void,
    ) => {
      const handler = (
        _e: unknown,
        payload: { text: string; sourceApp: string },
      ) => cb(payload)
      ipcRenderer.on("quick-ask:prefill", handler)
      return () => ipcRenderer.off("quick-ask:prefill", handler)
    },
    dismiss: () => ipcRenderer.invoke("quick-ask:dismiss"),
    resize: (contentHeightPx: number) =>
      ipcRenderer.invoke("quick-ask:resize", contentHeightPx),
  },

  /**
   * Microphone access helpers. ``ensureAccess()`` is a thin wrapper
   * around ``systemPreferences.askForMediaAccess`` in main — call it
   * before ``getUserMedia`` so on macOS the OS dialog fires the first
   * time and the cached decision is returned afterwards.
   */
  voice: {
    ensureMicrophoneAccess: (): Promise<
      "granted" | "denied" | "restricted" | "not-determined" | "unknown"
    > => ipcRenderer.invoke("voice:ensure-microphone-access"),
  },

  notifier: {
    onMessage: (cb: (msg: unknown) => void) => {
      const handler = (_e: unknown, msg: unknown) => cb(msg)
      ipcRenderer.on("notifier:message", handler)
      return () => ipcRenderer.off("notifier:message", handler)
    },
    activateMain: () => ipcRenderer.invoke("notifier:activate-main"),
    approve: (approvalId: string) =>
      ipcRenderer.invoke("notifier:approve", approvalId),
    deny: (approvalId: string) => ipcRenderer.invoke("notifier:deny", approvalId),
    /**
     * Fire a demo notifier card so the user can confirm the floating
     * window appears and clicks register. Call from the main window's
     * devtools console:
     *   window.hermes.notifier.demo()                  // cron card
     *   window.hermes.notifier.demo("approval-pending") // approval card
     */
    demo: (kind?: "cron-completed" | "approval-pending") =>
      ipcRenderer.invoke("notifier:demo", kind),
  },

  gbrain: {
    health: (): Promise<{ status: string; version?: string } | null> =>
      ipcRenderer.invoke("gbrain:health"),
    call: <T = unknown>(tool: string, args?: Record<string, unknown>): Promise<T> =>
      ipcRenderer.invoke("gbrain:call", { tool, args }),
    /**
     * Authenticated probe — runs the MCP `initialize` handshake against
     * the configured URL+token. Use this from "Test Connection" so an
     * invalid token surfaces immediately rather than at first tool call.
     */
    verifyAuth: (): Promise<
      | { ok: true }
      | { ok: false; reason: "invalid-token" | "other"; error: string }
    > => ipcRenderer.invoke("gbrain:verify-auth"),
    /**
     * Dynamic provider list. Shells out to `gbrain providers list` in
     * the main process — gbrain's recipe registry isn't surfaced over
     * MCP, so this is the only way to enumerate what gbrain actually
     * supports without hard-coding a stale mirror in the renderer.
     */
    providers: {
      list: (): Promise<{
        ok: boolean
        providers?: Array<{
          id: string
          tier: string
          embed: string
          expand: string
          chat: string
          ready: boolean
          missing_env?: string
          status_raw: string
        }>
        binary: string
        error?: string
      }> => ipcRenderer.invoke("gbrain:providers:list"),
      /**
       * Fetch one provider's env schema via `gbrain providers env <id>`.
       * Returns `required[]` + `optional[]` + `setupUrl` parsed from
       * the CLI stdout. UI uses this to render per-key Input fields.
       */
      env: (
        id: string,
      ): Promise<{
        ok: boolean
        schema?: { required: string[]; optional: string[]; setupUrl?: string }
        binary: string
        error?: string
      }> => ipcRenderer.invoke("gbrain:providers:env", id),
      /**
       * Read/write per-provider env-var overrides. Values live encrypted
       * in `~/.hermes/provider-env.json` (Electron safeStorage) and are
       * merged on top of `process.env` when the launcher spawns gbrain.
       * `list` returns the *keys* only — the UI shows "saved" indicators,
       * never re-displays the secret.
       */
      overrides: {
        list: (): Promise<{
          ok: boolean
          overrides?: Record<string, string[]>
          error?: string
        }> => ipcRenderer.invoke("gbrain:providers:overrides:list"),
        set: (
          providerId: string,
          envKey: string,
          value: string,
        ): Promise<{ ok: boolean; error?: string }> =>
          ipcRenderer.invoke("gbrain:providers:overrides:set", {
            providerId,
            envKey,
            value,
          }),
        unset: (
          providerId: string,
          envKey: string,
        ): Promise<{ ok: boolean; error?: string }> =>
          ipcRenderer.invoke("gbrain:providers:overrides:unset", {
            providerId,
            envKey,
          }),
      },
    },
    /**
     * "Make sure `gbrain serve --http` is up." Probes /health first; if
     * already running returns immediately. Otherwise spawns the daemon
     * detached and polls until ready (or up to 8s). Concurrent callers
     * share a single in-flight spawn in the main process.
     */
    launcher: {
      ensure: (): Promise<{
        ok: boolean
        started: boolean
        alreadyRunning: boolean
        binary: string
        pid?: number
        error?: string
      }> => ipcRenderer.invoke("gbrain:launcher:ensure"),
      /**
       * Hard-restart `gbrain serve --http`: kills the listener on the
       * configured port (if any) and respawns. Use when /health is fine
       * but auth is failing — likely the server is holding a stale brain
       * DB handle after a recovery/migration.
       */
      restart: (): Promise<{
        ok: boolean
        started: boolean
        alreadyRunning: boolean
        binary: string
        pid?: number
        error?: string
      }> => ipcRenderer.invoke("gbrain:launcher:restart"),
    },
  },

  /**
   * Hermes-agent lifecycle bridge — drives the first-run install wizard
   * and the supervised backplane subprocess. Logs from long-running
   * spawns stream back via `onJobLog`; completion lands in `onJobEnd`.
   */
  hermesRuntime: {
    detect: (): Promise<{ installed: boolean; binary?: string; version?: string }> =>
      ipcRenderer.invoke("hermes:detect"),
    install: (): Promise<{ id: string; pid: number | undefined }> =>
      ipcRenderer.invoke("hermes:install"),
    /**
     * Same install command, but spawned under a PTY so the embedded
     * `hermes setup` wizard sees a real terminal. Output arrives as raw
     * chunks via `onPtyData`; keystrokes from xterm.js go back through
     * `ptyInput`. Completion still lands on `onJobEnd`.
     */
    installPty: (): Promise<{ id: string; pid: number }> =>
      ipcRenderer.invoke("hermes:install-pty"),
    installPlugin: (
      args: { binary: string; pluginId: string },
    ): Promise<{ id: string; pid: number | undefined }> =>
      ipcRenderer.invoke("hermes:install-plugin", args),
    startBackplane: (
      args: { binary: string },
    ): Promise<{ id: string; pid: number | undefined; alreadyRunning: boolean }> =>
      ipcRenderer.invoke("hermes:start-backplane", args),
    stopBackplane: (): Promise<boolean> => ipcRenderer.invoke("hermes:stop-backplane"),
    cancelJob: (jobId: string): Promise<boolean> =>
      ipcRenderer.invoke("hermes:cancel-job", jobId),
    ptyInput: (args: { jobId: string; data: string }): Promise<boolean> =>
      ipcRenderer.invoke("hermes:pty-input", args),
    ptyResize: (args: { jobId: string; cols: number; rows: number }): Promise<boolean> =>
      ipcRenderer.invoke("hermes:pty-resize", args),
    requiredPlugins: (): Promise<readonly string[]> =>
      ipcRenderer.invoke("hermes:required-plugins"),
    installedPlugins: (): Promise<readonly string[]> =>
      ipcRenderer.invoke("hermes:installed-plugins"),
    installDisplayCommand: (): Promise<string> =>
      ipcRenderer.invoke("hermes:install-display-command"),
    onJobLog: (
      cb: (msg: { jobId: string; stream: "stdout" | "stderr"; line: string }) => void,
    ) => {
      const handler = (_e: unknown, msg: { jobId: string; stream: "stdout" | "stderr"; line: string }) => cb(msg)
      ipcRenderer.on("hermes:job-log", handler)
      return () => ipcRenderer.off("hermes:job-log", handler)
    },
    onJobEnd: (
      cb: (msg: { jobId: string; exitCode: number | null; error?: string }) => void,
    ) => {
      const handler = (_e: unknown, msg: { jobId: string; exitCode: number | null; error?: string }) => cb(msg)
      ipcRenderer.on("hermes:job-end", handler)
      return () => ipcRenderer.off("hermes:job-end", handler)
    },
    onPtyData: (cb: (msg: { jobId: string; data: string }) => void) => {
      const handler = (_e: unknown, msg: { jobId: string; data: string }) => cb(msg)
      ipcRenderer.on("hermes:pty-data", handler)
      return () => ipcRenderer.off("hermes:pty-data", handler)
    },
  },
}

contextBridge.exposeInMainWorld("hermes", api)

export type HermesBridge = typeof api
