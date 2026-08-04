import os from "node:os"

/**
 * Product-level default workspace root.
 *
 * Amiba starts every task in the signed-in OS user's home directory unless
 * that task has an explicit workspace binding. Use `os.homedir()` rather than
 * reading `process.env.HOME` directly so the contract also works on Windows.
 */
export function getDefaultWorkspaceRoot(): string {
  return os.homedir()
}
