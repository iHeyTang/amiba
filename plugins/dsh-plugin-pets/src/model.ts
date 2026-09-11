import { PetRegistry, type PetConfig } from "@mofli/core";
import { grovePack } from "@mofli/grove";
export const registry = new PetRegistry().registerPacks(grovePack);
export interface PetRecord {
  id: string;
  name: string;
  config: PetConfig;
  updatedAt: number;
}
export interface PetLibrary {
  version: 1;
  activeId: string | null;
  pets: PetRecord[];
}
export interface PetInput {
  id?: string;
  name: string;
  config?: unknown;
  skinId?: string;
  attachments?: string[];
}
export function catalog() {
  return {
    skins: grovePack.skins.map((s) => ({ id: s.id, name: s.name, rig: s.rig })),
    attachments: grovePack.attachments.map((p) => ({
      id: p.attachment.id,
      name: p.name,
      mount: p.attachment.mount,
    })),
  };
}
export function makeConfig(input: PetInput): PetConfig {
  if (input.config !== undefined) return registry.resolve(input.config).config;
  const skin = grovePack.skins.find((s) => s.id === input.skinId);
  if (!skin) throw new Error("Choose a skin from pets_catalog.");
  return registry.resolve({
    version: 1,
    skin,
    rigConfig: {},
    pose: {},
    attachments: (input.attachments ?? []).map((type, i) => ({
      id: `part-${i}`,
      type,
      version: 1,
    })),
  }).config;
}
export function validateInput(input: PetInput) {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.trim().length > 80
  )
    throw new Error("Pet name must contain 1–80 characters.");
  if (JSON.stringify(input).length > 200_000)
    throw new Error("Pet configuration is too large.");
  return makeConfig(input);
}
