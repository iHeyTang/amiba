/**
 * Desktop pet page entry.
 *
 * Boots a minimal page instead of the DSH shell: installs the Electron
 * platform adapter (from the preload bridge — no DSH client needed) and
 * renders the same `DesktopPet` surface as the old shell-hosted slot, fed by
 * the MAIN-PROCESS DSH state subscription layer's snapshot (`dshState`),
 * which keeps producing data even when the main window is closed.
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
// Single shared contract: the pet page subscribes to the same main-process
// snapshot every other Amiba window renders.
const dshState = window.amiba.dshState;
createRoot(root).render(
  <DesktopPet
    library={createPetPageLibrary(dshState)}
    notifications={createPetPageFeed(dshState)}
  />,
);