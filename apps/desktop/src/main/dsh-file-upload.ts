import { randomUUID } from 'node:crypto';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

interface UploadResponse { status: number; body: string }
interface Upload {
  owner: number; request: ClientRequest; result: Promise<UploadResponse>;
  writing: boolean; ended: boolean;
}
/** Bounded, owner-scoped streaming carrier. The Host owns all file/session semantics. */
export class DshFileUploadCarrier {
  private readonly uploads = new Map<string, Upload>();
  open(owner: number, rawUrl: string, baseUrl: string, browserCookie?: string): string {
    const target = new URL(rawUrl, baseUrl);
    if (target.origin !== new URL(baseUrl).origin || target.pathname !== '/api/session/uploadFileBinary' || target.username || target.password) throw new Error('File upload refused a non-runtime upload URL.');
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...(browserCookie ? { cookie: browserCookie } : {}) } });
    const result = new Promise<UploadResponse>((resolve, reject) => {
      request.on('error', reject);
      request.on('response', response => {
        const chunks: Buffer[] = []; let bytes = 0;
        response.on('error', reject);
        response.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) { response.destroy(new Error('Upload response exceeded its limit.')); return; }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 500, body: Buffer.concat(chunks).toString('utf8') }));
      });
    });
    // A server can reject before the renderer reaches finish; keep that rejection observed.
    void result.catch(() => {});
    const id = randomUUID();
    this.uploads.set(id, { owner, request, result, writing: false, ended: false });
    return id;
  }
  private owned(owner: number, id: string): Upload {
    const upload = this.uploads.get(id);
    if (!upload || upload.owner !== owner) throw new Error('Unknown file upload for this window.');
    return upload;
  }
  async write(owner: number, id: string, bytes: Uint8Array): Promise<void> {
    const upload = this.owned(owner, id);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 65536 || upload.writing || upload.ended) throw new Error('Invalid or concurrent upload chunk.');
    upload.writing = true;
    try {
      await new Promise<void>((resolve, reject) => upload.request.write(bytes, error => error ? reject(error) : resolve()));
    } finally { upload.writing = false; }
  }
  async finish(owner: number, id: string): Promise<UploadResponse> {
    const upload = this.owned(owner, id);
    if (upload.writing || upload.ended) throw new Error('File upload is not ready to finish.');
    upload.ended = true;
    upload.request.end();
    try { return await upload.result; }
    finally { this.uploads.delete(id); upload.request.destroy(); }
  }
  cancel(owner: number, id: string): void {
    const upload = this.uploads.get(id);
    if (!upload) return;
    if (upload.owner !== owner) throw new Error('Unknown file upload for this window.');
    this.uploads.delete(id);
    upload.request.destroy(new Error('File upload cancelled.'));
  }
  release(owner: number): void {
    for (const [id, upload] of this.uploads) if (upload.owner === owner) this.cancel(owner, id);
  }
}
