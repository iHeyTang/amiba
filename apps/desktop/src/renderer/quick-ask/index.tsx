import { setPlatform } from "@hermes-x/platform"
import React from "react"
import { createRoot } from "react-dom/client"

import { createElectronAdapter } from "../platform/electron"
import "../styles/globals.css"
import { QuickAskView } from "./QuickAskView"

// Each BrowserWindow has its OWN renderer process — the main window's
// `setPlatform()` call in `renderer/index.tsx` does not carry over. The
// Quick-Ask popup must initialise its own PlatformAdapter before any
// hook (`useQuickActions`, `useComposerAttachments`, etc.) runs, or
// `getPlatform()` throws "PlatformAdapter not initialized" the moment
// React mounts and the renderer crashes to a blank window.
setPlatform(createElectronAdapter())

const root = document.getElementById("root")
if (!root) throw new Error("root element missing")

createRoot(root).render(
  <React.StrictMode>
    <QuickAskView />
  </React.StrictMode>,
)
