import { z } from "zod";

const identifier = z.string().min(1).max(512);
export const resourceRefSchema = z
  .object({
    source: identifier,
    connectionId: identifier,
    identity: identifier,
    kind: identifier,
    id: identifier,
  })
  .strict();
export type ResourceRef = z.infer<typeof resourceRefSchema>;
export const resourceSummarySchema = z.object({
  ref: resourceRefSchema,
  title: z.string().max(500),
  account: z.string().max(200),
  description: z.string().max(1000).optional(),
  url: z.string().url().optional(),
});
export type ResourceSummary = z.infer<typeof resourceSummarySchema>;
export const resourceDocumentSchema = resourceSummarySchema.extend({
  text: z.string().max(40_000),
  truncated: z.boolean(),
  fields: z
    .array(
      z.object({ label: z.string().max(100), value: z.string().max(1000) }),
    )
    .max(20)
    .optional(),
});
export type ResourceDocument = z.infer<typeof resourceDocumentSchema>;
export type ResourcePurpose = "preview" | "reference" | "model";
export const resourceSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(100),
    source: identifier.optional(),
    connectionId: identifier.optional(),
    kind: identifier.optional(),
  })
  .strict();
export type ResourceSearch = z.infer<typeof resourceSearchSchema>;
export const resourceSearchResultSchema = z.object({
  items: z.array(resourceSummarySchema).max(60),
  unavailable: z.array(
    z.object({
      source: z.string(),
      connectionId: z.string().optional(),
      reason: z.string(),
    }),
  ),
});
export type ResourceSearchResult = z.infer<typeof resourceSearchResultSchema>;

/** A locator, not an authorization token. No display text is trusted as identity. */
export function encodeResourceRef(ref: ResourceRef): string {
  const value = resourceRefSchema.parse(ref);
  return [
    value.source,
    value.connectionId,
    value.identity,
    value.kind,
    value.id,
  ]
    .map(encodeURIComponent)
    .join("/");
}
export function decodeResourceRef(value: string): ResourceRef {
  if (value.length > 25_000) throw new Error("invalid_resource_reference");
  const parts = value.split("/");
  if (parts.length !== 5) throw new Error("invalid_resource_reference");
  const [source, connectionId, identity, kind, id] =
    parts.map(decodeURIComponent);
  return resourceRefSchema.parse({ source, connectionId, identity, kind, id });
}
export function resourceLink(ref: ResourceRef): string {
  return `amiba-resource:${encodeResourceRef(ref)}`;
}
/** Copy/paste references and visible citation links resolve to the same locator. */
export function parseResourceLink(value: string): ResourceRef {
  if (value.startsWith("#amiba-reference?")) {
    const params = new URLSearchParams(value.slice("#amiba-reference?".length));
    if (params.get("source") !== "resources")
      throw new Error("invalid_resource_reference");
    return decodeResourceRef(params.get("ref") ?? "");
  }
  if (!value.startsWith("amiba-resource:"))
    throw new Error("invalid_resource_reference");
  return decodeResourceRef(value.slice("amiba-resource:".length));
}
export function externalUrl(value?: string): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return;
  }
}
