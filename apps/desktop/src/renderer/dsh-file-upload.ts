type UploadBridge = Pick<Window['amiba']['dshClient'], 'uploadOpen' | 'uploadWrite' | 'uploadFinish' | 'uploadCancel'>;

/** Each acknowledged chunk releases the next read; no whole-file IPC copy. */
export function createDshFileUploadFetch(bridge: UploadBridge, baseUrl: string) {
  return async (input: URL, init: RequestInit): Promise<Response> => {
    const request = new Request(new URL(input.pathname + input.search, baseUrl), init);
    request.signal.throwIfAborted();
    const id = await bridge.uploadOpen(request.url);
    const reader = request.body?.getReader();
    const abort = () => {
      void bridge.uploadCancel(id).catch(() => {});
      void reader?.cancel(request.signal.reason).catch(() => {});
    };
    request.signal.addEventListener('abort', abort, { once: true });
    try {
      request.signal.throwIfAborted();
      if (reader) while (true) {
        const item = await reader.read();
        request.signal.throwIfAborted();
        if (item.done) break;
        if (!(item.value instanceof Uint8Array)) throw new TypeError('Upload stream requires byte chunks.');
        for (let offset = 0; offset < item.value.byteLength; offset += 65536) {
          request.signal.throwIfAborted();
          await bridge.uploadWrite(id, item.value.subarray(offset, offset + 65536));
        }
      }
      const response = await bridge.uploadFinish(id);
      request.signal.throwIfAborted();
      return new Response(response.body, { status: response.status });
    } catch (error) {
      await bridge.uploadCancel(id).catch(() => {});
      await reader?.cancel(error).catch(() => {});
      request.signal.throwIfAborted();
      throw error;
    } finally {
      request.signal.removeEventListener('abort', abort);
      reader?.releaseLock();
    }
  };
}
