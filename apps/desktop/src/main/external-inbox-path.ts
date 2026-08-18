import { createHash } from "node:crypto"
import path from "node:path"

/** Stable local IPC endpoint for the current platform and Amiba profile. */
export function inboxSocketPathFor(
  platform: NodeJS.Platform,
  userData: string,
): string {
  if (platform === "win32") {
    const profile = createHash("sha256").update(userData).digest("hex").slice(0, 16)
    return `\\\\.\\pipe\\amiba-inbox-${profile}`
  }
  return path.join(userData, "inbox.sock")
}
