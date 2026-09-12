import { openAsBlob } from 'node:fs';

// The server API is intentionally confined to this adapter. Adjust field names
// or response parsing here once the CDN upload contract is decided.
export async function postArtifact({ endpoint, token, file, name, version, target, sha512, kind }, fetchImpl = fetch) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('CDN upload endpoint must use HTTPS without URL credentials or fragment');
  const body = new FormData();
  body.set('file', await openAsBlob(file, { type: 'application/octet-stream' }), name);
  for (const [key, value] of Object.entries({ name, version, target, sha512, kind })) body.set(key, value);
  const response = await fetchImpl(url, {
    method: 'POST', body, redirect: 'error',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`CDN POST failed for ${name}: HTTP ${response.status}`);
  }
  // A 2xx response means the object is committed and accessible at its GET URL.
  // Never follow a returned URL or derive client update sources from responses.
  await response.body?.cancel();
}
