interface StartupScreenProps {
  leaving?: boolean
  message: string
  showStatus?: boolean
}

/**
 * The living bridge between Electron's first paint and the ready application.
 *
 * Its DOM mirrors the critical shell in index.html so React can take over
 * without replacing a blank page with a visibly different loading state.
 */
export function StartupScreen({
  leaving = false,
  message,
  showStatus = false,
}: StartupScreenProps) {
  return (
    <div
      className="amiba-startup-screen app-drag-region"
      data-leaving={leaving ? "true" : "false"}
      aria-live="polite"
      aria-busy={!leaving}
    >
      <div className="amiba-startup-content">
        <div className="amiba-startup-mark" aria-hidden="true">
          <span className="amiba-startup-signal amiba-startup-signal-one" />
          <span className="amiba-startup-signal amiba-startup-signal-two" />
          <span className="amiba-startup-membrane" />
          <span className="amiba-startup-nucleus" />
        </div>

        <div className="amiba-startup-copy">
          <span className="amiba-startup-wordmark">Amiba</span>
          <span
            className="amiba-startup-status"
            data-visible={showStatus && !leaving ? "true" : "false"}
          >
            {message}
            <span className="amiba-startup-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
