import { parseTokens, type ParsedPart } from "./composer/serialize";

export interface ComposerDraftDocument {
  readonly text: string;
  readonly parts: readonly ParsedPart[];
}

export function composerDraftDocument(parts: readonly ParsedPart[]): ComposerDraftDocument {
  const normalized: ParsedPart[] = [];
  for (const part of parts) {
    if (part.kind === "text") {
      if (!part.text) continue;
      const previous = normalized.at(-1);
      if (previous?.kind === "text") previous.text += part.text;
      else normalized.push({ kind: "text", text: part.text });
    } else normalized.push({ kind: "mention", raw: part.raw,
      mention: Object.freeze({ type: part.mention.type, display: part.mention.display, payload: Object.freeze({ ...part.mention.payload }) }) });
  }
  return Object.freeze({
    text: normalized.map(part => part.kind === "text" ? part.text : part.raw).join(""),
    parts: Object.freeze(normalized.map(part => Object.freeze(part))),
  });
}

export const legacyDraftDocument = (text: string): ComposerDraftDocument => composerDraftDocument(parseTokens(text));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Old string drafts keep their old meaning; v2 never guesses node kinds from text. */
export function decodeComposerDraft(value: unknown): ComposerDraftDocument | undefined {
  if (value === undefined) return composerDraftDocument([]);
  if (!record(value) || typeof value.text !== "string") return undefined;
  if (value.version === 1) return legacyDraftDocument(value.text);
  if (value.version !== 2 || !Array.isArray(value.parts)) return undefined;
  const parts: ParsedPart[] = [];
  for (const part of value.parts) {
    if (!record(part)) return undefined;
    if (part.kind === "text" && typeof part.text === "string") parts.push({ kind: "text", text: part.text });
    else if (part.kind === "mention" && typeof part.raw === "string" && record(part.mention)
      && typeof part.mention.type === "string" && typeof part.mention.display === "string" && record(part.mention.payload)
      && Object.values(part.mention.payload).every(item => typeof item === "string")) {
      parts.push({ kind: "mention", raw: part.raw, mention: { type: part.mention.type, display: part.mention.display,
        payload: part.mention.payload as Record<string, string> } });
    } else return undefined;
  }
  const document = composerDraftDocument(parts);
  return document.text === value.text ? document : undefined;
}

/** Legacy string edits preserve untouched structured parts instead of reparsing them. */
export function updateLegacyDraftDocument(current: ComposerDraftDocument, text: string): ComposerDraftDocument {
  if (current.text === text) return current;
  let start = 0, end = current.text.length, nextEnd = text.length;
  while (start < end && start < nextEnd && current.text[start] === text[start]) start++;
  while (end > start && nextEnd > start && current.text[end - 1] === text[nextEnd - 1]) { end--; nextEnd--; }
  let from = start, to = end, offset = 0;
  for (const part of current.parts) {
    const length = part.kind === "text" ? part.text.length : part.raw.length;
    if (part.kind === "mention") {
      if (from > offset && from < offset + length) from = offset;
      if (to > offset && to < offset + length) to = offset + length;
    }
    offset += length;
  }
  const slice = (first: number, last: number): ParsedPart[] => {
    const parts: ParsedPart[] = [];
    let offset = 0;
    for (const part of current.parts) {
      const length = part.kind === "text" ? part.text.length : part.raw.length;
      if (offset < last && offset + length > first) {
        parts.push(part.kind === "text" ? { kind: "text", text: part.text.slice(Math.max(0, first - offset), last - offset) } : part);
      }
      offset += length;
    }
    return parts;
  };
  const replacement = current.text.slice(from, start) + text.slice(start, nextEnd) + current.text.slice(end, to);
  return composerDraftDocument([...slice(0, from), ...parseTokens(replacement), ...slice(to, current.text.length)]);
}
