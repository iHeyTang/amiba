import type { Context } from "@deepseek-ai/cordis";
import type {} from "../../background/remote.js";
import {
  BACKGROUND_CHUNK_BYTES,
  MAX_BACKGROUND_BYTES,
  DEFAULT_BACKGROUND,
  type BackgroundApi,
  type BackgroundConfig,
  type BackgroundSnapshot,
} from "../../background/model.js";
export function createBackgroundController(ctx: Context) {
  let api: BackgroundApi | undefined;
  let state = {
    snapshot: {
      revision: 0,
      config: { ...DEFAULT_BACKGROUND },
    } as BackgroundSnapshot,
    ready: false,
    error: "",
  };
  let disposed = false,
    pending: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const emit = () => {
    if (!disposed) listeners.forEach((fn) => fn());
  };
  const accept = (snapshot: BackgroundSnapshot) => {
    if (snapshot.revision < state.snapshot.revision) return;
    if (
      snapshot.revision === state.snapshot.revision &&
      state.ready &&
      !state.error
    )
      return;
    state = { snapshot, ready: true, error: "" };
    emit();
  };
  const unwrap = async <T>(
    result: Promise<{ ok: true; value: T } | { ok: false; error: unknown }>,
  ): Promise<T> => {
    const value = await result;
    if (!value.ok)
      throw new Error(
        typeof value.error === "object" &&
        value.error &&
        "message" in value.error
          ? String(value.error.message)
          : String(value.error),
      );
    return value.value;
  };
  const requireApi = () => {
    if (!api) throw new Error("Background service unavailable");
    return api;
  };
  const refresh = () =>
    (pending ??= (async () => {
      try {
        accept(await requireApi().get());
      } catch (error) {
        if (!disposed) {
          state = { ...state, error: String(error) };
          emit();
        }
      }
    })().finally(() => {
      pending = undefined;
    }));
  ctx.inject(["remote.amibaBackground"], (child) => {
    const remote = child.remote.amibaBackground;
    api = {
      get: () => unwrap(remote.get()),
      configure: (config, revision) =>
        unwrap(remote.configure(config, revision)),
      beginUpload: (bytes) => unwrap(remote.beginUpload(bytes)),
      upload: (id, offset, data) => unwrap(remote.upload(id, offset, data)),
      finishUpload: (id) => unwrap(remote.finishUpload(id)),
      asset: (id, offset) => unwrap(remote.asset(id, offset)),
    };
    void refresh();
    return () => {
      api = undefined;
    };
  });
  const onVisible = () => {
    if (!document.hidden) void refresh();
  };
  const timer = setInterval(onVisible, 3000);
  document.addEventListener("visibilitychange", onVisible);
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    async configure(config: BackgroundConfig, revision: number) {
      const snapshot = await requireApi().configure(config, revision);
      accept(snapshot);
      return snapshot;
    },
    async upload(file: File, progress: (percent: number) => void) {
      if (!file.size || file.size > MAX_BACKGROUND_BYTES)
        throw new Error("Maximum background size: 64 MiB");
      const remote = requireApi();
      const id = await remote.beginUpload(file.size);
      for (
        let offset = 0;
        offset < file.size;
        offset += BACKGROUND_CHUNK_BYTES
      ) {
        const bytes = new Uint8Array(
          await file
            .slice(offset, offset + BACKGROUND_CHUNK_BYTES)
            .arrayBuffer(),
        );
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        await remote.upload(id, offset, btoa(binary));
        progress(
          Math.round(
            (Math.min(offset + bytes.length, file.size) / file.size) * 100,
          ),
        );
      }
      return remote.finishUpload(id);
    },
    async loadAsset(id: string, signal: AbortSignal) {
      const remote = requireApi();
      const chunks: ArrayBuffer[] = [];
      let offset = 0,
        mime = "";
      while (true) {
        signal.throwIfAborted();
        const chunk = await remote.asset(id, offset);
        signal.throwIfAborted();
        if (chunk.bytes > MAX_BACKGROUND_BYTES)
          throw new Error("Background too large");
        const binary = atob(chunk.data);
        if (!binary.length) throw new Error("Incomplete background");
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        chunks.push(bytes.buffer);
        offset += bytes.length;
        mime = chunk.mime;
        if (offset === chunk.bytes) break;
        if (offset > chunk.bytes) throw new Error("Invalid background length");
      }
      return new Blob(chunks, { type: mime });
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      listeners.clear();
    },
  };
}
export type BackgroundController = ReturnType<
  typeof createBackgroundController
>;
