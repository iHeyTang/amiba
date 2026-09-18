import { SessionsProvider } from "@amiba/app-runtime/core";
import { setPlatform } from "@amiba/app-runtime/platform";
import { seedDocumentLanguage } from "@amiba/i18n";
import React from "react";
import { createRoot } from "react-dom/client";

import { createElectronAdapter } from "../platform/electron";
import { installWindowMessages } from "../locales";
import "../styles/globals.css";
import { QuickAskView } from "./QuickAskView";

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

try {
  // Quick-Ask is a PURE VIEW: no DSH client boot, no transport install, no
  // window-local DSH connection. The chat engine, the conversation data plane
  // (sessions/workspaces/models) and the shared state snapshot all live in
  // the MAIN process and are reached through `window.amiba` — this window
  // only renders and routes interactions.
  setPlatform(createElectronAdapter());
  // Quick Ask boots NO DSH Client plugin graph — no Web Shell scripts, so no
  // `ctx.locale` and no official locale service in this window. It is the
  // runtime-ABSENT case of the two `@amiba/i18n` documents: the
  // browser-derived language is published into the document contract here so
  // the window carries a truthful `lang` from its first paint instead of
  // index.html's static `lang="en"`.
  seedDocumentLanguage();
  // …and the other half of the runtime-less contract: with no `ctx.locale`
  // in this realm nothing would ever register Amiba's copy, so this window
  // installs the catalogs itself. The dictionary IS in this bundle, by
  // design — that exception is what the plugin bundles no longer pay for.
  installWindowMessages();
  // `SessionsProvider` still owns this window's VIEW state (which session the
  // popup is showing, its open tabs, the cached messages) while every piece
  // of data it reads comes from the main process over IPC, so a session
  // created here appears in the main window's history immediately.
  createRoot(root).render(
    <React.StrictMode>
      <SessionsProvider>
        <QuickAskView />
      </SessionsProvider>
    </React.StrictMode>,
  );
} catch (error) {
  const failure = document.createElement("pre");
  failure.className = "p-4 text-sm text-destructive whitespace-pre-wrap";
  failure.textContent = error instanceof Error ? error.message : String(error);
  root.replaceChildren(failure);
}