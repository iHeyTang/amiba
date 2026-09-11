import { z } from "zod";

export const memorySessionSchema = z
  .string()
  .max(4096)
  .regex(/^memos_sess(?:_[a-zA-Z0-9_-]+)?=[a-zA-Z0-9._~-]+$/);
export const memoryPasswordSchema = z.string().min(1).max(1024);

export const memoryKindSchema = z.enum([
  "traces",
  "policies",
  "worldModels",
  "skills",
]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;
export const memoryQuerySchema = z.object({
  session: memorySessionSchema.optional(),
  kind: z.enum(["remembered", "traces", "policies", "worldModels", "skills"]),
  query: z.string().max(512),
  offset: z.number().int().min(0).max(1_000_000),
});
export type MemoryQuery = z.infer<typeof memoryQuerySchema>;
export const memoryEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: memoryKindSchema.optional(),
  category: z.string().optional(),
  episodeId: z.string().optional(),
  turnId: z.union([z.string(), z.number()]).optional(),
  stepCount: z.number().optional(),
  sections: z.array(z.object({ label: z.string(), text: z.string() })),
  sessionId: z.string().nullable(),
  profile: z.string().nullable(),
  timestamp: z.number().nullable(),
  status: z.string().nullable(),
  tags: z.array(z.string()),
});
export type MemoryEntry = z.infer<typeof memoryEntrySchema>;
export const memoryPageSchema = z.object({
  entries: z.array(memoryEntrySchema),
  total: z.number().nullable(),
  nextOffset: z.number().nullable(),
});
export type MemoryPage = z.infer<typeof memoryPageSchema>;
export const memoryOverviewSchema = z.object({
  traces: z.number(),
  episodes: z.number(),
  policies: z.number(),
  worldModels: z.number(),
  skills: z.number(),
});
export type MemoryOverview = z.infer<typeof memoryOverviewSchema>;

export const memoryDetailQuerySchema = z.object({
  kind: z.enum(["traces", "policies", "worldModels", "skills", "episodes"]),
  episodeId: z
    .string()
    .min(1)
    .max(512)
    .refine((id) => id !== "." && id !== "..")
    .optional(),
  turnId: z.union([z.string(), z.number()]).optional(),
  id: z
    .string()
    .min(1)
    .max(512)
    .refine((id) => id !== "." && id !== "..", "Invalid record ID"),
  session: memorySessionSchema.optional(),
});
export type MemoryDetailQuery = z.infer<typeof memoryDetailQuerySchema>;
export const memoryRelationSchema = z.object({
  episodeId: z.string().optional(),
  turnId: z.union([z.string(), z.number()]).optional(),
  kind: memoryDetailQuerySchema.shape.kind,
  id: z.string(),
  title: z.string(),
});
export const memoryDetailSchema = z.object({
  entry: memoryEntrySchema,
  steps: z.array(memoryEntrySchema).optional(),
  relations: z.array(memoryRelationSchema),
  relationsUnavailable: z.boolean().optional(),
  facts: z.array(z.object({ label: z.string(), value: z.string() })),
});
export type MemoryDetail = z.infer<typeof memoryDetailSchema>;

export const memoryUpdateSchema = z
  .object({
    kind: z.enum(["policies", "worldModels", "skills"]),
    id: memoryDetailQuerySchema.shape.id,
    session: memorySessionSchema.optional(),
    action: z.enum(["correct", "archive", "restore"]),
    title: z.string().trim().min(1).max(2000).optional(),
    sections: z
      .array(
        z.object({
          label: z.enum([
            "trigger",
            "procedure",
            "verification",
            "boundary",
            "body",
            "invocationGuide",
          ]),
          text: z.string().max(50000),
        }),
      )
      .max(6)
      .optional(),
  })
  .refine(
    (value) =>
      value.action !== "correct" ||
      value.title !== undefined ||
      !!value.sections?.length,
    "Empty correction",
  );
export type MemoryUpdate = z.infer<typeof memoryUpdateSchema>;

export const memoryCorrectionRequestSchema = z.object({
  kind: z.enum(["policies", "worldModels", "skills"]),
  id: memoryDetailQuerySchema.shape.id,
  session: memorySessionSchema.optional(),
  language: z.enum(["zh", "en"]),
});
export type MemoryCorrectionRequest = z.infer<
  typeof memoryCorrectionRequestSchema
>;
