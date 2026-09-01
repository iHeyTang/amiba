import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorCenter } from "./center.js";
import { apply } from "./index.js";

// Regression for the whole-branch-review Critical finding: connector-core's
// apply() registered TWO Cordis services under the exact same key
// ("amibaConnectors") — once via its own `ctx.provide("amibaConnectors",
// center)`, and again via `AmibaConnectorsRemoteService`'s Service-base
// constructor (`super(ctx, "amibaConnectors")` in remote-service.ts, before
// the fix). Cordis 4.0.1's real `ReflectService#provide` throws on a
// duplicate name (see node_modules/@deepseek-ai/cordis lib/index.js:
// `if (this.store[key]) throw new Error('service "${name}" has been
// registered at <${...}>')`) — so on a real Context, apply() itself throws,
// the whole plugin fiber fails, and connector-core (and therefore lark)
// never activates. Every other test in this package builds `ConnectorCenter`
// directly with a permissive test double that never enforces this, so
// nothing else in the suite would have caught it.

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/**
 * Minimal fake Cordis Context reproducing the ONE behavior that matters
 * here: `ctx.provide(name, value)` and `ctx.reflect.provide(name, value)`
 * share one underlying store (exactly like real cordis, where `ctx.provide`
 * is a mixin forwarding to `ctx.reflect.provide` — see
 * node_modules/@deepseek-ai/cordis lib/index.js's `this.mixin("reflect",
 * ["get", "set", "provide", ...])`) and throw when the same service name is
 * registered twice — matching `ReflectService#provide`'s real duplicate
 * check byte for byte. `TypertRemoteService`'s Service-base constructor only
 * ever touches `ctx.reflect.provide(name, self, check)` during construction
 * (verified against @deepseek-ai/cordis's Service class and confirmed by
 * remote-service.test.ts's own `fakeRemoteCtx` comment) — so this fake needs
 * nothing else from `ctx.reflect` to reproduce the collision faithfully.
 */
function fakeCordisCtx() {
  const store = new Map<string, unknown>();
  const provide = (name: string, value: unknown) => {
    if (store.has(name))
      throw new Error(`service "${name}" has been registered at <root>`);
    store.set(name, value);
  };
  const ctx = {
    reflect: { provide, get: (name: string) => store.get(name) },
    provide,
    effect: (callback: () => unknown) => {
      const cleanup = callback();
      return async () => {
        if (typeof cleanup === "function") await cleanup();
      };
    },
    // `apply()` also calls `ctx.logger("amiba-connector-core")` to pass a
    // logger into `seedAgentPresets` (see preset-seed.ts); a fresh temp
    // `agentPresetsRoot` below has no "restricted" directory yet, so the
    // seeder writes one and calls `.info` exactly once.
    logger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }),
    // Never exercised: a fresh store has no rows, so center.start() at the
    // end of apply() finds nothing to reconcile and neither the messaging
    // center nor the credentials seam is ever called.
    amibaMessageCenter: {},
    credentials: {},
  };
  return { ctx, store };
}

describe("connector-core plugin apply()", () => {
  it("registers the center and its Remote service under distinct Cordis service keys, without throwing on a real duplicate-registration guard", async () => {
    const root = await mkdtemp(join(tmpdir(), "amiba-connector-apply-"));
    roots.push(root);
    const agentPresetsRoot = await mkdtemp(join(tmpdir(), "amiba-connector-apply-presets-"));
    roots.push(agentPresetsRoot);
    const { ctx, store } = fakeCordisCtx();

    await expect(
      apply(ctx as never, { root, agentPresetsRoot }),
    ).resolves.toBeUndefined();

    expect(store.has("amibaConnectors")).toBe(true);
    expect(store.get("amibaConnectors")).toBeInstanceOf(ConnectorCenter);
    // The Remote service must live under its OWN key, distinct from
    // "amibaConnectors" (which the center itself already occupies) — the
    // fix's whole point. Its wire namespace still resolves to
    // "amibaConnectors" for the client (see remote.ts's descriptors and
    // remote-service.ts's `{ namespace: "amibaConnectors" }` option), but
    // that's a client-side concern this fake Context can't observe.
    expect(store.has("amibaConnectorsRemote")).toBe(true);
    expect(store.get("amibaConnectorsRemote")).not.toBe(
      store.get("amibaConnectors"),
    );
  });
});
