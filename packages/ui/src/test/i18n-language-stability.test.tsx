import { setPlatform, type PlatformAdapter } from "@amiba/app-runtime/platform";
import { LANG_PREF_STORAGE_KEY, useT } from "@amiba/i18n";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function LanguageProbe() {
  const { language } = useT();
  return <span data-testid="language">{language}</span>;
}

describe("document language stability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not publish auto/browser language while a newly mounted page reads the saved preference", async () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["en-US"]);
    vi.spyOn(window.navigator, "language", "get").mockReturnValue("en-US");

    let finishRead!: (value: Record<string, unknown>) => void;
    const pendingRead = new Promise<Record<string, unknown>>((resolve) => {
      finishRead = resolve;
    });
    setPlatform({
      storage: {
        get: vi.fn(() => pendingRead),
        set: vi.fn(async () => undefined),
        watch: vi.fn(() => () => undefined),
      },
    } as unknown as PlatformAdapter);
    document.documentElement.lang = "zh-CN";

    render(<LanguageProbe />);

    expect(screen.getByTestId("language")).toHaveTextContent("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");

    await act(async () => {
      finishRead({ [LANG_PREF_STORAGE_KEY]: "zh-CN" });
      await pendingRead;
    });

    expect(screen.getByTestId("language")).toHaveTextContent("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });
});
