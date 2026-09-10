import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";
import type { MediaRecord } from "./store.js";
export interface ArtifactChunk {
  data: string;
  nextOffset: number | null;
  mimeType: string;
  size: number;
}
declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaMediaUi: {
      setConfirmationThreshold(value: number, revision: number): Promise<RemoteResult<boolean>>;
      setModelEnabled(
        provider: string,
        model: string,
        enabled: boolean,
        revision: number,
      ): Promise<RemoteResult<boolean>>;
      catalog(): Promise<RemoteResult<string>>;
      setDefault(
        operation: string,
        selectionJson: string,
        revision: number,
      ): Promise<RemoteResult<boolean>>;
      authorizeNewGeneration(
        sessionId: string,
        recordId: string,
      ): Promise<RemoteResult<MediaRecord>>;
      inspect(
        sessionId: string,
        recordId: string,
      ): Promise<RemoteResult<MediaRecord>>;
      artifact(
        sessionId: string,
        recordId: string,
        artifactId: string,
        offset: number,
      ): Promise<RemoteResult<ArtifactChunk>>;
    };
  }
  interface TypertRemoteMap {
    "amibaMediaUi/setConfirmationThreshold": TypertRemoteNamespaceMap["amibaMediaUi"]["setConfirmationThreshold"];
    "amibaMediaUi/setModelEnabled": TypertRemoteNamespaceMap["amibaMediaUi"]["setModelEnabled"];
    "amibaMediaUi/catalog": TypertRemoteNamespaceMap["amibaMediaUi"]["catalog"];
    "amibaMediaUi/setDefault": TypertRemoteNamespaceMap["amibaMediaUi"]["setDefault"];
    "amibaMediaUi/authorizeNewGeneration": TypertRemoteNamespaceMap["amibaMediaUi"]["authorizeNewGeneration"];
    "amibaMediaUi/inspect": TypertRemoteNamespaceMap["amibaMediaUi"]["inspect"];
    "amibaMediaUi/artifact": TypertRemoteNamespaceMap["amibaMediaUi"]["artifact"];
  }
}
const artifact = z.object({
  id: z.string(),
  kind: z.enum(["image", "video", "audio", "file"]),
  mimeType: z.string(),
  path: z.string(),
  size: z.number(),
});
const mediaRecord = z.object({
  id: z.string(),
  sessionId: z.string(),
  provider: z.string(),
  model: z.string(),
  protocol: z.string(),
  operation: z.enum([
    "image.generate",
    "video.generate",
    "speech.synthesize",
    "audio.generate",
  ]),
  status: z.enum([
    "submitting",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "expired",
    "interrupted",
    "submission_unknown",
  ]),
  createdAt: z.number(),
  updatedAt: z.number(),
  task: z
    .object({ id: z.string(), model: z.string(), protocol: z.string() })
    .optional(),
  artifacts: z.array(artifact),
  error: z.string().optional(),
  warnings: z.array(z.string()).optional(),
  accounting: z
    .object({
      usage: z.record(z.string(), z.unknown()).optional(),
      cost: z.object({ amount: z.string(), currency: z.string() }).optional(),
    })
    .optional(),
  generationStatus: z
    .enum([
      "pending",
      "running",
      "succeeded",
      "failed",
      "cancelled",
      "expired",
      "unknown",
    ])
    .optional(),
  storageStatus: z.enum(["saving", "saved", "failed"]).optional(),
  storageError: z.string().optional(),
  resultCount: z.number().optional(),
  remoteArtifacts: z
    .array(
      z.object({
        index: z.number(),
        kind: z.enum(["image", "video", "audio", "file"]),
        url: z.string(),
        mimeType: z.string().optional(),
      }),
    )
    .optional(),
  retryAuthorizedAt: z.number().optional(),
});
export const MEDIA_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-media",
  descriptors: [
    "setConfirmationThreshold",
    "authorizeNewGeneration",
    "inspect",
    "artifact",
    "catalog",
    "setDefault",
    "setModelEnabled",
  ].map((method) => ({
    id: `@amiba/dsh-plugin-media#amibaMediaUi/${method}`,
    service: "amibaMediaUi",
    namespace: "amibaMediaUi",
    method,
    invocation: { kind: "direct" },
    parameters: (method === "setConfirmationThreshold" ? ["value", "revision"] : method === "setModelEnabled"
      ? ["provider", "model", "enabled", "revision"]
      : method === "catalog"
        ? []
        : method === "setDefault"
          ? ["operation", "selectionJson", "revision"]
          : method === "inspect" || method === "authorizeNewGeneration"
            ? ["sessionId", "recordId"]
            : ["sessionId", "recordId", "artifactId", "offset"]
    ).map((name) => ({
      name,
      wire: name,
      source: "json",
      codec: {
        mode: "strict",
        typeSymbol: `@amiba/media#${name}`,
        schema:
          name === "value" ? z.number().positive().max(1000) : name === "enabled"
            ? z.boolean()
            : name === "offset" || name === "revision"
              ? z.number().int().min(0)
              : z.string(),
      },
    })),
    result: {
      mode: "strict",
      typeSymbol: `@amiba/media#${method}`,
      schema:
        method === "catalog"
          ? z.string()
          : method === "setConfirmationThreshold" || method === "setDefault" || method === "setModelEnabled"
            ? z.boolean()
            : method === "inspect" || method === "authorizeNewGeneration"
              ? mediaRecord
              : z.object({
                  data: z.string(),
                  nextOffset: z.number().nullable(),
                  mimeType: z.string(),
                  size: z.number(),
                }),
    },
  })),
};
