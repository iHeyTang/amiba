// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MediaDelivery } from "./delivery.js";
vi.mock("@amiba/ui/plugin", async (original) => ({
  ...(await original<typeof import("@amiba/ui/plugin")>()),
  usePluginT: () => ({ t: (key: string) => key }),
}));
afterEach(cleanup);
it("renders generation success with a failed local save and an explicit upstream link in final delivery", async () => {
  const record = {
    id: "record",
    sessionId: "session",
    model: "model",
    status: "interrupted",
    generationStatus: "succeeded",
    storageStatus: "failed",
    storageError: "download failed",
    artifacts: [],
    remoteArtifacts: [
      { index: 0, kind: "image", url: "https://storage.example/result.png" },
      { index: 1, kind: "image", url: "javascript:alert(1)" },
    ],
  };
  render(
    <MediaDelivery
      code='{"sessionId":"session","recordId":"record"}'
      api={
        {
          inspect: vi.fn().mockResolvedValue({ ok: true, value: record }),
        } as never
      }
    />,
  );
  await screen.findByText("media.generatedSaveFailed");
  expect(screen.getByRole("link").getAttribute("href")).toBe(
    "https://storage.example/result.png",
  );
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.queryByText("empty")).toBeNull();
  expect(screen.getByText("media.saveRetryHint")).toBeTruthy();
});
