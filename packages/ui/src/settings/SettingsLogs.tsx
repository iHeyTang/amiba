import { DshSettingsLogs } from "./DshSettingsLogs";

export type SettingsLogSource = "agent";

export interface SettingsLogsProps {
  source?: SettingsLogSource;
  onSourceChange?: (source: SettingsLogSource) => void;
}

export function SettingsLogs(_props: SettingsLogsProps = {}) {
  return <DshSettingsLogs />;
}
