import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getHermesMemoryList = vi.hoisted(() => vi.fn());

vi.mock("@amiba/core", () => ({
  getHermesMemoryList,
}));

import { SettingsMemory } from "../SettingsMemory";

describe("SettingsMemory profile scope", () => {
  beforeEach(() => {
    getHermesMemoryList.mockReset();
    getHermesMemoryList.mockResolvedValue({
      ok: true,
      targets: [
        {
          ok: true,
          target: "memory",
          path: "/profiles/researcher/memories/MEMORY.md",
          entries: [],
          char_count: 0,
          char_limit: 2200,
          flagged_count: 0,
        },
      ],
    });
  });

  it("loads the selected profile and keeps embedded chrome compact", async () => {
    render(<SettingsMemory embedded profileId="researcher" />);

    await waitFor(() => {
      expect(getHermesMemoryList).toHaveBeenCalledWith("researcher");
    });
    expect(
      screen.queryByRole("heading", { level: 2, name: "Memory" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTitle("/profiles/researcher/memories/MEMORY.md"),
    ).toBeVisible();
  });
});
