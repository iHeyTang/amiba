import { setPlatform } from "@amiba/platform"
import React from "react"
import { createRoot } from "react-dom/client"

import App from "./App"
import { createElectronAdapter } from "./platform/electron"
import "./styles/globals.css"

setPlatform(createElectronAdapter())

const root = document.getElementById("root")
if (!root) throw new Error("root element missing")

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
