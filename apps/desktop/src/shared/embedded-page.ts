export interface EmbeddedPageBounds { x: number; y: number; width: number; height: number }
export type EmbeddedPageRequest =
  | { action: "mount"; id: string; url: string }
  | { action: "bounds"; id: string; bounds: EmbeddedPageBounds | null }
  | { action: "unmount"; id: string };

export function localPageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password) {
    throw new Error("Embedded management pages must use loopback HTTP.");
  }
  return url;
}
