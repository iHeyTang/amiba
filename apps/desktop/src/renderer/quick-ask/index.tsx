import { SessionsProvider } from "@hermes-x/core"
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

// SessionsProvider drives ``useSessions()`` inside ChatSurface — Quick-
// Ask reuses the same multi-session runtime as the main window. The two
// renderers each instantiate their own provider, but they share the
// underlying SessionDB index via the platform-storage broadcast, so a
// session created in Quick-Ask propagates into the main window's history
// drawer the next refresh tick.
createRoot(root).render(
  <React.StrictMode>
    <SessionsProvider>
      <QuickAskView />
    </SessionsProvider>
  </React.StrictMode>,
)
