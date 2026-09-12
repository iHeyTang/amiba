import type { ConversationLifecycle, ConversationOrigin } from "@amiba/dsh-plugin-session-features";
import type { ResourceCenter } from "./center.js";
import { parseResourceLink, resourceLink, type ResourceRef, type ResourceSearch, type ResourceSearchResult } from "./protocol.js";

export async function readSharedResource(center: ResourceCenter, lifecycle: ConversationLifecycle, origin: ConversationOrigin, ref: ResourceRef, signal: AbortSignal) {
  const reference = resourceLink(ref);
  const allowed = async () => (await lifecycle.sharedResources(origin)).some(grant => grant.reference === reference);
  if (!await allowed()) throw new Error("resource_not_shared_with_conversation");
  const doc = await center.read(ref, "model", signal);
  // Revocation during platform I/O must also prevent returning the result.
  if (!await allowed()) throw new Error("resource_sharing_revoked");
  return doc;
}
export async function searchSharedResources(center: ResourceCenter, lifecycle: ConversationLifecycle, origin: ConversationOrigin, query: ResourceSearch, signal: AbortSignal): Promise<ResourceSearchResult> {
  const grants = await lifecycle.sharedResources(origin);
  const items: ResourceSearchResult["items"] = [];
  const unavailable: ResourceSearchResult["unavailable"] = [];
  if (!grants.length) return { items, unavailable: [{ source: "shared-resources", reason: "no_resources_shared_with_conversation" }] };
  const needle = query.query.trim().toLocaleLowerCase();
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(20_000)]);
  for (const grant of grants) {
    bounded.throwIfAborted();
    const ref = parseResourceLink(grant.reference);
    if ((query.source && query.source !== ref.source) || (query.connectionId && query.connectionId !== ref.connectionId) || (query.kind && query.kind !== ref.kind)) continue;
    try {
      const doc = await readSharedResource(center, lifecycle, origin, ref, bounded);
      if (`${doc.title}\n${doc.text}`.toLocaleLowerCase().includes(needle)) {
        const { text: _text, truncated: _truncated, fields: _fields, ...summary } = doc;
        items.push(summary);
      }
    } catch {
      bounded.throwIfAborted();
      unavailable.push({ source: ref.source, reason: "shared_resource_unavailable" });
    }
    if (items.length === 60) break;
  }
  // A grant can be removed after its own read while another reference is loading.
  const current = new Set((await lifecycle.sharedResources(origin)).map(grant => grant.reference));
  return { items: items.filter(item => current.has(resourceLink(item.ref))), unavailable };
}
