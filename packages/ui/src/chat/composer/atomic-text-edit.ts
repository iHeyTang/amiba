/** Minimal UTF-16 edit expanded to whole reference/structural boundaries. */
export function atomicTextEdit(current: string, next: string,
  atoms: readonly { start: number; end: number }[]): { from: number; to: number; text: string } | undefined {
  if (current === next) return undefined;
  let start = 0, end = current.length, nextEnd = next.length;
  while (start < end && start < nextEnd && current[start] === next[start]) start++;
  while (end > start && nextEnd > start && current[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  let from = start, to = end;
  for (const atom of atoms) {
    if (from > atom.start && from < atom.end) from = atom.start;
    if (to > atom.start && to < atom.end) to = atom.end;
  }
  return { from, to, text: current.slice(from, start) + next.slice(start, nextEnd) + current.slice(end, to) };
}
