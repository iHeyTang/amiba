import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getHermesMemoryList = vi.hoisted(() => vi.fn());
const getHermesMemoryConfig = vi.hoisted(() => vi.fn());
const getHermesToolsetDetail = vi.hoisted(() => vi.fn());
const putHermesMemoryProvider = vi.hoisted(() => vi.fn());
const putHermesToolsetToggle = vi.hoisted(() => vi.fn());

vi.mock("@amiba/core", () => ({
  getHermesMemoryConfig,
  getHermesMemoryList,
  getHermesToolsetDetail,
  putHermesMemoryProvider,
  putHermesToolsetToggle,
}));

import { SettingsMemory } from "../SettingsMemory";

describe("SettingsMemory profile scope", () => {
  beforeEach(() => {
    getHermesMemoryList.mockReset();
    getHermesMemoryConfig.mockReset();
    getHermesToolsetDetail.mockReset();
    putHermesMemoryProvider.mockReset();
    putHermesToolsetToggle.mockReset();
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
    getHermesMemoryConfig.mockResolvedValue({
      ok: true,
      provider: "",
      providers: [
        {
          name: "",
          label: "Built-in memory",
          description: "Local memory",
          available: true,
        },
      ],
    });
    getHermesToolsetDetail.mockResolvedValue({
      ok: true,
      toolset: { name: "memory", enabled: true },
    });
    putHermesMemoryProvider.mockResolvedValue({ ok: true, provider: "" });
    putHermesToolsetToggle.mockResolvedValue({ ok: true, enabled: false });
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
    expect(
      screen.getByRole("switch", {
        name: "Allow this assistant to use memory",
      }),
    ).toBeChecked();
  });
});
