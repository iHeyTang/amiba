import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, JsonValue } from "@deepseek-ai/dsh-tools";
import { catalog, type PetInput } from "./model.js";
import type { PetService } from "./service.js";
const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
export function petOperations(service: PetService) {
  return {
    pets_catalog: () => catalog(),
    pets_list: () => service.list(),
    pets_save: (args: PetInput) => service.save(args),
    pets_activate: (args: { id: string | null }) => service.activate(args.id),
    pets_delete: (args: { id: string }) => service.remove(args.id),
  };
}
export function registerPetTools(ctx: Context, service: PetService) {
  const ops = petOperations(service);
  const specs: [keyof typeof ops, string, unknown][] = [
    [
      "pets_catalog",
      "List trusted Mofli skin and accessory IDs before creating a pet.",
      object({}),
    ],
    [
      "pets_list",
      "List saved Amiba pets and the active companion.",
      object({}),
    ],
    [
      "pets_save",
      "Create or update a pet. Choose skinId and attachment IDs from pets_catalog, or supply a complete Studio-exported config. Omit id to create; include an existing id to update. This saves a pet, not executable plugin code.",
      object(
        {
          id: { type: "string" },
          name: { type: "string" },
          skinId: { type: "string" },
          attachments: { type: "array", items: { type: "string" } },
          config: { type: "object" },
        },
        ["name"],
      ),
    ],
    [
      "pets_activate",
      "Select the companion from the pet library, or null to hide it. Surface providers must be enabled in Amiba Settings by the user.",
      object({ id: { type: ["string", "null"] } }, ["id"]),
    ],
    [
      "pets_delete",
      "Delete a saved pet only when the user asks to remove it.",
      object({ id: { type: "string" } }, ["id"]),
    ],
  ];
  for (const [name, description, parameters] of specs) {
    const definition: ToolDefinition = {
      name,
      description,
      parameters: parameters as never,
      output: {
        schema: object({ content: { type: "array", items: {} } }, [
          "content",
        ]) as never,
        render: (_args, value) =>
          (value as { content: JsonValue[] }).content as never,
      },
      execute: async (args) =>
        ({
          content: [
            {
              type: "text",
              text: JSON.stringify(
                await (ops[name] as (args: unknown) => unknown)(args),
              ),
            },
          ],
        }) as never,
    };
    ctx.effect(() => ctx.tools.register(definition), name);
  }
}
