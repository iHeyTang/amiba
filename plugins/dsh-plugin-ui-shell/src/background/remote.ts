import { z } from "zod";
import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import {
  assetIdSchema,
  backgroundConfigSchema,
  type BackgroundConfig,
  type BackgroundSnapshot,
  type BackgroundAsset,
} from "./model.js";
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaBackground: {
      get(): Promise<RemoteResult<BackgroundSnapshot>>;
      configure(
        config: BackgroundConfig,
        revision: number,
      ): Promise<RemoteResult<BackgroundSnapshot>>;
      beginUpload(bytes: number): Promise<RemoteResult<string>>;
      upload(
        id: string,
        offset: number,
        data: string,
      ): Promise<RemoteResult<number>>;
      finishUpload(id: string): Promise<RemoteResult<BackgroundAsset>>;
      asset(
        id: string,
        offset: number,
      ): Promise<RemoteResult<{ data: string; mime: string; bytes: number }>>;
    };
  }
}
const snapshot = z.object({
  revision: z.number(),
  config: backgroundConfigSchema,
});
const descriptor = (
  method: string,
  parameters: [string, z.ZodType][],
  result: z.ZodType,
): TypertRemoteContribution["descriptors"][number] => ({
  id: `@amiba/dsh-plugin-ui-shell#amibaBackground/${method}`,
  service: "amibaBackground",
  namespace: "amibaBackground",
  method,
  invocation: { kind: "direct" },
  parameters: parameters.map(([name, schema]) => ({
    name,
    wire: name,
    source: "json",
    codec: { mode: "strict", typeSymbol: `amiba/background#${name}`, schema },
  })),
  result: {
    mode: "strict",
    typeSymbol: `amiba/background#${method}`,
    schema: result,
  },
});
export const BACKGROUND_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-ui-shell",
  descriptors: [
    descriptor("get", [], snapshot),
    descriptor(
      "configure",
      [
        ["config", backgroundConfigSchema],
        ["revision", z.number().int().nonnegative()],
      ],
      snapshot,
    ),
    descriptor(
      "beginUpload",
      [["bytes", z.number().int().positive()]],
      z.string(),
    ),
    descriptor(
      "upload",
      [
        ["id", z.string()],
        ["offset", z.number().int().nonnegative()],
        ["data", z.string().max(349528)],
      ],
      z.number(),
    ),
    descriptor(
      "finishUpload",
      [["id", z.string()]],
      z.object({ id: assetIdSchema, mime: z.string(), bytes: z.number() }),
    ),
    descriptor(
      "asset",
      [
        ["id", assetIdSchema],
        ["offset", z.number().int().nonnegative()],
      ],
      z.object({ data: z.string(), mime: z.string(), bytes: z.number() }),
    ),
  ],
};
