import { Context } from "@deepseek-ai/cordis";
import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { installBackground } from "./host.js";
import { BACKGROUND_REMOTE } from "./remote.js";
let ctx: Context | undefined, root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
it("Agent import/configure and the real remote service share one durable snapshot", async () => {
  root = await mkdtemp(join(tmpdir(), "amiba-background-host-"));
  ctx = new Context();
  const tools = new Map<
    string,
    { execute(args: object): Promise<{ json: string }> }
  >();
  ctx.provide("tools", {
    register(definition: {
      name: string;
      execute(args: object): Promise<{ json: string }>;
    }) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
  });
  const fork = await ctx.plugin((child) => installBackground(child, root));
  expect([...tools.keys()]).toEqual([
    "background_get",
    "background_import",
    "background_configure",
  ]);
  const run = async (name: string, args = {}) =>
    JSON.parse((await tools.get(name)!.execute(args)).json);
  const source = join(root, "generated.png");
  await writeFile(
    source,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1sAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const asset = await run("background_import", { filePath: source });
  const snapshot = await run("background_get");
  await run("background_configure", {
    configJson: JSON.stringify({
      ...snapshot.config,
      enabled: true,
      assetId: asset.id,
    }),
    revision: snapshot.revision,
  });
  const remote = ctx.reflect.get("amibaBackground") as {
    get(): Promise<unknown>;
  };
  expect(await remote.get()).toEqual(await run("background_get"));
  const getDescriptor = BACKGROUND_REMOTE.descriptors.find(
    (d) => d.method === "get",
  )!;
  if (getDescriptor.result.mode !== "strict")
    throw new Error("Expected strict codec");
  expect(getDescriptor.result.schema.parse(await remote.get())).toEqual(
    await run("background_get"),
  );
  await fork.dispose();
  expect(tools.size).toBe(0);
});
