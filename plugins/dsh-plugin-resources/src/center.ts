import {
  encodeResourceRef,
  resourceDocumentSchema,
  resourceRefSchema,
  resourceSearchSchema,
  resourceSummarySchema,
  externalUrl,
  type ResourceDocument,
  type ResourcePurpose,
  type ResourceRef,
  type ResourceSearch,
  type ResourceSearchResult,
  type ResourceSummary,
} from "./protocol.js";

export interface ResourceSource {
  id: string;
  search(
    request: ResourceSearch,
    purpose: ResourcePurpose,
    signal: AbortSignal,
  ): Promise<ResourceSearchResult>;
  read(
    ref: ResourceRef,
    purpose: ResourcePurpose,
    signal: AbortSignal,
  ): Promise<ResourceDocument>;
}

/** Enforce cancellation even when an extension ignores its signal. */
export function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("resource_request_cancelled"));
    if (signal.aborted) {
      operation.catch(() => undefined);
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    operation
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Small routing service. Platform auth, storage and search remain provider-owned. */
export class ResourceCenter {
  private sources = new Map<
    string,
    { source: ResourceSource; controller: AbortController }
  >();
  register(source: ResourceSource): () => void {
    if (!/^[a-z][a-z0-9-]*$/.test(source.id))
      throw new Error("invalid_resource_source");
    if (this.sources.has(source.id))
      throw new Error("duplicate_resource_source");
    const entry = { source, controller: new AbortController() };
    this.sources.set(source.id, entry);
    return () => {
      entry.controller.abort();
      if (this.sources.get(source.id) === entry) this.sources.delete(source.id);
    };
  }
  listSources(): string[] { return [...this.sources.keys()]; }
  dispose(): void {
    for (const item of this.sources.values()) item.controller.abort();
    this.sources.clear();
  }
  async search(
    input: ResourceSearch,
    purpose: ResourcePurpose = "preview",
    signal?: AbortSignal,
  ): Promise<ResourceSearchResult> {
    const request = resourceSearchSchema.parse(input);
    const entries = [...this.sources.values()].filter(
      ({ source }) => !request.source || source.id === request.source,
    );
    if (request.source && !entries.length)
      return {
        items: [],
        unavailable: [{ source: request.source, reason: "source_not_registered" }],
      };
    const results = await Promise.all(
      entries.map(async (entry): Promise<ResourceSearchResult> => {
        const scoped = AbortSignal.any([
          entry.controller.signal,
          AbortSignal.timeout(15_000),
          ...(signal ? [signal] : []),
        ]);
        try {
          const result = await abortable(
            entry.source.search(request, purpose, scoped),
            scoped,
          );
          scoped.throwIfAborted();
          const items = result.items.slice(0, 30).map((item) => {
            const parsed = resourceSummarySchema.parse(item);
            if (
              parsed.ref.source !== entry.source.id ||
              (request.connectionId &&
                parsed.ref.connectionId !== request.connectionId) ||
              (request.kind && parsed.ref.kind !== request.kind)
            )
              throw new Error("resource_identity_mismatch");
            const { url: rawUrl, description, ...summary } = parsed;
            const url = externalUrl(rawUrl);
            return {
              ...summary,
              ...(url ? { url } : {}),
              ...(description !== undefined ? { description } : {}),
            };
          });
          return {
            items,
            unavailable: result.unavailable.slice(0, 60).map((item) => ({
              source: entry.source.id,
              ...(item.connectionId
                ? { connectionId: item.connectionId.slice(0, 512) }
                : {}),
              reason: ["connection_unavailable", "personal_authorization_required", "personal_authorization_expired", "agent_access_disabled", "permission_required", "resource_kind_unavailable", "permission_or_resource_unavailable", "search_failed"].includes(item.reason) ? item.reason : "permission_or_source_unavailable",
            })),
          };
        } catch {
          signal?.throwIfAborted();
          return {
            items: [],
            unavailable: [
              {
                source: entry.source.id,
                reason: entry.controller.signal.aborted
                  ? "source_unavailable"
                  : "search_failed",
              },
            ],
          };
        }
      }),
    );
    signal?.throwIfAborted();
    const seen = new Set<string>();
    const items: ResourceSummary[] = [];
    for (const result of results)
      for (const item of result.items) {
        const key = encodeResourceRef(item.ref);
        if (!seen.has(key) && items.length < 60) {
          seen.add(key);
          items.push(item);
        }
      }
    return { items, unavailable: results.flatMap((item) => item.unavailable) };
  }
  async read(
    input: ResourceRef,
    purpose: ResourcePurpose = "preview",
    signal?: AbortSignal,
  ): Promise<ResourceDocument> {
    const ref = resourceRefSchema.parse(input);
    const entry = this.sources.get(ref.source);
    if (!entry) throw new Error("source_unavailable");
    const scoped = AbortSignal.any([
      entry.controller.signal,
      AbortSignal.timeout(20_000),
      ...(signal ? [signal] : []),
    ]);
    const value = await abortable(
      entry.source.read(ref, purpose, scoped),
      scoped,
    );
    scoped.throwIfAborted();
    const doc = resourceDocumentSchema.parse({
      ...value,
      text: value.text.slice(0, 40_000),
      truncated: value.truncated || value.text.length > 40_000,
    });
    if (encodeResourceRef(doc.ref) !== encodeResourceRef(ref))
      throw new Error("resource_identity_mismatch");
    const { url: rawUrl, description, fields, ...summary } = doc;
    const url = externalUrl(rawUrl);
    return {
      ...summary,
      ...(url ? { url } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(fields !== undefined ? { fields } : {}),
    };
  }
}
