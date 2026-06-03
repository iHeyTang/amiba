/**
 * Inject an import map so dynamically imported extension bundles can resolve
 * bare specifiers like `react`, `@hermes-x/ui`, etc.
 *
 * Background: when the Phase 2 loader does `import("file:///<userData>/extensions/<id>/dist/renderer.js")`,
 * that bundle was built with these modules as `external` (so we ship them
 * once, in the desktop). The desktop's own bundle has already loaded the
 * real modules; we expose those instances on `globalThis.__hermesShared`
 * and use a trampoline JS blob per specifier — the import map points the
 * bare specifier at the blob URL, which re-exports everything off
 * `__hermesShared` so extensions get the *same* module instance the host
 * uses (critical for React: any second React instance breaks hooks).
 *
 * Chrome 108+ allows multiple import maps and adding them dynamically, so
 * inserting one after page bundle load is fine. Electron 33 ships
 * Chromium 130.
 */
import * as React from "react"
import * as ReactJsxRuntime from "react/jsx-runtime"
import * as ReactDOM from "react-dom"
import * as ReactDOMClient from "react-dom/client"
import * as HermesExtensionApi from "@hermes-x/extension-api"
import * as HermesExtensionHostRenderer from "@hermes-x/extension-host/renderer"
import * as HermesI18n from "@hermes-x/i18n"
import * as HermesPlatform from "@hermes-x/platform"
import * as HermesUI from "@hermes-x/ui"

type SharedModule = Record<string, unknown> & { default?: unknown }

const SHARED: Record<string, SharedModule> = {
  react: React as unknown as SharedModule,
  "react/jsx-runtime": ReactJsxRuntime as unknown as SharedModule,
  "react-dom": ReactDOM as unknown as SharedModule,
  "react-dom/client": ReactDOMClient as unknown as SharedModule,
  "@hermes-x/extension-api": HermesExtensionApi as unknown as SharedModule,
  "@hermes-x/extension-host/renderer": HermesExtensionHostRenderer as unknown as SharedModule,
  "@hermes-x/i18n": HermesI18n as unknown as SharedModule,
  "@hermes-x/platform": HermesPlatform as unknown as SharedModule,
  "@hermes-x/ui": HermesUI as unknown as SharedModule,
}

;(globalThis as unknown as { __hermesShared: typeof SHARED }).__hermesShared = SHARED

function makeTrampolineUrl(specifier: string, mod: SharedModule): string {
  // Re-export every named binding. We list them explicitly so importers
  // can do `import { useState } from "react"` and get the real value
  // rather than going through a default proxy.
  const exportNames = Object.keys(mod).filter((k) => k !== "default")
  const json = JSON.stringify(specifier)
  const namedExports = exportNames
    .map((name) => `export const ${name} = m[${JSON.stringify(name)}];`)
    .join("\n")
  const src = [
    `const m = globalThis.__hermesShared[${json}];`,
    `if (!m) throw new Error(${JSON.stringify(`hermes shared module missing: ${specifier}`)});`,
    namedExports,
    `export default m.default ?? m;`,
  ].join("\n")
  const blob = new Blob([src], { type: "application/javascript" })
  return URL.createObjectURL(blob)
}

let installed = false

export function installImportMap(): void {
  if (installed) return
  installed = true

  const imports: Record<string, string> = {}
  for (const specifier of Object.keys(SHARED)) {
    const mod = SHARED[specifier]
    if (!mod) continue
    imports[specifier] = makeTrampolineUrl(specifier, mod)
  }

  const script = document.createElement("script")
  script.type = "importmap"
  script.textContent = JSON.stringify({ imports })
  document.head.appendChild(script)
}
