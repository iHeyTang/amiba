import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BackgroundStore, mediaType } from "./store.js";
import { DEFAULT_BACKGROUND, MAX_BACKGROUND_BYTES } from "./model.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=",
  "base64",
);
let root: string, store: BackgroundStore;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "amiba-bg-test-"));
  store = new BackgroundStore(root);
});
afterEach(async () => {
  store.dispose();
  await rm(root, { recursive: true, force: true });
});
async function upload() {
  const id = store.beginUpload(png.length);
  store.upload(id, 0, png.toString("base64"));
  return store.finishUpload(id);
}
describe("durable application backgrounds", () => {
  it("migrates saved contain and strong settings without losing the selected asset", async () => {
    const asset = await upload();
    await writeFile(join(root, "background.json"), JSON.stringify({ revision: 7,
      config: { ...DEFAULT_BACKGROUND, enabled: true, assetId: asset.id, fit: "contain", glass: "strong" } }));
    const saved = await store.get();
    expect(saved.config).toEqual({ ...DEFAULT_BACKGROUND, enabled: true, assetId: asset.id });
    expect(saved.revision).toBe(7);
    const next = await store.configure({ ...saved.config, fit: "contain", glass: "strong" }, 7);
    expect(next.config.fit).toBe("cover");
    expect(next.config.glass).toBe("balanced");
  });
  it("copies a generated artifact, survives deleting its source and reopens after restart", async () => {
    const source = join(root, "generated.png");
    await writeFile(source, png);
    const asset = await store.importFile(source);
    await rm(source);
    const next = await store.configure(
      { ...DEFAULT_BACKGROUND, enabled: true, assetId: asset.id },
      0,
    );
    expect(await new BackgroundStore(root).get()).toEqual(next);
    expect(
      Buffer.from((await store.asset(asset.id, 0)).data, "base64"),
    ).toEqual(png);
  });
  it("rejects stale Agent writes while preserving the UI update, then permits another edit", async () => {
    const asset = await upload();
    const results = await Promise.allSettled([
      store.configure(
        { ...DEFAULT_BACKGROUND, assetId: asset.id, enabled: true },
        0,
      ),
      store.configure({ ...DEFAULT_BACKGROUND, dim: 0.6 }, 0),
    ]);
    expect(results.map((row) => row.status)).toEqual(["fulfilled", "rejected"]);
    expect((await store.get()).config.enabled).toBe(true);
    expect((await store.configure(DEFAULT_BACKGROUND, 1)).revision).toBe(2);
  });
  it("does not activate missing or invalid assets and rejects executable input", async () => {
    await expect(
      store.configure({ ...DEFAULT_BACKGROUND, enabled: true }, 0),
    ).rejects.toThrow();
    await expect(
      store.configure(
        { ...DEFAULT_BACKGROUND, assetId: "a".repeat(64) + ".png" },
        0,
      ),
    ).rejects.toThrow();
    expect(() => mediaType(Buffer.from('<svg onload="alert(1)"/>'))).toThrow();
    await expect(store.asset("../../secret", 0)).rejects.toThrow();
    expect((await store.get()).revision).toBe(0);
  });
  it("enforces ordered bounded uploads and refuses partial completion", async () => {
    expect(() => store.beginUpload(MAX_BACKGROUND_BYTES + 1)).toThrow();
    const id = store.beginUpload(png.length);
    expect(() => store.upload(id, 4, png.toString("base64"))).toThrow();
    await expect(store.finishUpload(id)).rejects.toThrow("Incomplete");
    store.upload(id, 0, png.subarray(0, 10).toString("base64"));
    store.upload(id, 10, png.subarray(10).toString("base64"));
    const asset = await store.finishUpload(id);
    expect(asset.mime).toBe("image/png");
    expect(() => store.upload(id, png.length, "AAAA")).toThrow();
    await expect(store.asset(asset.id, png.length)).rejects.toThrow();
  });
  it("validates glass, opacity, motion, poster and complete config at the service boundary", async () => {
    for (const patch of [
      { dim: -1 },
      { blur: 100 },
      { glass: "transparent" },
      { motion: "javascript" },
      { extra: true },
      { posterId: "a".repeat(64) + ".mp4" },
    ]) {
      await expect(
        store.configure({ ...DEFAULT_BACKGROUND, ...patch } as never, 0),
      ).rejects.toThrow();
    }
  });
});
