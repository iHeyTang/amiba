import type { LexicalEditor } from "lexical";
import type { ComposerTriggerController } from "./contracts";
import { $scanDraft, type DraftScan } from "./lexical-draft";
import type { CommandClaimStore } from "./claim";

type Lexicon = ReadonlyMap<"/" | "@", readonly string[]>;

/** rc.2 public decoration semantics. These are text ranges, never occurrences
 * or codec input. Newer slash-boundary semantics must use a versioned adapter. */
export function textReferenceRanges(draft: string, lexicon: Lexicon) {
  const ranges: { start: number; end: number }[] = [];
  for (const match of draft.matchAll(/(^|\s)([/@])([\w-]+)/g)) {
    if (!lexicon.get(match[2] as "/" | "@")?.includes(match[3])) continue;
    const start = match.index! + match[1].length;
    ranges.push({ start, end: start + match[2].length + match[3].length });
  }
  for (const match of draft.matchAll(/(^|\s)(@(?:"[^"\n]*\/|[^\s"]+\/))/g)) {
    const start = match.index! + match[1].length;
    const end = start + match[2].length;
    if (!ranges.some(range => range.start < end && start < range.end)) ranges.push({ start, end });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/**
 * The leading slash-command token of an active claim, or none. The claim is a
 * draft prefix (`'/goal '`), so the highlight stops at the trimmed token —
 * the trailing separator and the free-form args stay plain.
 */
export function commandTokenRanges(token: string | undefined): { start: number; end: number }[] {
  if (token === undefined) return [];
  const end = token.trimEnd().length;
  if (end === 0) return [];
  return [{ start: 0, end }];
}

// Structural declarations also allow older DOM type libraries. Feature-detect
// the editor's own window: detached windows have independent registries.
interface HighlightWindow {
  CSS?: { highlights?: { set(name: string, highlight: unknown): void; delete(name: string): void } };
  Highlight?: new (...ranges: Range[]) => unknown;
}
let nextHighlight = 0;

/**
 * Paint text ranges with the CSS Custom Highlight API. Paint only — never
 * mutate Lexical nodes, selection, persisted draft or history. `computeRanges`
 * runs inside a Lexical read, so it may use the `$`-helpers freely.
 */
function subscribeHighlight(
  editor: LexicalEditor,
  namePrefix: string,
  computeRanges: (scan: DraftScan) => { start: number; end: number }[],
  style: string,
): { repaint: () => void; dispose: () => void } {
  const name = `${namePrefix}-${++nextHighlight}`;
  let clearRoot = () => {};
  let repaint = () => {};
  const offRoot = editor.registerRootListener(root => {
    clearRoot();
    clearRoot = () => {};
    repaint = () => {};
    if (!root) return;
    const document = root.ownerDocument;
    const view = document.defaultView as HighlightWindow | null;
    const registry = view?.CSS?.highlights;
    const Highlight = view?.Highlight;
    if (!registry || !Highlight) return;
    const styleEl = document.createElement("style");
    styleEl.textContent = `::highlight(${name}) { ${style} }`;
    document.head.append(styleEl);
    repaint = () => editor.getEditorState().read(() => {
      const scan = $scanDraft();
      const ranges: Range[] = [];
      for (const reference of computeRanges(scan)) {
        for (const leaf of scan.leaves) {
          if (!leaf.text || leaf.end <= reference.start || leaf.start >= reference.end) continue;
          const element = editor.getElementByKey(leaf.node.getKey());
          if (!element || !root.contains(element)) continue;
          const walker = document.createTreeWalker(element, 4 /* SHOW_TEXT */);
          let offset = leaf.start;
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const end = offset + (node.textContent?.length ?? 0);
            const from = Math.max(reference.start, offset);
            const to = Math.min(reference.end, end);
            if (from < to) {
              const range = document.createRange();
              range.setStart(node, from - offset);
              range.setEnd(node, to - offset);
              ranges.push(range);
            }
            offset = end;
          }
        }
      }
      registry.set(name, new Highlight(...ranges));
    });
    clearRoot = () => { registry.delete(name); styleEl.remove(); };
    repaint();
  });
  const offEditor = editor.registerUpdateListener(() => repaint());
  repaint();
  return {
    repaint: () => repaint(),
    dispose: () => { offEditor(); offRoot(); clearRoot(); },
  };
}

/** Paint-only highlight of the official hot reference lexicon. */
export function subscribeTextReferenceHighlights(
  editor: LexicalEditor,
  lexicon: NonNullable<ComposerTriggerController["lexicon"]>,
): () => void {
  const highlighter = subscribeHighlight(
    editor,
    "amiba-text-reference",
    (scan) => textReferenceRanges(scan.draft, lexicon.getSnapshot()),
    "background-color: hsl(var(--muted) / .5); color: hsl(var(--foreground));",
  );
  const offLexicon = lexicon.subscribe(highlighter.repaint);
  return () => { offLexicon(); highlighter.dispose(); };
}

/** Paint-only highlight of the active slash-command claim token. */
export function subscribeCommandTokenHighlight(
  editor: LexicalEditor,
  claims: CommandClaimStore,
): () => void {
  const highlighter = subscribeHighlight(
    editor,
    "amiba-command-token",
    () => commandTokenRanges(claims.get()?.token),
    "background-color: hsl(var(--primary) / .12); color: hsl(var(--foreground));",
  );
  const offClaims = claims.subscribe(highlighter.repaint);
  return () => { offClaims(); highlighter.dispose(); };
}
