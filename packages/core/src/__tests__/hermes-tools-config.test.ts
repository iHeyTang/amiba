import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({
  backplaneFetch,
}));

import {
  getHermesComputerUseStatus,
  getHermesTerminalBackends,
  getHermesToolsetModels,
  postHermesComputerUseGrant,
  postHermesToolsetSetup,
  putHermesTerminalBackend,
  putHermesTerminalEnv,
  putHermesToolsetEnv,
  putHermesToolsetModel,
  putHermesToolsetProvider,
} from "../hermes-tools";

describe("Hermes capability configuration client", () => {
  beforeEach(() => {
    backplaneFetch.mockReset();
    backplaneFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("selects independent web capability providers", async () => {
    await putHermesToolsetProvider("web", "Example Search", "search");

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/tools/toolsets/web/provider",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          provider: "Example Search",
          capability: "search",
        }),
      }),
    );
  });

  it("targets capability configuration at a named profile", async () => {
    await putHermesToolsetProvider(
      "web",
      "Example Search",
      "search",
      "researcher",
    );

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/tools/toolsets/web/provider?profile=researcher",
      expect.objectContaining({
        method: "PUT",
      }),
    );
  });

  it("sends credential values only in the write request body", async () => {
    await putHermesToolsetEnv("homeassistant", {
      HASS_TOKEN: "secret",
      HASS_URL: "http://homeassistant.local:8123",
    });

    const [, init] = backplaneFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      env: {
        HASS_TOKEN: "secret",
        HASS_URL: "http://homeassistant.local:8123",
      },
    });
  });

  it("loads and saves a provider-specific model", async () => {
    backplaneFetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            name: "image_gen",
            has_models: true,
            models: [{ id: "image-model", display: "Image Model" }],
            current: "image-model",
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            name: "image_gen",
            model: "image-model",
          }),
        ),
      );

    const models = await getHermesToolsetModels("image_gen", "Example");
    expect(models.models[0]?.id).toBe("image-model");

    await putHermesToolsetModel("image_gen", "image-model", "Example");
    expect(backplaneFetch).toHaveBeenLastCalledWith(
      "/hermes/tools/toolsets/image_gen/model",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          model: "image-model",
          provider: "Example",
        }),
      }),
    );
  });

  it("runs only the named setup action endpoint", async () => {
    await postHermesToolsetSetup("browser", "agent_browser");

    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/tools/toolsets/browser/post-setup",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ key: "agent_browser" }),
      }),
    );
  });

  it("reads and updates terminal backend settings through dedicated routes", async () => {
    backplaneFetch
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          active: "local",
          backends: [],
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, backend: "docker" }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          saved: ["TERMINAL_DOCKER_IMAGE"],
        }),
      );

    expect((await getHermesTerminalBackends()).active).toBe("local");
    await putHermesTerminalBackend("docker");
    expect(backplaneFetch).toHaveBeenNthCalledWith(
      2,
      "/hermes/tools/terminal/backend",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ backend: "docker" }),
      }),
    );
    await putHermesTerminalEnv({ TERMINAL_DOCKER_IMAGE: "python:3.12" });
    expect(backplaneFetch).toHaveBeenLastCalledWith(
      "/hermes/tools/terminal/env",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          env: { TERMINAL_DOCKER_IMAGE: "python:3.12" },
        }),
      }),
    );
  });

  it("uses fixed computer-use status and permission routes", async () => {
    backplaneFetch
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          platform: "darwin",
          platform_supported: true,
          installed: true,
          ready: false,
          can_grant: true,
          checks: [],
        }),
      )
      .mockResolvedValueOnce(Response.json({ ok: true, pid: 42 }));

    const status = await getHermesComputerUseStatus();
    expect(status.can_grant).toBe(true);

    await postHermesComputerUseGrant();
    expect(backplaneFetch).toHaveBeenLastCalledWith(
      "/hermes/tools/computer-use/permissions/grant",
      { method: "POST" },
    );
  });
});
