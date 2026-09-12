import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  validateInput,
  registry,
  type PetLibrary,
  type PetInput,
} from "./model.js";
export class PetService {
  private queue = Promise.resolve();
  constructor(private root: string) {}
  private async read(): Promise<PetLibrary> {
    let raw: string;
    try {
      raw = await readFile(join(this.root, "pets.json"), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, activeId: null, pets: [] };
      throw e;
    }
    const state = JSON.parse(raw) as PetLibrary;
    if (state.version !== 1 || !Array.isArray(state.pets))
      throw new Error("Unsupported pet library");
    return state;
  }
  async list() {
    await this.queue;
    return this.compatible(await this.read());
  }
  /** Keep newer/local pets on disk so switching package versions never loses them. */
  private compatible(state: PetLibrary): PetLibrary {
    const pets = state.pets.filter(pet => {
      try { registry.resolve(pet.config); return true; } catch { return false; }
    });
    return { ...state, pets, activeId: pets.some(pet => pet.id === state.activeId) ? state.activeId : null };
  }
  private mutate(fn: (state: PetLibrary) => void) {
    const run = this.queue.then(async () => {
      const state = await this.read();
      fn(state);
      await mkdir(this.root, { recursive: true });
      const temp = join(this.root, `pets.${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify(state, null, 2), "utf8");
      await rename(temp, join(this.root, "pets.json"));
      return this.compatible(state);
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  save(input: PetInput) {
    const config = validateInput(input);
    return this.mutate((state) => {
      const id = input.id ?? randomUUID();
      const at = state.pets.findIndex((p) => p.id === id);
      if (input.id && at < 0) throw new Error("Pet not found");
      if (at < 0 && state.pets.length >= 100)
        throw new Error("Pet library is full (100 pets).");
      const pet = {
        id,
        name: input.name.trim(),
        config,
        updatedAt: Date.now(),
      };
      if (at < 0) state.pets.push(pet);
      else state.pets[at] = pet;
      if (!state.activeId) state.activeId = id;
    });
  }
  activate(id: string | null) {
    return this.mutate((s) => {
      if (id && !s.pets.some((p) => p.id === id))
        throw new Error("Pet not found");
      if (id) registry.resolve(s.pets.find(pet => pet.id === id)!.config);
      s.activeId = id;
    });
  }
  remove(id: string) {
    return this.mutate((s) => {
      if (!s.pets.some((p) => p.id === id)) throw new Error("Pet not found");
      s.pets = s.pets.filter((p) => p.id !== id);
      if (s.activeId === id) s.activeId = null;
    });
  }
}
