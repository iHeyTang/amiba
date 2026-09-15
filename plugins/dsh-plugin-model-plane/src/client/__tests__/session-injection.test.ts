import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it, vi } from "vitest";

vi.mock("@amiba/ui/plugin", () => ({
  PageContent: () => null,
  ScrollArea: () => null,
}));
vi.mock("../ProviderOnboarding.js", () => ({ ProviderOnboarding: () => null }));
vi.mock("../ModelProviderConfigTab.js", () => ({
  ModelProviderConfigTab: () => null,
}));
vi.mock("../native-settings.js", () => ({ NativeProviderSettings: class {} }));
vi.mock("../DshComposerModelPicker.js", () => ({
  DshComposerModelPicker: () => null,
  makeSessionModelEngine: vi.fn(),
}));
import * as plugin from "../index.js";
import type { SessionModelWire } from "../DshComposerModelPicker.js";

describe("session picker dependency injection", () => {
  it("reads the bound session projection through the registered picker wire", async () => {
    const ctx = new Context();
    const seats = new Map<string, { inject(): { wire?: SessionModelWire } }>();
    const selected = { provider: "deepseek", model: "chat" };
    const getSnapshot = vi.fn(() => ({ next: selected }));
    const faceOf = vi.fn(() => ({ getSnapshot }));
    const binding = vi.fn((id: string) =>
      id === "existing-session"
        ? { session: { projections: { faceOf } } }
        : undefined,
    );
    const services = ctx.plugin((provider: Context) => {
      provider.provide("slots", {
        inject: (_name: string, install: () => unknown) => install(),
        register: (seat: {
          name: string;
          inject(): { wire?: SessionModelWire };
        }) => {
          seats.set(seat.name, seat);
          return () => seats.delete(seat.name);
        },
      });
      provider.provide("connection", {});
      provider.provide("sessions", { binding });
      provider.provide("remote", {
        session: {},
        settings: {},
        llm: {},
        credentials: {},
      });
      for (const service of ["session", "settings", "llm", "credentials"])
        provider.provide(`remote.${service}`, {});
    });
    await services;
    const fiber = ctx.plugin(plugin);
    try {
      await fiber;
      const wire = seats.get("conversation.input.model")!.inject().wire!;
      expect(
        wire.modelSelection(
          "existing-session" as Parameters<
            SessionModelWire["modelSelection"]
          >[0],
        ),
      ).toEqual(selected);
      expect(binding).toHaveBeenCalledWith("existing-session");
      expect(faceOf).toHaveBeenCalledWith("modelSelection");
      expect(
        wire.modelSelection(
          "missing-session" as Parameters<
            SessionModelWire["modelSelection"]
          >[0],
        ),
      ).toBeUndefined();
      expect(seats.has("amiba.composer.modelPicker")).toBe(true);
    } finally {
      await fiber.dispose();
      await services.dispose();
    }
  });
});
