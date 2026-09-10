import { dirname } from 'node:path';
import type { MediaStore } from './store.js';
/** Native request values may contain {$mediaAsset:{recordId,artifactId}} placeholders.
 * They resolve inside the owning session, without exposing bytes to model context. */
export async function resolveMediaAssets(store: MediaStore, sessionId: string, parameters: Record<string, unknown>): Promise<Record<string, unknown>> {
  let totalBytes = 0;
  async function visit(value: unknown, depth: number): Promise<unknown> {
    if (depth > 40) throw new Error('Media parameters are nested too deeply');
    if (Array.isArray(value)) return Promise.all(value.map(item => visit(item, depth + 1)));
    if (!value || typeof value !== 'object') return value;
    const object = value as Record<string, unknown>;
    if ('$mediaAsset' in object) {
      if (Object.keys(object).length !== 1) throw new Error('Asset placeholder must not contain other fields');
      const reference = object.$mediaAsset as { recordId?: unknown; artifactId?: unknown } | null;
      if (!reference || typeof reference.recordId !== 'string' || typeof reference.artifactId !== 'string') throw new Error('Invalid media asset reference');
      const record = await store.read(sessionId, reference.recordId);
      const artifact = record.artifacts.find(row => row.id === reference.artifactId);
      if (!artifact || dirname(artifact.path) !== store.directory(sessionId)) throw new Error('Media asset is not in this session');
      totalBytes += artifact.size;
      if (totalBytes > 32 * 1024 * 1024) throw new Error('Referenced assets exceed the 32 MiB inline limit; this input requires provider upload support');
      const bytes = await store.readArtifactChunk(sessionId, artifact, 0, artifact.size);
      if (bytes.length !== artifact.size) throw new Error('Media asset is truncated');
      return `data:${artifact.mimeType};base64,${bytes.toString('base64')}`;
    }
    return Object.fromEntries(await Promise.all(Object.entries(object).map(async ([key, item]) => [key, await visit(item, depth + 1)])));
  }
  return await visit(parameters, 0) as Record<string, unknown>;
}
