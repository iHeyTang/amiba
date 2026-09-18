/**
 * Desktop pet page entry.
 *
 * Boots a minimal page instead of the DSH shell: installs the Electron
 * platform adapter (from the preload bridge — no DSH client needed) and
 * renders the same `DesktopPet` surface as the old shell-hosted slot, fed by
 * snapshots the main window's pets plugin forwards over IPC.
 */
import { createRoot } from "react-dom/client";
import { setPlatform } from "@amiba/app-runtime/platform";
import { DesktopPet } from "@amiba/dsh-plugin-pets/pet";
import { createElectronAdapter } from "../platform/electron.js";
import { createPetPageFeed, createPetPageLibrary } from "./stores.js";
import "../styles/globals.css";

// The pet page has no DSH locale service; seed the same browser-derived
// language the main renderer uses so plugin labels render localized.
document.documentElement.lang = navigator.language.startsWith("zh")
  ? "zh-CN"
  : "en";

setPlatform(createElectronAdapter());

const root = document.getElementById("root");
if (!root) throw new Error("pet root element missing");
const bridge = window.amiba.desktopPet;
createRoot(root).render(
  <DesktopPet
    library={createPetPageLibrary(bridge)}
    notifications={createPetPageFeed(bridge)}
  />,
);