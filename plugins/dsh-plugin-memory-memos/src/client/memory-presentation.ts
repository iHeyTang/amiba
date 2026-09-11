import type { MemoryEntry } from "../dashboard.js";

/** Prefer the authored heading over a machine-style skill identifier, without rewriting stored content. */
export function memoryTitle(entry: MemoryEntry): string {
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(entry.title)) return entry.title;
  const heading = entry.sections
    .map((section) => section.text.match(/^#{1,3}\s+(.+)$/m)?.[1])
    .find(Boolean);
  return heading ?? entry.title.replaceAll("_", " ");
}
export function memoryExcerpt(text: string | undefined): string | undefined {
  return text
    ?.replace(/^#{1,6}\s+.+\n?/, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
