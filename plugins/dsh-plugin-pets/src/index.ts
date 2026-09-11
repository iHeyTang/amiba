import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { PetService } from "./service.js";
import { StudioHost } from "./studio.js";
import { registerPetTools } from "./tools.js";
import type { PetInput } from "./model.js";
export * from "./remote.js";
export const name = "amiba-pets";
export const inject = ["tools"];
export interface Config {
  root: string;
}
export const Config: z<Config> = z.object({ root: z.string().required() });
class PetRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private pets: PetService,
    private host: StudioHost,
  ) {
    super(ctx, "amibaPets");
  }
  @Remote list() {
    return this.pets.list();
  }
  @Remote save(input: PetInput) {
    return this.pets.save(input);
  }
  @Remote activate(id: string | null) {
    return this.pets.activate(id);
  }
  @Remote deletePet(id: string) {
    return this.pets.remove(id);
  }
  @Remote studio() {
    return this.host.open();
  }
}
export function apply(ctx: Context, config: Config) {
  const pets = new PetService(config.root);
  const studio = new StudioHost();
  new PetRemote(ctx, pets, studio);
  registerPetTools(ctx, pets);
  ctx.effect(() => () => studio.dispose(), "amiba-pets-studio");
}
