export interface PluginStartupState {
  phase: "preparing" | "prompt" | "loading" | "safe" | "ready";
  count: number;
  deadline?: number;
  reason?: "interrupted" | "inspection-failed" | "failed";
}
