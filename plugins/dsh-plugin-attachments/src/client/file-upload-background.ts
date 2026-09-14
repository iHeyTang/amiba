// Adapted from deepseek-harness c291e796, MIT; see ../../LICENSE.deepseek.
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { FileUploadValue } from '../file-upload-remote.js';
type FileUploadBody = Blob | ReadableStream<Uint8Array>;
type FileUploadFetch = (input: URL, init: RequestInit) => Promise<Response>;
interface FileUploadTransport { post(request: FileUploadRequest): Promise<FileUploadResponse> }
export function createBackgroundUpload(): { available: boolean; transport: FileUploadTransport } {
  const hook = (globalThis as typeof globalThis & { __DSH_FILE_UPLOAD__?: { fetch: FileUploadFetch } }).__DSH_FILE_UPLOAD__;
  const page = Reflect.get(globalThis, 'location') as Location | undefined;
  const available = hook !== undefined || (!isFixturePage() && typeof Worker === 'function' && (page?.protocol === 'http:' || page?.protocol === 'https:'));
  return { available, transport: hook ? customTransport(hook.fetch) : workerTransport() };
}
interface FileUploadRequest {
  readonly path: string
  readonly body: FileUploadBody
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: { readonly loaded: number; readonly total?: number }) => void
}

interface FileUploadResponse {
  readonly status: number
  readonly body: string
}

interface UploadWorkerStart {
  readonly url: string
  readonly body: FileUploadBody
  readonly headers: Readonly<Record<string, string>>
}

type UploadWorkerOutput =
  | { readonly kind: 'progress'; readonly loaded: number; readonly total?: number }
  | { readonly kind: 'complete'; readonly status: number; readonly body: string }
  | { readonly kind: 'error'; readonly message: string }

interface UploadWorkerScope {
  onmessage: ((event: MessageEvent<UploadWorkerStart>) => void) | null
  postMessage(message: UploadWorkerOutput): void
}

interface UploadXhr {
  readonly upload: { onprogress: ((event: ProgressEvent) => void) | null }
  status: number
  responseText: string
  withCredentials: boolean
  onload: ((event: ProgressEvent) => void) | null
  onerror: ((event: ProgressEvent) => void) | null
  open(method: string, url: string): void
  setRequestHeader(name: string, value: string): void
  send(body: Blob): void
}

type UploadWorkerFetch = (
  input: string,
  init: RequestInit & { readonly duplex: 'half' },
) => Promise<Response>

/**
 * Self-contained Worker body; its string form becomes the Blob Worker source.
 * @param scope - Worker global used for requests and progress messages.
 * @param createXhr - XMLHttpRequest factory used for Blob progress.
 * @param doFetch - Fetch carrier used for one-shot ReadableStream bodies.
 */
export function fileUploadWorker(
  scope: UploadWorkerScope = self,
  createXhr: () => UploadXhr = () => new XMLHttpRequest(),
  doFetch: UploadWorkerFetch = (input, init) => fetch(input, init),
): void {
  scope.onmessage = (event: MessageEvent<UploadWorkerStart>) => {
    const request = event.data
    if (request.body instanceof Blob) {
      const xhr = createXhr()
      xhr.open('POST', request.url)
      xhr.withCredentials = true
      for (const [name, value] of Object.entries(request.headers)) xhr.setRequestHeader(name, value)
      xhr.upload.onprogress = (progress) => {
        scope.postMessage({
          kind: 'progress',
          loaded: progress.loaded,
          ...(progress.lengthComputable ? { total: progress.total } : {}),
        } satisfies UploadWorkerOutput)
      }
      xhr.onload = () => {
        scope.postMessage({ kind: 'complete', status: xhr.status, body: xhr.responseText } satisfies UploadWorkerOutput)
      }
      xhr.onerror = () => {
        scope.postMessage({ kind: 'error', message: 'background upload transport failed' } satisfies UploadWorkerOutput)
      }
      xhr.send(request.body)
      return
    }
    if (!(request.body instanceof ReadableStream)) {
      scope.postMessage({ kind: 'error', message: 'background upload worker received an invalid body' })
      return
    }
    const source = request.body
    void (async () => {
      const reader = source.getReader()
      let loaded = 0
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const item = await reader.read()
          if (item.done) {
            controller.close()
            return
          }
          if (!(item.value instanceof Uint8Array)) {
            throw new TypeError('background upload stream produced a non-Uint8Array chunk')
          }
          loaded += item.value.byteLength
          scope.postMessage({ kind: 'progress', loaded })
          controller.enqueue(item.value)
        },
        async cancel(reason) {
          await reader.cancel(reason)
        },
      })
      const response = await doFetch(request.url, {
        method: 'POST',
        headers: request.headers,
        credentials: 'include',
        body,
        duplex: 'half',
      })
      scope.postMessage({
        kind: 'complete',
        status: response.status,
        body: await response.text(),
      })
    })().catch((error: unknown) => {
      scope.postMessage({
        kind: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })
  }
}

function customTransport(customFetch: FileUploadFetch): FileUploadTransport {
  return {
    async post(request) {
      const init: RequestInit & { duplex?: 'half' } = {
        method: 'POST',
        ...(request.headers === undefined ? {} : { headers: request.headers }),
        body: request.body,
        ...(request.body instanceof ReadableStream ? { duplex: 'half' as const } : {}),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }
      request.signal?.throwIfAborted()
      if (request.onProgress) {
        const source = request.body instanceof Blob ? request.body.stream() : request.body
        const total = request.body instanceof Blob ? request.body.size : undefined
        let loaded = 0
        init.body = source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            if (!(chunk instanceof Uint8Array)) throw new TypeError('upload requires byte chunks')
            loaded += chunk.byteLength
            request.onProgress?.({ loaded, ...(total === undefined ? {} : { total }) })
            controller.enqueue(chunk)
          },
        }))
        init.duplex = 'half'
      }
      const response = await customFetch(resolveUrl(request.path), init)
      return { status: response.status, body: await response.text() }
    },
  }
}

function workerTransport(): FileUploadTransport {
  return {
    post(request) {
      if (typeof Worker !== 'function') {
        return Promise.reject(new Error('background upload requires Web Worker support'))
      }
      const workerUrl = URL.createObjectURL(new Blob([
        `(${fileUploadWorker.toString()})()`,
      ], { type: 'text/javascript' }))
      const worker = new Worker(workerUrl, { name: 'dsh-file-upload' })
      URL.revokeObjectURL(workerUrl)
      return new Promise((resolve, reject) => {
        let settled = false
        const abort = (): void => {
          settled = true
          worker.terminate()
          request.signal?.removeEventListener('abort', abort)
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        }
        const finish = (settle: () => void): void => {
          if (settled) return
          settled = true
          request.signal?.removeEventListener('abort', abort)
          worker.terminate()
          settle()
        }
        worker.onmessage = (event: MessageEvent<UploadWorkerOutput>) => {
          const output = event.data
          if (output.kind === 'progress') {
            try {
              request.onProgress?.({ loaded: output.loaded, ...(output.total === undefined ? {} : { total: output.total }) })
            } catch (error) { finish(() => { reject(error) }) }
          } else if (output.kind === 'complete') {
            finish(() => { resolve({ status: output.status, body: output.body }) })
          } else {
            finish(() => { reject(new Error(output.message)) })
          }
        }
        worker.onerror = (event) => {
          finish(() => { reject(new Error(event.message || 'background upload worker failed')) })
        }
        if (request.signal?.aborted === true) {
          abort()
          return
        }
        request.signal?.addEventListener('abort', abort, { once: true })
        const message: UploadWorkerStart = {
          url: resolveUrl(request.path).href,
          body: request.body,
          headers: request.headers ?? {},
        }
        try {
          if (request.body instanceof ReadableStream) worker.postMessage(message, [request.body])
          else worker.postMessage(message)
        } catch (error) { finish(() => { reject(error) }) }
      })
    },
  }
}

function resolveUrl(path: string): URL {
  const pageLocation = Reflect.get(globalThis, 'location') as unknown
  const origin = typeof pageLocation === 'object' && pageLocation !== null
    && 'origin' in pageLocation && typeof pageLocation.origin === 'string'
    ? pageLocation.origin
    : undefined
  return new URL(path, origin === undefined || origin === 'null' ? 'http://dsh.internal' : origin)
}

function isFixturePage(): boolean {
  const pageLocation = Reflect.get(globalThis, 'location') as unknown
  return typeof pageLocation === 'object' && pageLocation !== null
    && 'search' in pageLocation && typeof pageLocation.search === 'string'
    && new URLSearchParams(pageLocation.search).has('fixture')
}

export function parseFileUploadResult(body: string): RemoteResult<FileUploadValue> {
  const value = JSON.parse(body) as unknown
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new TypeError('file upload transport returned an invalid result')
  }
  if (!value.ok) {
    const error = value.error
    if (!isRecord(error) || typeof error.code !== 'string'
      || typeof error.message !== 'string' || !isRecord(error.details)) {
      throw new TypeError('file upload transport returned an invalid failure')
    }
    return {
      ok: false,
      error: { code: error.code as never, message: error.message, details: error.details as never },
    }
  }
  const result = value.value
  const file = isRecord(result) ? result.file : undefined
  if (!isRecord(result) || typeof result.receiptId !== 'string' || !isRecord(file)
    || typeof file.attachmentId !== 'string' || typeof file.name !== 'string'
    || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
    throw new TypeError('file upload transport returned an invalid receipt')
  }
  return {
    ok: true,
    value: {
      receiptId: result.receiptId as FileUploadValue['receiptId'],
      file: {
        attachmentId: file.attachmentId as FileUploadValue['file']['attachmentId'],
        name: file.name,
        bytes: file.bytes,
      },
    },
  }
}

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
