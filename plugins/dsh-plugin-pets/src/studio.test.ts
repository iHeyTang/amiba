import { expect, it } from "vitest";
import { StudioHost, withFallbackIcon } from "./studio.js";
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
it("gives every served page a tab icon because Studio declares none", async () => {
  const host = new StudioHost();
  try {
    const url = await host.open();
    const html = await (await fetch(url)).text();
    expect(html).toContain('<link rel="icon" href="/amiba-icon.svg"');
    // The icon is served by the plugin, not read from the installed build.
    const icon = await fetch(new URL("/amiba-icon.svg", url));
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(icon.headers.get("x-content-type-options")).toBe("nosniff");
    const svg = await icon.text();
    expect(svg.startsWith("<!--")).toBe(true);
    expect(svg).toContain("<svg");
    expect(svg).toContain('width="1024"');
    expect(await (await fetch(new URL("/spatial.html", url))).text()).toContain(
      'rel="icon"',
    );
    // A browser asking for the conventional path still gets no file.
    expect((await fetch(new URL("/favicon.ico", url))).status).toBe(404);
  } finally {
    host.dispose();
  }
});
it("leaves pages that carry their own icon or no head alone", () => {
  const own = '<html><head><link rel="shortcut icon" href="/own.ico"></head>';
  expect(withFallbackIcon(own)).toBe(own);
  const bare = "<html><body>no head</body></html>";
  expect(withFallbackIcon(bare)).toBe(bare);
  expect(withFallbackIcon("<html><head><title>x</title></head>")).toBe(
    '<html><head><title>x</title><link rel="icon" href="/amiba-icon.svg" type="image/svg+xml"></head>',
  );
});
