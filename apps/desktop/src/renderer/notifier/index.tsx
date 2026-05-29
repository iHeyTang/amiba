import React from "react"
import { createRoot } from "react-dom/client"

import "../styles/globals.css"
import { NotifierView } from "./NotifierView"

const root = document.getElementById("root")
if (!root) throw new Error("root element missing")

createRoot(root).render(
  <React.StrictMode>
    <NotifierView />
  </React.StrictMode>
)
