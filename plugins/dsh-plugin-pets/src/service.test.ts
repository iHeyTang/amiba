import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
      skinId: catalog().skins[0].id,
      attachments: [part.id],
    });
    expect(config.attachments[0].type).toBe(part.id);
  }
});
