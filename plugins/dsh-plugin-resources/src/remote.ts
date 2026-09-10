import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import {
  resourceRefSchema,
  resourceSearchSchema,
  resourceDocumentSchema,
  resourceSearchResultSchema,
  type ResourceRef,
  type ResourceSearch,
  type ResourceDocument,
  type ResourceSearchResult,
} from "./protocol.js";
export interface ResourcesRemote {
  search(input: ResourceSearch): Promise<RemoteResult<ResourceSearchResult>>;
  read(ref: ResourceRef): Promise<RemoteResult<ResourceDocument>>;
  reference(ref: ResourceRef): Promise<RemoteResult<ResourceDocument>>;
}
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaResources: ResourcesRemote;
  }
  interface TypertRemoteMap {
    "amibaResources/search": ResourcesRemote["search"];
    "amibaResources/read": ResourcesRemote["read"];
    "amibaResources/reference": ResourcesRemote["reference"];
  }
}
export const AMIBA_RESOURCES_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-resources",
  descriptors: (
    [
      ["search", "input", resourceSearchSchema, resourceSearchResultSchema],
      ["read", "ref", resourceRefSchema, resourceDocumentSchema],
      ["reference", "ref", resourceRefSchema, resourceDocumentSchema],
    ] as const
  ).map(([method, arg, input, result]) => ({
    id: `@amiba/dsh-plugin-resources#amibaResources/${method}`,
    service: "amibaResourcesRemote",
    namespace: "amibaResources",
    method,
    invocation: { kind: "direct" },
    parameters: [
      {
        name: arg,
        wire: arg,
        source: "json",
        codec: {
          mode: "strict",
          typeSymbol: `@amiba/resources#${arg}`,
          schema: input as z.ZodType,
        },
      },
    ],
    result: {
      mode: "strict",
      typeSymbol: `@amiba/resources#${method}-result`,
      schema: result as z.ZodType,
    },
  })),
};
