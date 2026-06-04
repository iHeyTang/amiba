/**
 * `hermes-shared://<specifier>` — serves a small ESM "trampoline" module for
 * each shared dependency name. The trampoline does
 *
 *   export const useState = globalThis.__hermesShared["react"].useState;
 *   ...
 *
 * for every named export the module is known to expose. The runtime value
 * is whatever `setup-importmap.ts` placed on `globalThis.__hermesShared` —
 * the desktop's own React, our @hermes-x packages, etc. Hooks therefore see
 * the same React instance as the host renderer.
 *
 * The named-export lists are hardcoded here because ESM can't generate
 * `export` bindings at module-evaluation time. React-family lists pinned to
 * the versions in apps/desktop/package.json (React 18.3.1).
 */
import { protocol } from "electron"

const SCHEME = "hermes-shared"

/**
 * Exports per shared module. When you add a new shared package or update
 * React/ReactDOM major versions, sync this list with the package's public
 * API. Anything missing here will throw "x is not exported" at extension
 * load time.
 */
const EXPORTS: Record<string, readonly string[]> = {
  react: [
    "useState",
    "useEffect",
    "useLayoutEffect",
    "useInsertionEffect",
    "useContext",
    "useReducer",
    "useCallback",
    "useMemo",
    "useRef",
    "useImperativeHandle",
    "useDebugValue",
    "useTransition",
    "useDeferredValue",
    "useId",
    "useSyncExternalStore",
    "createElement",
    "cloneElement",
    "createContext",
    "createRef",
    "Fragment",
    "StrictMode",
    "Suspense",
    "Profiler",
    "Component",
    "PureComponent",
    "forwardRef",
    "memo",
    "lazy",
    "isValidElement",
    "Children",
    "startTransition",
    "version",
  ],
  "react/jsx-runtime": ["jsx", "jsxs", "Fragment"],
  "react/jsx-dev-runtime": ["jsxDEV", "Fragment"],
  "react-dom": [
    "createPortal",
    "flushSync",
    "render",
    "hydrate",
    "unmountComponentAtNode",
    "findDOMNode",
    "unstable_batchedUpdates",
    "version",
  ],
  "react-dom/client": ["createRoot", "hydrateRoot"],
  // Build-time named exports of packages/extension-host/src/renderer/index.ts
  "@hermes-x/extension-host/renderer": [
    "createSlotRegistry",
    "SlotOutlet",
    "SingleSlotOutlet",
    "SlotRegistryProvider",
    "useSlotRegistry",
    "makeRendererHost",
    "discoverRendererExtensions",
    "useI18n",
    "bootRendererExtensions",
    "useExtensionSettingsTabs",
    "useActivityBarItems",
    "useExtensionRegistry",
  ],
  // @hermes-x/extension-api is types-only at runtime; nothing to re-export.
  "@hermes-x/extension-api": [],
  // @hermes-x/i18n exports
  "@hermes-x/i18n": [
    "useT",
    "useStoredLanguagePreference",
    "loadLanguagePreference",
    "saveLanguagePreference",
    "resolveLanguage",
    "getCurrentLanguage",
    "subscribeLanguage",
    "LANG_PREF_STORAGE_KEY",
    "DEFAULT_LANGUAGE_PREFERENCE",
  ],
  // @hermes-x/platform exports
  "@hermes-x/platform": [
    "getPlatform",
    "setPlatform",
  ],
  // @hermes-x/ui — too many components; we re-export the ones knowledge-base
  // uses today and add more on demand. (Run the diagnostic in the comment
  // below to refresh.)
  //
  //   node -e "const m = await import('@hermes-x/ui'); console.log(Object.keys(m).join('\n'))"
  "@hermes-x/ui": [
    "Button",
    "Dialog",
    "DialogContent",
    "DialogFooter",
    "DialogHeader",
    "DialogTitle",
    "DialogDescription",
    "HermesLogo",
    "Input",
    "Label",
    "ScrollArea",
    "Separator",
    "Textarea",
    "cn",
  ],
}

/** Allowed scheme list. Call before app.whenReady(). */
export function registerSharedProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

/** Handler registration. Call after app.whenReady(). */
export function registerSharedProtocolHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response("invalid URL", { status: 400 })
    }
    // For hermes-shared://react the specifier is the host. URL parsing
    // lowercases the host, so we keep the lookup case-insensitive.
    // We also support hermes-shared://react/jsx-runtime form (path appended).
    const host = url.hostname
    const path = url.pathname.replace(/^\/+/, "")
    const specifier = path ? `${host}/${path}` : host
    const exportNames = EXPORTS[specifier]
    if (!exportNames) {
      return new Response(
        `unknown shared module: ${specifier}`,
        { status: 404 },
      )
    }

    const jsonSpec = JSON.stringify(specifier)
    const lines = [
      `const m = globalThis.__hermesShared[${jsonSpec}];`,
      `if (!m) throw new Error(${JSON.stringify(`hermes-shared: ${specifier} not initialised on globalThis.__hermesShared`)});`,
      ...exportNames.map(
        (name) => `export const ${name} = m[${JSON.stringify(name)}];`,
      ),
      `export default m.default ?? m;`,
    ]
    const src = lines.join("\n")

    return new Response(src, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store",
      },
    })
  })
}

/**
 * Build the import map JSON that index.html injects statically — a plain
 * mapping of bare specifier → hermes-shared URL for every module in EXPORTS.
 * Surfaces as a helper because the renderer's setup-importmap.ts isn't
 * what writes it any more, the static HTML is.
 *
 * Currently unused at runtime (the map is hardcoded in index.html), but
 * kept for tests / docs / future code-gen.
 */
export function buildImportMap(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const specifier of Object.keys(EXPORTS)) {
    if (EXPORTS[specifier]!.length === 0) continue
    out[specifier] = `${SCHEME}://${specifier}`
  }
  return out
}
