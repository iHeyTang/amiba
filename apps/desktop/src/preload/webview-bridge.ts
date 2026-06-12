/**
 * Entry point for the webview bridge preload bundle.
 * Bundled to `out/preload/webview-bridge.js` by electron-vite.
 * Injected into every extension WebView (http://127.0.0.1:<port>/extensions/<id>/<view>).
 */
export * from "@amiba/extension-host/webview-preload"
