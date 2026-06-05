/**
 * The host extension-API contract level this SDK targets. Monotonic
 * integer — bump on ANY breaking change to the extension-facing surface
 * (MainHost / WebViewHostAPI / manifest schema). Extensions declare the
 * minimum level they need via `manifest.apiVersion`; the host gates on
 * `apiVersion <= HOST_API_VERSION`.
 */
export const API_VERSION = 1
