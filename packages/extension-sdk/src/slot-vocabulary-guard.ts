/**
 * Compile-time tripwire for the mirrored official declarations in
 * `./slots.ts` (currently: `shell.overlay`).
 *
 * This file is the ONLY place in the SDK allowed to import
 * `@deepseek-ai/dsh-client-ui-layout/client`: that entry also merges
 * `layout: ILayout` into the cordis Context, so it must never sit on the
 * public export graph — Amiba's `ctx.layout` face (dsh-plugin-ui-shell's
 * `AmibaLayoutService`) is wider, and the double merge would TS2717 every
 * consumer. Loading the official declaration here beside Amiba's mirror
 * makes `pnpm typecheck` fail the moment the official `shell.overlay`
 * shape drifts from the re-declaration (duplicate SlotMap keys must stay
 * identical), without leaking the Context merge to SDK consumers: nothing
 * reachable from `index.ts` imports this file and the build excludes it.
 */
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "./slots.js";

export {};
