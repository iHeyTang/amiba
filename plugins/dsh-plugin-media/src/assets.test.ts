import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { MediaStore } from './store.js';
import { resolveMediaAssets } from './assets.js';
it('resolves nested references inside the owning session without changing exclusive fields', async () => {
  const root = await mkdtemp(join(tmpdir(), 'media-assets-'));
  try {
    const store = new MediaStore(root);
    const artifact = await store.saveArtifact('one', 'image', 'image/png', new Uint8Array([1,2,3]));
    const id = 'a0000000-0000-0000-0000-000000000001';
    await store.write({ id, sessionId: 'one', provider: 'p', model: 'm', protocol: 'native', operation: 'image.generate', status: 'succeeded', createdAt: 1, updatedAt: 1, artifacts: [artifact] });
    const parameters = { content: [{ image_url: { url: { $mediaAsset: { recordId: id, artifactId: artifact.id } } } }], exclusive: { number: 3 } };
    expect(await resolveMediaAssets(store, 'one', parameters)).toEqual({ content: [{ image_url: { url: 'data:image/png;base64,AQID' } }], exclusive: { number: 3 } });
    await expect(resolveMediaAssets(store, 'two', parameters)).rejects.toThrow();
    expect(typeof parameters.content[0]!.image_url.url).toBe('object');
  } finally { await rm(root, { recursive: true, force: true }); }
});
