import { describe, expect, it } from "vitest";

import {
  MINIMUM_HERMES_VERSION,
  getHermesVersionCompatibility,
  parseHermesVersion,
} from "../hermes-version";

describe("Hermes minimum version contract", () => {
  it("parses the version from Hermes CLI output", () => {
    expect(parseHermesVersion("Hermes Agent v0.17.2")).toMatchObject({
      major: 0,
      minor: 17,
      patch: 2,
      prerelease: false,
      normalized: "0.17.2",
    });
  });

  it("accepts the minimum and newer releases", () => {
    expect(MINIMUM_HERMES_VERSION).toBe("0.19.0");
    expect(getHermesVersionCompatibility("0.19.0").compatible).toBe(true);
    expect(getHermesVersionCompatibility("Hermes v0.20.0").compatible).toBe(
      true,
    );
  });

  it("rejects older, prerelease, and unverifiable versions", () => {
    expect(getHermesVersionCompatibility("0.18.99")).toMatchObject({
      compatible: false,
      reason: "unsupported",
    });
    expect(getHermesVersionCompatibility("0.19.0rc1")).toMatchObject({
      compatible: false,
      reason: "unsupported",
    });
    expect(getHermesVersionCompatibility("unknown")).toMatchObject({
      compatible: false,
      reason: "unverifiable",
    });
  });
});
