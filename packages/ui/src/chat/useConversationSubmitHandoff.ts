import { useEffect, useRef } from "react";

/** Wait for the destination render before resuming a send: its closures must
 * contain the new session's messages, not the source session's history. */
export function useConversationSubmitHandoff<T>({ activeId, prepare, refresh, open, run }: {
  activeId: string;
  prepare(id: string): Promise<string>;
  refresh(): Promise<unknown>;
  open(id: string): Promise<void>;
  run(args: T): Promise<void>;
}) {
  const mounted = useRef(true);
  const active = useRef(activeId);
  active.current = activeId;
  const runLatest = useRef(run);
  runLatest.current = run;
  const pending = useRef<{ source: string; target: string; args: T; resolve(): void; reject(error: unknown): void } | null>(null);
  useEffect(() => {
    const turn = pending.current;
    if (!turn) return;
    if (turn.target === activeId) {
      pending.current = null;
      void runLatest.current(turn.args).then(turn.resolve, turn.reject);
    } else if (turn.source !== activeId) {
      pending.current = null;
      turn.reject(new Error("The active conversation changed before sending. Please retry."));
    }
  }, [activeId]);
  useEffect(() => {
    mounted.current = true;
    return () => {
    mounted.current = false;
    pending.current?.reject(new Error("The conversation was closed before sending."));
    pending.current = null;
    };
  }, []);
  return async (args: T): Promise<boolean> => {
    const source = active.current;
    if (!source) return false;
    const target = await prepare(source);
    if (!mounted.current) throw new Error("The conversation was closed before sending.");
    if (active.current !== source) throw new Error("The active conversation changed before sending. Please retry.");
    if (target === source) return false;
    await refresh();
    if (!mounted.current) throw new Error("The conversation was closed before sending.");
    if (active.current !== source) throw new Error("The active conversation changed before sending. Please retry.");
    if (pending.current) throw new Error("A conversation switch is already in progress.");
    await new Promise<void>((resolve, reject) => {
      const turn = { source, target, args, resolve, reject };
      pending.current = turn;
      void open(target).catch((error) => {
        if (pending.current === turn) pending.current = null;
        reject(error);
      });
    });
    return true;
  };
}
