import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type { PetInput, PetLibrary } from "./model.js";
export const petInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(80),
  config: z.unknown().optional(),
  skinId: z.string().optional(),
  attachments: z.array(z.string()).max(30).optional(),
});
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaPets: {
      list(): Promise<RemoteResult<PetLibrary>>;
      save(input: PetInput): Promise<RemoteResult<PetLibrary>>;
      activate(id: string | null): Promise<RemoteResult<PetLibrary>>;
      deletePet(id: string): Promise<RemoteResult<PetLibrary>>;
      studio(): Promise<RemoteResult<string>>;
    };
  }
  interface TypertRemoteMap {
    "amibaPets/list": () => Promise<RemoteResult<PetLibrary>>;
    "amibaPets/save": (input: PetInput) => Promise<RemoteResult<PetLibrary>>;
    "amibaPets/activate": (
      id: string | null,
    ) => Promise<RemoteResult<PetLibrary>>;
    "amibaPets/deletePet": (id: string) => Promise<RemoteResult<PetLibrary>>;
    "amibaPets/studio": () => Promise<RemoteResult<string>>;
  }
}
const library = z.object({
  version: z.literal(1),
  activeId: z.string().nullable(),
  pets: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      config: z.unknown(),
      updatedAt: z.number(),
    }),
  ),
});
function descriptor(
  method: string,
  parameters: [string, z.ZodType][],
  result: z.ZodType,
): TypertRemoteContribution["descriptors"][number] {
  return {
    id: `@amiba/dsh-plugin-pets#amibaPets/${method}`,
    service: "amibaPets",
    namespace: "amibaPets",
    method,
    invocation: { kind: "direct" },
    parameters: parameters.map(([name, schema]) => ({
      name,
      wire: name,
      source: "json",
      codec: { mode: "strict", typeSymbol: `amiba/pets#${name}`, schema },
    })),
    result: {
      mode: "strict",
      typeSymbol: `amiba/pets#${method}-result`,
      schema: result,
    },
  };
}
export const PET_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-pets",
  descriptors: [
    descriptor("list", [], library),
    descriptor("save", [["input", petInputSchema]], library),
    descriptor("activate", [["id", z.string().nullable()]], library),
    descriptor("deletePet", [["id", z.string()]], library),
    descriptor("studio", [], z.string().url()),
  ],
};
