import { DshSettingsStatus } from "./DshSettingsStatus";

export interface SettingsStatusProps {
  onViewUpdateLogs?: () => void;
}

export function SettingsStatus(_props: SettingsStatusProps = {}) {
  return <DshSettingsStatus />;
}
