import type { ResourceCenter } from "@amiba/dsh-plugin-resources";
import { parseResourceLink, resourceLink } from "@amiba/dsh-plugin-resources/protocol";

export interface SharedResourceChoice { reference: string; title: string; description?: string }
export interface SharedResourceSearch { items: SharedResourceChoice[]; unavailable: boolean }

/** Owner UI only. Search is account-bound; no agent can grant itself resources. */
export async function searchShareableResources(resources: ResourceCenter, connectionId: string, query: string): Promise<SharedResourceSearch> {
  const result = await resources.search({ connectionId, query }, "preview");
  return {
    items: result.items.filter(item => item.ref.connectionId === connectionId).map(item => ({ reference: resourceLink(item.ref), title: item.title, ...(item.description ? { description: item.description } : {}) })),
    unavailable: result.unavailable.length > 0,
  };
}

/** Re-read every newly shared document using the owner's current platform authority.
 * Existing grants can be retained/revoked even when the platform is offline. */
export async function validateSharedResources(resources: ResourceCenter | undefined, connectionId: string, references: string[], previous: SharedResourceChoice[]): Promise<SharedResourceChoice[]> {
  if (references.length > 100) throw new Error("too_many_shared_resources");
  const refs = [...new Set(references)].map(reference => {
    const ref = parseResourceLink(reference);
    if (ref.connectionId !== connectionId) throw new Error("resource_account_mismatch");
    return ref;
  });
  const grants: SharedResourceChoice[] = [];
  for (const ref of refs) {
    const reference = resourceLink(ref);
    const retained = previous.find(item => item.reference === reference);
    if (retained) { grants.push({ reference, title: retained.title }); continue; }
    if (!resources) throw new Error("resource_source_unavailable");
    const doc = await resources.read(ref, "preview");
    if (resourceLink(doc.ref) !== reference) throw new Error("resource_identity_mismatch");
    grants.push({ reference, title: doc.title });
  }
  return grants;
}
