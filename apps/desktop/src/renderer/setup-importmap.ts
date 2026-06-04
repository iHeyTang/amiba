/**
 * Populate `globalThis.__hermesShared` with the renderer's own copies of
 * shared modules (React, @hermes-x/*). Trampoline modules served by the
 * main process under `hermes-shared://<specifier>` re-export from this
 * object — which is what the static <script type="importmap"> entry in
 * `index.html` points each bare specifier at.
 *
 * Critical invariant: the React instance an extension component pulls
 * via `import { useState } from "react"` MUST be the same React instance
 * the host renderer uses, or hooks throw "Invalid hook call." Exposing
 * desktop's own React on the global guarantees that.
 *
 * This runs BEFORE any extension import (called at the top of index.tsx).
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

export function installImportMap(): void {
  ;(globalThis as unknown as { __hermesShared: typeof SHARED }).__hermesShared =
    SHARED
}
