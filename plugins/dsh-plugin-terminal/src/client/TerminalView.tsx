import { useCallback, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XtermTerminal } from "@xterm/xterm";
import type {
  WorkspaceDevelopmentAdapter,
  WorkspaceTerminalSnapshot,
} from "@amiba/app-runtime/platform";
import { useT, useDocumentTheme } from "@amiba/dsh-plugin-ui-shell/client";
import { workspaceTerminalTheme } from "./workspace-terminal-theme.js";
type PendingTerminalChunk = {
  sequence: number;
  chunk: string;
};

export function WorkspaceTerminalView({
  sessionId,
  terminalId,
  development,
  onSnapshot,
}: {
  sessionId: string;
  terminalId: string;
  development: WorkspaceDevelopmentAdapter;
  onSnapshot: (snapshot: WorkspaceTerminalSnapshot) => void;
}) {
  const { t } = useT();
  const documentTheme = useDocumentTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XtermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initialThemeRef = useRef(documentTheme);
  const hydratedRef = useRef(false);
  const outputSequenceRef = useRef(0);
  const pendingChunksRef = useRef<PendingTerminalChunk[]>([]);
  const [error, setError] = useState<string | null>(null);

  const hydrateTerminal = useCallback(
    (next: WorkspaceTerminalSnapshot) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      terminal.reset();
      terminal.write(next.output);
      outputSequenceRef.current = next.sequence;
      hydratedRef.current = true;
      for (const event of pendingChunksRef.current) {
        if (event.sequence <= outputSequenceRef.current) continue;
        terminal.write(event.chunk);
        outputSequenceRef.current = event.sequence;
      }
      pendingChunksRef.current = [];
      onSnapshot(next);
    },
    [onSnapshot],
  );

  useEffect(() => {
    if (!development || !hostRef.current) return;
    let disposed = false;
    let resizeFrame: number | null = null;
    hydratedRef.current = false;
    outputSequenceRef.current = 0;
    pendingChunksRef.current = [];

    const terminal = new XtermTerminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.35,
      macOptionIsMeta: true,
      minimumContrastRatio: 4.5,
      scrollOnUserInput: true,
      scrollback: 10_000,
      theme: workspaceTerminalTheme(initialThemeRef.current),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown" &&
        event.metaKey &&
        event.key.toLocaleLowerCase() === "c" &&
        terminal.hasSelection()
      ) {
        void navigator.clipboard.writeText(terminal.getSelection());
        return false;
      }
      return true;
    });

    const inputSubscription = terminal.onData((data) => {
      development.terminalWrite(sessionId, terminalId, data);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      development.terminalResize(sessionId, terminalId, cols, rows);
    });
    const unsubscribe = development.onTerminalData((event) => {
      if (
        event.sessionId !== sessionId ||
        event.terminalId !== terminalId ||
        disposed
      )
        return;
      if (!hydratedRef.current) {
        pendingChunksRef.current.push({
          sequence: event.sequence,
          chunk: event.chunk,
        });
        return;
      }
      if (event.sequence <= outputSequenceRef.current) return;
      terminal.write(event.chunk);
      outputSequenceRef.current = event.sequence;
    });

    const fit = () => {
      if (disposed || !hostRef.current) return;
      try {
        fitAddon.fit();
        development.terminalResize(
          sessionId,
          terminalId,
          terminal.cols,
          terminal.rows,
        );
      } catch {
        /* The pane can collapse between ResizeObserver and animation frame. */
      }
    };
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    });
    resizeObserver.observe(hostRef.current);
    fit();

    void development
      .terminalGet(sessionId, terminalId)
      .then(
        (current) =>
          current ?? development.terminalStart(sessionId, terminalId),
      )
      .then((next) => {
        if (disposed) return;
        hydrateTerminal(next);
        fit();
        terminal.focus();
        setError(null);
      })
      .catch((cause) => {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => {
      disposed = true;
      if (resizeFrame != null) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      unsubscribe();
      inputSubscription.dispose();
      resizeSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [development, hydrateTerminal, sessionId, terminalId]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.options.theme = workspaceTerminalTheme(documentTheme);
    fitAddonRef.current?.fit();
  }, [documentTheme]);

  return (
    <div
      data-workspace-terminal-id={terminalId}
      className="relative h-full min-h-0 bg-background p-2"
    >
      <div
        ref={hostRef}
        data-selection="text"
        className="amiba-terminal h-full min-h-0 overflow-hidden"
        aria-label={t("workspacePane.terminal")}
      />
      {error ? (
        <p className="pointer-events-none absolute inset-x-3 bottom-3 rounded-md border border-destructive/20 bg-background/95 px-2 py-1.5 text-[10px] text-destructive shadow-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
