import { describe, expect, it } from "vitest";

import {
  AMIBA_DSH_BUNDLES,
  amibaDshProfileBundles,
  amibaDshProfileManifest,
} from "./index.js";

describe("Amiba DSH profile composition", () => {
  it("keeps headless independent of Web and Electron", () => {
    const bundles = amibaDshProfileBundles("headless");
    expect(bundles).toEqual([
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-headless",
      AMIBA_DSH_BUNDLES.core,
    ]);
    expect(bundles).not.toContain(AMIBA_DSH_BUNDLES.web);
    expect(bundles).not.toContain(AMIBA_DSH_BUNDLES.desktop);
  });

  it("adds Electron providers only to the desktop surface", () => {
    expect(amibaDshProfileBundles("web")).not.toContain(
      AMIBA_DSH_BUNDLES.desktop,
    );
    expect(amibaDshProfileBundles("desktop").at(-1)).toBe(
      AMIBA_DSH_BUNDLES.desktop,
    );
  });

  it("preserves third-party layers without duplicating managed bundles", () => {
    const manifest = amibaDshProfileManifest("desktop", {
      dsh: {
        profile: {
          bundles: [
            AMIBA_DSH_BUNDLES.desktop,
            "@example/dsh-bundle-extra",
            "@deepseek-ai/dsh-web-app",
          ],
        },
      },
    });
    expect((manifest.dsh as any).profile.bundles).toEqual([
      "@deepseek-ai/dsh-base",
      "@deepseek-ai/dsh-web-app",
      "@example/dsh-bundle-extra",
      AMIBA_DSH_BUNDLES.core,
      AMIBA_DSH_BUNDLES.web,
      AMIBA_DSH_BUNDLES.desktop,
    ]);
  });
});
