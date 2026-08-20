import { setPlatform } from "@amiba/app-runtime/platform"
import { seedDocumentLanguage } from "@amiba/i18n"
import React from "react"
import { createRoot } from "react-dom/client"

import { createElectronAdapter } from "../platform/electron"
import "../styles/globals.css"
import { NotifierView } from "./NotifierView"

// The notifier runs in its own renderer process, so it needs the same
// storage-backed platform setup as the main and Quick-Ask windows. This keeps
// its light/dark mode and accent preference in sync with Amiba.
setPlatform(createElectronAdapter())
// Like Quick Ask, this window boots no DSH Client plugin graph: the
// runtime-ABSENT case, where the browser-derived language is the answer.
seedDocumentLanguage()

const root = document.getElementById("root")
if (!root) throw new Error("root element missing")

createRoot(root).render(
  <React.StrictMode>
    <NotifierView />
  </React.StrictMode>
)
