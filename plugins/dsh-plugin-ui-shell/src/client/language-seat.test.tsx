// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AmibaLanguageRow,
  LANGUAGE_ROW_ENTRY_ID,
  LANGUAGE_ROW_SHADOW_PRIORITY,
  type LanguageLocaleRuntime,
} from "./language-seat.js";

function fakeLocale(initial: "zh" | "en") {
  const listeners = new Set<() => void>();
  const locales = [
    { id: "zh" as const, label: "中文" },
    { id: "en" as const, label: "English" },
  ];
  let snapshot = { active: initial, locales, revision: 0 };
  const setLocale = vi.fn((id: string) => {
    snapshot = {
      active: id === "zh" ? "zh" : "en",
      locales,
      revision: snapshot.revision + 1,
    };
    for (const listener of [...listeners]) listener();
  });
  const runtime: LanguageLocaleRuntime = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setLocale,
  };
  return { runtime, setLocale };
}

afterEach(cleanup);

describe("the language row visual shadow", () => {
  it("targets the official cell at a winning shadow priority", () => {
    expect(LANGUAGE_ROW_ENTRY_ID).toBe("language");
    expect(LANGUAGE_ROW_SHADOW_PRIORITY).toBeLessThan(0);
  });

  it("renders Amiba's standard Select while reading the official locale snapshot", () => {
    const locale = fakeLocale("en");
    render(<AmibaLanguageRow locale={locale.runtime} t={() => "Language"} />);

    const trigger = screen.getByRole("combobox", { name: "Language" });
    expect(trigger.textContent).toContain("English");
    // This class comes from @amiba/ui's shared form-control surface. The
    // official DSH Menu trigger used `border:none` instead.
    expect(trigger.classList.contains("border")).toBe(true);

    act(() => locale.setLocale("zh"));
    expect(trigger.textContent).toContain("中文");
  });
});
