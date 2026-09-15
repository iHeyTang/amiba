import { Context, Service } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";

vi.mock("../DshAgentPresetsPage.js", () => ({
  DshAgentPresetsPage: () => null,
}));

import * as plugin from "../index.js";
import type { AgentPresetsAdapter } from "../data.js";

/**
 * The gateway installs the Client Remote as a `remote` Service whose tracker
 * `associate` is `"remote"`, and every selected wire namespace as its own
 * `remote.<namespace>` service. Reading `ctx.remote.agentPresets` therefore
 * resolves the service named `remote.agentPresets`, which Cordis only hands to
 * a fiber that declares it in `inject` — otherwise the bare property read
 * throws `cannot get property "remote.agentPresets" without inject`. A plain
 * object stub would hide that: the access would degrade to a normal property
 * read and never exercise the inject requirement.
 */
class RemoteServiceStub extends Service {
  constructor(ctx: Context) {
    super(ctx, "remote");
  }

  $on(): () => void {
    return () => {};
  }
}

/** One `settings.section` seat as this plugin registers it. */
interface SectionSeat {
  name: string;
  inject(): { adapter: AgentPresetsAdapter };
}

const PRESET = {
  id: "standard",
  name: "Standard",
  isDefault: true,
  description: "The shipped preset",
  trust: "system" as const,
};

function seatStub(seats: Map<string, SectionSeat>) {
  return {
    inject: (_name: string, install: () => unknown) => install(),
    register: (seat: SectionSeat) => {
      seats.set(seat.name, seat);
      return () => seats.delete(seat.name);
    },
    getVersion: () => 0,
    entriesOfSlot: () => [],
    subscribe: () => () => {},
  };
}

describe("agent-preset client injection", () => {
  it("reads the roster and writes the default through its declared remote faces", async () => {
    const ctx = new Context();
    const seats = new Map<string, SectionSeat>();
    const list = vi.fn(async () => ({
      ok: true as const,
      value: { presets: [PRESET] },
    }));
    const update = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const services = ctx.plugin((provider: Context) => {
      new RemoteServiceStub(provider);
      provider.provide("slots", seatStub(seats));
      provider.provide("remote.agentPresets", {
        list,
        copy: vi.fn(),
        read: vi.fn(),
        deletePreset: vi.fn(),
      });
      provider.provide("remote.settings", {
        update,
        openAgentPresetDirectory: vi.fn(),
      });
    });
    await services;

    const fiber = ctx.plugin(plugin);
    try {
      await fiber;
      const adapter = seats.get("settings.section")!.inject().adapter;

      // Both of these hit an undeclared face when `inject` omits
      // `remote.agentPresets` / `remote.settings`; the adapter folds the throw
      // into `ok: false`, which is exactly the red banner the page renders.
      await expect(adapter.getAgentPresets()).resolves.toEqual({
        ok: true,
        active: "standard",
        profiles: [
          {
            id: "standard",
            name: "Standard",
            is_default: true,
            description: "The shipped preset",
            trust: "system",
          },
        ],
      });
      await expect(adapter.setDefaultAgentPreset("standard")).resolves.toEqual({
        ok: true,
      });
      expect(list).toHaveBeenCalledOnce();
      expect(update).toHaveBeenCalledWith(
        "agent-presets",
        { default: "standard" },
        undefined,
      );
    } finally {
      await fiber.dispose();
      await services.dispose();
    }
  });
});
