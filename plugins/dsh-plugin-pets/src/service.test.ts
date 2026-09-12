import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PetService } from "./service.js";
import { catalog, makeConfig } from "./model.js";
import { petOperations } from "./tools.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function service() {
  const root = await mkdtemp(join(tmpdir(), "amiba-pets-test-"));
  roots.push(root);
  return { root, pets: new PetService(root) };
}
it("agent catalog/create/activate and UI persistence use the same library", async () => {
  const { root, pets } = await service();
  const ops = petOperations(pets);
  const resource = ops.pets_catalog();
  const saved = await ops.pets_save({
    name: "Bean",
    skinId: resource.skins[0].id,
  });
  const id = saved.pets[0].id;
  expect((await new PetService(root).list()).pets[0].name).toBe("Bean");
  expect((await ops.pets_activate({ id: null })).activeId).toBe(null);
  expect((await ops.pets_activate({ id })).activeId).toBe(id);
  expect((await ops.pets_delete({ id })).pets).toEqual([]);
});
it("serializes concurrent mutations and rejects invalid or executable resources", async () => {
  const { pets } = await service();
  const skinId = catalog().skins[0].id;
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      pets.save({ name: `Pet ${i}`, skinId }),
    ),
  );
  expect((await pets.list()).pets).toHaveLength(8);
  expect(() =>
    pets.save({ name: "bad", skinId: "https://evil.invalid/code.js" }),
  ).toThrow();
  await expect(pets.activate("missing")).rejects.toThrow("not found");
  expect((await pets.list()).pets).toHaveLength(8);
});
it("validates every shipped skin and supported accessory through the published registry", () => {
  for (const skin of catalog().skins) {
    const config = makeConfig({ name: skin.name, skinId: skin.id });
    expect(makeConfig({ name: skin.name, config })).toEqual(config);
  }
  for (const part of catalog().attachments) {
    const config = makeConfig({
      name: "test",
      skinId: catalog().skins.find(s => s.dimension === part.dimension)!.id,
      attachments: [part.id],
    });
    expect(config.attachments[0].type).toBe(part.id);
  }
});

it.skipIf(!catalog().skins.some(s => s.dimension === "3d"))("rejects mixing spatial and flat accessories", () => {
  const parts = catalog().attachments, skins = catalog().skins;
  expect(() => makeConfig({ name: "invalid", skinId: skins.find(s => s.dimension === "2d")!.id,
    attachments: [parts.find(p => p.dimension === "3d")!.id] })).toThrow();
});

it("retains unsupported local pets on disk while serving compatible published pets", async () => {
  const { root, pets } = await service();
  const valid = makeConfig({ name: "Published", skinId: catalog().skins[0].id });
  const unsupported = { ...valid, skin: { ...valid.skin, rig: "unpublished-local-rig" } };
  await writeFile(join(root, "pets.json"), JSON.stringify({ version: 1, activeId: "local", pets: [
    { id: "local", name: "Local", config: unsupported, updatedAt: 1 },
    { id: "online", name: "Published", config: valid, updatedAt: 1 },
  ] }));
  expect((await pets.list()).pets.map(pet => pet.id)).toEqual(["online"]);
  expect((await pets.list()).activeId).toBe(null);
  await expect(pets.activate("local")).rejects.toThrow();
  await pets.save({ name: "Another", skinId: catalog().skins[0].id });
  const raw = JSON.parse(await readFile(join(root, "pets.json"), "utf8"));
  expect(raw.pets).toHaveLength(3);
  expect(raw.pets[0].config).toEqual(unsupported);
});
