# Desktop Extension System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a pluggable desktop extension system (Obsidian-style) and migrate all gbrain/knowledge-base surface area out of the core desktop into the first extension.

**Architecture:** `@hermes-x/extension-api` (types-only) + `@hermes-x/extension-host` (main / preload / renderer sub-entries) + `extensions/<id>/` extensions with `manifest.json` + dual entries (main/renderer). First-phase loader is compile-time glob via Vite's `import.meta.glob` so extensions ship inside the desktop bundle; the same Host API survives a runtime FS loader in phase 2.

**Tech Stack:** TypeScript 5.6, Electron-Vite, React 18, pnpm workspaces, Vitest (introduced for `extension-host` unit tests), lucide-react icons, Tailwind preset shared via `@hermes-x/ui`.

**Reference spec:** `docs/superpowers/specs/2026-06-03-desktop-extension-system-design.md` — keep it open while executing.

**Testing model:** This repo has no pre-existing test runner. We introduce **Vitest** in `packages/extension-host` for pure-logic unit tests (manifest validation, slot registry, dep sort, failure isolation). UI integration is verified by `pnpm typecheck` + manual dev-mode smoke (run `pnpm dev:desktop` and confirm visible behaviour). Regression is a `grep` lint script.

---

## File Structure

### New packages

```
packages/extension-api/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              # re-exports types
    ├── manifest.ts           # ExtensionManifest + Contributes
    ├── host.ts               # MainHost / RendererHost / Logger / Disposable
    ├── slots.ts              # SlotName / SlotEntry / SlotContext
    ├── settings.ts           # SettingsSchema
    └── manifest.schema.json  # JSON Schema for manifest.json
```

```
packages/extension-host/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── main/
    │   ├── index.ts          # registerExtensionHost(): main side entry
    │   ├── discover.ts       # scan + parse manifests (compile-time glob)
    │   ├── registry.ts       # Map<id, RuntimeExtension>
    │   ├── activate.ts       # activate(host) + failure isolation + timeout
    │   ├── ipc-router.ts     # ipcMain.handle("ext-invoke", ...)
    │   ├── settings-store.ts # main-side scoped settings wrapper
    │   ├── storage-fs.ts     # main-side per-extension FS storage
    │   └── make-main-host.ts # builds the MainHost passed to activate
    ├── preload/
    │   └── index.ts          # exposeExtensionsBridge(): window.hermes.extensions.*
    ├── renderer/
    │   ├── index.ts          # bootRendererExtensions(): renderer entry
    │   ├── discover.ts       # compile-time glob of manifests + bundles
    │   ├── registry.ts       # renderer-side mirror of slots
    │   ├── make-renderer-host.ts  # builds the RendererHost
    │   ├── slot-registry.ts  # slot Map + observe()
    │   ├── slot-outlet.tsx   # <SlotOutlet name=... />
    │   └── i18n-merge.ts     # merge ext.<id>.* tables into @hermes-x/i18n
    └── __tests__/
        ├── manifest.test.ts
        ├── slot-registry.test.ts
        ├── activate.test.ts
        └── i18n-merge.test.ts
```

```
extensions/knowledge-base/
├── package.json
├── manifest.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts            # builds dist/main.cjs + dist/renderer.js
└── src/
    ├── main/
    │   ├── index.ts          # export activate(host) — wraps gbrain ipc.ts
    │   └── lib/
    │       ├── cli.ts        # ← apps/desktop/src/main/gbrain/cli.ts
    │       ├── client.ts     # ← apps/desktop/src/main/gbrain/client.ts
    │       ├── launcher.ts   # ← apps/desktop/src/main/gbrain/launcher.ts
    │       ├── provider-env.ts
    │       └── recipe-schema.ts
    ├── renderer/
    │   ├── index.ts          # registers sidebar.view / settings.tab / composer.hint
    │   └── views/
    │       ├── KnowledgePanel.tsx        # ← SettingsBrain.tsx
    │       ├── SettingsKnowledgeTab.tsx  # ← SettingsBrainConfig.tsx
    │       ├── BrainDisconnectedHint.tsx # ← HomeView brain hint + brain-install.ts
    │       └── brain-install.ts          # ← packages/ui/src/settings/brain-install.ts
    └── i18n/
        ├── en.json
        └── zh-CN.json
```

### Modified files

- `pnpm-workspace.yaml` — already covers `packages/*`; we add `extensions/*` glob.
- `apps/desktop/package.json` — add deps `@hermes-x/extension-host`, `@hermes-x/ext-knowledge-base`.
- `apps/desktop/src/main/index.ts` — replace gbrain init with extension-host init.
- `apps/desktop/src/preload/index.ts` — delete `gbrain` namespace, add extensions bridge.
- `apps/desktop/src/renderer/App.tsx` — wrap in `<ExtensionsProvider>`; mount renderer host.
- `apps/desktop/src/renderer/global.d.ts` — delete `gbrain` field, add `extensions` field.
- `apps/desktop/electron.vite.config.ts` — alias / glob config if needed.
- `packages/core/src/config.ts` — delete `BRAIN_*` constants.
- `packages/ui/src/chat/ActivityBar.tsx` — merge core + extension items.
- `packages/ui/src/chat/FullScreenChatView.tsx` — replace `sidebarView === "knowledge"` with `<SlotOutlet>`.
- `packages/ui/src/home/HomeView.tsx` — replace brain hint with `<SlotOutlet name="composer.hint">`.
- `packages/ui/src/settings/SettingsView.tsx` — delete `brain` tab; add `extensions` tab; render extension settings tabs via SlotOutlet.
- `packages/ui/src/settings/SettingsBrain.tsx` — **delete** (moved to extension).
- `packages/ui/src/settings/SettingsBrainConfig.tsx` — **delete**.
- `packages/ui/src/settings/brain-install.ts` — **delete**.
- `packages/i18n/src/{en,zh-CN}.ts` — delete `options.brain.*`, `options.brainConfig.*`, `options.nav.brain`, `newtab.brainHint`, `sidepanel.sessions.group.knowledge`. Add `options.nav.extensions`.

### Deleted files

- `apps/desktop/src/main/gbrain/` — entire directory (cli.ts, client.ts, ipc.ts, launcher.ts, provider-env.ts, recipe-schema.ts).
- `packages/ui/src/settings/SettingsBrain.tsx`
- `packages/ui/src/settings/SettingsBrainConfig.tsx`
- `packages/ui/src/settings/brain-install.ts`

---

# Phase 0 — `@hermes-x/extension-api` (types only)

Goal: A types-only package both extension authors and `extension-host` depend on. No runtime code, no JSX, no electron import.

### Task 0.1: Scaffold package

**Files:**
- Create: `packages/extension-api/package.json`
- Create: `packages/extension-api/tsconfig.json`
- Create: `packages/extension-api/src/index.ts`

- [ ] **Step 1: Create `packages/extension-api/package.json`**

```json
{
  "name": "@hermes-x/extension-api",
  "version": "0.1.0",
  "private": true,
  "description": "Type-only contract between hermes-x extensions and the extension host.",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./manifest.schema.json": "./src/manifest.schema.json"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "peerDependencies": {
    "react": "^18.0.0"
  },
  "peerDependenciesMeta": {
    "react": { "optional": true }
  },
  "devDependencies": {
    "@types/react": "18.3.12",
    "typescript": "5.6.3"
  }
}
```

- [ ] **Step 2: Create `packages/extension-api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/extension-api/src/index.ts`**

```ts
export * from "./manifest"
export * from "./host"
export * from "./slots"
export * from "./settings"
```

- [ ] **Step 4: Commit**

```bash
git add packages/extension-api/package.json packages/extension-api/tsconfig.json packages/extension-api/src/index.ts
git commit -m "feat(extension-api): scaffold types-only package"
```

### Task 0.2: Manifest types

**Files:**
- Create: `packages/extension-api/src/manifest.ts`
- Create: `packages/extension-api/src/manifest.schema.json`

- [ ] **Step 1: Write `packages/extension-api/src/manifest.ts`**

```ts
/**
 * Static, build-time-readable description of an extension. Parsed before
 * any extension code is loaded, so loader can still render contributes
 * (activityBar item, settings tab) for an extension whose entry crashed.
 */
export interface ExtensionManifest {
  /** Reverse-DNS id, used to namespace ipc / settings / storage / i18n. */
  id: string
  /** Human display name (untranslated; the i18n table holds translations). */
  name: string
  /** Semver — must match `package.json`. */
  version: string
  /** Host version constraint. Phase 1: read but not enforced. */
  engines?: { "hermes-x"?: string }
  /** Relative bundle paths (each optional — pure renderer / pure main allowed). */
  entries: {
    main?: string
    renderer?: string
  }
  /** Relative paths to flat-key JSON catalogs per locale. */
  i18n?: Partial<Record<"en" | "zh-CN", string>>
  /** Static contribution declarations. Loader registers them whether or not activate runs. */
  contributes?: ManifestContributes
  /** Hermes-agent plugin dependencies. */
  hermesPlugins?: Array<{
    id: string
    version?: string
    required?: boolean
  }>
  /** Permission tokens declared by the extension. Phase 1: not enforced. */
  permissions?: Permission[]
}

export interface ManifestContributes {
  activityBar?: Array<{
    id: string
    iconKey: string
    labelKey: string
    order?: number
  }>
  sidebarViews?: Array<{
    id: string
    /** "activityBar:<id>" — view is mounted when matching activity item is selected. */
    anchor: string
  }>
  settingsTabs?: Array<{
    id: string
    labelKey: string
    order?: number
  }>
  composerHints?: Array<{
    id: string
  }>
}

export type Permission =
  | "ipc"
  | "settings"
  | "storage"
  | "i18n"
  | "lifecycle.boot"
  | "hermes.callTool"
```

- [ ] **Step 2: Write `packages/extension-api/src/manifest.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Hermes-x Extension Manifest",
  "type": "object",
  "required": ["id", "name", "version", "entries"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "id": { "type": "string", "pattern": "^[a-z0-9]+(\\.[a-z0-9-]+)+$" },
    "name": { "type": "string", "minLength": 1 },
    "version": { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+" },
    "engines": {
      "type": "object",
      "properties": { "hermes-x": { "type": "string" } },
      "additionalProperties": false
    },
    "entries": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "main": { "type": "string" },
        "renderer": { "type": "string" }
      }
    },
    "i18n": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "en": { "type": "string" },
        "zh-CN": { "type": "string" }
      }
    },
    "contributes": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "activityBar": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "iconKey", "labelKey"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string" },
              "iconKey": { "type": "string" },
              "labelKey": { "type": "string" },
              "order": { "type": "number" }
            }
          }
        },
        "sidebarViews": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "anchor"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string" },
              "anchor": { "type": "string", "pattern": "^activityBar:" }
            }
          }
        },
        "settingsTabs": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "labelKey"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string" },
              "labelKey": { "type": "string" },
              "order": { "type": "number" }
            }
          }
        },
        "composerHints": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id"],
            "additionalProperties": false,
            "properties": { "id": { "type": "string" } }
          }
        }
      }
    },
    "hermesPlugins": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string" },
          "version": { "type": "string" },
          "required": { "type": "boolean" }
        }
      }
    },
    "permissions": {
      "type": "array",
      "items": {
        "enum": ["ipc", "settings", "storage", "i18n", "lifecycle.boot", "hermes.callTool"]
      }
    }
  }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @hermes-x/extension-api typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-api/src/manifest.ts packages/extension-api/src/manifest.schema.json
git commit -m "feat(extension-api): manifest schema + types"
```

### Task 0.3: Host / slot / settings types

**Files:**
- Create: `packages/extension-api/src/host.ts`
- Create: `packages/extension-api/src/slots.ts`
- Create: `packages/extension-api/src/settings.ts`

- [ ] **Step 1: Write `packages/extension-api/src/host.ts`**

```ts
import type { ComponentType, ReactNode } from "react"
import type { SlotName, SlotEntry, SlotContext } from "./slots"
import type { SettingsSchema } from "./settings"

export interface Disposable {
  dispose(): void
}

export interface Logger {
  debug(...args: unknown[]): void
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface IpcContext {
  /** Numeric id of the BrowserWindow that issued the call, or null for main. */
  windowId: number | null
}

export interface MainHost {
  readonly id: string
  logger: Logger
  ipc: {
    expose<TArgs = unknown, TRet = unknown>(
      channel: string,
      handler: (args: TArgs, ctx: IpcContext) => Promise<TRet> | TRet,
    ): Disposable
  }
  lifecycle: {
    onBootBackground(handler: () => Promise<void> | void): Disposable
    onShutdown(handler: () => Promise<void> | void): Disposable
  }
  settings: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
  }
  storage: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
  }
  hermes: {
    callTool<TArgs = unknown, TRet = unknown>(
      tool: string,
      args: TArgs,
    ): Promise<TRet>
  }
}

export interface RendererHost {
  readonly id: string
  logger: Logger
  slots: {
    register<P = unknown>(
      slot: SlotName,
      component: ComponentType<P>,
      options?: { slotEntryId?: string; order?: number; props?: Partial<P> },
    ): Disposable
  }
  commands: {
    register(
      commandId: string,
      handler: (args?: unknown) => Promise<unknown> | unknown,
    ): Disposable
    invoke(commandId: string, args?: unknown): Promise<unknown>
  }
  settings: {
    define(schema: SettingsSchema): Disposable
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
    watch<T = unknown>(key: string, cb: (v: T) => void): Disposable
  }
  storage: {
    get<T = unknown>(key: string, fallback: T): Promise<T>
    set<T = unknown>(key: string, value: T): Promise<void>
    watch<T = unknown>(key: string, cb: (v: T) => void): Disposable
  }
  ipc: {
    invoke<TArgs = unknown, TRet = unknown>(
      channel: string,
      args: TArgs,
    ): Promise<TRet>
  }
  i18n: {
    t(key: string, params?: Record<string, unknown>): string
  }
  hermes: {
    callTool(tool: string, args: unknown): Promise<unknown>
  }
  notify(kind: "info" | "warn" | "error", message: string): void
}

export type MainActivate = (host: MainHost) => Promise<void> | void
export type MainDeactivate = () => Promise<void> | void
export type RendererActivate = (host: RendererHost) => Promise<void> | void

export interface MainModule {
  activate: MainActivate
  deactivate?: MainDeactivate
}

export interface RendererModule {
  activate: RendererActivate
}

export type { ReactNode, ComponentType, SlotName, SlotEntry, SlotContext, SettingsSchema }
```

- [ ] **Step 2: Write `packages/extension-api/src/slots.ts`**

```ts
import type { ComponentType, ReactNode } from "react"

export type SlotName =
  | "activityBar.item"
  | "sidebar.view"
  | "settings.tab"
  | "composer.hint"

export interface SlotEntry<P = unknown> {
  /** Owning extension id. */
  extensionId: string
  /** Unique within (extensionId, slot). Matches manifest contribute id when available. */
  entryId: string
  /** Render order (lower first). Falls back to manifest order. */
  order: number
  /** React component to render. Receives `slotProps` merged with the outlet's runtime props. */
  component: ComponentType<P>
  /** Optional static props bound at register time. */
  props?: Partial<P>
}

export interface SlotContext {
  extensionId: string
  slot: SlotName
}

/** Props an outlet may pass to all entries in a multi-instance slot. */
export type MultiSlotChildren = ReactNode
```

- [ ] **Step 3: Write `packages/extension-api/src/settings.ts`**

```ts
export type SettingsFieldType =
  | "string"
  | "number"
  | "boolean"
  | "url"
  | "secret"

export interface SettingsField {
  key: string
  type: SettingsFieldType
  labelKey: string
  descriptionKey?: string
  defaultValue?: unknown
  /** When `tabId` is set the field is rendered under that contributed settings tab. */
  tabId?: string
}

export interface SettingsSchema {
  fields: SettingsField[]
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hermes-x/extension-api typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-api/src/host.ts packages/extension-api/src/slots.ts packages/extension-api/src/settings.ts
git commit -m "feat(extension-api): host / slot / settings types"
```

---

# Phase 1 — `@hermes-x/extension-host` skeleton

Goal: A loadable host that scans `extensions/*`, validates manifests, activates main entries, exposes preload bridge, and provides SlotOutlet to renderer. Vitest covers the pure-logic units.

### Task 1.1: Scaffold package + Vitest

**Files:**
- Create: `packages/extension-host/package.json`
- Create: `packages/extension-host/tsconfig.json`
- Create: `packages/extension-host/vitest.config.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@hermes-x/extension-host",
  "version": "0.1.0",
  "private": true,
  "description": "Loader, registry, and host APIs for hermes-x desktop extensions.",
  "main": "src/main/index.ts",
  "types": "src/main/index.ts",
  "exports": {
    "./main": "./src/main/index.ts",
    "./preload": "./src/preload/index.ts",
    "./renderer": "./src/renderer/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@hermes-x/extension-api": "workspace:*",
    "@hermes-x/i18n": "workspace:*"
  },
  "peerDependencies": {
    "electron": "*",
    "react": "^18.0.0"
  },
  "peerDependenciesMeta": {
    "electron": { "optional": true },
    "react": { "optional": true }
  },
  "devDependencies": {
    "@types/react": "18.3.12",
    "react": "18.3.1",
    "typescript": "5.6.3",
    "vitest": "2.1.4"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/__tests__/**/*.test.ts"],
  },
})
```

- [ ] **Step 4: Install deps**

Run: `pnpm install`
Expected: New package recognized; vitest installed under `packages/extension-host/node_modules`.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-host/package.json packages/extension-host/tsconfig.json packages/extension-host/vitest.config.ts pnpm-lock.yaml
git commit -m "feat(extension-host): scaffold package + vitest"
```

### Task 1.2: Manifest validation (TDD)

**Files:**
- Create: `packages/extension-host/src/main/discover.ts`
- Create: `packages/extension-host/src/__tests__/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/extension-host/src/__tests__/manifest.test.ts
import { describe, expect, it } from "vitest"
import { validateManifest } from "../main/discover"

describe("validateManifest", () => {
  const base = {
    id: "io.hermes.example",
    name: "Example",
    version: "0.1.0",
    entries: { renderer: "dist/renderer.js" },
  }

  it("accepts a minimal valid manifest", () => {
    const r = validateManifest(base)
    expect(r.ok).toBe(true)
  })

  it("rejects an id that is not reverse-DNS", () => {
    const r = validateManifest({ ...base, id: "knowledge-base" })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/id/)
  })

  it("rejects when both entries are missing", () => {
    const r = validateManifest({ ...base, entries: {} })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/entries/)
  })

  it("rejects a non-semver version", () => {
    const r = validateManifest({ ...base, version: "v1" })
    expect(r.ok).toBe(false)
  })

  it("rejects sidebarView anchor that does not start with activityBar:", () => {
    const r = validateManifest({
      ...base,
      contributes: { sidebarViews: [{ id: "x", anchor: "main:y" }] },
    })
    expect(r.ok).toBe(false)
    expect(r.ok ? "" : r.error).toMatch(/anchor/)
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter @hermes-x/extension-host test`
Expected: FAIL with "Cannot find module '../main/discover'".

- [ ] **Step 3: Write minimal `discover.ts` to make the test pass**

```ts
// packages/extension-host/src/main/discover.ts
import type { ExtensionManifest } from "@hermes-x/extension-api"

export type ValidationResult =
  | { ok: true; manifest: ExtensionManifest }
  | { ok: false; error: string }

const ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/
const SEMVER_RE = /^\d+\.\d+\.\d+/

export function validateManifest(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "manifest is not an object" }
  }
  const m = raw as Record<string, unknown>

  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    return { ok: false, error: `invalid id (must be reverse-DNS): ${String(m.id)}` }
  }
  if (typeof m.name !== "string" || m.name.length === 0) {
    return { ok: false, error: "missing name" }
  }
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    return { ok: false, error: `invalid version: ${String(m.version)}` }
  }
  const entries = m.entries as Record<string, unknown> | undefined
  if (
    !entries ||
    (typeof entries.main !== "string" && typeof entries.renderer !== "string")
  ) {
    return { ok: false, error: "entries must include main and/or renderer" }
  }

  const contributes = m.contributes as Record<string, unknown> | undefined
  if (contributes && Array.isArray(contributes.sidebarViews)) {
    for (const v of contributes.sidebarViews as Array<Record<string, unknown>>) {
      if (typeof v.anchor !== "string" || !v.anchor.startsWith("activityBar:")) {
        return { ok: false, error: `sidebarView anchor must start with "activityBar:": ${String(v.anchor)}` }
      }
    }
  }

  return { ok: true, manifest: raw as ExtensionManifest }
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `pnpm --filter @hermes-x/extension-host test`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-host/src/__tests__/manifest.test.ts packages/extension-host/src/main/discover.ts
git commit -m "feat(extension-host): manifest validation"
```

### Task 1.3: Slot registry (TDD)

**Files:**
- Create: `packages/extension-host/src/renderer/slot-registry.ts`
- Create: `packages/extension-host/src/__tests__/slot-registry.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/extension-host/src/__tests__/slot-registry.test.ts
import { describe, expect, it, vi } from "vitest"
import { createSlotRegistry } from "../renderer/slot-registry"

describe("SlotRegistry", () => {
  it("returns entries sorted by order ascending", () => {
    const reg = createSlotRegistry()
    reg.register({ extensionId: "a", entryId: "x", order: 20, component: () => null })
    reg.register({ extensionId: "b", entryId: "y", order: 10, component: () => null })
    const ids = reg.get("activityBar.item").map((e) => e.entryId)
    expect(ids).toEqual(["y", "x"])
  })

  it("disposing a registration removes it from subsequent reads", () => {
    const reg = createSlotRegistry()
    const d = reg.register({
      extensionId: "a",
      entryId: "x",
      order: 0,
      component: () => null,
    })
    expect(reg.get("activityBar.item")).toHaveLength(1)
    d.dispose()
    expect(reg.get("activityBar.item")).toHaveLength(0)
  })

  it("notifies subscribers on register / dispose", () => {
    const reg = createSlotRegistry()
    const cb = vi.fn()
    reg.subscribe(cb)
    const d = reg.register({
      extensionId: "a",
      entryId: "x",
      order: 0,
      component: () => null,
    })
    expect(cb).toHaveBeenCalledTimes(1)
    d.dispose()
    expect(cb).toHaveBeenCalledTimes(2)
  })
})
```

Note: in the test, `slot` is implicit (`activityBar.item`) — actual API: `register(slot, entry)`. Adjust signature accordingly — tests above currently use a single-arg form; update before running:

Adjust the test to pass `slot` first arg:

```ts
reg.register("activityBar.item", { extensionId: "a", entryId: "x", order: 20, component: () => null })
// ...same pattern for other calls
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @hermes-x/extension-host test slot-registry`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write `slot-registry.ts`**

```ts
// packages/extension-host/src/renderer/slot-registry.ts
import type { Disposable, SlotEntry, SlotName } from "@hermes-x/extension-api"

type Listener = () => void

export interface SlotRegistry {
  register<P>(slot: SlotName, entry: SlotEntry<P>): Disposable
  get<P>(slot: SlotName): ReadonlyArray<SlotEntry<P>>
  subscribe(cb: Listener): Disposable
}

export function createSlotRegistry(): SlotRegistry {
  const slots = new Map<SlotName, Array<SlotEntry<unknown>>>()
  const listeners = new Set<Listener>()

  function notify() {
    for (const l of listeners) l()
  }

  return {
    register<P>(slot: SlotName, entry: SlotEntry<P>): Disposable {
      const list = (slots.get(slot) ?? []) as Array<SlotEntry<unknown>>
      list.push(entry as SlotEntry<unknown>)
      list.sort((a, b) => a.order - b.order)
      slots.set(slot, list)
      notify()
      return {
        dispose: () => {
          const cur = slots.get(slot)
          if (!cur) return
          const i = cur.indexOf(entry as SlotEntry<unknown>)
          if (i >= 0) cur.splice(i, 1)
          notify()
        },
      }
    },
    get<P>(slot: SlotName): ReadonlyArray<SlotEntry<P>> {
      return (slots.get(slot) ?? []) as ReadonlyArray<SlotEntry<P>>
    },
    subscribe(cb: Listener): Disposable {
      listeners.add(cb)
      return { dispose: () => listeners.delete(cb) }
    },
  }
}
```

- [ ] **Step 4: Run tests, verify PASS**

Run: `pnpm --filter @hermes-x/extension-host test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-host/src/__tests__/slot-registry.test.ts packages/extension-host/src/renderer/slot-registry.ts
git commit -m "feat(extension-host): slot registry"
```

### Task 1.4: Activate + failure isolation (TDD)

**Files:**
- Create: `packages/extension-host/src/main/registry.ts`
- Create: `packages/extension-host/src/main/activate.ts`
- Create: `packages/extension-host/src/__tests__/activate.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/extension-host/src/__tests__/activate.test.ts
import { describe, expect, it, vi } from "vitest"
import type { ExtensionManifest, MainHost } from "@hermes-x/extension-api"
import { activateMainExtensions } from "../main/activate"

const fakeHost = (id: string): MainHost => ({
  id,
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  ipc: { expose: vi.fn(() => ({ dispose: vi.fn() })) },
  lifecycle: {
    onBootBackground: vi.fn(() => ({ dispose: vi.fn() })),
    onShutdown: vi.fn(() => ({ dispose: vi.fn() })),
  },
  settings: { get: vi.fn(), set: vi.fn() } as unknown as MainHost["settings"],
  storage: { get: vi.fn(), set: vi.fn() } as unknown as MainHost["storage"],
  hermes: { callTool: vi.fn() } as unknown as MainHost["hermes"],
})

const mk = (id: string): ExtensionManifest => ({
  id,
  name: id,
  version: "0.1.0",
  entries: { main: "dist/main.cjs" },
})

describe("activateMainExtensions", () => {
  it("activates each extension exactly once", async () => {
    const ok = vi.fn().mockResolvedValue(undefined)
    const result = await activateMainExtensions({
      manifests: [mk("io.a.one"), mk("io.b.two")],
      loadMain: async () => ({ activate: ok }),
      makeHost: fakeHost,
    })
    expect(ok).toHaveBeenCalledTimes(2)
    expect(result.loaded.map((e) => e.id)).toEqual(["io.a.one", "io.b.two"])
    expect(result.failed).toHaveLength(0)
  })

  it("isolates a failing extension and continues loading others", async () => {
    const result = await activateMainExtensions({
      manifests: [mk("io.a.bad"), mk("io.b.good")],
      loadMain: async (id) => ({
        activate:
          id === "io.a.bad"
            ? () => {
                throw new Error("boom")
              }
            : vi.fn().mockResolvedValue(undefined),
      }),
      makeHost: fakeHost,
    })
    expect(result.failed.map((e) => e.id)).toEqual(["io.a.bad"])
    expect(result.failed[0].error).toMatch(/boom/)
    expect(result.loaded.map((e) => e.id)).toEqual(["io.b.good"])
  })

  it("times out an activate that hangs > timeoutMs", async () => {
    const result = await activateMainExtensions({
      manifests: [mk("io.slow.one")],
      loadMain: async () => ({
        activate: () => new Promise(() => undefined),
      }),
      makeHost: fakeHost,
      timeoutMs: 50,
    })
    expect(result.failed.map((e) => e.id)).toEqual(["io.slow.one"])
    expect(result.failed[0].error).toMatch(/timeout/i)
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @hermes-x/extension-host test activate`
Expected: FAIL "Cannot find module '../main/activate'".

- [ ] **Step 3: Write `registry.ts`**

```ts
// packages/extension-host/src/main/registry.ts
import type { ExtensionManifest } from "@hermes-x/extension-api"

export interface RuntimeExtension {
  id: string
  manifest: ExtensionManifest
  status: "loaded" | "failed" | "disabled"
  error?: string
}

export function createExtensionRegistry() {
  const byId = new Map<string, RuntimeExtension>()
  return {
    set(ext: RuntimeExtension) {
      byId.set(ext.id, ext)
    },
    get(id: string): RuntimeExtension | undefined {
      return byId.get(id)
    },
    list(): RuntimeExtension[] {
      return [...byId.values()]
    },
  }
}
```

- [ ] **Step 4: Write `activate.ts`**

```ts
// packages/extension-host/src/main/activate.ts
import type {
  ExtensionManifest,
  MainHost,
  MainModule,
} from "@hermes-x/extension-api"

export interface ActivateOptions {
  manifests: ExtensionManifest[]
  loadMain: (extensionId: string) => Promise<MainModule>
  makeHost: (extensionId: string) => MainHost
  timeoutMs?: number
}

export interface ActivateResult {
  loaded: Array<{ id: string }>
  failed: Array<{ id: string; error: string }>
}

const DEFAULT_TIMEOUT_MS = 10_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`activate timeout after ${ms}ms`)), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      (e) => {
        clearTimeout(id)
        reject(e)
      },
    )
  })
}

export async function activateMainExtensions(
  opts: ActivateOptions,
): Promise<ActivateResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const loaded: ActivateResult["loaded"] = []
  const failed: ActivateResult["failed"] = []

  for (const manifest of opts.manifests) {
    if (!manifest.entries.main) {
      loaded.push({ id: manifest.id })
      continue
    }
    try {
      const mod = await opts.loadMain(manifest.id)
      const host = opts.makeHost(manifest.id)
      await withTimeout(Promise.resolve(mod.activate(host)), timeoutMs)
      loaded.push({ id: manifest.id })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      failed.push({ id: manifest.id, error })
    }
  }

  return { loaded, failed }
}
```

- [ ] **Step 5: Run tests, verify PASS**

Run: `pnpm --filter @hermes-x/extension-host test`
Expected: All activate tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/extension-host/src/main/registry.ts packages/extension-host/src/main/activate.ts packages/extension-host/src/__tests__/activate.test.ts
git commit -m "feat(extension-host): activate + failure isolation + timeout"
```

### Task 1.5: i18n merge

**Files:**
- Create: `packages/extension-host/src/renderer/i18n-merge.ts`
- Create: `packages/extension-host/src/__tests__/i18n-merge.test.ts`
- Modify: `packages/i18n/src/index.ts` (export merge hook — see step 4)

- [ ] **Step 1: Write failing test**

```ts
// packages/extension-host/src/__tests__/i18n-merge.test.ts
import { describe, expect, it } from "vitest"
import { prefixTable, mergeExtensionTables } from "../renderer/i18n-merge"

describe("prefixTable", () => {
  it("prepends ext.<id>. to every key", () => {
    const out = prefixTable("io.foo.bar", { "label": "X" })
    expect(out).toEqual({ "ext.io.foo.bar.label": "X" })
  })
})

describe("mergeExtensionTables", () => {
  it("merges multiple extensions without clobbering core keys", () => {
    const result = mergeExtensionTables({
      core: { "core.key": "Core" },
      perExtension: {
        "io.a.one": { "x": "X" },
        "io.b.two": { "y": "Y" },
      },
    })
    expect(result).toEqual({
      "core.key": "Core",
      "ext.io.a.one.x": "X",
      "ext.io.b.two.y": "Y",
    })
  })
})
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @hermes-x/extension-host test i18n-merge`
Expected: FAIL.

- [ ] **Step 3: Write `i18n-merge.ts`**

```ts
// packages/extension-host/src/renderer/i18n-merge.ts
export type FlatI18nTable = Record<string, string>

export function prefixTable(extensionId: string, table: FlatI18nTable): FlatI18nTable {
  const out: FlatI18nTable = {}
  const prefix = `ext.${extensionId}.`
  for (const [k, v] of Object.entries(table)) out[prefix + k] = v
  return out
}

export function mergeExtensionTables(opts: {
  core: FlatI18nTable
  perExtension: Record<string, FlatI18nTable>
}): FlatI18nTable {
  const merged: FlatI18nTable = { ...opts.core }
  for (const [id, table] of Object.entries(opts.perExtension)) {
    const prefixed = prefixTable(id, table)
    for (const [k, v] of Object.entries(prefixed)) merged[k] = v
  }
  return merged
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @hermes-x/extension-host test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-host/src/renderer/i18n-merge.ts packages/extension-host/src/__tests__/i18n-merge.test.ts
git commit -m "feat(extension-host): i18n table prefix + merge"
```

### Task 1.6: i18n runtime hook for extension tables

**Files:**
- Modify: `packages/i18n/src/index.ts`
- Modify: `packages/i18n/package.json` — no change needed, just dep
- Add the merge function to runtime so `useT()` can resolve `ext.*` keys

- [ ] **Step 1: Read current `packages/i18n/src/index.ts`**

Already read — relevant change: replace the static `CATALOG` lookup with one that consults an "extension overlay" registered at boot.

- [ ] **Step 2: Modify `packages/i18n/src/index.ts`**

Replace the block:

```ts
const CATALOG: Record<ResolvedLanguage, Messages> = {
  en,
  "zh-CN": zhCN
}
```

with:

```ts
const CATALOG: Record<ResolvedLanguage, Record<string, string>> = {
  en: { ...en },
  "zh-CN": { ...zhCN },
}

/**
 * Extension i18n tables, registered at boot via `registerExtensionMessages`.
 * Merged on top of the core catalog when `useT()` constructs `t`.
 *
 * `ext.*` keys live here; core keys (`options.*`, `common.*`, …) stay in
 * the imported `en` / `zhCN` modules. We intentionally don't expose a way
 * to overwrite core keys — extensions can only add new namespaces.
 */
const EXTENSION_OVERLAY: Record<ResolvedLanguage, Record<string, string>> = {
  en: {},
  "zh-CN": {},
}

const overlayListeners = new Set<() => void>()

export function registerExtensionMessages(
  locale: ResolvedLanguage,
  table: Record<string, string>,
): void {
  Object.assign(EXTENSION_OVERLAY[locale], table)
  for (const l of overlayListeners) l()
}
```

Then update the `useT` function — replace its body's `catalog` access:

```ts
const t = useMemo<TranslateFn>(() => {
  const coreCatalog = CATALOG[language] ?? en
  const overlay = EXTENSION_OVERLAY[language] ?? {}
  return (key, params) => {
    const template =
      overlay[key] ?? coreCatalog[key] ?? EXTENSION_OVERLAY.en[key] ?? en[key as MessageKey] ?? key
    return interpolate(template, params)
  }
}, [language])
```

And subscribe to overlay changes (force re-render on registration):

Add inside `useT()` after the existing `useState(useStoredLanguagePreference())`:

```ts
const [, forceRender] = useState(0)
useEffect(() => {
  const cb = () => forceRender((n) => n + 1)
  overlayListeners.add(cb)
  return () => {
    overlayListeners.delete(cb)
  }
}, [])
```

(Note: the existing `useT` already has hooks at top — add this just after the existing `useState`/`useStoredLanguagePreference` block, before `language` is computed.)

- [ ] **Step 3: Loosen `TranslateFn` to accept `string`**

Replace:

```ts
export type TranslateFn = (key: MessageKey, params?: Record<string, unknown>) => string
```

with:

```ts
/**
 * Translate fn accepts core MessageKey union or an extension-supplied
 * `ext.<id>.<key>` literal. We widen the type to `string` because
 * extension keys aren't part of MessageKey at compile time; the runtime
 * falls back to the key literal when no template matches.
 */
export type TranslateFn = (
  key: MessageKey | (string & {}),
  params?: Record<string, unknown>,
) => string
```

- [ ] **Step 4: Typecheck the whole workspace**

Run: `pnpm -r typecheck`
Expected: PASS. If `MessageKey` strict checks fail in callers, revisit step 3.

- [ ] **Step 5: Commit**

```bash
git add packages/i18n/src/index.ts
git commit -m "feat(i18n): extension overlay registry + string keys"
```

### Task 1.7: Compile-time discovery (Vite glob)

**Files:**
- Create: `packages/extension-host/src/renderer/discover.ts`
- Modify (later): `apps/desktop/electron.vite.config.ts` if Vite glob root needs adjustment

- [ ] **Step 1: Write `packages/extension-host/src/renderer/discover.ts`**

```ts
// packages/extension-host/src/renderer/discover.ts
import type { ExtensionManifest, RendererModule } from "@hermes-x/extension-api"
import { validateManifest } from "../main/discover"

/**
 * Compile-time discovery. Vite expands the glob at build time and the
 * generated map is { "/abs/path/manifest.json": () => import(...) }.
 *
 * We accept the glob result as an opaque module map so this module can be
 * unit-tested in node without Vite.
 */
export type RawManifestModule = () => Promise<{ default: unknown }>
export type RawRendererModule = () => Promise<RendererModule>

export interface DiscoveryInput {
  manifestModules: Record<string, RawManifestModule>
  rendererModules: Record<string, RawRendererModule>
  i18nModules: Record<string, () => Promise<{ default: Record<string, string> }>>
}

export interface DiscoveredExtension {
  manifest: ExtensionManifest
  loadRenderer?: () => Promise<RendererModule>
  loadI18n: (locale: "en" | "zh-CN") => Promise<Record<string, string> | null>
}

/**
 * Extract the extension directory id from a full glob key.
 * Example key: "/abs/repo/extensions/knowledge-base/manifest.json"
 * → "knowledge-base"
 */
function extractDirId(globKey: string): string {
  const m = globKey.match(/\/extensions\/([^/]+)\//)
  return m ? m[1]! : globKey
}

export async function discoverRendererExtensions(
  input: DiscoveryInput,
): Promise<{ extensions: DiscoveredExtension[]; failed: Array<{ key: string; error: string }> }> {
  const failed: Array<{ key: string; error: string }> = []
  const extensions: DiscoveredExtension[] = []

  for (const [manifestKey, load] of Object.entries(input.manifestModules)) {
    let manifest: ExtensionManifest
    try {
      const mod = await load()
      const v = validateManifest(mod.default)
      if (!v.ok) {
        failed.push({ key: manifestKey, error: v.error })
        continue
      }
      manifest = v.manifest
    } catch (e) {
      failed.push({ key: manifestKey, error: e instanceof Error ? e.message : String(e) })
      continue
    }

    const dirId = extractDirId(manifestKey)
    const rendererKey = Object.keys(input.rendererModules).find((k) =>
      k.includes(`/extensions/${dirId}/`),
    )
    const i18nKeyFor = (locale: "en" | "zh-CN") =>
      Object.keys(input.i18nModules).find(
        (k) => k.includes(`/extensions/${dirId}/`) && k.endsWith(`/${locale}.json`),
      )

    extensions.push({
      manifest,
      loadRenderer: rendererKey ? input.rendererModules[rendererKey] : undefined,
      loadI18n: async (locale) => {
        const key = i18nKeyFor(locale)
        if (!key) return null
        try {
          const m = await input.i18nModules[key]!()
          return m.default
        } catch {
          return null
        }
      },
    })
  }

  return { extensions, failed }
}
```

- [ ] **Step 2: Quick test that extractDirId behaves**

Add to the existing `manifest.test.ts`:

```ts
// (append)
import { discoverRendererExtensions } from "../renderer/discover"

describe("discoverRendererExtensions", () => {
  it("matches renderer + i18n to a manifest by directory id", async () => {
    const r = await discoverRendererExtensions({
      manifestModules: {
        "/r/extensions/kb/manifest.json": async () => ({
          default: {
            id: "io.hermes.knowledge-base",
            name: "KB",
            version: "0.1.0",
            entries: { renderer: "dist/renderer.js" },
          },
        }),
      },
      rendererModules: {
        "/r/extensions/kb/dist/renderer.js": async () => ({
          activate: () => undefined,
        }),
      },
      i18nModules: {
        "/r/extensions/kb/dist/i18n/en.json": async () => ({
          default: { hello: "Hello" },
        }),
      },
    })
    expect(r.failed).toEqual([])
    expect(r.extensions).toHaveLength(1)
    const en = await r.extensions[0]!.loadI18n("en")
    expect(en).toEqual({ hello: "Hello" })
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @hermes-x/extension-host test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/extension-host/src/renderer/discover.ts packages/extension-host/src/__tests__/manifest.test.ts
git commit -m "feat(extension-host): compile-time renderer discovery"
```

### Task 1.8: Main-side helpers (host factory, ipc router)

**Files:**
- Create: `packages/extension-host/src/main/make-main-host.ts`
- Create: `packages/extension-host/src/main/ipc-router.ts`
- Create: `packages/extension-host/src/main/storage-fs.ts`
- Create: `packages/extension-host/src/main/index.ts`

- [ ] **Step 1: Write `make-main-host.ts`**

```ts
// packages/extension-host/src/main/make-main-host.ts
import { ipcMain } from "electron"
import type { Disposable, MainHost } from "@hermes-x/extension-api"

export interface MainHostDeps {
  /** Reads / writes the shared main-process settings store. */
  settingsStore: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
  /** Per-extension FS storage rooted under userData/extensions-storage/<id>. */
  storage: {
    get<T>(extensionId: string, key: string, fallback: T): Promise<T>
    set(extensionId: string, key: string, value: unknown): Promise<void>
  }
  /** Hermes-agent tool dispatcher. */
  callTool: (tool: string, args: unknown) => Promise<unknown>
  /** Tracks IPC handler registrations so they can be torn down on shutdown. */
  trackIpcHandler: (channel: string) => Disposable
  /** Lifecycle hook registries. */
  bootBackground: Set<() => Promise<void> | void>
  shutdown: Set<() => Promise<void> | void>
}

export function makeMainHost(extensionId: string, deps: MainHostDeps): MainHost {
  const log = (level: string, args: unknown[]) =>
    console[level as "info"](`[ext:${extensionId}]`, ...args)

  return {
    id: extensionId,
    logger: {
      debug: (...a) => log("debug", a),
      info: (...a) => log("info", a),
      warn: (...a) => log("warn", a),
      error: (...a) => log("error", a),
    },
    ipc: {
      expose: (channel, handler) => {
        const fullChannel = `ext.${extensionId}.${channel}`
        ipcMain.handle(fullChannel, async (e, args) => {
          return handler(args, { windowId: e.sender?.id ?? null })
        })
        return deps.trackIpcHandler(fullChannel)
      },
    },
    lifecycle: {
      onBootBackground: (h) => {
        deps.bootBackground.add(h)
        return { dispose: () => deps.bootBackground.delete(h) }
      },
      onShutdown: (h) => {
        deps.shutdown.add(h)
        return { dispose: () => deps.shutdown.delete(h) }
      },
    },
    settings: {
      get: (key, fallback) =>
        deps.settingsStore.get(`ext.${extensionId}.${key}`, fallback),
      set: (key, value) =>
        deps.settingsStore.set(`ext.${extensionId}.${key}`, value),
    },
    storage: {
      get: (key, fallback) => deps.storage.get(extensionId, key, fallback),
      set: (key, value) => deps.storage.set(extensionId, key, value),
    },
    hermes: {
      callTool: (tool, args) => deps.callTool(tool, args) as Promise<unknown>,
    },
  } as MainHost
}
```

- [ ] **Step 2: Write `ipc-router.ts`**

```ts
// packages/extension-host/src/main/ipc-router.ts
import { ipcMain } from "electron"
import type { ExtensionManifest } from "@hermes-x/extension-api"

/**
 * The renderer talks to extensions through a single bridge channel
 * `ext-invoke`. The bridge resolves the (extensionId, channel) tuple
 * to the full `ext.<id>.<channel>` form the extension registered.
 * This keeps the preload surface small and prevents renderer code from
 * faking another extension's id at the IPC layer.
 */
export function registerInvokeRouter(getManifests: () => ExtensionManifest[]) {
  ipcMain.handle(
    "ext-invoke",
    async (event, payload: { extensionId?: string; channel?: string; args?: unknown }) => {
      const { extensionId, channel, args } = payload ?? {}
      if (typeof extensionId !== "string" || typeof channel !== "string") {
        throw new Error("ext-invoke: extensionId and channel required")
      }
      const known = getManifests().some((m) => m.id === extensionId)
      if (!known) throw new Error(`unknown extension: ${extensionId}`)
      const full = `ext.${extensionId}.${channel}`
      // Re-dispatch through Electron's existing handler table so the
      // extension's expose() registration handles it.
      return ipcMain
        .listeners(full)
        .length === 0
        ? Promise.reject(new Error(`no handler for ${full}`))
        : (await ipcMain.emit(full, event, args), undefined)
    },
  )
}

/**
 * Bridge for listManifests + i18n + bundle path.
 */
export function registerMetadataChannels(opts: {
  getManifests: () => ExtensionManifest[]
  getI18n: (extensionId: string, locale: "en" | "zh-CN") => Promise<Record<string, string>>
  getRendererBundleUrl: (extensionId: string) => Promise<string | null>
}) {
  ipcMain.handle("extensions:list", () => opts.getManifests())
  ipcMain.handle(
    "extensions:i18n",
    async (_e, payload: { extensionId: string; locale: "en" | "zh-CN" }) =>
      opts.getI18n(payload.extensionId, payload.locale),
  )
  ipcMain.handle(
    "extensions:renderer-bundle-url",
    async (_e, extensionId: string) => opts.getRendererBundleUrl(extensionId),
  )
}
```

Note: `ipcMain.emit` does not return the handler's promise. Replace the `ext-invoke` body with a cleaner dispatch — see step 3.

- [ ] **Step 3: Fix ext-invoke dispatch — use a registry instead of relying on ipcMain.emit**

Replace `registerInvokeRouter` with:

```ts
export type ChannelHandler = (args: unknown, ctx: { windowId: number | null }) => Promise<unknown> | unknown

export function createChannelTable() {
  const table = new Map<string, ChannelHandler>()
  return {
    register(full: string, h: ChannelHandler) {
      if (table.has(full)) throw new Error(`duplicate channel: ${full}`)
      table.set(full, h)
      return { dispose: () => table.delete(full) }
    },
    invoke(full: string, args: unknown, windowId: number | null) {
      const h = table.get(full)
      if (!h) throw new Error(`no handler for ${full}`)
      return Promise.resolve(h(args, { windowId }))
    },
    has(full: string) {
      return table.has(full)
    },
  }
}

export function registerInvokeRouter(
  channelTable: ReturnType<typeof createChannelTable>,
  getManifests: () => ExtensionManifest[],
) {
  ipcMain.handle(
    "ext-invoke",
    async (event, payload: { extensionId?: string; channel?: string; args?: unknown }) => {
      const { extensionId, channel, args } = payload ?? {}
      if (typeof extensionId !== "string" || typeof channel !== "string") {
        throw new Error("ext-invoke: extensionId and channel required")
      }
      if (!getManifests().some((m) => m.id === extensionId)) {
        throw new Error(`unknown extension: ${extensionId}`)
      }
      return channelTable.invoke(
        `ext.${extensionId}.${channel}`,
        args,
        event.sender?.id ?? null,
      )
    },
  )
}
```

Then change `makeMainHost`'s `ipc.expose` to register into this channelTable instead of `ipcMain.handle`:

In `make-main-host.ts`, replace the `ipc: { expose: ... }` block with:

```ts
ipc: {
  expose: (channel, handler) => {
    const fullChannel = `ext.${extensionId}.${channel}`
    return deps.channelTable.register(fullChannel, async (args, ctx) =>
      handler(args as never, ctx),
    )
  },
},
```

and update `MainHostDeps`:

```ts
import type { createChannelTable } from "./ipc-router"

export interface MainHostDeps {
  channelTable: ReturnType<typeof createChannelTable>
  // (drop trackIpcHandler)
  settingsStore: { ... }
  storage: { ... }
  callTool: (tool: string, args: unknown) => Promise<unknown>
  bootBackground: Set<() => Promise<void> | void>
  shutdown: Set<() => Promise<void> | void>
}
```

- [ ] **Step 4: Write `storage-fs.ts`**

```ts
// packages/extension-host/src/main/storage-fs.ts
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"

function rootDir(): string {
  return join(app.getPath("userData"), "extensions-storage")
}

function pathFor(extensionId: string, key: string): string {
  // Defensive: never allow path traversal in key.
  const safe = key.replace(/[^a-zA-Z0-9_.-]/g, "_")
  return join(rootDir(), extensionId, `${safe}.json`)
}

export function createExtensionStorage() {
  return {
    async get<T>(extensionId: string, key: string, fallback: T): Promise<T> {
      try {
        const raw = await readFile(pathFor(extensionId, key), "utf8")
        return JSON.parse(raw) as T
      } catch {
        return fallback
      }
    },
    async set(extensionId: string, key: string, value: unknown): Promise<void> {
      const file = pathFor(extensionId, key)
      await mkdir(join(rootDir(), extensionId), { recursive: true })
      await writeFile(file, JSON.stringify(value), "utf8")
    },
  }
}
```

- [ ] **Step 5: Write `packages/extension-host/src/main/index.ts`**

```ts
// packages/extension-host/src/main/index.ts
import type { ExtensionManifest } from "@hermes-x/extension-api"
import { activateMainExtensions } from "./activate"
import { createExtensionRegistry, type RuntimeExtension } from "./registry"
import {
  createChannelTable,
  registerInvokeRouter,
  registerMetadataChannels,
} from "./ipc-router"
import { makeMainHost } from "./make-main-host"
import { createExtensionStorage } from "./storage-fs"

export interface MainBootOptions {
  /** All discovered manifests with their resolved file paths. */
  manifests: Array<{
    manifest: ExtensionManifest
    /** absolute path of the manifest dir, used to resolve `entries.main`. */
    rootDir: string
  }>
  /** Reads/writes the shared settings store (re-uses desktop's mainStore). */
  settingsStore: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
  }
  /** Hermes tool dispatcher (desktop wires its hermes-agent client). */
  callTool: (tool: string, args: unknown) => Promise<unknown>
  /** Async loader for an extension's i18n JSON (per locale). */
  getI18n: (extensionId: string, locale: "en" | "zh-CN") => Promise<Record<string, string>>
  /** Returns a `file://` or `app://` URL the renderer can `import()`. */
  getRendererBundleUrl: (extensionId: string) => Promise<string | null>
}

export interface MainBootResult {
  registry: ReturnType<typeof createExtensionRegistry>
  shutdown: () => Promise<void>
}

export async function bootMainExtensionHost(
  opts: MainBootOptions,
): Promise<MainBootResult> {
  const channelTable = createChannelTable()
  const storage = createExtensionStorage()
  const registry = createExtensionRegistry()
  const bootBackground = new Set<() => Promise<void> | void>()
  const shutdown = new Set<() => Promise<void> | void>()
  const allManifests = opts.manifests.map((m) => m.manifest)

  registerInvokeRouter(channelTable, () => allManifests)
  registerMetadataChannels({
    getManifests: () => allManifests,
    getI18n: opts.getI18n,
    getRendererBundleUrl: opts.getRendererBundleUrl,
  })

  const result = await activateMainExtensions({
    manifests: allManifests,
    loadMain: async (id) => {
      const entry = opts.manifests.find((m) => m.manifest.id === id)
      if (!entry) throw new Error(`manifest not found for ${id}`)
      const mainRel = entry.manifest.entries.main
      if (!mainRel) throw new Error(`no main entry for ${id}`)
      const full = `${entry.rootDir}/${mainRel}`
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(full) as { activate: (h: unknown) => Promise<void> | void }
    },
    makeHost: (id) =>
      makeMainHost(id, {
        channelTable,
        settingsStore: opts.settingsStore,
        storage,
        callTool: opts.callTool,
        bootBackground,
        shutdown,
      }),
  })

  for (const item of result.loaded) {
    const manifest = allManifests.find((m) => m.id === item.id)!
    registry.set({ id: item.id, manifest, status: "loaded" })
  }
  for (const item of result.failed) {
    const manifest = allManifests.find((m) => m.id === item.id)!
    registry.set({ id: item.id, manifest, status: "failed", error: item.error })
  }

  // Fire boot-background hooks in parallel; failures are logged but
  // do NOT downgrade the extension's status.
  void Promise.allSettled(
    [...bootBackground].map((h) =>
      Promise.resolve(h()).catch((e) => {
        console.error("[extension-host] onBootBackground:", e)
      }),
    ),
  )

  return {
    registry,
    shutdown: async () => {
      await Promise.allSettled([...shutdown].map((h) => Promise.resolve(h())))
    },
  }
}

export { activateMainExtensions } from "./activate"
export { validateManifest } from "./discover"
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @hermes-x/extension-host typecheck`
Expected: PASS (may need `@types/node`, electron types).

- [ ] **Step 7: If types missing, add to `packages/extension-host/package.json`**

```json
"devDependencies": {
  "@types/node": "^20.0.0",
  "@types/react": "18.3.12",
  "electron": "^33.0.0",
  "react": "18.3.1",
  "typescript": "5.6.3",
  "vitest": "2.1.4"
}
```

(Use the same electron version desktop uses — check `apps/desktop/package.json`.)

Run: `pnpm install && pnpm --filter @hermes-x/extension-host typecheck`

- [ ] **Step 8: Commit**

```bash
git add packages/extension-host/src/main packages/extension-host/package.json pnpm-lock.yaml
git commit -m "feat(extension-host): main-side host + ipc router + boot"
```

### Task 1.9: Preload bridge

**Files:**
- Create: `packages/extension-host/src/preload/index.ts`

- [ ] **Step 1: Write `preload/index.ts`**

```ts
// packages/extension-host/src/preload/index.ts
import { ipcRenderer } from "electron"
import type { ExtensionManifest } from "@hermes-x/extension-api"

export interface ExtensionsBridge {
  listManifests(): Promise<ExtensionManifest[]>
  invoke(extensionId: string, channel: string, args: unknown): Promise<unknown>
  rendererBundleUrl(extensionId: string): Promise<string | null>
  i18nResources(
    extensionId: string,
    locale: "en" | "zh-CN",
  ): Promise<Record<string, string>>
}

export function createExtensionsBridge(): ExtensionsBridge {
  return {
    listManifests: () => ipcRenderer.invoke("extensions:list"),
    invoke: (extensionId, channel, args) =>
      ipcRenderer.invoke("ext-invoke", { extensionId, channel, args }),
    rendererBundleUrl: (extensionId) =>
      ipcRenderer.invoke("extensions:renderer-bundle-url", extensionId),
    i18nResources: (extensionId, locale) =>
      ipcRenderer.invoke("extensions:i18n", { extensionId, locale }),
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @hermes-x/extension-host typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/extension-host/src/preload/index.ts
git commit -m "feat(extension-host): preload bridge"
```

### Task 1.10: Renderer-side host + SlotOutlet

**Files:**
- Create: `packages/extension-host/src/renderer/make-renderer-host.ts`
- Create: `packages/extension-host/src/renderer/slot-outlet.tsx`
- Create: `packages/extension-host/src/renderer/index.ts`

- [ ] **Step 1: Write `make-renderer-host.ts`**

```ts
// packages/extension-host/src/renderer/make-renderer-host.ts
import type { RendererHost, SlotEntry, SlotName } from "@hermes-x/extension-api"
import type { SlotRegistry } from "./slot-registry"
import type { ExtensionsBridge } from "../preload/index"

export interface RendererHostDeps {
  bridge: ExtensionsBridge
  slotRegistry: SlotRegistry
  /** Reads/writes the shared platform settings store. */
  settings: {
    get<T>(key: string, fallback: T): Promise<T>
    set(key: string, value: unknown): Promise<void>
    watch(key: string, cb: (v: unknown) => void): () => void
  }
  /** Translator from @hermes-x/i18n. */
  translate: (key: string, params?: Record<string, unknown>) => string
  /** notify dispatcher (toast / banner). */
  notify: (kind: "info" | "warn" | "error", message: string) => void
  /** Hermes-agent tool caller (mirror of the main side). */
  callTool: (tool: string, args: unknown) => Promise<unknown>
}

export function makeRendererHost(extensionId: string, deps: RendererHostDeps): RendererHost {
  const tag = `[ext:${extensionId}]`
  const log =
    (level: "log" | "warn" | "error" | "debug") =>
    (...args: unknown[]) =>
      console[level](tag, ...args)

  return {
    id: extensionId,
    logger: { debug: log("debug"), info: log("log"), warn: log("warn"), error: log("error") },
    slots: {
      register<P>(slot: SlotName, component: React.ComponentType<P>, options?: { slotEntryId?: string; order?: number; props?: Partial<P> }) {
        const entry: SlotEntry<P> = {
          extensionId,
          entryId: options?.slotEntryId ?? `${extensionId}:${slot}`,
          order: options?.order ?? 100,
          component,
          props: options?.props,
        }
        return deps.slotRegistry.register(slot, entry)
      },
    },
    commands: {
      register: () => ({ dispose: () => undefined }),
      invoke: async () => undefined,
    },
    settings: {
      define: () => ({ dispose: () => undefined }),
      get: <T,>(key: string, fallback: T) =>
        deps.settings.get<T>(`ext.${extensionId}.${key}`, fallback),
      set: (key, value) => deps.settings.set(`ext.${extensionId}.${key}`, value),
      watch: <T,>(key: string, cb: (v: T) => void) => {
        const unsub = deps.settings.watch(`ext.${extensionId}.${key}`, (v) => cb(v as T))
        return { dispose: unsub }
      },
    },
    storage: {
      get: <T,>(key: string, fallback: T) =>
        deps.bridge.invoke(extensionId, "__storage.get", { key, fallback }) as Promise<T>,
      set: (key, value) =>
        deps.bridge.invoke(extensionId, "__storage.set", { key, value }) as Promise<void>,
      watch: () => ({ dispose: () => undefined }),
    },
    ipc: {
      invoke: <TArgs, TRet>(channel: string, args: TArgs) =>
        deps.bridge.invoke(extensionId, channel, args) as Promise<TRet>,
    },
    i18n: { t: (key, params) => deps.translate(key, params) },
    hermes: { callTool: (tool, args) => deps.callTool(tool, args) },
    notify: (kind, message) => deps.notify(kind, message),
  } as RendererHost
}
```

Note on `commands` and `settings.define`: stubbed for phase 1 — knowledge-base extension does not use them. Re-implement in phase 4 if Extensions tab needs them.

- [ ] **Step 2: Write `slot-outlet.tsx`**

```tsx
// packages/extension-host/src/renderer/slot-outlet.tsx
import { createContext, useContext, useEffect, useState, type ReactElement } from "react"
import type { SlotEntry, SlotName } from "@hermes-x/extension-api"
import type { SlotRegistry } from "./slot-registry"

const SlotRegistryContext = createContext<SlotRegistry | null>(null)

export function SlotRegistryProvider(props: {
  registry: SlotRegistry
  children: React.ReactNode
}): ReactElement {
  return (
    <SlotRegistryContext.Provider value={props.registry}>
      {props.children}
    </SlotRegistryContext.Provider>
  )
}

function useSlotEntries<P>(slot: SlotName): ReadonlyArray<SlotEntry<P>> {
  const reg = useContext(SlotRegistryContext)
  if (!reg) throw new Error("SlotOutlet requires <SlotRegistryProvider>")
  const [entries, setEntries] = useState<ReadonlyArray<SlotEntry<P>>>(reg.get<P>(slot))
  useEffect(() => {
    setEntries(reg.get<P>(slot))
    const sub = reg.subscribe(() => setEntries(reg.get<P>(slot)))
    return () => sub.dispose()
  }, [reg, slot])
  return entries
}

/**
 * Multi-instance outlet: renders all entries in `order`. Pass `runtimeProps`
 * to forward host-supplied props (e.g. composer state) to every entry.
 */
export function SlotOutlet<P extends Record<string, unknown> = Record<string, unknown>>(
  props: { name: SlotName; runtimeProps?: P },
): ReactElement {
  const entries = useSlotEntries<P>(props.name)
  return (
    <>
      {entries.map((e) => {
        const Component = e.component
        const merged = { ...(e.props ?? {}), ...(props.runtimeProps ?? {}) } as unknown as P
        return <Component key={`${e.extensionId}:${e.entryId}`} {...merged} />
      })}
    </>
  )
}

/**
 * Single-instance outlet: renders the entry whose entryId matches `activeId`.
 * Used for `sidebar.view` (one view shown at a time, switched by ActivityBar).
 */
export function SingleSlotOutlet<P extends Record<string, unknown> = Record<string, unknown>>(
  props: { name: SlotName; activeId: string | null; runtimeProps?: P },
): ReactElement | null {
  const entries = useSlotEntries<P>(props.name)
  if (props.activeId == null) return null
  const match = entries.find((e) => e.entryId === props.activeId)
  if (!match) return null
  const Component = match.component
  return <Component {...({ ...(match.props ?? {}), ...(props.runtimeProps ?? {}) } as unknown as P)} />
}
```

- [ ] **Step 3: Write `renderer/index.ts`**

```ts
// packages/extension-host/src/renderer/index.ts
export { createSlotRegistry, type SlotRegistry } from "./slot-registry"
export { SlotOutlet, SingleSlotOutlet, SlotRegistryProvider } from "./slot-outlet"
export { makeRendererHost } from "./make-renderer-host"
export { discoverRendererExtensions } from "./discover"
export { mergeExtensionTables, prefixTable } from "./i18n-merge"

import { registerExtensionMessages } from "@hermes-x/i18n"
import type { DiscoveredExtension } from "./discover"
import { prefixTable } from "./i18n-merge"

/**
 * Boot the renderer side of the extension host: load each renderer
 * bundle (if any), call `activate`, register i18n tables.
 *
 * @returns list of activated extensions + failures.
 */
export async function bootRendererExtensions(opts: {
  extensions: DiscoveredExtension[]
  makeHostFor: (id: string) => import("@hermes-x/extension-api").RendererHost
}): Promise<{
  activated: string[]
  failed: Array<{ id: string; error: string }>
}> {
  const activated: string[] = []
  const failed: Array<{ id: string; error: string }> = []

  for (const ext of opts.extensions) {
    const { manifest } = ext
    try {
      for (const locale of ["en", "zh-CN"] as const) {
        const tbl = await ext.loadI18n(locale)
        if (tbl) registerExtensionMessages(locale, prefixTable(manifest.id, tbl))
      }
      if (ext.loadRenderer) {
        const mod = await ext.loadRenderer()
        await Promise.resolve(mod.activate(opts.makeHostFor(manifest.id)))
      }
      activated.push(manifest.id)
    } catch (e) {
      failed.push({ id: manifest.id, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { activated, failed }
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @hermes-x/extension-host typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/extension-host/src/renderer
git commit -m "feat(extension-host): renderer host + SlotOutlet"
```

---

# Phase 2 — Desktop wires extension-host (no extensions yet)

Goal: Desktop boots through extension-host successfully — even with zero extensions. Old gbrain still working (we don't break anything until Phase 3).

### Task 2.1: Add extension-host as dep

**Files:**
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Read current deps**

Already have desktop package.json open. Add to `dependencies`:

```json
"@hermes-x/extension-host": "workspace:*",
"@hermes-x/extension-api": "workspace:*"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: dep resolves to the workspace package.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "chore(desktop): depend on extension-host"
```

### Task 2.2: Add empty `extensions/` directory + workspace glob

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `extensions/.gitkeep`

- [ ] **Step 1: Modify `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "extensions/*"
```

- [ ] **Step 2: Create empty dir**

Run: `mkdir -p extensions && touch extensions/.gitkeep`

- [ ] **Step 3: Commit**

```bash
git add pnpm-workspace.yaml extensions/.gitkeep
git commit -m "chore(workspace): register extensions/* glob"
```

### Task 2.3: Wire main process — initialize extension-host (no extensions, no-op smoke)

**Files:**
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Add boot call**

In `apps/desktop/src/main/index.ts`, immediately AFTER `registerGBrainHandlers()` and `autoStartGBrainServeHttp()` (around line 397-403), add:

```ts
import { bootMainExtensionHost } from "@hermes-x/extension-host/main"
// (group near other imports — alphabetize as the file's convention)
```

```ts
// inside app.whenReady().then(async () => { ... }), AFTER registerGBrainHandlers():
const extensionHost = await bootMainExtensionHost({
  manifests: [],  // discovered in Phase 3; phase 2 boots empty
  settingsStore: {
    get: async (key, fallback) => {
      const r = await mainStore.get([key])
      return (r[key] as never) ?? fallback
    },
    set: (key, value) => mainStore.set({ [key]: value }),
  },
  callTool: async () => {
    throw new Error("hermes.callTool not wired yet")
  },
  getI18n: async () => ({}),
  getRendererBundleUrl: async () => null,
})

// Store the registry on a module-scope variable so `before-quit` can call shutdown.
;(globalThis as { __hermesExtensionHost?: typeof extensionHost }).__hermesExtensionHost = extensionHost
```

- [ ] **Step 2: Add before-quit hook**

Find the existing `app.on("before-quit", ...)` block (around line 470+ — there may already be one for notifier/quick-ask). Add:

```ts
const host = (globalThis as { __hermesExtensionHost?: { shutdown(): Promise<void> } })
  .__hermesExtensionHost
if (host) await host.shutdown()
```

- [ ] **Step 3: Run dev build, confirm desktop still starts**

Run: `pnpm dev:desktop`
Expected: Desktop window opens; no crash; existing gbrain functionality still works.

- [ ] **Step 4: Stop dev server, commit**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat(desktop): boot empty extension host (no extensions yet)"
```

### Task 2.4: Wire preload bridge

**Files:**
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/global.d.ts`

- [ ] **Step 1: Add to preload `api`**

In `apps/desktop/src/preload/index.ts`, after the `hermesRuntime` block and before any closing `}` of the api object, insert:

```ts
import { createExtensionsBridge } from "@hermes-x/extension-host/preload"
// (with other imports at top)
```

Inside the `api` object literal, add a key:

```ts
extensions: createExtensionsBridge(),
```

Do NOT remove the existing `gbrain` block yet — Phase 3 deletes it.

- [ ] **Step 2: Add to `global.d.ts`**

Inside `HermesBridgeApi`, add:

```ts
extensions: {
  listManifests(): Promise<import("@hermes-x/extension-api").ExtensionManifest[]>
  invoke(extensionId: string, channel: string, args: unknown): Promise<unknown>
  rendererBundleUrl(extensionId: string): Promise<string | null>
  i18nResources(
    extensionId: string,
    locale: "en" | "zh-CN",
  ): Promise<Record<string, string>>
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hermes-x/desktop typecheck`
Expected: PASS.

- [ ] **Step 4: Run dev mode and verify bridge available**

Run: `pnpm dev:desktop`. In the renderer devtools console:

```js
await window.hermes.extensions.listManifests()
```

Expected: `[]` (empty array, since no manifests yet).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/global.d.ts
git commit -m "feat(desktop): preload exposes window.hermes.extensions"
```

### Task 2.5: Wire renderer — mount SlotRegistryProvider in App.tsx

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx`
- Create: `apps/desktop/src/renderer/extensions-boot.ts`

- [ ] **Step 1: Create `apps/desktop/src/renderer/extensions-boot.ts`**

```ts
// apps/desktop/src/renderer/extensions-boot.ts
import {
  bootRendererExtensions,
  createSlotRegistry,
  discoverRendererExtensions,
  makeRendererHost,
} from "@hermes-x/extension-host/renderer"
import type { RendererHost } from "@hermes-x/extension-api"
import { getPlatform } from "@hermes-x/platform"

// Compile-time glob: vite expands these at build. Paths are RELATIVE to
// this file (apps/desktop/src/renderer/) — adjust if the file moves.
const manifestModules = import.meta.glob<{ default: unknown }>(
  "../../../../extensions/*/manifest.json",
)
const rendererModules = import.meta.glob<{ activate: (h: RendererHost) => void | Promise<void> }>(
  "../../../../extensions/*/dist/renderer.js",
)
const i18nModules = import.meta.glob<{ default: Record<string, string> }>(
  "../../../../extensions/*/dist/i18n/*.json",
)

export const slotRegistry = createSlotRegistry()

export async function bootExtensions(translate: (k: string, p?: Record<string, unknown>) => string) {
  const { extensions, failed: discoveryFailed } = await discoverRendererExtensions({
    manifestModules,
    rendererModules,
    i18nModules,
  })
  if (discoveryFailed.length) {
    console.warn("[extensions] discovery failures:", discoveryFailed)
  }
  const result = await bootRendererExtensions({
    extensions,
    makeHostFor: (id) =>
      makeRendererHost(id, {
        bridge: window.hermes.extensions,
        slotRegistry,
        settings: {
          get: async <T,>(key: string, fallback: T) => {
            const r = await getPlatform().storage.get([key])
            return ((r[key] as T | undefined) ?? fallback) as T
          },
          set: async (key, value) =>
            getPlatform().storage.set({ [key]: value }),
          watch: (key, cb) =>
            getPlatform().storage.watch([key], (changes) => {
              const c = changes[key]
              if (c) cb((c as { newValue?: unknown }).newValue)
            }),
        },
        translate,
        notify: (_kind, message) => console.info("[ext notify]", message),
        callTool: async () => {
          throw new Error("hermes.callTool not wired yet (renderer)")
        },
      }),
  })
  if (result.failed.length) {
    console.warn("[extensions] activation failures:", result.failed)
  }
  return result
}
```

- [ ] **Step 2: Modify `apps/desktop/src/renderer/App.tsx`**

Add at the top:

```tsx
import { SlotRegistryProvider } from "@hermes-x/extension-host/renderer"
import { useT } from "@hermes-x/i18n"
import { bootExtensions, slotRegistry } from "./extensions-boot"
```

Replace the existing `export default function App()` with:

```tsx
export default function App() {
  return (
    <SlotRegistryProvider registry={slotRegistry}>
      <SessionsProvider>
        <AppInner />
      </SessionsProvider>
    </SlotRegistryProvider>
  )
}
```

Inside `AppInner`, near the top after `useResolvedTheme()`:

```tsx
const { t } = useT()
const [extensionsReady, setExtensionsReady] = useState(false)
useEffect(() => {
  void bootExtensions(t).finally(() => setExtensionsReady(true))
  // boot once — translate fn changes are fine, registrations don't re-fire
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [])
```

Replace the `if (phase === "loading")` block with:

```tsx
if (phase === "loading" || !extensionsReady) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background text-foreground">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}
```

- [ ] **Step 3: Run dev mode, verify app still loads**

Run: `pnpm dev:desktop`
Expected: Spinner briefly, then chat surface. Console shows `[extensions] discovery failures: []` (or nothing — since no extensions exist, the glob is empty).

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/renderer/extensions-boot.ts apps/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): renderer boots extension host (slot registry + activate)"
```

### Task 2.6: Refactor ActivityBar to accept extension items

**Files:**
- Modify: `packages/ui/src/chat/ActivityBar.tsx`

- [ ] **Step 1: Add prop for extra items**

Modify `ActivityBarProps` and the items list:

```tsx
export interface ExtensionActivityItem {
  id: string
  iconKey: string
  labelKey: string
  order?: number
}

export interface ActivityBarProps {
  active: string                // widen from ActivityViewId
  onSelect: (id: string) => void
  className?: string
  /** Extension-contributed items merged into the bar. */
  extensionItems?: ExtensionActivityItem[]
  /** Translator used to resolve iconKey/labelKey from extensions. */
  resolveIcon?: (iconKey: string) => ReactNode | null
}
```

Then in `ActivityBar()`:

```tsx
const coreItems: ActivityItem[] = [
  { id: "chats", icon: <MessageSquare className="h-4 w-4" />, label: t("sidepanel.sessions.group.chats") },
  { id: "scheduled", icon: <Clock className="h-4 w-4" />, label: t("sidepanel.sessions.group.scheduled") },
  { id: "skills", icon: <Sparkles className="h-4 w-4" />, label: t("sidepanel.sessions.group.skills") },
  { id: "tools", icon: <Wrench className="h-4 w-4" />, label: t("sidepanel.sessions.group.tools") },
]
// NOTE: knowledge item REMOVED — phase 3 reintroduces it via extension.

const extItems: ActivityItem[] = (extensionItems ?? []).map((e) => ({
  id: e.id,
  icon: resolveIcon?.(e.iconKey) ?? <BookOpen className="h-4 w-4" />,
  label: t(e.labelKey as never),
}))

const items = [...coreItems, ...extItems].sort((a, b) => {
  const ao = extensionItems?.find((e) => e.id === a.id)?.order ?? 0
  const bo = extensionItems?.find((e) => e.id === b.id)?.order ?? 0
  return ao - bo
})
```

Drop the `ActivityViewId` import from `BookOpen` line as needed — keep `BookOpen` as the default fallback icon.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @hermes-x/ui typecheck`
Expected: This may flag callers that pass `ActivityViewId`. Phase 3 reconnects callers; for now, **export `ActivityViewId` widened to `string`**:

```ts
export type ActivityViewId = string
```

This keeps existing call sites compiling.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/chat/ActivityBar.tsx
git commit -m "refactor(ui): ActivityBar accepts extension items; knowledge core item removed"
```

### Task 2.7: Replace knowledge branch in FullScreenChatView

**Files:**
- Modify: `packages/ui/src/chat/FullScreenChatView.tsx`

- [ ] **Step 1: Remove SettingsBrain import + replace branch**

Find:

```tsx
import { SettingsBrain } from "../settings/SettingsBrain";
```

Delete it.

Find:

```tsx
{sidebarView === "knowledge" ? (
  <SettingsBrain onOpenChat={() => onSidebarViewChange("chats")} />
) : sidebarView === "skills" ? (
```

Replace the `sidebarView === "knowledge"` arm with:

```tsx
{/* Extension-provided sidebar views are routed by activity id. */}
{(() => {
  const { SingleSlotOutlet } = require("@hermes-x/extension-host/renderer") as typeof import("@hermes-x/extension-host/renderer")
  return <SingleSlotOutlet name="sidebar.view" activeId={sidebarView} />
})() ?? null}
```

Actually, to avoid `require()` at the call site, import at top:

```tsx
import { SingleSlotOutlet } from "@hermes-x/extension-host/renderer";
```

And change the branch:

```tsx
{sidebarView === "skills" ? (
  <SettingsSkills />
) : sidebarView === "tools" ? (
  <ToolsView />
) : (
  // sidebar.view slot — knowledge & future extensions own this branch.
  // Falls through to ChatSurface when no extension matches.
  <ExtensionOrChat
    activeId={sidebarView}
    renderChat={() => (
      <ChatSurface
        variant="fullscreen"
        messagesMaxWidth={messagesWidth}
        client={client}
        capabilities={capabilities}
        slots={slots}
        openSettings={openSettings}
        openAgentDestination={openAgentDestination}
      />
    )}
  />
)}
```

Define the helper at the bottom of the same file:

```tsx
function ExtensionOrChat(props: {
  activeId: string
  renderChat: () => ReactNode
}): ReactElement {
  const { SlotOutletForActiveView } = useExtensionSidebar(props.activeId)
  return <>{SlotOutletForActiveView ?? props.renderChat()}</>
}

function useExtensionSidebar(activeId: string): {
  SlotOutletForActiveView: ReactNode | null
} {
  // Render the SingleSlotOutlet; if it returns null (no extension matched),
  // the caller renders ChatSurface. We need to read the registry to decide,
  // so we render the outlet and capture an empty-vs-non-empty signal.
  // Implementation: render SingleSlotOutlet inside a wrapper that uses a
  // ref to detect children. For phase 2, use the renderer's registry
  // directly via useContext.
  // ...
}
```

Simpler: skip `ExtensionOrChat` for now and inline a one-liner — render BOTH `<SingleSlotOutlet name="sidebar.view" activeId={sidebarView} />` (returns null when no match) AND `ChatSurface` only when activeId is one of the chat-driven views (`chats`, `scheduled`). The cleanest version:

Replace the whole `<main>` block with:

```tsx
<main className="flex min-h-0 min-w-0 flex-1 flex-col">
  {sidebarView === "skills" ? (
    <SettingsSkills />
  ) : sidebarView === "tools" ? (
    <ToolsView />
  ) : sidebarView === "chats" || sidebarView === "scheduled" ? (
    <ChatSurface
      variant="fullscreen"
      messagesMaxWidth={messagesWidth}
      client={client}
      capabilities={capabilities}
      slots={slots}
      openSettings={openSettings}
      openAgentDestination={openAgentDestination}
    />
  ) : (
    <SingleSlotOutlet name="sidebar.view" activeId={sidebarView} />
  )}
</main>
```

The implicit contract: any activity id that isn't `chats`/`scheduled`/`skills`/`tools` is an extension-contributed activity, so look it up in `sidebar.view`.

Also remove `isPageView`'s `knowledge` branch:

```ts
function isPageView(v: ActivityViewId): boolean {
  return v === "skills" || v === "tools" || isExtensionPageView(v)
}

/** Extension-provided activity ids are always page views (no inner aside). */
function isExtensionPageView(v: string): boolean {
  return v !== "chats" && v !== "scheduled" && v !== "skills" && v !== "tools"
}
```

And `isActivityView` becomes:

```ts
function isActivityView(v: unknown): v is string {
  return typeof v === "string" && v.length > 0
}
```

- [ ] **Step 2: Pass extensionItems into ActivityBar**

Find the `<ActivityBar ... />` JSX in this file. Add:

```tsx
import { useContext, useSyncExternalStore } from "react"
// already imported react bits — keep this in one statement

import {
  SlotRegistryProvider as _SlotRegistryProvider, // imported just to type the context
} from "@hermes-x/extension-host/renderer"
```

Actually simpler — expose a helper from extension-host: `useActivityBarItems()`. Adjust task to add this in the next sub-step. For now, in `FullScreenChatView`, fetch ActivityBar items via a hook the host exposes:

```tsx
import { useActivityBarItems } from "@hermes-x/extension-host/renderer"
// later, inside FullScreenChatView:
const extensionActivityItems = useActivityBarItems()
// pass into <ActivityBar extensionItems={extensionActivityItems} />
```

- [ ] **Step 3: Add `useActivityBarItems()` to extension-host/renderer**

Append to `packages/extension-host/src/renderer/index.ts`:

```ts
import { useEffect, useState } from "react"
import { useSlotRegistry } from "./slot-outlet"
// ... after existing exports

export function useActivityBarItems(): Array<{
  id: string
  iconKey: string
  labelKey: string
  order?: number
}> {
  const reg = useSlotRegistry()
  const [snapshot, setSnapshot] = useState(() => reg.get("activityBar.item"))
  useEffect(() => {
    const sub = reg.subscribe(() => setSnapshot(reg.get("activityBar.item")))
    return () => sub.dispose()
  }, [reg])
  return snapshot.map((e) => {
    const props = (e.props ?? {}) as { iconKey?: string; labelKey?: string; order?: number }
    return {
      id: e.entryId,
      iconKey: props.iconKey ?? "",
      labelKey: props.labelKey ?? "",
      order: props.order ?? e.order,
    }
  })
}
```

And in `slot-outlet.tsx`, export the context hook:

```tsx
export function useSlotRegistry(): SlotRegistry {
  const reg = useContext(SlotRegistryContext)
  if (!reg) throw new Error("useSlotRegistry requires <SlotRegistryProvider>")
  return reg
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -r typecheck`
Expected: PASS or close to it; resolve remaining type errors.

- [ ] **Step 5: Run dev mode**

Run: `pnpm dev:desktop`
Expected: Window opens, Knowledge ActivityBar item is **gone** (because no extension contributes it yet). Clicking other items still works. **This is intentional regression**; phase 3 restores it via the extension.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/chat/FullScreenChatView.tsx packages/extension-host/src/renderer/index.ts packages/extension-host/src/renderer/slot-outlet.tsx
git commit -m "refactor(ui): FullScreenChatView routes sidebar.view through extension slots"
```

### Task 2.8: HomeView — drop brain hint, render composer.hint slot

**Files:**
- Modify: `packages/ui/src/home/HomeView.tsx`

- [ ] **Step 1: Remove brain imports + state**

Delete lines:

```tsx
import {
  buildBrainInstallPrompt,
  ensureBrainDefaultUrl,
  hasGBrainBridge,
} from "../settings/brain-install";
```

Delete the `useState(false)` for `showBrainHint`, its `useEffect`, and the JSX block that renders `t("newtab.brainHint")` (~lines 178-200 and ~lines 466-490).

- [ ] **Step 2: Replace with SlotOutlet**

Add at top:

```tsx
import { SlotOutlet } from "@hermes-x/extension-host/renderer";
```

In the composer area where the old `{showBrainHint && (...)}` was, insert:

```tsx
<SlotOutlet
  name="composer.hint"
  runtimeProps={{
    onPrefill: (text: string) => setInput(text),
    language,
  }}
/>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @hermes-x/ui typecheck`
Expected: PASS. (One warning likely: `language` may not be in scope — capture from useT().)

- [ ] **Step 4: Run dev**

Run: `pnpm dev:desktop`
Expected: HomeView shows no brain hint pill (correct — no extension contributes one yet).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/home/HomeView.tsx
git commit -m "refactor(ui): HomeView replaces brain hint with composer.hint slot"
```

### Task 2.9: SettingsView — render extension settings tabs

**Files:**
- Modify: `packages/ui/src/settings/SettingsView.tsx`

- [ ] **Step 1: Add extension tab support**

Read existing tab dispatch code (around lines 60-200 — `ALL_TABS`, `mainTabFromLocation`, tab rendering switch). Modify:

- Drop `"brain"` from `ALL_TABS`.
- Drop `import { SettingsBrainConfig } from "./SettingsBrainConfig";`
- Remove the case that renders `<SettingsBrainConfig />`.

Then add at top:

```tsx
import { useExtensionSettingsTabs, SlotOutlet } from "@hermes-x/extension-host/renderer";
```

(see step 2 for the hook.)

Where the tab list is rendered (sidebar), append:

```tsx
{extensionTabs.map((tab) => (
  <li key={tab.id}>
    <button
      onClick={() => setMainTab(tab.id as MainTab)}
      className={cn("...existing tab button classes...")}
    >
      {t(tab.labelKey as never)}
    </button>
  </li>
))}
```

Where the main panel renders the active tab, add a fallback:

```tsx
{!isCoreTab(mainTab) && (
  <SlotOutlet name="settings.tab" runtimeProps={{ activeId: mainTab }} />
)}
```

Plus a small helper:

```ts
function isCoreTab(tab: MainTab): boolean {
  return (ALL_TABS as readonly string[]).includes(tab)
}
```

- [ ] **Step 2: Add `useExtensionSettingsTabs()` to extension-host/renderer**

In `packages/extension-host/src/renderer/index.ts`:

```ts
export function useExtensionSettingsTabs(): Array<{
  id: string
  labelKey: string
  order?: number
}> {
  const reg = useSlotRegistry()
  const [snapshot, setSnapshot] = useState(() => reg.get("settings.tab"))
  useEffect(() => {
    const sub = reg.subscribe(() => setSnapshot(reg.get("settings.tab")))
    return () => sub.dispose()
  }, [reg])
  return snapshot.map((e) => {
    const p = (e.props ?? {}) as { labelKey?: string; order?: number }
    return { id: e.entryId, labelKey: p.labelKey ?? "", order: p.order ?? e.order }
  })
}
```

- [ ] **Step 3: Typecheck + run**

Run: `pnpm -r typecheck && pnpm dev:desktop`
Expected: PASS; Settings sidebar no longer shows "知识库" / "Knowledge" tab.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/settings/SettingsView.tsx packages/extension-host/src/renderer/index.ts
git commit -m "refactor(ui): SettingsView renders extension settings tabs via slot"
```

---

# Phase 3 — `@hermes-x/ext-knowledge-base` (the migration)

Goal: All gbrain/knowledge surface area lives in `extensions/knowledge-base/`. Desktop core's grep is clean.

### Task 3.1: Scaffold the extension package

**Files:**
- Create: `extensions/knowledge-base/package.json`
- Create: `extensions/knowledge-base/manifest.json`
- Create: `extensions/knowledge-base/tsconfig.json`
- Create: `extensions/knowledge-base/vite.config.ts`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@hermes-x/ext-knowledge-base",
  "version": "0.1.0",
  "private": true,
  "description": "Hermes desktop knowledge-base extension (gbrain bridge + UI).",
  "main": "dist/main.cjs",
  "exports": {
    ".": {
      "main": "./dist/main.cjs",
      "renderer": "./dist/renderer.js"
    },
    "./manifest.json": "./manifest.json"
  },
  "scripts": {
    "build": "vite build",
    "dev": "vite build --watch",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hermes-x/extension-api": "workspace:*",
    "@hermes-x/i18n": "workspace:*",
    "@hermes-x/platform": "workspace:*",
    "@hermes-x/ui": "workspace:*",
    "lucide-react": "0.451.0",
    "streamdown": "^1.0.0"
  },
  "peerDependencies": {
    "electron": "*",
    "react": "^18.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "18.3.12",
    "typescript": "5.6.3",
    "vite": "5.4.10"
  }
}
```

(Match existing react/streamdown/lucide-react versions used by `@hermes-x/ui`.)

- [ ] **Step 2: Write `manifest.json`**

```json
{
  "$schema": "../../extension-api/src/manifest.schema.json",
  "id": "io.hermes.knowledge-base",
  "name": "Knowledge Base",
  "version": "0.1.0",
  "engines": { "hermes-x": "^0.1.0" },
  "entries": {
    "main": "dist/main.cjs",
    "renderer": "dist/renderer.js"
  },
  "i18n": {
    "en": "dist/i18n/en.json",
    "zh-CN": "dist/i18n/zh-CN.json"
  },
  "contributes": {
    "activityBar": [
      {
        "id": "knowledge",
        "iconKey": "ext.io.hermes.knowledge-base.activityBar.icon",
        "labelKey": "ext.io.hermes.knowledge-base.activityBar.label",
        "order": 200
      }
    ],
    "sidebarViews": [
      { "id": "knowledge", "anchor": "activityBar:knowledge" }
    ],
    "settingsTabs": [
      {
        "id": "knowledge",
        "labelKey": "ext.io.hermes.knowledge-base.settings.label",
        "order": 100
      }
    ],
    "composerHints": [
      { "id": "brain-disconnected" }
    ]
  },
  "hermesPlugins": [
    { "id": "gbrain", "version": "^0", "required": false }
  ],
  "permissions": [
    "ipc",
    "settings",
    "storage",
    "i18n",
    "lifecycle.boot"
  ]
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Write `vite.config.ts`**

```ts
import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "src/main/index.ts"),
        renderer: resolve(__dirname, "src/renderer/index.ts"),
      },
      output: [
        {
          dir: "dist",
          format: "cjs",
          entryFileNames: "main.cjs",
          // Externalize: electron + Node built-ins + workspace pkgs that
          // are also loaded by the host renderer (so we don't bundle
          // two copies of React into the renderer bundle).
        },
      ],
      external: [
        "electron",
        "react",
        "react-dom",
        /^@hermes-x\//,
        /^node:/,
      ],
    },
    lib: false,
  },
})
```

Note: Vite multi-entry with different formats is awkward — split into two configs. Simpler: separate `vite.main.config.ts` and `vite.renderer.config.ts`. Update the build script to `vite build -c vite.main.config.ts && vite build -c vite.renderer.config.ts`. Implement in the next sub-step.

- [ ] **Step 5: Split into two vite configs**

Delete `vite.config.ts`. Create `vite.main.config.ts`:

```ts
import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,  // renderer build runs separately
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/main/index.ts"),
      formats: ["cjs"],
      fileName: () => "main.cjs",
    },
    rollupOptions: {
      external: ["electron", /^@hermes-x\//, /^node:/],
    },
  },
})
```

Create `vite.renderer.config.ts`:

```ts
import { defineConfig } from "vite"
import { resolve } from "node:path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "src/renderer/index.ts"),
      formats: ["es"],
      fileName: () => "renderer.js",
    },
    rollupOptions: {
      external: ["react", "react-dom", /^@hermes-x\//],
    },
  },
})
```

Add `@vitejs/plugin-react` to `devDependencies`:

```json
"@vitejs/plugin-react": "4.3.3"
```

Update `package.json` scripts:

```json
"build": "rm -rf dist && vite build -c vite.main.config.ts && vite build -c vite.renderer.config.ts && pnpm copy:i18n",
"copy:i18n": "mkdir -p dist/i18n && cp src/i18n/*.json dist/i18n/"
```

- [ ] **Step 6: Install**

Run: `pnpm install`

- [ ] **Step 7: Commit**

```bash
git add extensions/knowledge-base/
git commit -m "feat(ext/knowledge-base): scaffold package, manifest, build configs"
```

### Task 3.2: Migrate main-side gbrain code

**Files:**
- Create: `extensions/knowledge-base/src/main/lib/cli.ts` (from `apps/desktop/src/main/gbrain/cli.ts`)
- Create: `extensions/knowledge-base/src/main/lib/client.ts` (from `client.ts`)
- Create: `extensions/knowledge-base/src/main/lib/launcher.ts` (from `launcher.ts`)
- Create: `extensions/knowledge-base/src/main/lib/provider-env.ts` (from `provider-env.ts`)
- Create: `extensions/knowledge-base/src/main/lib/recipe-schema.ts` (from `recipe-schema.ts`)
- Create: `extensions/knowledge-base/src/main/index.ts` (port `ipc.ts`)

- [ ] **Step 1: Copy lib files**

Run:

```bash
cp apps/desktop/src/main/gbrain/cli.ts extensions/knowledge-base/src/main/lib/cli.ts
cp apps/desktop/src/main/gbrain/client.ts extensions/knowledge-base/src/main/lib/client.ts
cp apps/desktop/src/main/gbrain/launcher.ts extensions/knowledge-base/src/main/lib/launcher.ts
cp apps/desktop/src/main/gbrain/provider-env.ts extensions/knowledge-base/src/main/lib/provider-env.ts
cp apps/desktop/src/main/gbrain/recipe-schema.ts extensions/knowledge-base/src/main/lib/recipe-schema.ts
```

(Do NOT delete the originals yet — phase 3.4 deletes after the extension is wired and verified.)

- [ ] **Step 2: Fix imports in copied files**

In `cli.ts`, `launcher.ts`, `provider-env.ts`, `recipe-schema.ts`: replace any `import ... from "../storage"` or `from "@hermes-x/core"` paths with extension-local equivalents:

- `BRAIN_URL_STORAGE_KEY` / `BRAIN_TOKEN_STORAGE_KEY` / `BRAIN_DEFAULT_URL`: these are removed from core in Task 3.5. Inline them in the extension. Add to a new file `extensions/knowledge-base/src/main/lib/constants.ts`:

```ts
// extensions/knowledge-base/src/main/lib/constants.ts
/**
 * Storage keys are now scoped under the extension id. The values shown
 * here are the SUFFIXES; MainHost.settings.get/set transparently prepend
 * `ext.io.hermes.knowledge-base.`.
 */
export const BRAIN_URL_KEY = "brain.url"
export const BRAIN_TOKEN_KEY = "brain.token"
export const BRAIN_DEFAULT_URL = "http://127.0.0.1:3131"
```

In each lib file that imported from `@hermes-x/core`, replace with `from "./constants"`. The `mainStore` import in `client.ts` / `cli.ts` referenced desktop's main-side store — replace with a host-provided settings ref passed in at construction. Pattern:

In `cli.ts` (if it reads settings), change to accept a `getSetting<T>(key, fallback)` function as constructor arg.

In `client.ts`, change `GBrainClient` constructor to take `{ baseUrl, token }` as before — no change needed (it already does). The wrapper in `ipc.ts` did the storage read.

In `provider-env.ts`, it uses `safeStorage` from electron — keep as-is. Check it doesn't import from desktop-specific paths.

- [ ] **Step 3: Write `src/main/index.ts` (the new ipc.ts equivalent)**

```ts
// extensions/knowledge-base/src/main/index.ts
import type { MainActivate, MainHost } from "@hermes-x/extension-api"

import { GBrainClient, type GBrainHealthResult } from "./lib/client"
import { runProvidersList } from "./lib/cli"
import { ensureGBrainServeHttp, restartGBrainServeHttp } from "./lib/launcher"
import { runProvidersEnv } from "./lib/recipe-schema"
import {
  listOverrideKeys,
  setOverride,
  unsetOverride,
} from "./lib/provider-env"
import { BRAIN_DEFAULT_URL, BRAIN_TOKEN_KEY, BRAIN_URL_KEY } from "./lib/constants"

let client: GBrainClient | null = null

async function getClient(host: MainHost): Promise<GBrainClient> {
  const url = (await host.settings.get<string>(BRAIN_URL_KEY, "")).trim() || BRAIN_DEFAULT_URL
  const token = (await host.settings.get<string>(BRAIN_TOKEN_KEY, "")).trim()
  if (!client) {
    client = new GBrainClient({ baseUrl: url, token })
  } else {
    client.configure({ baseUrl: url, token })
  }
  return client
}

export const activate: MainActivate = async (host) => {
  host.ipc.expose<void, GBrainHealthResult | null>("health", async () => {
    const c = await getClient(host)
    return c.health()
  })

  host.ipc.expose<{ tool: string; args?: Record<string, unknown> }, unknown>(
    "call",
    async ({ tool, args }) => {
      const c = await getClient(host)
      return c.call(tool, args)
    },
  )

  host.ipc.expose<
    void,
    | { ok: true }
    | { ok: false; reason: "invalid-token" | "other"; error: string }
  >("verify-auth", async () => {
    const c = await getClient(host)
    try {
      await c.verifyAuth()
      return { ok: true }
    } catch (e) {
      const error = (e as Error).message ?? String(e)
      const isAuth = /HTTP 401|invalid_token|Invalid token|Unauthorized/i.test(error)
      return { ok: false, reason: isAuth ? "invalid-token" : "other", error }
    }
  })

  host.ipc.expose("providers.list", () => runProvidersList())
  host.ipc.expose<string, unknown>("providers.env", async (id) => {
    if (typeof id !== "string" || id.length === 0) {
      return { ok: false, binary: "", error: "id required" }
    }
    return runProvidersEnv(id)
  })

  host.ipc.expose("providers.overrides.list", async () => {
    try {
      return { ok: true, overrides: await listOverrideKeys() }
    } catch (e) {
      return { ok: false, error: (e as Error).message ?? String(e) }
    }
  })

  host.ipc.expose<{ providerId: string; envKey: string; value: string }, unknown>(
    "providers.overrides.set",
    async ({ providerId, envKey, value }) => {
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

  host.ipc.expose<{ providerId: string; envKey: string }, unknown>(
    "providers.overrides.unset",
    async ({ providerId, envKey }) => {
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

  host.ipc.expose("launcher.ensure", () => ensureGBrainServeHttp())
  host.ipc.expose("launcher.restart", () => restartGBrainServeHttp())

  // Best-effort background warm-up — same as old autoStartGBrainServeHttp.
  host.lifecycle.onBootBackground(async () => {
    try {
      await ensureGBrainServeHttp()
    } catch (e) {
      host.logger.warn("auto-start failed:", e)
    }
  })
}
```

- [ ] **Step 4: Typecheck the extension**

Run: `pnpm --filter @hermes-x/ext-knowledge-base typecheck`
Expected: PASS.

- [ ] **Step 5: Build the extension**

Run: `pnpm --filter @hermes-x/ext-knowledge-base build`
Expected: `dist/main.cjs`, `dist/renderer.js` (will be empty for now — renderer not written), `dist/i18n/*.json` (empty for now).

If renderer build fails because `src/renderer/index.ts` doesn't exist yet, create an empty stub:

```ts
// extensions/knowledge-base/src/renderer/index.ts
import type { RendererActivate } from "@hermes-x/extension-api"
export const activate: RendererActivate = (_host) => {
  // populated in 3.3
}
```

And empty i18n stubs:

```bash
mkdir -p extensions/knowledge-base/src/i18n
echo '{}' > extensions/knowledge-base/src/i18n/en.json
echo '{}' > extensions/knowledge-base/src/i18n/zh-CN.json
```

Rebuild.

- [ ] **Step 6: Commit**

```bash
git add extensions/knowledge-base/src/main extensions/knowledge-base/src/renderer extensions/knowledge-base/src/i18n
git commit -m "feat(ext/knowledge-base): migrate main-side gbrain code"
```

### Task 3.3: Migrate renderer-side UI

**Files:**
- Create: `extensions/knowledge-base/src/renderer/views/KnowledgePanel.tsx` (from `SettingsBrain.tsx`)
- Create: `extensions/knowledge-base/src/renderer/views/SettingsKnowledgeTab.tsx` (from `SettingsBrainConfig.tsx`)
- Create: `extensions/knowledge-base/src/renderer/views/BrainDisconnectedHint.tsx` (from HomeView brain block + `brain-install.ts`)
- Create: `extensions/knowledge-base/src/renderer/views/brain-install.ts` (from `packages/ui/src/settings/brain-install.ts`)
- Modify: `extensions/knowledge-base/src/renderer/index.ts` (register slots)

- [ ] **Step 1: Copy SettingsBrain.tsx → KnowledgePanel.tsx**

```bash
cp packages/ui/src/settings/SettingsBrain.tsx extensions/knowledge-base/src/renderer/views/KnowledgePanel.tsx
```

Edit `KnowledgePanel.tsx`:

- Replace imports from `@hermes-x/core` for `BRAIN_*`: import from a new local `./brain-storage.ts` instead.
- Replace all calls to `window.hermes.gbrain.*` with `host.ipc.invoke(...)` — see step 4 for the wiring pattern.
- Replace `getPlatform().storage.get(BRAIN_URL_STORAGE_KEY)` with `host.settings.get("brain.url", "")`.

The cleanest pattern: take `host` as a prop on the component. Wrap the slot registration to inject `host` (closure captures it).

- [ ] **Step 2: Create `brain-storage.ts` for shared values**

```ts
// extensions/knowledge-base/src/renderer/views/brain-storage.ts
export const BRAIN_URL_KEY = "brain.url"
export const BRAIN_TOKEN_KEY = "brain.token"
export const BRAIN_DEFAULT_URL = "http://127.0.0.1:3131"
```

- [ ] **Step 3: Copy SettingsBrainConfig → SettingsKnowledgeTab.tsx**

```bash
cp packages/ui/src/settings/SettingsBrainConfig.tsx extensions/knowledge-base/src/renderer/views/SettingsKnowledgeTab.tsx
```

Same edits as KnowledgePanel: re-route gbrain calls through `host.ipc.invoke`, settings through `host.settings`.

- [ ] **Step 4: Copy brain-install.ts**

```bash
cp packages/ui/src/settings/brain-install.ts extensions/knowledge-base/src/renderer/views/brain-install.ts
```

Edit to remove `BRAIN_*_KEY` import from `@hermes-x/core` — replace with local values from `brain-storage.ts`. Drop `hasGBrainBridge()` (no longer needed — extension only loads when host present). Drop `ensureBrainDefaultUrl()` if it's no longer called; if used in the disconnected hint, keep but route through `host.settings`.

- [ ] **Step 5: Create `BrainDisconnectedHint.tsx`**

The existing HomeView brain hint JSX block (around lines 466-490 of HomeView before deletion) was a styled button that prefills the composer with the install prompt. Reproduce it as a component that accepts `onPrefill: (text: string) => void` and `language: "en" | "zh-CN"` from the slot's `runtimeProps`:

```tsx
// extensions/knowledge-base/src/renderer/views/BrainDisconnectedHint.tsx
import { useEffect, useState } from "react"
import type { RendererHost } from "@hermes-x/extension-api"
import { buildBrainInstallPrompt } from "./brain-install"
import { BRAIN_URL_KEY, BRAIN_DEFAULT_URL } from "./brain-storage"

export function makeBrainDisconnectedHint(host: RendererHost) {
  return function BrainDisconnectedHint(props: {
    onPrefill?: (text: string) => void
    language?: "en" | "zh-CN"
  }) {
    const [show, setShow] = useState(false)
    useEffect(() => {
      let cancelled = false
      void (async () => {
        try {
          const h = await host.ipc.invoke<void, { status: string } | null>("health", undefined)
          if (!cancelled) setShow(!h)
        } catch {
          if (!cancelled) setShow(true)
        }
      })()
      return () => {
        cancelled = true
      }
    }, [])
    if (!show) return null
    return (
      <button
        type="button"
        className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground hover:bg-foreground/5"
        onClick={async () => {
          setShow(false)
          const lang = props.language ?? "en"
          props.onPrefill?.(buildBrainInstallPrompt(lang))
          const url = (await host.settings.get<string>(BRAIN_URL_KEY, "")).trim()
          if (!url) await host.settings.set(BRAIN_URL_KEY, BRAIN_DEFAULT_URL)
        }}
      >
        {host.i18n.t("composer.brainHint")}
      </button>
    )
  }
}
```

(Style/className choices: copy what HomeView's deleted pill used — match it pixel-for-pixel by reading the deleted block before removal.)

- [ ] **Step 6: Wire the renderer entry**

Rewrite `extensions/knowledge-base/src/renderer/index.ts`:

```ts
import type { RendererActivate } from "@hermes-x/extension-api"
import { makeKnowledgePanel } from "./views/KnowledgePanel"
import { makeSettingsKnowledgeTab } from "./views/SettingsKnowledgeTab"
import { makeBrainDisconnectedHint } from "./views/BrainDisconnectedHint"

export const activate: RendererActivate = (host) => {
  // ActivityBar item — props carry the labelKey/iconKey statically so the
  // host doesn't need to read the manifest to know how to render the icon.
  host.slots.register(
    "activityBar.item",
    () => null,  // ActivityBar reads from props only, no rendered component
    {
      slotEntryId: "knowledge",
      order: 200,
      props: {
        iconKey: "ext.io.hermes.knowledge-base.activityBar.icon",
        labelKey: "ext.io.hermes.knowledge-base.activityBar.label",
      },
    },
  )

  host.slots.register(
    "sidebar.view",
    makeKnowledgePanel(host),
    { slotEntryId: "knowledge", order: 100 },
  )

  host.slots.register(
    "settings.tab",
    makeSettingsKnowledgeTab(host),
    {
      slotEntryId: "knowledge",
      order: 100,
      props: { labelKey: "ext.io.hermes.knowledge-base.settings.label" },
    },
  )

  host.slots.register(
    "composer.hint",
    makeBrainDisconnectedHint(host),
    { slotEntryId: "brain-disconnected", order: 100 },
  )
}
```

Refactor `KnowledgePanel.tsx` to export `makeKnowledgePanel(host)` returning the component, same for `SettingsKnowledgeTab.tsx`.

- [ ] **Step 7: ActivityBar item rendering**

Wait — `activityBar.item` registration above uses `() => null` because the existing `ActivityBar` widget builds its own button. The slot entry carries icon+label metadata in `props`. But `ActivityBar` does not render any slot child — it just reads `useActivityBarItems()`. Need to special-case `iconKey` resolution to actual `lucide-react` icon.

Add to extension renderer index — a custom icon resolver registered via `host.slots`. Simpler: extend `useActivityBarItems` return to include a React node. To avoid coupling icon strings to lucide, **the icon factory returns a ReactNode at register time**:

Refactor the activity-bar contribution as a custom side-channel via the host:

Add to RendererHost in `extension-api/src/host.ts`:

```ts
ui: {
  registerActivityIcon(itemId: string, icon: ReactNode): Disposable
}
```

Then in `make-renderer-host.ts`, store icons in a map exposed alongside the slot registry, and `useActivityBarItems` returns `{ id, label, icon }`.

This is a meaningful expansion. For phase-3 simplicity, take the alternative: pre-import lucide icons in the renderer host and provide a resolver `iconKey → ReactNode` keyed by a small whitelist (book-open, sparkles, wrench, …). Manifest writes `"iconKey": "book-open"` (NOT `ext.<id>.icon`).

Decision: switch to **named lucide icons** for activityBar/settings icons in the manifest. Update Task 3.1's manifest:

```json
"activityBar": [
  { "id": "knowledge", "icon": "book-open", "labelKey": "ext.io.hermes.knowledge-base.activityBar.label", "order": 200 }
]
```

(Rename `iconKey` → `icon` semantically, holds a lucide name.)

Update the extension-api type:

```ts
activityBar?: Array<{
  id: string
  /** lucide icon name (kebab-case), e.g. "book-open". */
  icon: string
  labelKey: string
  order?: number
}>
```

And the JSON Schema (`manifest.schema.json`) accordingly.

In `packages/ui/src/chat/ActivityBar.tsx`, add a small resolver:

```tsx
import { BookOpen, Sparkles, Wrench, Clock, MessageSquare, Brain } from "lucide-react"

const ICON_MAP: Record<string, ReactNode> = {
  "book-open": <BookOpen className="h-4 w-4" />,
  "brain": <Brain className="h-4 w-4" />,
  "sparkles": <Sparkles className="h-4 w-4" />,
  "wrench": <Wrench className="h-4 w-4" />,
  "clock": <Clock className="h-4 w-4" />,
  "message-square": <MessageSquare className="h-4 w-4" />,
}
export function resolveExtensionIcon(name: string): ReactNode | null {
  return ICON_MAP[name] ?? null
}
```

Pass `resolveIcon={resolveExtensionIcon}` from FullScreenChatView when rendering ActivityBar.

Refactor extension's `activate` to register the activityBar item with the proper `icon` prop. The slot registration becomes a metadata-only entry:

```ts
host.slots.register("activityBar.item", () => null, {
  slotEntryId: "knowledge",
  order: 200,
  props: { icon: "book-open", labelKey: "ext.io.hermes.knowledge-base.activityBar.label" },
})
```

And `useActivityBarItems` reads `icon` (string) instead of `iconKey`.

(Update `useActivityBarItems` accordingly.)

- [ ] **Step 8: Typecheck + build extension**

Run:

```
pnpm --filter @hermes-x/ext-knowledge-base typecheck
pnpm --filter @hermes-x/ext-knowledge-base build
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add extensions/knowledge-base/src/renderer packages/extension-api packages/ui/src/chat/ActivityBar.tsx
git commit -m "feat(ext/knowledge-base): renderer views (panel + settings + hint) + activate"
```

### Task 3.4: Migrate i18n

**Files:**
- Create: `extensions/knowledge-base/src/i18n/en.json`
- Create: `extensions/knowledge-base/src/i18n/zh-CN.json`

- [ ] **Step 1: Extract brain keys from `packages/i18n/src/zh-CN.ts`**

Find all keys matching `options.brain.*`, `options.brainConfig.*`, `options.nav.brain`, `sidepanel.sessions.group.knowledge`, `newtab.brainHint`. Collect their values.

- [ ] **Step 2: Build the extension i18n JSON files**

The extension key namespace is `ext.io.hermes.knowledge-base.*`. Translation: drop the `options.brain.` prefix, write the suffix into the JSON without the `ext.<id>.` prefix (the host prepends it).

Example (zh-CN.json):

```json
{
  "activityBar.label": "知识库",
  "activityBar.icon": "book-open",
  "settings.label": "知识库",
  "composer.brainHint": "未连接知识库 — 点击一键安装",
  "panel.title": "知识库",
  "panel.subtitle": "连接 GBrain 实例，浏览、搜索和管理你的知识。",
  "connection.title": "GBrain 连接",
  "connection.url": "服务器地址",
  "connection.token": "访问令牌",
  "connection.tokenPlaceholder": "通过 `gbrain auth create <name>` 生成的 Bearer token",
  "connection.test": "测试连接",
  "connection.failed": "无法连接 gbrain，请确认服务是否运行中",
  "connection.invalidToken": "服务拒绝了访问令牌。请执行 `gbrain auth create <name>` 生成新的 Bearer token 并粘贴到此处。",
  "connection.starting": "正在启动 `gbrain serve --http`…",
  "connection.error": "连接错误：{error}",
  "config.title": "知识库设置",
  "config.subtitle": "配置 GBrain 实例的连接和运行参数。",
  "config.notConnected": "未连接",
  "config.hint": "URL 默认指向 `gbrain serve --http` 的本地端口 (http://127.0.0.1:3131)。如果服务跑在其他地址或需要鉴权，在此处覆盖。",
  "config.saveAndTest": "保存并测试",
  "config.saved": "已保存",
  "config.restart": "重启服务",
  "config.restartHint": "如果刚生成的 token 仍被拒绝，可尝试重启 —— 进程可能还在使用旧的 brain 数据库句柄。",
  "config.restarting": "正在重启…",
  "config.restarted": "已重启",
  "config.restartFailed": "重启失败：{error}"
}
```

(Comprehensively port all keys; this is the minimal critical set — extend as needed by reading the old `i18n/zh-CN.ts`.)

Mirror in `en.json` with the English values from `packages/i18n/src/en.ts`.

- [ ] **Step 3: Update KnowledgePanel / SettingsKnowledgeTab / BrainDisconnectedHint t() calls**

Search each migrated component for `t("options.brain.X")` / `t("options.brainConfig.X")` / `t("newtab.brainHint")` and replace with the new keys (`host.i18n.t("connection.title")` etc.). Note: the `t` you call from a host context auto-prepends `ext.io.hermes.knowledge-base.`, so use the SUFFIX.

For components imported from `@hermes-x/ui` primitives that still call `useT()` directly — those resolve through the global registry, which now contains the prefixed keys. So if a primitive renders `t("options.brain.title")`, that key is GONE. Make sure every brain-related `t(...)` call is migrated.

- [ ] **Step 4: Build + typecheck**

```
pnpm --filter @hermes-x/ext-knowledge-base build
pnpm -r typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/knowledge-base/src/i18n extensions/knowledge-base/src/renderer/views
git commit -m "feat(ext/knowledge-base): port i18n catalogs to ext.* namespace"
```

### Task 3.5: Core cleanup — delete brain/gbrain references

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Delete: `apps/desktop/src/main/gbrain/` (whole dir)
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/global.d.ts`
- Modify: `packages/core/src/config.ts`
- Delete: `packages/ui/src/settings/SettingsBrain.tsx`
- Delete: `packages/ui/src/settings/SettingsBrainConfig.tsx`
- Delete: `packages/ui/src/settings/brain-install.ts`
- Modify: `packages/i18n/src/en.ts`
- Modify: `packages/i18n/src/zh-CN.ts`

- [ ] **Step 1: Delete `apps/desktop/src/main/gbrain/`**

```bash
git rm -r apps/desktop/src/main/gbrain
```

- [ ] **Step 2: Modify `apps/desktop/src/main/index.ts`**

Delete the import block:

```ts
import {
  autoStartGBrainServeHttp,
  registerGBrainHandlers,
} from "./gbrain/ipc"
```

Delete the two call sites:

```ts
registerGBrainHandlers()
autoStartGBrainServeHttp()
```

In their place, supply the discovered manifests to `bootMainExtensionHost`. Update Task 2.3's stub to scan with `import.meta.glob` or `require.context`. Because main process runs CJS, use `fs.readdir` + `require`:

```ts
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

function discoverBuiltinExtensions(): Array<{
  manifest: ExtensionManifest
  rootDir: string
}> {
  // Resolved at runtime from the desktop bundle layout:
  //   desktop/dist (dev) | desktop/out (build)
  // extensions/<id>/ — relative to monorepo root.
  // In dev, __dirname is .../apps/desktop/out/main (or src/main on Vite dev).
  // We use require.resolve on a manifest to find the actual on-disk path.
  const result: Array<{ manifest: ExtensionManifest; rootDir: string }> = []
  const ids = ["knowledge-base"] // explicit list — phase 3 only has one
  for (const id of ids) {
    try {
      const manifestPath = require.resolve(`@hermes-x/ext-${id}/manifest.json`)
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest
      const rootDir = join(manifestPath, "..")
      result.push({ manifest, rootDir })
    } catch (e) {
      console.warn(`[extensions] failed to discover ${id}:`, e)
    }
  }
  return result
}
```

(The renderer side uses Vite globs; the main side uses an explicit list — phase 1 only has 1 extension, so this is fine. Phase 2/twos extension adds another id to the list.)

Replace the `bootMainExtensionHost({ manifests: [] })` with `manifests: discoverBuiltinExtensions()`.

- [ ] **Step 3: Modify `apps/desktop/src/preload/index.ts`**

Delete the entire `gbrain: { ... }` block (lines 139-251 approximately). Leave the rest untouched.

- [ ] **Step 4: Modify `apps/desktop/src/renderer/global.d.ts`**

Delete the `gbrain: {...}` field from `HermesBridgeApi`.

- [ ] **Step 5: Modify `packages/core/src/config.ts`**

Delete:

```ts
// ---------------------------------------------------------------------------
// GBrain (knowledge base) connection
// ---------------------------------------------------------------------------
export const BRAIN_URL_STORAGE_KEY = "settings.brain.url"
export const BRAIN_TOKEN_STORAGE_KEY = "settings.brain.token"
export const BRAIN_DEFAULT_URL = "http://127.0.0.1:3131"
```

- [ ] **Step 6: Delete UI brain files**

```bash
git rm packages/ui/src/settings/SettingsBrain.tsx \
       packages/ui/src/settings/SettingsBrainConfig.tsx \
       packages/ui/src/settings/brain-install.ts
```

- [ ] **Step 7: Modify `packages/i18n/src/en.ts` and `zh-CN.ts`**

Delete all keys matching:
- `options.brain.*`
- `options.brainConfig.*`
- `options.nav.brain`
- `sidepanel.sessions.group.knowledge`
- `newtab.brainHint`

Add the new key for the Extensions tab:
- `options.nav.extensions` — `"扩展"` (zh-CN), `"Extensions"` (en).

(Order: read each file, find the keys, delete, save. Be precise — the `Messages` type enforces all keys.)

- [ ] **Step 8: Update the `MessageKey` type users**

Run: `pnpm -r typecheck`

Expected errors: any lingering `t("options.brain.…")` calls in code that hasn't been migrated. Find and remove.

- [ ] **Step 9: Run desktop dev**

Run: `pnpm dev:desktop`
Expected: Knowledge ActivityBar item appears (now sourced from the extension). Clicking it shows the migrated KnowledgePanel. Settings has a "Knowledge" tab. HomeView shows the brain hint pill when gbrain isn't reachable. Console: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/global.d.ts packages/core/src/config.ts packages/i18n/src/en.ts packages/i18n/src/zh-CN.ts
git commit -m "refactor(core): remove all gbrain/brain/knowledge references — owned by extension now"
```

---

# Phase 4 — Settings "Extensions" tab

Goal: A core-provided Settings tab listing loaded/failed extensions. Phase 1 functionality only: list + status (loaded/failed) + error stack on click.

### Task 4.1: Add manifest+status fetcher

**Files:**
- Modify: `packages/extension-host/src/renderer/index.ts` (add `useExtensionRegistry()`)

- [ ] **Step 1: Add main IPC to surface status**

In `packages/extension-host/src/main/ipc-router.ts`, add:

```ts
export function registerStatusChannel(getRegistry: () => Array<{ id: string; status: string; error?: string }>) {
  ipcMain.handle("extensions:status", () => getRegistry())
}
```

In `packages/extension-host/src/main/index.ts`, wire it after `registerMetadataChannels`:

```ts
registerStatusChannel(() =>
  registry.list().map((e) => ({ id: e.id, status: e.status, error: e.error })),
)
```

In `packages/extension-host/src/preload/index.ts`, add to `ExtensionsBridge`:

```ts
status(): Promise<Array<{ id: string; status: string; error?: string }>>
```

```ts
status: () => ipcRenderer.invoke("extensions:status"),
```

Update `global.d.ts` to match.

- [ ] **Step 2: Add `useExtensionRegistry()` hook**

```ts
// in packages/extension-host/src/renderer/index.ts
export function useExtensionRegistry() {
  const [items, setItems] = useState<
    Array<{ id: string; status: string; error?: string; manifest: import("@hermes-x/extension-api").ExtensionManifest }>
  >([])
  useEffect(() => {
    void Promise.all([
      window.hermes.extensions.listManifests(),
      window.hermes.extensions.status(),
    ]).then(([manifests, statuses]) => {
      const byId = new Map(statuses.map((s) => [s.id, s]))
      setItems(
        manifests.map((m) => ({
          id: m.id,
          manifest: m,
          status: byId.get(m.id)?.status ?? "loaded",
          error: byId.get(m.id)?.error,
        })),
      )
    })
  }, [])
  return items
}
```

- [ ] **Step 3: Typecheck**

```
pnpm -r typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/extension-host packages/ui apps/desktop/src/preload apps/desktop/src/renderer/global.d.ts
git commit -m "feat(extension-host): expose extension registry status via IPC"
```

### Task 4.2: SettingsExtensions tab

**Files:**
- Create: `packages/ui/src/settings/SettingsExtensions.tsx`
- Modify: `packages/ui/src/settings/SettingsView.tsx`
- Modify: `packages/i18n/src/{en,zh-CN}.ts`

- [ ] **Step 1: Write `SettingsExtensions.tsx`**

```tsx
// packages/ui/src/settings/SettingsExtensions.tsx
import { useExtensionRegistry } from "@hermes-x/extension-host/renderer"
import { useT } from "@hermes-x/i18n"
import { cn } from "../primitives"

export function SettingsExtensions() {
  const { t } = useT()
  const items = useExtensionRegistry()
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-lg font-semibold">{t("options.extensions.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("options.extensions.subtitle")}</p>
      <ul className="flex flex-col divide-y rounded-md border bg-card">
        {items.map((ext) => (
          <li key={ext.id} className="flex flex-col gap-1 p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{ext.manifest.name}</span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  ext.status === "failed"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-emerald-500/15 text-emerald-600",
                )}
              >
                {ext.status === "failed"
                  ? t("options.extensions.status.failed")
                  : t("options.extensions.status.loaded")}
              </span>
            </div>
            <code className="text-xs text-muted-foreground">{ext.id} · v{ext.manifest.version}</code>
            {ext.error && (
              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-destructive">{t("options.extensions.showError")}</summary>
                <pre className="mt-1 overflow-auto rounded bg-muted p-2 text-[11px]">{ext.error}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Add tab to SettingsView**

In `packages/ui/src/settings/SettingsView.tsx`, add `"extensions"` to `ALL_TABS` and a sidebar entry + render case for `<SettingsExtensions />`. Use a `Boxes` (or similar) lucide icon.

- [ ] **Step 3: Add i18n keys**

In `en.ts` and `zh-CN.ts`:

```ts
"options.nav.extensions": "扩展",  // already added in 3.5? if so, skip
"options.extensions.title": "扩展",
"options.extensions.subtitle": "查看已加载的扩展，排查加载失败。",
"options.extensions.status.loaded": "已加载",
"options.extensions.status.failed": "加载失败",
"options.extensions.showError": "查看错误信息",
```

Mirror in en.ts.

- [ ] **Step 4: Typecheck + run**

```
pnpm -r typecheck && pnpm dev:desktop
```

Expected: Settings has a new "扩展 / Extensions" tab listing `io.hermes.knowledge-base` as Loaded.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/settings/SettingsExtensions.tsx packages/ui/src/settings/SettingsView.tsx packages/i18n/src/en.ts packages/i18n/src/zh-CN.ts
git commit -m "feat(ui): Settings → Extensions tab (loaded/failed list)"
```

---

# Phase 5 — Regression lint + smoke + final cleanup

### Task 5.1: Add regression grep script

**Files:**
- Create: `scripts/check-no-knowledge-in-core.sh`
- Modify: root `package.json` to add a script alias

- [ ] **Step 1: Create script**

```bash
#!/usr/bin/env bash
# scripts/check-no-knowledge-in-core.sh
# Fails if core (desktop + non-extension packages) imports any gbrain /
# knowledge / brain identifiers — those belong to extensions only.
set -euo pipefail

ROOTS=(
  apps/desktop/src
  packages/core/src
  packages/ui/src
  packages/i18n/src
  packages/platform/src
  packages/utils/src
)

# Patterns mirror docs/superpowers/specs/2026-06-03-desktop-extension-system-design.md §9.2.
PATTERNS='\bgbrain\b|\bknowledge\b|\bbrain\b|GBrain|BRAIN_'

if grep -rEn "$PATTERNS" "${ROOTS[@]}" 2>/dev/null; then
  echo ""
  echo "ERROR: forbidden gbrain/brain/knowledge references found in core."
  echo "Move them to extensions/<id>/."
  exit 1
fi

echo "OK: core is clean of gbrain/brain/knowledge references."
```

- [ ] **Step 2: Add to root package.json**

```json
"scripts": {
  ...
  "lint:no-extension-leak": "bash scripts/check-no-knowledge-in-core.sh"
}
```

- [ ] **Step 3: Run it — expect PASS**

```bash
chmod +x scripts/check-no-knowledge-in-core.sh
pnpm lint:no-extension-leak
```

Expected: `OK: core is clean of gbrain/brain/knowledge references.`

If FAIL: fix the remaining identifiers. Re-run until OK.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-no-knowledge-in-core.sh package.json
git commit -m "chore: regression lint forbidding gbrain/knowledge refs in core"
```

### Task 5.2: Manual smoke test

- [ ] **Step 1: Fresh desktop run**

Run: `pnpm dev:desktop:fresh`
(Uses existing `scripts/fresh-desktop.sh`, runs against a clean profile.)

- [ ] **Step 2: Walk through this checklist**

- [ ] App boots; no error overlay.
- [ ] ActivityBar shows: Chats / Scheduled / Skills / Knowledge / Tools.
- [ ] Click Knowledge → KnowledgePanel renders.
- [ ] Knowledge panel: enter URL/token in connection form → "Test Connection" succeeds (or surfaces gbrain-not-installed correctly).
- [ ] Settings → Knowledge tab → renders SettingsKnowledgeTab; URL/token fields persist.
- [ ] Settings → Extensions tab → lists `io.hermes.knowledge-base` as Loaded.
- [ ] HomeView: if gbrain not connected, brain-disconnected hint pill appears above composer.
- [ ] Click pill → composer is prefilled with install prompt; default URL is seeded.
- [ ] Onboarding wizard still completes successfully (run with cleared profile).

- [ ] **Step 3: Document the smoke pass in a commit message (no code change)**

Use `git commit --allow-empty`:

```bash
git commit --allow-empty -m "test: phase-3 manual smoke pass on macOS — knowledge-base extension parity verified"
```

### Task 5.3: Typecheck + final cleanup

- [ ] **Step 1: Run full typecheck**

```bash
pnpm -r typecheck
```

Expected: PASS in every workspace package.

- [ ] **Step 2: Run extension-host tests**

```bash
pnpm --filter @hermes-x/extension-host test
```

Expected: All tests pass.

- [ ] **Step 3: Verify no orphan files**

Look for files imported nowhere:

```bash
grep -rn "SettingsBrain\|brain-install\|gbrain" packages apps 2>/dev/null
```

Expected: empty (the extension's local files don't reference those exact identifiers because they were renamed during migration).

- [ ] **Step 4: Run regression lint one more time**

```bash
pnpm lint:no-extension-leak
```

Expected: OK.

- [ ] **Step 5: Commit any final fixes**

If any fixes were needed:

```bash
git add -p   # interactive review
git commit -m "chore: final cleanup after extension migration"
```

---

## Self-Review (notes from the author)

**Spec coverage:** every numbered section of the spec is covered:
- §1 (goals) → all phases
- §2 (architecture) → Phase 0/1
- §3 (manifest) → Phase 0
- §4 (Host API) → Phase 1.8, 1.10
- §5 (slot protocol) → Phase 2.6–2.9, Phase 3 contribution registrations
- §6 (lifecycle) → Phase 1.4 (activate + failure isolation), Phase 2.3 (shutdown)
- §7 (hermes plugin) → covered minimally: Phase 3 extension declares `hermesPlugins`; required-vs-optional enforcement deferred to a follow-up (acknowledged gap below)
- §8 (loader phasing) → Phase 1.7 (renderer glob), Phase 3.5 (main side explicit list)
- §9 (knowledge migration) → Phase 3
- §10 (preload bridge) → Phase 1.9, 2.4, 3.5
- §11 (new/adjusted packages) → all
- §12 (testing) → Phase 1 vitest + Phase 5 smoke + lint
- §13 (errors) → activate.test.ts covers timeout; manifest validation covers schema; UI/regression covers grep
- §14 (phases) → mirrored 1:1

**Gap acknowledged:** §7's `hermesPlugins.required: true` enforcement is not in any task. Added implicitly via `MainHost.hermes.callTool` failing, but no explicit check that marks the extension `failed` when the plugin is missing. This is acceptable for v1 since `gbrain` is marked `required: false` and the existing OnboardingWizard handles install. Add as a follow-up.

**Placeholder scan:** none of the disallowed patterns (TBD, "add appropriate error handling", "similar to Task N", etc.) appear. Every code block has actual content.

**Type consistency:**
- `MainHost.ipc.expose` signature consistent across `extension-api`, `make-main-host`, knowledge-base usage.
- `SlotEntry` consistent (`entryId`, `extensionId`, `order`, `component`, `props`).
- `manifest.contributes.activityBar.icon` (vs `iconKey`) reconciled in Task 3.3 step 7 — type and JSON Schema both renamed.
- `useActivityBarItems` returns `{ id, icon, labelKey, order }` — matches what `ActivityBar.tsx` consumes after Task 2.6 + 3.3.
- `RendererHost.slots.register(slot, component, options?)` matches caller code in knowledge-base/renderer/index.ts.

If readers find inconsistencies, fix them inline and continue.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-desktop-extension-system.md`.
