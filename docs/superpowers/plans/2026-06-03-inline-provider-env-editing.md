# Inline Provider Env Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit each gbrain provider's API keys / env-style config directly from the Settings → Brain panel, with the values persisted by amiba (encrypted via Electron `safeStorage`) and injected into `gbrain serve --http` at spawn time.

**Architecture:** gbrain remains untouched. amiba owns a parallel env-override store under `~/.hermes/provider-env.json`: a `{ providerId: { envKey: encryptedBase64 } }` map encrypted with Electron's `safeStorage` (OS keychain-derived). The launcher merges decrypted overrides on top of `process.env` when spawning gbrain. Each `ProviderRow` becomes an expandable card; on expand, the renderer fetches that provider's required/optional env list via a new `gbrain providers env <id>` CLI bridge, then renders one Input + per-key Save button. Edits don't take effect until gbrain is restarted (existing restart button covers this).

**Tech Stack:** Electron `safeStorage`, Node `fs/promises`, Electron IPC (`ipcMain.handle` / `contextBridge`), React 18 with existing `Input` / `Button` primitives, existing i18n tables in `@amiba/i18n`.

---

## File Structure

**Create:**
- `apps/desktop/src/main/gbrain/provider-env.ts` — encrypted JSON store: read/write/list overrides for `{ providerId, envKey }` pairs; exposes `mergedEnv(baseEnv)` for the launcher.
- `apps/desktop/src/main/gbrain/recipe-schema.ts` — wraps `gbrain providers env <id>` subprocess and parses its stdout into `{ required: string[], optional: string[], setupUrl?: string, setupHint?: string }`.

**Modify:**
- `apps/desktop/src/main/gbrain/cli.ts` — re-export the new `runProvidersEnv()` from `recipe-schema.ts` for symmetry with `runProvidersList()`. Keep `cli.ts` as the single subprocess-bridge surface.
- `apps/desktop/src/main/gbrain/launcher.ts` — replace `env: process.env` in the `spawn(...)` call with `env: providerEnv.mergedEnv(process.env)`.
- `apps/desktop/src/main/gbrain/ipc.ts` — register 4 new handlers: `gbrain:providers:env`, `gbrain:providers:overrides:list`, `gbrain:providers:overrides:set`, `gbrain:providers:overrides:unset`.
- `apps/desktop/src/preload/index.ts` — expose those handlers under `window.hermes.gbrain.providers.{env,overrides}`.
- `packages/ui/src/settings/SettingsBrainConfig.tsx` — extend the existing `GBrainBridge` interface, replace `ProviderRow` with an expandable card containing per-field Input + Save controls.
- `packages/i18n/src/en.ts` — add 9 new strings (listed in Task 7).
- `packages/i18n/src/zh-CN.ts` — same 9 keys in Chinese.

**No tests added.** The desktop and packages workspaces have no `vitest`/`jest` setup; introducing a test framework is out of scope for this change. Verification is manual via `pnpm dev` for the desktop app, with explicit steps in each task.

---

### Task 1: Encrypted Provider-Env Store

**Files:**
- Create: `apps/desktop/src/main/gbrain/provider-env.ts`

- [ ] **Step 1: Write the store module**

Create `apps/desktop/src/main/gbrain/provider-env.ts`:

```typescript
/**
 * Per-provider env-var overrides, persisted by amiba outside gbrain.
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
```

- [ ] **Step 2: Type-check the new module**

Run: `cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba/apps/desktop && pnpm exec tsc --noEmit`

Expected: PASS (no diagnostics from `provider-env.ts`). If `electron` import isn't resolvable, confirm `apps/desktop/tsconfig.node.json` (or whichever covers `src/main/**`) has it — it should, given `launcher.ts` already imports `child_process` and other Node-only modules without issue.

- [ ] **Step 3: Commit**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba
git add apps/desktop/src/main/gbrain/provider-env.ts
git commit -m "feat(desktop): encrypted provider-env store backed by safeStorage"
```

---

### Task 2: Recipe Schema Subprocess Bridge

**Files:**
- Create: `apps/desktop/src/main/gbrain/recipe-schema.ts`
- Modify: `apps/desktop/src/main/gbrain/cli.ts`

- [ ] **Step 1: Write the subprocess bridge**

Create `apps/desktop/src/main/gbrain/recipe-schema.ts`. We shell out to `gbrain providers env <id>` because its stdout is the only place that gives us the `optional[]` list and `setup_url` per provider — `providers list` and `providers explain --json` don't expose either. The expected stdout format is well-defined in `gbrain/src/commands/providers.ts:runEnv`.

```typescript
/**
 * Per-provider env schema bridge: `gbrain providers env <id>`.
 *
 * The CLI prints:
 *   <Name> (<id>)
 *   <blank>
 *   Required:
 *     KEY                              ✓ set
 *     OTHER_KEY                        ✗ not set
 *
 *   Optional:
 *     KEY                              ✓ set
 *
 *   Setup: <url>
 *
 *   <free-form setup hint paragraph>
 *
 * We only parse the structured parts (required, optional, setup_url).
 * The `set / not set` annotation is recomputed on the renderer from
 * the overrides store anyway, so we ignore it here.
 */

import { spawn } from "child_process"
import { existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

const SPAWN_TIMEOUT_MS = 8_000

export interface ProviderEnvSchema {
  required: string[]
  optional: string[]
  setupUrl?: string
}

export interface ProvidersEnvResult {
  ok: boolean
  schema?: ProviderEnvSchema
  binary: string
  error?: string
}

function findGBrainBinary(): string {
  const explicit = process.env.GBRAIN_BIN
  if (explicit && existsSync(explicit)) return explicit
  const candidates = [
    join(homedir(), ".bun", "bin", "gbrain"),
    "/opt/homebrew/bin/gbrain",
    "/usr/local/bin/gbrain",
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return "gbrain"
}

/** Pure parser, exported for inline review (no unit-test infra in this repo). */
export function parseEnvOutput(stdout: string): ProviderEnvSchema {
  const lines = stdout.split(/\r?\n/)
  const required: string[] = []
  const optional: string[] = []
  let setupUrl: string | undefined
  let mode: "required" | "optional" | null = null

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line === "Required:") {
      mode = "required"
      continue
    }
    if (line === "Optional:") {
      mode = "optional"
      continue
    }
    if (line.startsWith("Setup:")) {
      setupUrl = line.slice("Setup:".length).trim() || undefined
      mode = null
      continue
    }
    // Blank line / free text ends any list mode.
    if (line.trim() === "" || !line.startsWith("  ")) {
      mode = null
      continue
    }
    // Indented row: `  KEY            ✓ set`.
    const token = line.trim().split(/\s+/)[0]
    if (!/^[A-Z][A-Z0-9_]*$/.test(token)) continue
    if (mode === "required") required.push(token)
    else if (mode === "optional") optional.push(token)
  }
  return { required, optional, setupUrl }
}

export async function runProvidersEnv(
  id: string,
): Promise<ProvidersEnvResult> {
  const binary = findGBrainBinary()
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) {
    return { ok: false, binary, error: `invalid provider id: ${id}` }
  }
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (r: ProvidersEnvResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(binary, ["providers", "env", id], {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (e) {
      finish({ ok: false, binary, error: (e as Error).message ?? String(e) })
      return
    }

    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8")
    })
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8")
    })
    child.on("error", (err: Error) => {
      finish({ ok: false, binary, error: err.message ?? String(err) })
    })
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM")
      } catch {
        /* best effort */
      }
      finish({
        ok: false,
        binary,
        error: `gbrain providers env ${id} timed out after ${SPAWN_TIMEOUT_MS}ms`,
      })
    }, SPAWN_TIMEOUT_MS)

    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0 && stdout.trim().length === 0) {
        finish({
          ok: false,
          binary,
          error:
            stderr.trim() || `gbrain providers env ${id} exited ${code}`,
        })
        return
      }
      finish({ ok: true, schema: parseEnvOutput(stdout), binary })
    })
  })
}
```

- [ ] **Step 2: Re-export from `cli.ts`**

Edit `apps/desktop/src/main/gbrain/cli.ts`. After the `runProvidersList` block (line 191), append:

```typescript
export {
  parseEnvOutput,
  runProvidersEnv,
  type ProviderEnvSchema,
  type ProvidersEnvResult,
} from "./recipe-schema"
```

- [ ] **Step 3: Manual parser sanity check**

In `apps/desktop` run:

```bash
node -e '
const { parseEnvOutput } = require("./src/main/gbrain/recipe-schema.ts");
console.log(parseEnvOutput(`OpenAI (openai)\n\nRequired:\n  OPENAI_API_KEY                   ✗ not set\n\nOptional:\n  OPENAI_ORG_ID                    ✗ not set\n  OPENAI_PROJECT                   ✗ not set\n\nSetup: https://platform.openai.com/api-keys\n`));
'
```

Skip this if Node can't load TS directly — the parser will get exercised end-to-end in Task 8 anyway. The point of this step is to eyeball the shape: `{ required: ["OPENAI_API_KEY"], optional: ["OPENAI_ORG_ID", "OPENAI_PROJECT"], setupUrl: "https://..." }`.

Better alternative: run the actual CLI and confirm the parser handles the live output. From the desktop workspace:

```bash
~/.bun/bin/gbrain providers env openai
```

Confirm the stdout matches the format expected by `parseEnvOutput` (the `Required:` / `Optional:` headers and indented `  KEY  status` rows).

- [ ] **Step 4: Type-check**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba/apps/desktop && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba
git add apps/desktop/src/main/gbrain/recipe-schema.ts apps/desktop/src/main/gbrain/cli.ts
git commit -m "feat(desktop): bridge \`gbrain providers env <id>\` for per-provider schema"
```

---

### Task 3: Launcher Env Injection

**Files:**
- Modify: `apps/desktop/src/main/gbrain/launcher.ts:204` (the `spawn(...)` call inside `runEnsure`)

- [ ] **Step 1: Import the merger**

Edit `apps/desktop/src/main/gbrain/launcher.ts`. At the top, after the existing imports (line 34):

```typescript
import { mergedEnv } from "./provider-env"
```

- [ ] **Step 2: Replace the env passed to spawn**

In `runEnsure`, replace this block (the existing `spawn(binary, ...)` call around line 204):

```typescript
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(binary, ["serve", "--http", "--port", String(port)], {
      detached: true,
      // We deliberately drop stderr/stdout — keeping them piped would
      // require draining them forever in the main process, defeating the
      // "detached, outlives the desktop" point. gbrain logs to ~/.gbrain
      // by default; that's where the user looks if they need diagnostics.
      stdio: "ignore",
      env: process.env,
    })
  } catch (e) {
```

with:

```typescript
  let env: NodeJS.ProcessEnv
  try {
    env = await mergedEnv(process.env)
  } catch (e) {
    return {
      ok: false,
      started: false,
      alreadyRunning: false,
      binary,
      error: `failed to load provider env overrides: ${(e as Error).message ?? String(e)}`,
    }
  }

  let child: ReturnType<typeof spawn>
  try {
    child = spawn(binary, ["serve", "--http", "--port", String(port)], {
      detached: true,
      // We deliberately drop stderr/stdout — keeping them piped would
      // require draining them forever in the main process, defeating the
      // "detached, outlives the desktop" point. gbrain logs to ~/.gbrain
      // by default; that's where the user looks if they need diagnostics.
      stdio: "ignore",
      env,
    })
  } catch (e) {
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba/apps/desktop && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Smoke-verify without overrides**

With no `~/.hermes/provider-env.json` present yet, start the app:

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba/apps/desktop && pnpm dev
```

Open Settings → Brain → confirm the connection still comes up green and the existing Providers list still renders. We're only validating that `mergedEnv` returns a copy of `process.env` when the store file is absent — no regression in the no-override path.

Stop dev server when verified (Ctrl-C in the terminal).

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba
git add apps/desktop/src/main/gbrain/launcher.ts
git commit -m "feat(desktop): inject decrypted provider-env overrides into gbrain spawn"
```

---

### Task 4: IPC Handlers

**Files:**
- Modify: `apps/desktop/src/main/gbrain/ipc.ts`

- [ ] **Step 1: Read the current `ipc.ts` structure**

Open `apps/desktop/src/main/gbrain/ipc.ts` and confirm the existing `gbrain:providers:list` handler (around line 115) is registered via `ipcMain.handle`. The new handlers follow the same pattern.

- [ ] **Step 2: Add the four new handlers**

In `ipc.ts`, near the existing `gbrain:providers:list` registration, add:

```typescript
import { runProvidersEnv } from "./recipe-schema"
import {
  listOverrideKeys,
  setOverride,
  unsetOverride,
} from "./provider-env"

// ... inside the same registration block:

ipcMain.handle("gbrain:providers:env", async (_e, id: unknown) => {
  if (typeof id !== "string" || id.length === 0) {
    return { ok: false, binary: "", error: "id required" }
  }
  return runProvidersEnv(id)
})

ipcMain.handle("gbrain:providers:overrides:list", async () => {
  try {
    return { ok: true, overrides: await listOverrideKeys() }
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? String(e) }
  }
})

ipcMain.handle(
  "gbrain:providers:overrides:set",
  async (
    _e,
    payload: { providerId?: string; envKey?: string; value?: string },
  ) => {
    const { providerId, envKey, value } = payload ?? {}
    if (!providerId || !envKey || typeof value !== "string") {
      return { ok: false, error: "providerId, envKey, value required" }
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(envKey)) {
      return { ok: false, error: `invalid envKey: ${envKey}` }
    }
    try {
      await setOverride(providerId, envKey, value)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? String(e) }
    }
  },
)

ipcMain.handle(
  "gbrain:providers:overrides:unset",
  async (_e, payload: { providerId?: string; envKey?: string }) => {
    const { providerId, envKey } = payload ?? {}
    if (!providerId || !envKey) {
      return { ok: false, error: "providerId, envKey required" }
    }
    try {
      await unsetOverride(providerId, envKey)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? String(e) }
    }
  },
)
```

Insert these immediately after the existing `ipcMain.handle("gbrain:providers:list", ...)` line so all `providers:*` handlers stay grouped.

- [ ] **Step 3: Type-check**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba/apps/desktop && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba
git add apps/desktop/src/main/gbrain/ipc.ts
git commit -m "feat(desktop): IPC handlers for provider env schema + overrides"
```

---

### Task 5: Preload Bridge

**Files:**
- Modify: `apps/desktop/src/preload/index.ts:159-175` (existing `gbrain.providers` block)

- [ ] **Step 1: Extend `gbrain.providers`**

Edit `apps/desktop/src/preload/index.ts`. Replace the existing `providers: { list: ... }` block (lines 159-175 — find the `providers:` key under `gbrain:` containing the `list:` arrow function) with:

```typescript
    providers: {
      list: (): Promise<{
        ok: boolean
        providers?: Array<{
          id: string
          tier: string
          embed: string
          expand: string
          chat: string
          ready: boolean
          missing_env?: string
          status_raw: string
        }>
        binary: string
        error?: string
      }> => ipcRenderer.invoke("gbrain:providers:list"),
      /**
       * Fetch one provider's env schema via `gbrain providers env <id>`.
       * Returns `required[]` + `optional[]` + `setupUrl` parsed from
       * the CLI stdout. UI uses this to render per-key Input fields.
       */
      env: (
        id: string,
      ): Promise<{
        ok: boolean
        schema?: { required: string[]; optional: string[]; setupUrl?: string }
        binary: string
        error?: string
      }> => ipcRenderer.invoke("gbrain:providers:env", id),
      /**
       * Read/write per-provider env-var overrides. Values live encrypted
       * in `~/.hermes/provider-env.json` (Electron safeStorage) and are
       * merged on top of `process.env` when the launcher spawns gbrain.
       * `list` returns the *keys* only — the UI shows "saved" indicators,
       * never re-displays the secret.
       */
      overrides: {
        list: (): Promise<{
          ok: boolean
          overrides?: Record<string, string[]>
          error?: string
        }> => ipcRenderer.invoke("gbrain:providers:overrides:list"),
        set: (
          providerId: string,
          envKey: string,
          value: string,
        ): Promise<{ ok: boolean; error?: string }> =>
          ipcRenderer.invoke("gbrain:providers:overrides:set", {
            providerId,
            envKey,
            value,
          }),
        unset: (
          providerId: string,
          envKey: string,
        ): Promise<{ ok: boolean; error?: string }> =>
          ipcRenderer.invoke("gbrain:providers:overrides:unset", {
            providerId,
            envKey,
          }),
      },
    },
```

- [ ] **Step 2: Update the renderer global type**

Open `apps/desktop/src/renderer/global.d.ts`. Locate the `gbrain.providers` shape (mirrors the preload). Replace it with the same shape used in Step 1 (the `list` entry plus the new `env` and `overrides` entries).

If `global.d.ts` declares the shape inline, copy the type literal from Step 1 verbatim. If it imports a type from `@amiba/...`, keep the import structure and extend the type definition there instead.

- [ ] **Step 3: Type-check**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba/apps/desktop && pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Verify the bridge from devtools**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba/apps/desktop && pnpm dev
```

Open the main window's devtools (Cmd-Option-I). In the console:

```javascript
await window.hermes.gbrain.providers.env("openai")
```

Expected: `{ ok: true, schema: { required: ["OPENAI_API_KEY"], optional: ["OPENAI_ORG_ID","OPENAI_PROJECT"], setupUrl: "https://..." }, binary: "..." }`. The exact field list matches `~/.bun/install/global/node_modules/gbrain/src/core/ai/recipes/openai.ts`.

Then:

```javascript
await window.hermes.gbrain.providers.overrides.set("openai", "OPENAI_API_KEY", "sk-test-dummy")
await window.hermes.gbrain.providers.overrides.list()
await window.hermes.gbrain.providers.overrides.unset("openai", "OPENAI_API_KEY")
```

Expected: `{ ok: true }`, then `{ ok: true, overrides: { openai: ["OPENAI_API_KEY"] } }`, then `{ ok: true }`. After the unset, `~/.hermes/provider-env.json` should be `{}`. Verify with:

```bash
cat ~/.hermes/provider-env.json
```

Stop dev server.

- [ ] **Step 5: Commit**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/global.d.ts
git commit -m "feat(desktop): expose provider env + overrides over preload bridge"
```

---

### Task 6: i18n Strings

**Files:**
- Modify: `packages/i18n/src/en.ts` (insert after line 96)
- Modify: `packages/i18n/src/zh-CN.ts` (same insertion point — keep keys aligned)

- [ ] **Step 1: Add English strings**

In `packages/i18n/src/en.ts`, replace the existing `options.brainConfig.providers.envHint` line + nothing-else with the new key set (the old hint key is replaced because the panel no longer points users at the shell). After `"options.brainConfig.providers.refresh": "Re-probe",`:

```typescript
  "options.brainConfig.providers.envHint":
    "Paste each provider's API key directly here. Values are encrypted via your OS keychain and injected into gbrain when it starts. Restart gbrain after editing to apply.",
  "options.brainConfig.providers.expand": "Configure",
  "options.brainConfig.providers.collapse": "Done",
  "options.brainConfig.providers.required": "Required",
  "options.brainConfig.providers.optional": "Optional",
  "options.brainConfig.providers.placeholder.saved": "saved — paste a new value to replace",
  "options.brainConfig.providers.placeholder.empty": "not set",
  "options.brainConfig.providers.save": "Save",
  "options.brainConfig.providers.saved": "Saved — restart gbrain to apply",
  "options.brainConfig.providers.clear": "Clear",
  "options.brainConfig.providers.setupLink": "Get an API key →",
```

Keep the existing `envHint` key but replace its value with the new copy (above). If your editor reformats the multi-line string, ensure the i18n loader still parses it (it's a plain JSON-ish module).

- [ ] **Step 2: Add Chinese strings**

In `packages/i18n/src/zh-CN.ts`, insert the matching keys near the existing `options.brainConfig.providers.*` group:

```typescript
  "options.brainConfig.providers.envHint":
    "直接在此处粘贴每个 provider 的 API key。值通过系统 keychain 加密，在 gbrain 启动时注入；修改后请重启 gbrain 使其生效。",
  "options.brainConfig.providers.expand": "配置",
  "options.brainConfig.providers.collapse": "收起",
  "options.brainConfig.providers.required": "必填",
  "options.brainConfig.providers.optional": "可选",
  "options.brainConfig.providers.placeholder.saved": "已保存 — 粘贴新值可覆盖",
  "options.brainConfig.providers.placeholder.empty": "未设置",
  "options.brainConfig.providers.save": "保存",
  "options.brainConfig.providers.saved": "已保存，重启 gbrain 后生效",
  "options.brainConfig.providers.clear": "清除",
  "options.brainConfig.providers.setupLink": "申请 API key →",
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba && pnpm -r exec tsc --noEmit
```

Expected: PASS across all workspaces. If i18n uses a typed dictionary that requires keys in both locales, ensure both files have identical key sets.

- [ ] **Step 4: Commit**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba
git add packages/i18n/src/en.ts packages/i18n/src/zh-CN.ts
git commit -m "i18n: strings for inline provider env editing"
```

---

### Task 7: UI — Expandable Provider Card

**Files:**
- Modify: `packages/ui/src/settings/SettingsBrainConfig.tsx` (header comment, `GBrainBridge` interface around line 92, providers state + `refreshProviders` around line 192-264, and the `ProviderRow` component at line 610-653)

- [ ] **Step 1: Update the header comment**

Edit the file-top docstring. Replace the "No file-plane editor" paragraph (lines 19-25) with:

```typescript
 *   3. **Providers** — dynamic enumeration of gbrain's recipe registry
 *      via the `gbrain providers list` CLI subprocess, with each row
 *      expandable into an inline editor that writes per-provider env
 *      values into amiba's encrypted override store (`safeStorage`
 *      → `~/.hermes/provider-env.json`). The launcher merges those on
 *      top of `process.env` when spawning gbrain, so edits apply on
 *      the next restart without asking the user to maintain shell
 *      exports. gbrain itself is untouched — `gbrain config show`
 *      will not see these values.
 */
```

- [ ] **Step 2: Extend the `GBrainBridge` interface**

Locate the `GBrainBridge` interface (around line 92). Replace its `providers` property with:

```typescript
  providers?: {
    list: () => Promise<ListProvidersResult>
    env: (id: string) => Promise<{
      ok: boolean
      schema?: { required: string[]; optional: string[]; setupUrl?: string }
      binary: string
      error?: string
    }>
    overrides: {
      list: () => Promise<{
        ok: boolean
        overrides?: Record<string, string[]>
        error?: string
      }>
      set: (
        providerId: string,
        envKey: string,
        value: string,
      ) => Promise<{ ok: boolean; error?: string }>
      unset: (
        providerId: string,
        envKey: string,
      ) => Promise<{ ok: boolean; error?: string }>
    }
  }
```

- [ ] **Step 3: Add overrides state in `SettingsBrainConfig`**

Inside `SettingsBrainConfig()` near the existing providers state (line 192), add:

```typescript
  const [overrideKeys, setOverrideKeys] = useState<Record<string, string[]>>({})

  const refreshOverrides = useCallback(async () => {
    const bridge = gbrainBridge()?.providers?.overrides
    if (!bridge) return
    const r = await bridge.list()
    if (r.ok) setOverrideKeys(r.overrides ?? {})
  }, [])

  useEffect(() => {
    void refreshOverrides()
  }, [refreshOverrides])
```

- [ ] **Step 4: Rewrite `ProviderRow`**

Replace the existing `ProviderRow` function (lines 610-653) with:

```typescript
function ProviderRow({
  provider,
  savedKeys,
  onChanged,
}: {
  provider: GBrainProvider
  savedKeys: string[]
  onChanged: () => void
}) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [schema, setSchema] = useState<{
    required: string[]
    optional: string[]
    setupUrl?: string
  } | null>(null)
  const [schemaLoading, setSchemaLoading] = useState(false)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  // Lazy-load the schema the first time the card opens. We deliberately
  // do NOT pre-fetch on mount — listing 18 providers would mean 18
  // subprocess spawns at panel-render time.
  useEffect(() => {
    if (!open || schema || schemaLoading) return
    const bridge = gbrainBridge()?.providers
    if (!bridge) return
    setSchemaLoading(true)
    setSchemaError(null)
    void bridge
      .env(provider.id)
      .then((r) => {
        if (!r.ok) setSchemaError(r.error ?? "failed to load schema")
        else setSchema(r.schema ?? null)
      })
      .finally(() => setSchemaLoading(false))
  }, [open, schema, schemaLoading, provider.id])

  const capabilityChip = (label: string, on: boolean) =>
    on ? (
      <span
        className="rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
        title={label}
      >
        {label}
      </span>
    ) : null

  return (
    <div className="rounded border border-border/40 bg-background/40 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">{provider.id}</span>
        <span
          className="rounded bg-muted/60 px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground"
          title={provider.tier}
        >
          {provider.tier}
        </span>
        <span className="flex items-center gap-1">
          {capabilityChip("embed", provider.embed === "yes")}
          {capabilityChip("expand", provider.expand === "yes")}
          {capabilityChip("chat", provider.chat === "yes")}
        </span>
        <span
          className={`ml-auto shrink-0 text-[10px] ${
            provider.ready || savedKeys.length > 0
              ? "text-[hsl(var(--success))]"
              : "text-muted-foreground"
          }`}
          title={provider.status_raw}
        >
          {provider.ready
            ? "✓ ready"
            : savedKeys.length > 0
              ? `✓ saved (${savedKeys.length})`
              : `✗ ${provider.missing_env ?? "setup"}`}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px]"
          onClick={() => setOpen((v) => !v)}
        >
          {open
            ? t("options.brainConfig.providers.collapse")
            : t("options.brainConfig.providers.expand")}
        </Button>
      </div>

      {open && (
        <div className="mt-2 border-t border-border/30 pt-2">
          {schemaLoading && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("options.brainConfig.providers.loading")}
            </div>
          )}
          {schemaError && (
            <p className="text-[11px] text-destructive">{schemaError}</p>
          )}
          {schema && (
            <div className="space-y-3">
              {schema.required.length > 0 && (
                <FieldGroup
                  title={t("options.brainConfig.providers.required")}
                  keys={schema.required}
                  providerId={provider.id}
                  savedKeys={savedKeys}
                  onChanged={onChanged}
                />
              )}
              {schema.optional.length > 0 && (
                <FieldGroup
                  title={t("options.brainConfig.providers.optional")}
                  keys={schema.optional}
                  providerId={provider.id}
                  savedKeys={savedKeys}
                  onChanged={onChanged}
                />
              )}
              {schema.setupUrl && (
                <a
                  href={schema.setupUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-primary hover:underline"
                >
                  {t("options.brainConfig.providers.setupLink")}
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FieldGroup({
  title,
  keys,
  providerId,
  savedKeys,
  onChanged,
}: {
  title: string
  keys: string[]
  providerId: string
  savedKeys: string[]
  onChanged: () => void
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-1.5">
        {keys.map((k) => (
          <FieldRow
            key={k}
            providerId={providerId}
            envKey={k}
            saved={savedKeys.includes(k)}
            onChanged={onChanged}
          />
        ))}
      </div>
    </div>
  )
}

function FieldRow({
  providerId,
  envKey,
  saved,
  onChanged,
}: {
  providerId: string
  envKey: string
  saved: boolean
  onChanged: () => void
}) {
  const { t } = useT()
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = useCallback(async () => {
    const bridge = gbrainBridge()?.providers?.overrides
    if (!bridge || value.length === 0) return
    setBusy(true)
    setError(null)
    setJustSaved(false)
    try {
      const r = await bridge.set(providerId, envKey, value)
      if (!r.ok) {
        setError(r.error ?? "save failed")
        return
      }
      setValue("")
      setJustSaved(true)
      onChanged()
    } finally {
      setBusy(false)
    }
  }, [providerId, envKey, value, onChanged])

  const clear = useCallback(async () => {
    const bridge = gbrainBridge()?.providers?.overrides
    if (!bridge) return
    setBusy(true)
    setError(null)
    setJustSaved(false)
    try {
      const r = await bridge.unset(providerId, envKey)
      if (!r.ok) {
        setError(r.error ?? "clear failed")
        return
      }
      onChanged()
    } finally {
      setBusy(false)
    }
  }, [providerId, envKey, onChanged])

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Label className="w-44 shrink-0 font-mono text-[10px]">{envKey}</Label>
        <Input
          type="password"
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setJustSaved(false)
          }}
          placeholder={
            saved
              ? t("options.brainConfig.providers.placeholder.saved")
              : t("options.brainConfig.providers.placeholder.empty")
          }
          className="h-7 flex-1 text-xs"
          disabled={busy}
        />
        <Button
          size="sm"
          className="h-7 px-2 text-[11px]"
          onClick={() => void save()}
          disabled={busy || value.length === 0}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            t("options.brainConfig.providers.save")
          )}
        </Button>
        {saved && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => void clear()}
            disabled={busy}
          >
            {t("options.brainConfig.providers.clear")}
          </Button>
        )}
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      {justSaved && !error && (
        <p className="text-[10px] text-[hsl(var(--success))]">
          {t("options.brainConfig.providers.saved")}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Update the `ProviderRow` call site**

In the providers `.map(...)` (around line 575), pass the new props:

```typescript
                  {providers.map((p) => (
                    <ProviderRow
                      key={p.id}
                      provider={p}
                      savedKeys={overrideKeys[p.id] ?? []}
                      onChanged={refreshOverrides}
                    />
                  ))}
```

- [ ] **Step 6: Type-check**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba && pnpm -r exec tsc --noEmit
```

Expected: PASS across `packages/ui` and `apps/desktop`.

- [ ] **Step 7: Commit**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba
git add packages/ui/src/settings/SettingsBrainConfig.tsx
git commit -m "feat(ui): inline editor for per-provider env values"
```

---

### Task 8: End-to-End Manual Verification

**Files:** No code changes. This task locks in the contract from the user's perspective.

- [ ] **Step 1: Boot the desktop in dev mode**

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba/apps/desktop && pnpm dev
```

- [ ] **Step 2: Confirm clean state**

Make sure `~/.hermes/provider-env.json` does NOT exist (delete it if it does). Open Settings → Brain. Each provider row should render exactly as before (ready/missing status) — we're confirming the no-override path is unchanged.

- [ ] **Step 3: Edit a provider that wasn't ready**

Pick a provider showing `✗ missing FOO_API_KEY` (e.g. `deepseek` if you don't have DEEPSEEK_API_KEY in your shell). Click "Configure" → the card expands → a Loader2 briefly spins → the required env field renders. Paste a fake value (`sk-test-1234`), click Save. Confirm:

- Row status flips to `✓ saved (1)`.
- "Saved — restart gbrain to apply" appears under the field.
- `~/.hermes/provider-env.json` exists and is mode `0600`, containing base64 ciphertext (not the raw `sk-test-1234`).

```bash
cat ~/.hermes/provider-env.json
stat -f '%Sp' ~/.hermes/provider-env.json   # macOS: should print -rw-------
```

- [ ] **Step 4: Restart gbrain and confirm injection**

Click "Restart" in the Connection section. Wait for the restart-then-test cycle to complete. In a separate terminal:

```bash
curl -s http://127.0.0.1:3131/health
```

The /health should still come up. Then verify the env was actually injected by checking the gbrain process env:

```bash
GBRAIN_PID=$(lsof -ti :3131 -sTCP:LISTEN)
ps eww -p "$GBRAIN_PID" | tr ' ' '\n' | grep -E "DEEPSEEK_API_KEY|FOO_API_KEY"
```

Expected: the line `DEEPSEEK_API_KEY=sk-test-1234` (or whichever key you set) appears. This proves the override made it into the spawned process env.

- [ ] **Step 5: Clear and re-verify**

Back in the UI, click "Clear" next to the field. Restart gbrain again. Re-run the `ps eww` check from Step 4. Expected: the key is gone from the spawned env (matches your shell baseline).

Confirm `~/.hermes/provider-env.json` is back to `{}`.

- [ ] **Step 6: Probe the encryption envelope**

To sanity-check the safeStorage round-trip, set a value, kill the desktop fully, restart it, and open the same provider card. The `✓ saved (N)` indicator should reappear (the launcher reads + decrypts the store on next boot). If the indicator is missing, the decrypt path is silently dropping entries — investigate `provider-env.ts` `decrypt()`.

- [ ] **Step 7: Commit the verification checklist**

No code changes — but make sure the plan checkboxes above are all ticked in this file. Then:

```bash
cd /Users/zhangdehui/Documents/CodeRepo/amiba/amiba
git add docs/superpowers/plans/2026-06-03-inline-provider-env-editing.md
git commit -m "docs: mark inline provider env editing plan as verified"
```

---

## Out of Scope

- **Migrating gbrain's own 3 hardcoded slots** (`openai_api_key`, `anthropic_api_key`, `zeroentropy_api_key` in `~/.gbrain/config.json`) to our store. They keep working independently — if both are set, gbrain's own slots win because they're hydrated into env *before* our override merges in. Tackle this only if user reports double-source confusion.
- **A "Restart now" affordance inline in the provider card.** The existing Connection-section restart button is the obvious place. Adding a second restart button per card would create UX redundancy.
- **Inline schema introspection** (showing each key's expected format / regex). gbrain doesn't expose validation rules per key, and our `safeStorage`-encrypted box accepts any string. Format-checking belongs in gbrain.
- **Sync across machines.** safeStorage is OS-keychain-derived, so the encrypted JSON is non-portable. That's a feature, not a bug.
