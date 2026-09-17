import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Quit Amiba and let the user install the downloaded DMG by hand.
 *
 * `open` runs from a detached helper that first waits for this process to exit.
 * Mounting the image while the running copy is still registered makes Finder
 * complain about an application in use, so the hand-off has to outlive us. The
 * wait is capped so a stuck shutdown cannot leave the helper spinning forever.
 */
export function openInstallerAfterExit(
  filePath: string,
  quit: () => void,
  { pid = process.pid, spawnImpl = spawn }: { pid?: number; spawnImpl?: typeof spawn } = {},
): void {
  if (!path.isAbsolute(filePath)) throw new Error("Installer path must be absolute");
  const script = 'n=0; while kill -0 "$1" 2>/dev/null && [ "$n" -lt 300 ]; do sleep 0.2; n=$((n + 1)); done; exec open "$2"';
  const child = spawnImpl("/bin/sh", ["-c", script, "amiba-installer-handoff", String(pid), filePath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  quit();
}
