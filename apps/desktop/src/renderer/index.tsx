import { setPlatform } from "@hermes-x/platform"
import React from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import { createElectronAdapter } from "./platform/electron"
import { installImportMap } from "./setup-importmap"
import "./styles/globals.css"

// Must run before any dynamic import of an extension bundle. The map
// resolves bare specifiers (react, @hermes-x/*) the extension's externalised
// build expects — see setup-importmap.ts for the why.
installImportMap()
setPlatform(createElectronAdapter())

const root = document.getElementById("root")
if (!root) throw new Error("root element missing")

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
