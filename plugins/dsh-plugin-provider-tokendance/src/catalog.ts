/** TokenDance's public directory is the authority for model protocol support. */
export const PROTOCOLS = {
  "openai:chat-completions": "openai-completions",
  "openai:responses": "openai-responses",
  "anthropic:messages": "anthropic-messages",
} as const;
export type Protocol = (typeof PROTOCOLS)[keyof typeof PROTOCOLS];
export interface CatalogModel {
  id: string;
  name: string;
  description?: string;
  api: Protocol;
  supportedApis: Protocol[];
  contextWindow?: number;
  maxTokens?: number;
  input?: ("text" | "image")[];
}
export function parseCatalog(body: unknown): CatalogModel[] {
  const rows = (body as { data?: unknown[] })?.data;
  if (!Array.isArray(rows))
    throw new Error("TokenDance returned an invalid model directory");
  const seen = new Set<string>();
  return rows.flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    if (!row || typeof row.id !== "string" || !row.id || seen.has(row.id))
      return [];
    const supportedApis = Object.entries(PROTOCOLS)
      .filter(
        ([wire]) =>
          Array.isArray(row.supported_protocols) &&
          row.supported_protocols.includes(wire),
      )
      .map(([, api]) => api);
    if (!supportedApis.length) return []; // Image/video/audio endpoints are not chat models.
    seen.add(row.id);
    const input = Array.isArray(row.input_modalities)
      ? row.input_modalities.filter(
          (v): v is "text" | "image" => v === "text" || v === "image",
        )
      : [];
    return [
      {
        id: row.id,
        name: typeof row.name === "string" ? row.name : row.id,
        ...(typeof row.description === "string" && row.description.trim() ? { description: row.description } : {}),
        api: supportedApis[0]!,
        supportedApis,
        ...(typeof row.context_length === "number" && row.context_length > 0
          ? { contextWindow: row.context_length }
          : {}),
        ...(typeof row.max_output_tokens === "number" &&
        row.max_output_tokens > 0
          ? { maxTokens: row.max_output_tokens }
          : {}),
        ...(input.length ? { input } : {}),
      },
    ];
  });
}
