import { expect, it } from "vitest";
import { StudioHost } from "./studio.js";
it("serves the installed Studio build on loopback and closes it on unload", async () => {
  const host = new StudioHost();
  try {
    const [url, second] = await Promise.all([host.open(), host.open()]);
    expect(url).toBe(second);
    expect(new URL(url).hostname).toBe("127.0.0.1");
    const html = await (await fetch(url)).text();
    expect(html).toContain("Mofli Studio");
    const script = html.match(/src="([^"]+\.js)"/)![1];
    expect(
      (await fetch(new URL(script, url))).headers.get("content-type"),
    ).toContain("javascript");
    expect((await fetch(url, { method: "POST" })).status).toBe(405);
    expect((await fetch(new URL("/missing.json", url))).status).toBe(404);
    host.dispose();
    await expect(host.open()).rejects.toThrow("unloaded");
  } finally {
    host.dispose();
  }
});
