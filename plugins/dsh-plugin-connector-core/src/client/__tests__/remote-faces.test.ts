import { Context, Service } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";

// The settings section only needs the seat registration itself; the page
// components are exercised by their own tests.
vi.mock("../DshSettingsConnect.js", () => ({ DshSettingsConnect: () => null }));
vi.mock("../ConnectQuestionScreen.js", () => ({
  ConnectQuestionScreen: () => null,
}));
vi.mock("../ConnectAddToolview.js", () => ({ ConnectAddToolview: () => null }));
vi.mock("../DesktopSyncSettings.js", () => ({ DesktopSyncHeader: () => null }));

import * as plugin from "../index.js";
import type { PresetOption } from "../connector-ui-registry.js";

/**
 * The gateway installs the Client Remote as a `remote` Service (so
 * `remote.<namespace>` lookups go through Cordis's inject check) and every
 * selected wire namespace as its own `remote.<namespace>` service. A plain
 * object stub would degrade those reads to ordinary property access and never
 * exercise the requirement.
 */
class RemoteServiceStub extends Service {
  constructor(ctx: Context) {
    super(ctx, "remote");
  }

  $on(): () => void {
    return () => {};
  }

  $mount(): Promise<() => Promise<void>> {
    return Promise.resolve(async () => {});
  }
}

interface Seat {
  name: string;
  inject(): { loadPresets: () => Promise<PresetOption[]> };
}

function slotStub(seats: Map<string, Seat>) {
  return {
    inject: (_name: string, install: () => unknown) => install(),
    register: (seat: Seat) => {
      seats.set(seat.name, seat);
      return () => seats.delete(seat.name);
    },
  };
}

describe("connector-core client injection", () => {
  it("loads the wizard's preset options through the injected agentPresets face", async () => {
    const ctx = new Context();
    const seats = new Map<string, Seat>();
    const list = vi.fn(async () => ({
      ok: true as const,
      value: {
        presets: [
          { id: "restricted", name: "Restricted", isDefault: true },
          { id: "full", name: "  ", isDefault: false },
        ],
      },
    }));
    const services = ctx.plugin((provider: Context) => {
      new RemoteServiceStub(provider);
      provider.provide("slots", slotStub(seats));
      // Only the preset face is read by this test; the connector face is built
      // into a lazy adapter and never invoked.
      provider.provide("remote.amibaConnectors", {} as never);
      provider.provide("remote.agentPresets", { list });
    });
    await services;

    const fiber = ctx.plugin(plugin);
    try {
      await fiber;
      const loadPresets = seats.get("settings.section")!.inject().loadPresets;

      await expect(loadPresets()).resolves.toEqual([
        { id: "restricted", label: "Restricted", isDefault: true },
        { id: "full", label: "full", isDefault: false },
      ]);
      expect(list).toHaveBeenCalledOnce();
    } finally {
      await fiber.dispose();
      await services.dispose();
    }
  });
});
