import { setPlatform } from "@amiba/app-runtime/platform"
import { seedDocumentLanguage } from "@amiba/i18n"
import React from "react"
import { createRoot } from "react-dom/client"

import { createElectronAdapter } from "../platform/electron"
import { installWindowMessages } from "../locales"
import "../styles/globals.css"
import { NotifierView } from "./NotifierView"

// The notifier runs in its own renderer process, so it needs the same
// storage-backed platform setup as the main and Quick-Ask windows. This keeps
// its light/dark mode and accent preference in sync with Amiba.
setPlatform(createElectronAdapter())
// Like Quick Ask, this window boots no DSH Client plugin graph: the
// runtime-ABSENT case, where the browser-derived language is the answer.
seedDocumentLanguage()
// …and, for the same reason, nothing in this realm would ever register Amiba's
// copy with a locale service, so the window installs the catalogs itself. The
// dictionary IS in this bundle, by design — that exception is what the plugin
// bundles no longer pay for.
installWindowMessages()

const root = document.getElementById("root")
if (!root) throw new Error("root element missing")

createRoot(root).render(
  <React.StrictMode>
    <NotifierView />
  </React.StrictMode>
)
