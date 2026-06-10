import { homedir, platform } from "node:os"
import { join } from "node:path"

const APP_NAME = "Hermes" // matches apps/desktop/package.json's build.productName

/**
 * Resolve where the desktop reads its extensions from at runtime.
 *
 * Honours AMIBA_DEV_EXTENSIONS_PATH override (same env var the desktop
 * itself respects), otherwise uses Electron's standard userData location:
 *   macOS:   ~/Library/Application Support/Hermes/extensions/
 *   Linux:   ~/.config/Hermes/extensions/
 *   Windows: %APPDATA%/Hermes/extensions/
 */
export function resolveExtensionsDir(): string {
  if (process.env.AMIBA_DEV_EXTENSIONS_PATH) {
    return process.env.AMIBA_DEV_EXTENSIONS_PATH
  }
  const home = homedir()
  const plat = platform()
  if (plat === "darwin") {
    return join(home, "Library", "Application Support", APP_NAME, "extensions")
  }
  if (plat === "win32") {
    const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming")
    return join(appData, APP_NAME, "extensions")
  }
  // linux + others
  return join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), APP_NAME, "extensions")
}
