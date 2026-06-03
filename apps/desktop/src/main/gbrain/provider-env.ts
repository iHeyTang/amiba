/**
 * Per-provider env-var overrides, persisted by hermes-x outside gbrain.
 *
 * gbrain's gateway reads API keys from `process.env` at startup. We want
 * the UI to set those values without asking the user to maintain shell
 * exports. So we store `{ providerId: { envKey: value } }` in
 * `~/.hermes/provider-env.json`, encrypt each value with Electron's
 * `safeStorage` (OS keychain-derived key — no native deps), and merge
 * the decrypted map on top of `process.env` when spawning
 * `gbrain serve --http`.
 *
 * Values are encrypted *individually* so a corrupt entry doesn't take
 * the whole store down; if `safeStorage.decryptString` throws on one
 * key we skip it and continue. The file itself is plain JSON so the
 * user can inspect / hand-prune it.
 */

import { safeStorage } from "electron"
import { promises as fs } from "fs"
import { homedir } from "os"
import { dirname, join } from "path"

const STORE_PATH = join(homedir(), ".hermes", "provider-env.json")

/** On-disk shape: `{ [providerId]: { [envKey]: base64-ciphertext } }`. */
type EncryptedStore = Record<string, Record<string, string>>

async function readRaw(): Promise<EncryptedStore> {
  try {
    const buf = await fs.readFile(STORE_PATH, "utf8")
    const parsed = JSON.parse(buf) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as EncryptedStore
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw e
  }
}

async function writeRaw(store: EncryptedStore): Promise<void> {
  await fs.mkdir(dirname(STORE_PATH), { recursive: true })
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), {
    mode: 0o600,
  })
}

function encrypt(plain: string): string {
  return safeStorage.encryptString(plain).toString("base64")
}

function decrypt(b64: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(b64, "base64"))
  } catch {
    return null
  }
}

/**
 * Read-only listing for the UI. Returns `{ providerId: envKey[] }` —
 * we deliberately do NOT decrypt + return values; the UI only needs to
 * know which keys are populated so it can show a "saved" indicator and
 * a placeholder instead of the secret. Operators who want the raw
 * value can read the JSON file.
 */
export async function listOverrideKeys(): Promise<Record<string, string[]>> {
  const store = await readRaw()
  const out: Record<string, string[]> = {}
  for (const [providerId, entries] of Object.entries(store)) {
    out[providerId] = Object.keys(entries)
  }
  return out
}

export async function setOverride(
  providerId: string,
  envKey: string,
  value: string,
): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "OS keychain unavailable — refusing to write provider env in cleartext",
    )
  }
  const store = await readRaw()
  if (!store[providerId]) store[providerId] = {}
  store[providerId][envKey] = encrypt(value)
  await writeRaw(store)
}

export async function unsetOverride(
  providerId: string,
  envKey: string,
): Promise<void> {
  const store = await readRaw()
  const entries = store[providerId]
  if (!entries) return
  delete entries[envKey]
  if (Object.keys(entries).length === 0) delete store[providerId]
  await writeRaw(store)
}

/**
 * Decrypt every override and overlay on top of `base`. Used by the
 * launcher when spawning gbrain. Provider id is informational here —
 * env vars are global from gbrain's perspective. If two providers
 * happen to set the same env var (they shouldn't, but the schema
 * doesn't prevent it), last-write-wins by iteration order.
 */
export async function mergedEnv(
  base: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const store = await readRaw()
  const out: NodeJS.ProcessEnv = { ...base }
  for (const entries of Object.values(store)) {
    for (const [envKey, b64] of Object.entries(entries)) {
      const plain = decrypt(b64)
      if (plain !== null) out[envKey] = plain
    }
  }
  return out
}
