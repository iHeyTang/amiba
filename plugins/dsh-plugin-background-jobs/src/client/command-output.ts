/** Interpret only the official trailing job status line; preserve the stored text. */
export function commandOutput(text: string, status: string) {
  const trimmed = text.replace(/^(?:[\t ]*\r?\n)+/, "").replace(/(?:\r?\n[\t ]*)+$/, "");
  const footer = /(?:^|\r?\n)\[status: (running|stopping|completed|failed|killed|interrupted)(?:, exit code: (-?\d+))?\]$/.exec(trimmed);
  if (!footer || footer[1] !== status) return {text: trimmed, exitCode: undefined};
  return {
    text: trimmed.slice(0, footer.index).replace(/(?:\r?\n[\t ]*)+$/, ""),
    exitCode: footer[2] === undefined ? undefined : Number(footer[2]),
  };
}
