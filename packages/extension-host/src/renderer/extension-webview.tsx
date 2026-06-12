/**
 * ExtensionWebView — wraps an Electron `<webview>` tag pointing at the
 * extension's loopback HTTP view URL
 * (http://127.0.0.1:<port>/extensions/<id>/<view>, served by ext-http-server).
 *
 * The webview preload (`out/preload/webview-bridge.js`) is injected via the
 * `preload` attribute. Its path is fetched once at React boot from
 * `window.amiba.getWebviewPreloadPath()` and cached module-level.
 *
 * Session is scoped to `persist:amiba-extensions` so extension cookies /
 * localStorage are isolated from the main renderer but shared across all
 * extension webviews in the same app session.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react"

import { desktopBridge } from "./bridge"

// ---------------------------------------------------------------------------
// Module-level preload path cache
// ---------------------------------------------------------------------------

let preloadPathCache: string | null = null
let preloadPathPromise: Promise<string> | null = null

function getPreloadPath(): Promise<string> {
  if (preloadPathCache) return Promise.resolve(preloadPathCache)
  if (preloadPathPromise) return preloadPathPromise
  preloadPathPromise = (
    desktopBridge().getWebviewPreloadPath()
  ).then((p) => {
    preloadPathCache = p
    return p
  })
  return preloadPathPromise
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ExtensionWebViewProps {
  /** http://127.0.0.1:<port>/extensions/<extensionId>/<view-path> URL */
  src: string
  className?: string
  style?: CSSProperties
}

/**
 * React wrapper for the Electron `<webview>` element. The `<webview>` tag is
 * not a standard DOM element so we create it via a ref and set its attributes
 * imperatively to avoid TypeScript / JSX type complaints.
 */
export function ExtensionWebView({ src, className, style }: ExtensionWebViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [preloadPath, setPreloadPath] = useState<string | null>(preloadPathCache)

  // Resolve preload path on first render if not yet cached.
  useEffect(() => {
    if (preloadPath) return
    void getPreloadPath().then(setPreloadPath)
  }, [preloadPath])

  // Create / update the <webview> element once we have the preload path.
  useEffect(() => {
    if (!preloadPath || !containerRef.current) return

    // Remove any previous webview.
    const container = containerRef.current
    while (container.firstChild) container.removeChild(container.firstChild)

    const wv = document.createElement("webview")
    wv.setAttribute("src", src)
    wv.setAttribute("preload", `file://${preloadPath}`)
    // nodeintegration must be the string "false" — boolean attributes in
    // webview land behave differently from standard HTML.
    wv.setAttribute("nodeintegration", "false")
    wv.setAttribute("contextIsolation", "true")
    wv.setAttribute("allowpopups", "false")
    wv.setAttribute("partition", "persist:amiba-extensions")
    wv.style.width = "100%"
    wv.style.height = "100%"
    wv.style.border = "none"

    container.appendChild(wv)

    return () => {
      try {
        container.removeChild(wv)
      } catch {
        // Already removed (e.g. parent unmount beat the cleanup).
      }
    }
  }, [src, preloadPath])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: "100%", height: "100%", ...style }}
    />
  )
}
