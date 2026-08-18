import { SessionsProvider } from "@amiba/app-runtime/core";
import { DshApiClient } from "@amiba/app-runtime/dsh-client";
import { setPlatform } from "@amiba/app-runtime/platform";
import React from "react";
import { createRoot } from "react-dom/client";

import { createElectronAdapter } from "../platform/electron";
import { installDshClientTransport } from "../dsh-client-transport";
import "../styles/globals.css";
import { QuickAskView } from "./QuickAskView";

const root = document.getElementById("root");
if (!root) throw new Error("root element missing");

// SessionsProvider drives ``useSessions()`` inside ChatSurface — Quick-
// Ask reuses the same multi-session runtime as the main window. The two
// renderers each instantiate their own provider, but they share the
// underlying SessionDB index via the platform-storage broadcast, so a
// session created in Quick-Ask propagates into the main window's history
// drawer the next refresh tick.
void (async () => {
  try {
    // Each BrowserWindow owns a separate renderer. Quick Ask therefore joins
    // the same DSH Client graph through the generic Electron transport before
    // any shared UI hook reads the platform contract.
    const boot = await window.amiba.dshClient.boot();
    installDshClientTransport(boot.baseUrl);
    const dshClient = new DshApiClient({ baseUrl: boot.baseUrl });
    setPlatform(createElectronAdapter(dshClient));
    createRoot(root).render(
      <React.StrictMode>
        <SessionsProvider>
          <QuickAskView dshClient={dshClient} />
        </SessionsProvider>
      </React.StrictMode>,
    );
  } catch (error) {
    const failure = document.createElement("pre");
    failure.className = "p-4 text-sm text-destructive whitespace-pre-wrap";
    failure.textContent = error instanceof Error ? error.message : String(error);
    root.replaceChildren(failure);
  }
})();
