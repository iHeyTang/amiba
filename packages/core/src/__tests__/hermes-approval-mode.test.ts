import { beforeEach, describe, expect, it, vi } from "vitest";

const backplaneFetch = vi.hoisted(() => vi.fn());

vi.mock("../backplane-client", () => ({ backplaneFetch }));

import {
  getHermesApprovalMode,
  setHermesApprovalMode,
} from "../hermes-approval-mode";

describe("Hermes approval mode client", () => {
  beforeEach(() => backplaneFetch.mockReset());

  it("reads the selected profile's effective mode", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({ ok: true, mode: "smart", profile: "researcher" }),
    );

    await expect(getHermesApprovalMode("researcher")).resolves.toEqual({
      ok: true,
      mode: "smart",
      profile: "researcher",
      changed: undefined,
    });
    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/approvals/mode?profile=researcher",
      { method: "GET" },
    );
  });

  it("persists a three-way Hermes mode", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({
        ok: true,
        mode: "off",
        profile: "default",
        changed: true,
      }),
    );

    await expect(setHermesApprovalMode("off", "default")).resolves.toEqual({
      ok: true,
      mode: "off",
      profile: "default",
      changed: true,
    });
    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/approvals/mode?profile=default",
      expect.objectContaining({ method: "PUT", body: '{"mode":"off"}' }),
    );
  });

  it("targets the default profile explicitly and tolerates older responses", async () => {
    backplaneFetch.mockResolvedValue(
      Response.json({ ok: true, mode: "manual" }),
    );

    await expect(getHermesApprovalMode()).resolves.toEqual({
      ok: true,
      mode: "manual",
      profile: "default",
      changed: undefined,
    });
    expect(backplaneFetch).toHaveBeenCalledWith(
      "/hermes/approvals/mode?profile=default",
      { method: "GET" },
    );
  });
});
