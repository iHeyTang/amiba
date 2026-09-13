import { useEffect, useState } from "react";
import type { ImageAttachmentRef } from "@amiba/extension-sdk";
import type { SessionFace } from "@deepseek-ai/dsh-client-runtime/client";

export type MessageImageLoader = ((attachment: ImageAttachmentRef) => Promise<string>) & {
  peek(attachment: ImageAttachmentRef): string | undefined;
};
type ImageSession = Pick<SessionFace, "readAttachment">;
interface ImageUrls {
  create(data: Uint8Array, mediaType: string): string;
  revoke(url: string): void;
}
const browserUrls: ImageUrls = {
  create(data, mediaType) {
    return URL.createObjectURL(new Blob([Uint8Array.from(data).buffer], { type: mediaType }));
  },
  revoke: url => URL.revokeObjectURL(url),
};

/** A cache belongs to one authorized session face, never just an attachment ID. */
export function createSessionImageLoader(session: ImageSession, urls: ImageUrls = browserUrls) {
  const entries = new Map<string, { pending: Promise<string>; url?: string }>();
  let disposed = false;
  const loadImage: MessageImageLoader = Object.assign((attachment: ImageAttachmentRef) => {
    if (disposed) return Promise.reject(new Error("Image session was released"));
    const id = attachment.attachmentId;
    const cached = entries.get(id);
    if (cached) return cached.pending;
    // Defer the call so synchronous errors have the same retry semantics as RPC errors.
    const entry: { pending: Promise<string>; url?: string } = { pending: undefined! };
    entry.pending = Promise.resolve().then(() => {
      if (disposed) throw new Error("Image session was released");
      return session.readAttachment(id);
    }).then(result => {
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
      if (disposed) throw new Error("Image session was released before loading completed");
      if (result.value.attachment.attachmentId !== id) throw new Error("Image response identity mismatch");
      const url = urls.create(result.value.data, result.value.attachment.mediaType);
      entry.url = url;
      return url;
    }).catch(error => {
      if (entries.get(id) === entry) entries.delete(id);
      throw error;
    });
    entries.set(id, entry);
    return entry.pending;
  }, { peek: (attachment: ImageAttachmentRef) => entries.get(attachment.attachmentId)?.url });
  return {
    loadImage,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const entry of entries.values()) if (entry.url) urls.revoke(entry.url);
      entries.clear();
    },
  };
}

/** Effect-owned instances survive StrictMode replay without reusing disposed caches. */
export function useSessionImageLoader(session: ImageSession | undefined) {
  const [state, setState] = useState<{ session: ImageSession; loader: ReturnType<typeof createSessionImageLoader> }>();
  useEffect(() => {
    if (!session) { setState(undefined); return; }
    const loader = createSessionImageLoader(session);
    setState({ session, loader });
    return () => loader.dispose();
  }, [session]);
  // Never hand a new conversation the previous session's authorization or cached URL.
  return state?.session === session ? state?.loader.loadImage : undefined;
}
