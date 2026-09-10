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
  kind: memoryKindSchema,
  query: z.string().max(512),
  offset: z.number().int().min(0).max(1_000_000),
});
export type MemoryQuery = z.infer<typeof memoryQuerySchema>;
export const memoryEntrySchema = z.object({
  id: z.string(),
  title: z.string(),
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
