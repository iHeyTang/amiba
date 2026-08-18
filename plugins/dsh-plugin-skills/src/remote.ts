import type {
  RemoteResult,
  TypertRemoteContribution,
} from "@deepseek-ai/dsh-typert-protocol";
import { z } from "zod";

import type {
  AmibaSkillDocument,
  AmibaSkillFileContent,
  AmibaSkillFileList,
  AmibaSkillSnapshot,
} from "./skill-store.js";

const resourceBaseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("directory"), path: z.string() }),
  z.object({ kind: z.literal("url"), url: z.string() }),
  z.object({ kind: z.literal("opaque"), description: z.string() }),
]);

const skillSchema = z.object({
  name: z.string(),
  description: z.string(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
  userInvocable: z.boolean(),
  source: z.string(),
  provider: z.string(),
  resourceBase: resourceBaseSchema.optional(),
  editable: z.boolean(),
});

const snapshotSchema = z.object({
  skills: z.array(skillSchema),
  userRoot: z.string(),
});

const documentSchema = z.object({
  name: z.string(),
  document: z.string(),
  editable: z.boolean(),
  source: z.string(),
  provider: z.string(),
  resourceBase: resourceBaseSchema.optional(),
});

const fileListSchema = z.object({
  root: z.string(),
  files: z.array(z.object({ path: z.string(), size: z.number() })),
  truncated: z.boolean(),
});

const fileContentSchema = z.object({
  path: z.string(),
  size: z.number(),
  encoding: z.enum(["utf-8", "binary", "too-large"]),
  content: z.string().optional(),
});

const savedSchema = z.object({ name: z.string() });
const removedSchema = z.object({ name: z.string(), deleted: z.boolean() });

const stringCodec = {
  mode: "strict" as const,
  typeSymbol: "typescript#string",
  schema: z.string(),
};

const sessionCodec = {
  mode: "strict" as const,
  typeSymbol: "@amiba/skills#session-id",
  schema: z.string().nullable(),
};

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface TypertRemoteNamespaceMap {
    amibaSkills: {
      list(sessionId: string | null): Promise<RemoteResult<AmibaSkillSnapshot>>;
      read(name: string, sessionId: string | null): Promise<RemoteResult<AmibaSkillDocument>>;
      listFiles(name: string, sessionId: string | null): Promise<RemoteResult<AmibaSkillFileList>>;
      readFile(name: string, path: string, sessionId: string | null): Promise<RemoteResult<AmibaSkillFileContent>>;
      save(
        name: string,
        document: string,
        sessionId: string | null,
      ): Promise<RemoteResult<{ name: string }>>;
      removeSkill(
        name: string,
        sessionId: string | null,
      ): Promise<RemoteResult<{ name: string; deleted: boolean }>>;
    };
  }

  interface TypertRemoteMap {
    "amibaSkills/list": (
      sessionId: string | null,
    ) => Promise<RemoteResult<AmibaSkillSnapshot>>;
    "amibaSkills/read": (name: string, sessionId: string | null) => Promise<RemoteResult<AmibaSkillDocument>>;
    "amibaSkills/listFiles": (name: string, sessionId: string | null) => Promise<RemoteResult<AmibaSkillFileList>>;
    "amibaSkills/readFile": (name: string, path: string, sessionId: string | null) => Promise<RemoteResult<AmibaSkillFileContent>>;
    "amibaSkills/save": (
      name: string,
      document: string,
      sessionId: string | null,
    ) => Promise<RemoteResult<{ name: string }>>;
    "amibaSkills/removeSkill": (
      name: string,
      sessionId: string | null,
    ) => Promise<RemoteResult<{ name: string; deleted: boolean }>>;
  }
}

function descriptor(
  method: string,
  parameters: TypertRemoteContribution["descriptors"][number]["parameters"],
  result: TypertRemoteContribution["descriptors"][number]["result"],
) {
  return {
    id: `@amiba/dsh-plugin-skills#amibaSkills/${method}`,
    service: "amibaSkills",
    namespace: "amibaSkills",
    method,
    invocation: { kind: "direct" as const },
    parameters,
    result,
  };
}

/** Strict Client descriptors for the Skills plugin's DSH Remote face. */
export const AMIBA_SKILLS_REMOTE: TypertRemoteContribution = {
  package: "@amiba/dsh-plugin-skills",
  descriptors: [
    descriptor(
      "list",
      [
        {
          name: "sessionId",
          wire: "sessionId",
          source: "json",
            codec: sessionCodec,
        },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/skills#snapshot",
        schema: snapshotSchema,
      },
    ),
    descriptor(
      "read",
      [
        { name: "name", wire: "name", source: "json", codec: stringCodec },
        { name: "sessionId", wire: "sessionId", source: "json", codec: sessionCodec },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/skills#document",
        schema: documentSchema,
      },
    ),
    descriptor(
      "listFiles",
      [
        { name: "name", wire: "name", source: "json", codec: stringCodec },
        { name: "sessionId", wire: "sessionId", source: "json", codec: sessionCodec },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/skills#file-list",
        schema: fileListSchema,
      },
    ),
    descriptor(
      "readFile",
      [
        { name: "name", wire: "name", source: "json", codec: stringCodec },
        { name: "path", wire: "path", source: "json", codec: stringCodec },
        { name: "sessionId", wire: "sessionId", source: "json", codec: sessionCodec },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/skills#file-content",
        schema: fileContentSchema,
      },
    ),
    descriptor(
      "save",
      [
        { name: "name", wire: "name", source: "json", codec: stringCodec },
        {
          name: "document",
          wire: "document",
          source: "json",
          codec: stringCodec,
        },
        { name: "sessionId", wire: "sessionId", source: "json", codec: sessionCodec },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/skills#saved",
        schema: savedSchema,
      },
    ),
    descriptor(
      "removeSkill",
      [
        { name: "name", wire: "name", source: "json", codec: stringCodec },
        { name: "sessionId", wire: "sessionId", source: "json", codec: sessionCodec },
      ],
      {
        mode: "strict",
        typeSymbol: "@amiba/skills#removed",
        schema: removedSchema,
      },
    ),
  ],
};
