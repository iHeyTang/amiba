/** Browser-safe status contract; no MemOS runtime imports in the client. */
export interface MemosStatus {
  engine: "memos";
  version: string;
  state: "starting" | "ready" | "error" | "stopped";
  mode: "full" | "lightweight";
  home: string;
  viewerUrl: string | null;
  error: string | null;
}

export function initialMemosStatus(home: string): MemosStatus {
  return {
    engine: "memos",
    version: "2.0.18",
    state: "starting",
    mode: "full",
    home,
    viewerUrl: null,
    error: null,
  };
}
