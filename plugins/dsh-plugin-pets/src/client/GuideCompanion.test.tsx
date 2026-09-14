// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { GuideCompanion } from "./GuideCompanion.js";
import { grovePack, makeConfig, type PetRecord } from "../model.js";
import type { PetLibraryClient } from "./library.js";
const { view } = vi.hoisted(() => ({ view: vi.fn((_props: unknown) => null) }));
vi.mock("./PetView.js", () => ({ PetView: view }));
it("previews a built-in pet for an empty library and uses the active pet when available", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  let state = {
    library: {
      version: 1 as const,
      activeId: null as string | null,
      pets: [] as PetRecord[],
    },
    loading: false,
    error: null,
  };
  const save = vi.fn();
  let notify = () => {};
  const library = {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      notify = fn;
      return () => {};
    },
    save,
  } as unknown as PetLibraryClient;
  try {
    act(() => root.render(<GuideCompanion library={library} mood="waiting" />));
    expect(view.mock.lastCall?.[0]).toMatchObject({
      name: "Mofli",
      previewScene: "waiting",
    });
    const config = makeConfig({
      name: "My pet",
      skinId: grovePack.skins[0].id,
    });
    act(() => {
      state = {
        ...state,
        library: {
          version: 1,
          activeId: "mine",
          pets: [{ id: "mine", name: "My pet", config, updatedAt: 1 }],
        },
      };
      notify();
    });
    expect(view.mock.lastCall?.[0]).toMatchObject({ name: "My pet", config });
    act(() =>
      root.render(<GuideCompanion library={library} mood="completed" />),
    );
    expect(view.mock.lastCall?.[0]).toMatchObject({
      previewScene: "completed",
    });
    expect(save).not.toHaveBeenCalled();
  } finally {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
