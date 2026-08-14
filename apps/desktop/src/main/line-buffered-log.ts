export interface LineBufferedLog {
  write(chunk: string): void;
  flush(): void;
}

/**
 * Forward a byte-stream-shaped string as complete log lines.
 *
 * Child-process data events do not preserve line boundaries: one event can
 * contain several lines, or half of one line. Keeping the unfinished tail
 * here lets callers add the same prefix to every logical line without
 * trimming meaningful spacing from terminal-style output.
 */
export function createLineBufferedLog(
  prefix: string,
  emit: (line: string) => void,
): LineBufferedLog {
  let pending = "";

  const emitLine = (line: string) => {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    emit(normalized ? `${prefix} ${normalized}` : prefix);
  };

  return {
    write(chunk) {
      pending += chunk;

      let newlineIndex = pending.indexOf("\n");
      while (newlineIndex !== -1) {
        emitLine(pending.slice(0, newlineIndex));
        pending = pending.slice(newlineIndex + 1);
        newlineIndex = pending.indexOf("\n");
      }
    },

    flush() {
      if (pending) emitLine(pending);
      pending = "";
    },
  };
}
