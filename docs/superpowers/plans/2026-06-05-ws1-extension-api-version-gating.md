# WS1 — Extension API Version Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define a host "extension API contract level" (monotonic integer), expose it to extensions at runtime, let a manifest declare the minimum level it needs (`manifest.apiVersion`), and enforce it at activation and marketplace-install so incompatible extensions are skipped gracefully (never crash).

**Architecture:** A single integer `API_VERSION` lives in `@amiba/extension-api`; the host re-exports it as `HOST_API_VERSION` (what this desktop implements). A pure `checkCompat(required, host)` decides compatibility. `validateManifest` learns to read/validate `apiVersion`. `activateOne` (covers initial discovery + hot-reload) and `installFromRelease` (marketplace) gate on it; incompatible extensions get registry status `"incompatible"` + a reason, which already flows out through the existing `extensions:status` IPC channel. Extensions can read the host's level via `host.hostInfo.apiVersion` (main) and `window.hermes.apiVersion` (webview) to degrade gracefully.

**Tech Stack:** TypeScript, vitest (already configured in `packages/extension-host`), pnpm workspace.

**Branch:** `feat/extension-sdk-versioning` (already checked out). **Spec:** `docs/superpowers/specs/2026-06-05-extension-distribution-and-versioning-design.md` (§3).

**Commit identity:** Author all commits as `iHeyTang <dehui1012@gmail.com>` — either run once on this branch `git config user.name iHeyTang && git config user.email dehui1012@gmail.com`, or pass `-c user.name=iHeyTang -c user.email=dehui1012@gmail.com` on each `git commit`. Steps below show plain `git commit`; apply the identity per this note.

**Decisions locked by the spec:** integer API level (not semver); absent `manifest.apiVersion` ⇒ defaults to `1` (back-compat); no public registry; **no renderer Extensions-management UI exists on this branch**, so WS1 stops at the data contract (status + reason on `extensions:status`).

---

## File Structure

- `packages/extension-api/src/version.ts` — **Create.** Exports `API_VERSION` (the contract level this SDK targets).
- `packages/extension-api/src/index.ts` — **Modify.** Re-export `./version`.
- `packages/extension-api/src/manifest.ts` — **Modify.** Add `apiVersion?: number` to `ExtensionManifest`.
- `packages/extension-api/src/manifest.schema.json` — **Modify.** Add `apiVersion` property.
- `packages/extension-api/src/host.ts` — **Modify.** Add `hostInfo: { readonly apiVersion: number }` to `MainHost`.
- `packages/extension-api/src/webview.ts` — **Modify.** Add `readonly apiVersion: number` to `WebViewHostAPI`.
- `packages/extension-host/src/version.ts` — **Create.** Re-export `HOST_API_VERSION` (= the SDK's `API_VERSION` this host ships).
- `packages/extension-host/src/compat.ts` — **Create.** Pure `checkCompat()` + `DEFAULT_API_VERSION`.
- `packages/extension-host/src/__tests__/compat.test.ts` — **Create.** Unit tests for `checkCompat`.
- `packages/extension-host/src/main/discover.ts` — **Modify.** `validateManifest` validates `apiVersion`.
- `packages/extension-host/src/__tests__/manifest.test.ts` — **Modify.** Tests for `apiVersion` validation.
- `packages/extension-host/src/main/registry.ts` — **Modify.** Add `"incompatible"` to `RuntimeExtension.status`.
- `packages/extension-host/src/main/index.ts` — **Modify.** `activateOne` gates on compatibility.
- `packages/extension-host/src/main/marketplace.ts` — **Modify.** `installFromRelease` gates on compatibility.
- `packages/extension-host/src/runner/index.ts` — **Modify.** Add `hostInfo` to the `MainHost` proxy.
- `packages/extension-host/src/webview-preload/index.ts` — **Modify.** Add `apiVersion` to `window.hermes`.
- `extensions/{tool-meter,token-meter,knowledge-base}/manifest.json` — **Modify.** Add `"apiVersion": 1` (example + smoke).
- `docs/marketplace-bootstrap.md` — **Modify.** Document `apiVersion` + gating.

---

## Task 1: Contract version constant + pure `checkCompat`

**Files:**
- Create: `packages/extension-api/src/version.ts`
- Modify: `packages/extension-api/src/index.ts`
- Create: `packages/extension-host/src/version.ts`
- Create: `packages/extension-host/src/compat.ts`
- Test: `packages/extension-host/src/__tests__/compat.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension-host/src/__tests__/compat.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { checkCompat } from "../compat"

describe("checkCompat", () => {
  it("treats an absent required version as compatible", () => {
    expect(checkCompat(undefined, 1)).toEqual({ ok: true })
  })

  it("is compatible when required equals host", () => {
    expect(checkCompat(2, 2)).toEqual({ ok: true })
  })

  it("is compatible when required is below host", () => {
    expect(checkCompat(1, 3)).toEqual({ ok: true })
  })

  it("is incompatible when required exceeds host, with a reason citing both numbers", () => {
    const r = checkCompat(4, 2)
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.reason).toMatch(/4/)
    expect(r.ok ? "" : r.reason).toMatch(/2/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -F @amiba/extension-host exec vitest run src/__tests__/compat.test.ts`
Expected: FAIL — `Failed to resolve import "../compat"` / "checkCompat is not a function".

- [ ] **Step 3: Create the API_VERSION constant in extension-api**

Create `packages/extension-api/src/version.ts`:

```ts
/**
 * The host extension-API contract level this SDK targets. Monotonic
 * integer — bump on ANY breaking change to the extension-facing surface
 * (MainHost / WebViewHostAPI / manifest schema). Extensions declare the
 * minimum level they need via `manifest.apiVersion`; the host gates on
 * `apiVersion <= HOST_API_VERSION`.
 */
export const API_VERSION = 1
```

Edit `packages/extension-api/src/index.ts` to add the re-export (append after the existing exports):

```ts
export * from "./manifest"
export * from "./host"
export * from "./settings"
export * from "./webview"
export * from "./version"
```

- [ ] **Step 4: Create HOST_API_VERSION re-export in extension-host**

Create `packages/extension-host/src/version.ts`:

```ts
// The extension-API level THIS host implements. It equals the API_VERSION
// of the @amiba/extension-api the host ships, so re-export keeps them in
// lockstep automatically. Extensions built against a newer SDK declare a
// higher manifest.apiVersion and are gated off until the host catches up.
export { API_VERSION as HOST_API_VERSION } from "@amiba/extension-api"
```

- [ ] **Step 5: Implement `checkCompat`**

Create `packages/extension-host/src/compat.ts`:

```ts
/** Level assumed when a manifest omits `apiVersion` (legacy / minimal). */
export const DEFAULT_API_VERSION = 1

export type CompatResult = { ok: true } | { ok: false; reason: string }

/**
 * An extension is compatible when the host implements an API level at
 * least as high as the extension requires. Absent `required` defaults to
 * DEFAULT_API_VERSION so pre-apiVersion manifests keep loading.
 */
export function checkCompat(
  required: number | undefined,
  hostApiVersion: number,
): CompatResult {
  const need = required ?? DEFAULT_API_VERSION
  if (need <= hostApiVersion) return { ok: true }
  return {
    ok: false,
    reason: `requires host extension API level ${need}, but this desktop implements ${hostApiVersion} — update the desktop app`,
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -F @amiba/extension-host exec vitest run src/__tests__/compat.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 7: Typecheck both packages**

Run: `pnpm -F @amiba/extension-host exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/extension-api/src/version.ts packages/extension-api/src/index.ts \
        packages/extension-host/src/version.ts packages/extension-host/src/compat.ts \
        packages/extension-host/src/__tests__/compat.test.ts
git commit -m "feat(extension-api+host): API_VERSION constant + checkCompat()"
```

---

## Task 2: Manifest `apiVersion` field — type, schema, validation

**Files:**
- Modify: `packages/extension-api/src/manifest.ts:13-14` (add field near `engines`)
- Modify: `packages/extension-api/src/manifest.schema.json:11` (add property after `version`)
- Modify: `packages/extension-host/src/main/discover.ts:22-24` (validate after the version check)
- Test: `packages/extension-host/src/__tests__/manifest.test.ts` (append cases)

- [ ] **Step 1: Write the failing tests**

Append inside the `describe("validateManifest", …)` block in `packages/extension-host/src/__tests__/manifest.test.ts` (before its closing `})`):

```ts
  // ---------------------------------------------------------------------------
  // apiVersion (minimum host API level)
  // ---------------------------------------------------------------------------

  it("accepts a manifest with an integer apiVersion", () => {
    expect(validateManifest({ ...base, apiVersion: 2 }).ok).toBe(true)
  })

  it("accepts a manifest without apiVersion (optional)", () => {
    expect(validateManifest(base).ok).toBe(true)
  })

  it("rejects apiVersion 0", () => {
    const r = validateManifest({ ...base, apiVersion: 0 })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/apiVersion/)
  })

  it("rejects a non-integer apiVersion", () => {
    expect(validateManifest({ ...base, apiVersion: 1.5 }).ok).toBe(false)
  })

  it("rejects a string apiVersion", () => {
    expect(validateManifest({ ...base, apiVersion: "2" }).ok).toBe(false)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm -F @amiba/extension-host exec vitest run src/__tests__/manifest.test.ts`
Expected: FAIL — the "rejects apiVersion 0 / non-integer / string" cases fail because `validateManifest` does not yet check `apiVersion`.

- [ ] **Step 3: Add the field to the manifest type**

In `packages/extension-api/src/manifest.ts`, add the field right after the `version` field (currently the `engines?` block at lines 13-14). Insert before `engines?`:

```ts
  /** Minimum host extension-API level this extension requires (integer ≥ 1). Absent ⇒ 1. */
  apiVersion?: number
```

- [ ] **Step 4: Add the field to the JSON schema**

In `packages/extension-api/src/manifest.schema.json`, add this line immediately after the `"version"` property (line 11, after its trailing comma):

```json
    "apiVersion": { "type": "integer", "minimum": 1 },
```

- [ ] **Step 5: Validate it in `validateManifest`**

In `packages/extension-host/src/main/discover.ts`, add this block immediately after the version check (after the `if (typeof m.version !== "string" …)` block that ends at line 24):

```ts
  if (m.apiVersion !== undefined) {
    if (
      typeof m.apiVersion !== "number" ||
      !Number.isInteger(m.apiVersion) ||
      m.apiVersion < 1
    ) {
      return {
        ok: false,
        error: `invalid apiVersion (must be an integer ≥ 1): ${String(m.apiVersion)}`,
      }
    }
  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm -F @amiba/extension-host exec vitest run src/__tests__/manifest.test.ts`
Expected: PASS (all original + 5 new cases).

- [ ] **Step 7: Typecheck**

Run: `pnpm -F @amiba/extension-host exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add packages/extension-api/src/manifest.ts packages/extension-api/src/manifest.schema.json \
        packages/extension-host/src/main/discover.ts packages/extension-host/src/__tests__/manifest.test.ts
git commit -m "feat(extension-api+host): manifest.apiVersion field + validation"
```

---

## Task 3: Expose host API level to extensions (`host.hostInfo` + `window.hermes.apiVersion`)

Types and their implementers land in ONE commit so `tsc` stays green.

**Files:**
- Modify: `packages/extension-api/src/host.ts:86-87` (add `hostInfo` to `MainHost`, right after `readonly id`)
- Modify: `packages/extension-api/src/webview.ts:104-106` (add `apiVersion` to `WebViewHostAPI`, after `readonly theme`)
- Modify: `packages/extension-host/src/runner/index.ts:134-136` (add `hostInfo` to the host proxy + import)
- Modify: `packages/extension-host/src/webview-preload/index.ts:74-85` (add `apiVersion` getter + import)

- [ ] **Step 1: Add `hostInfo` to the `MainHost` interface**

In `packages/extension-api/src/host.ts`, inside `export interface MainHost {`, add immediately after the `readonly id: string` line:

```ts
  /** Host runtime info — notably the extension-API level this desktop implements. */
  hostInfo: { readonly apiVersion: number }
```

- [ ] **Step 2: Add `apiVersion` to the `WebViewHostAPI` interface**

In `packages/extension-api/src/webview.ts`, inside `export interface WebViewHostAPI {`, add immediately after the `readonly theme: "light" | "dark"` line:

```ts
  /** Host extension-API level this desktop implements (for graceful degradation). */
  readonly apiVersion: number
```

- [ ] **Step 3: Implement `hostInfo` in the runner host proxy**

In `packages/extension-host/src/runner/index.ts`:

(a) Add the value import after the existing `import type { … } from "@amiba/extension-api"` block (around line 25):

```ts
import { HOST_API_VERSION } from "../version"
```

(b) Inside `const host: MainHost = {`, add immediately after `id: extensionId,` (line 135):

```ts
  hostInfo: { apiVersion: HOST_API_VERSION },
```

- [ ] **Step 4: Implement `apiVersion` in the webview preload**

In `packages/extension-host/src/webview-preload/index.ts`:

(a) Add the value import after the `import type { … } from "@amiba/extension-api"` block (around line 23):

```ts
import { HOST_API_VERSION } from "../version"
```

(b) Inside `const api: WebViewHostAPI = {`, add immediately after the `get theme()` getter block (line 85):

```ts
  get apiVersion(): number {
    return HOST_API_VERSION
  },
```

- [ ] **Step 5: Typecheck**

Run: `pnpm -F @amiba/extension-host exec tsc --noEmit`
Expected: exit 0. (If it fails complaining the runner/preload `host`/`api` objects miss a member, the additions in Steps 3-4 were not applied to the right object.)

- [ ] **Step 6: Run the full extension-host test suite (no regressions)**

Run: `pnpm -F @amiba/extension-host test`
Expected: PASS (all suites).

- [ ] **Step 7: Commit**

```bash
git add packages/extension-api/src/host.ts packages/extension-api/src/webview.ts \
        packages/extension-host/src/runner/index.ts packages/extension-host/src/webview-preload/index.ts
git commit -m "feat(extension-api+host): expose host apiVersion via host.hostInfo + window.hermes"
```

---

## Task 4: Gate activation on compatibility

`activateOne` is the single runtime path for both initial discovery and hot-reload, so gating there covers "discover" + "activate". Incompatible extensions get registry status `"incompatible"` (+ reason) and are NOT forked into a runner.

**Files:**
- Modify: `packages/extension-host/src/main/registry.ts:6` (extend status union)
- Modify: `packages/extension-host/src/main/index.ts:164-171` (gate at the top of `activateOne` + imports)

- [ ] **Step 1: Extend the registry status union**

In `packages/extension-host/src/main/registry.ts`, change the `status` field of `RuntimeExtension`:

```ts
  status: "loaded" | "failed" | "disabled" | "incompatible"
```

- [ ] **Step 2: Add imports to the host boot module**

In `packages/extension-host/src/main/index.ts`, after the existing import of `createRunnerManagerWithRpc` (line 20), add:

```ts
import { checkCompat } from "../compat"
import { HOST_API_VERSION } from "../version"
```

- [ ] **Step 3: Gate at the top of `activateOne`**

In `packages/extension-host/src/main/index.ts`, replace the opening of `activateOne` (lines 164-166):

```ts
  async function activateOne(entry: { manifest: ExtensionManifest; rootDir: string }): Promise<void> {
    const { manifest } = entry
    if (!manifest.entries.main) {
```

with:

```ts
  async function activateOne(entry: { manifest: ExtensionManifest; rootDir: string }): Promise<void> {
    const { manifest } = entry
    const compat = checkCompat(manifest.apiVersion, HOST_API_VERSION)
    if (!compat.ok) {
      console.warn(`[extension-host] ${manifest.id} incompatible: ${compat.reason}`)
      registry.set({ id: manifest.id, manifest, status: "incompatible", error: compat.reason })
      return
    }
    if (!manifest.entries.main) {
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -F @amiba/extension-host exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm -F @amiba/extension-host test`
Expected: PASS (no regressions; existing discover/registry tests still green).

- [ ] **Step 6: Commit**

```bash
git add packages/extension-host/src/main/registry.ts packages/extension-host/src/main/index.ts
git commit -m "feat(extension-host): gate activation on manifest.apiVersion (status: incompatible)"
```

---

## Task 5: Gate marketplace install on compatibility

Refuse to install a tarball whose `apiVersion` exceeds the host's level, with a clear error surfaced through the existing `marketplace:install` IPC path.

**Files:**
- Modify: `packages/extension-host/src/main/marketplace.ts` (add imports + check after manifest id validation, ~line 168)

- [ ] **Step 1: Add imports**

In `packages/extension-host/src/main/marketplace.ts`, after the existing `import { validateManifest } from "./discover"` (line 16), add:

```ts
import { checkCompat } from "../compat"
import { HOST_API_VERSION } from "../version"
```

- [ ] **Step 2: Add the compatibility check after id validation**

In `installFromRelease`, immediately after the block that throws on manifest-id mismatch (the `if (v.manifest.id !== release.entry.id) { … }` ending around line 167), insert:

```ts
    const compat = checkCompat(v.manifest.apiVersion, HOST_API_VERSION)
    if (!compat.ok) {
      throw new Error(`install: ${v.manifest.id} ${compat.reason}`)
    }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -F @amiba/extension-host exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm -F @amiba/extension-host test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-host/src/main/marketplace.ts
git commit -m "feat(extension-host): refuse marketplace install of API-incompatible extensions"
```

---

## Task 6: Stamp bundled extensions + document the field

**Files:**
- Modify: `extensions/tool-meter/manifest.json`, `extensions/token-meter/manifest.json`, `extensions/knowledge-base/manifest.json`
- Modify: `docs/marketplace-bootstrap.md`

- [ ] **Step 1: Add `apiVersion` to each bundled manifest**

In each of the three `manifest.json` files, add `"apiVersion": 1,` immediately after the `"version": "0.1.0",` line. Example for `extensions/tool-meter/manifest.json`:

```json
  "id": "io.hermes.tool-meter",
  "name": "Tool Activity",
  "version": "0.1.0",
  "apiVersion": 1,
  "engines": { "amiba": "^0.1.0" },
```

(Apply the same one-line insertion to token-meter and knowledge-base.)

- [ ] **Step 2: Document the field**

In `docs/marketplace-bootstrap.md`, add a short subsection (place it near where manifest fields / publishing are described):

```markdown
## API compatibility (`apiVersion`)

Each extension declares the minimum host extension-API level it needs:

```json
{ "id": "...", "version": "0.1.0", "apiVersion": 1 }
```

`apiVersion` is a monotonic integer matching the `@amiba/extension-api`
`API_VERSION` the extension built against. The desktop implements a level
(`HOST_API_VERSION`); it loads an extension only when
`apiVersion <= HOST_API_VERSION`. Otherwise the extension is marked
**incompatible** (skipped at activation; refused at marketplace install)
and the user is told to update the desktop. Omitting `apiVersion` defaults
to `1` for backward compatibility.
```

- [ ] **Step 3: Verify the stamped manifests still validate**

Run: `pnpm -F @amiba/extension-host test`
Expected: PASS. Then sanity-check the JSON parses:

Run: `node -e "for (const p of ['tool-meter','token-meter','knowledge-base']) { const m = require('./extensions/'+p+'/manifest.json'); if (m.apiVersion !== 1) throw new Error(p+': apiVersion not 1'); } console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add extensions/tool-meter/manifest.json extensions/token-meter/manifest.json \
        extensions/knowledge-base/manifest.json docs/marketplace-bootstrap.md
git commit -m "chore(extensions+docs): stamp apiVersion:1 and document API gating"
```

---

## Final Verification

- [ ] **Run the whole extension-host suite + typecheck once more**

Run: `pnpm -F @amiba/extension-host test && pnpm -F @amiba/extension-host exec tsc --noEmit`
Expected: all tests PASS, tsc exit 0.

- [ ] **Manual integration smoke (optional but recommended)**

In a desktop dev run, temporarily set a test extension's `manifest.apiVersion` to `HOST_API_VERSION + 1`, reload, and confirm: (a) it does not activate, (b) `extensions:status` reports `status: "incompatible"` with the reason, (c) the app does not crash. Revert the manifest after.

---

## Self-Review (done while writing)

- **Spec §3.1 integer level** → Task 1 (`API_VERSION`, `checkCompat`). ✓
- **Spec §3.2 single source + exposure** → Task 1 (`HOST_API_VERSION` re-export) + Task 3 (`host.hostInfo`, `window.hermes.apiVersion`). ✓
- **Spec §3.3 manifest field** → Task 2 (`apiVersion` type + schema + validation). ✓
- **Spec §3.4 enforce at discover/activate + install** → Task 4 (activateOne, covers discovery + reload) + Task 5 (marketplace install). ✓
- **Spec §3.5 status + reason** → Task 4 sets `status: "incompatible"` + `error`, which flows through the existing `registerStatusChannel` (`extensions:status`). Renderer label deferred (no management UI on this branch — noted). ✓
- **Type consistency:** `checkCompat(required: number | undefined, hostApiVersion: number) => { ok: true } | { ok: false; reason: string }` used identically in Tasks 4 & 5; `HOST_API_VERSION` (number) and `manifest.apiVersion?: number` consistent across Tasks 1-5; status string `"incompatible"` matches between registry union (Task 4) and the value set in `activateOne`. ✓
- **Placeholder scan:** every code step has complete code; no TODO/TBD. ✓
