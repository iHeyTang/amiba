import type { DialogOverlayVariant } from "../primitives";
import type { AgentModelSelection } from "@amiba/app-runtime/platform";
import { DshComposerModelPicker } from "./DshComposerModelPicker";

export interface ComposerModelPickerProps {
  dialogSize?: "default" | "tall";
  disabled?: boolean;
  overlayVariant?: DialogOverlayVariant;
  /** DSH owns preset scoping; retained for stable caller props. */
  profileId?: string;
  sessionId?: string;
  refreshKey?: number;
  draftSelection?: AgentModelSelection;
  onDraftSelectionChange?: (selection: AgentModelSelection) => void;
}

/** Native DSH model selector backed by the exact runtime catalog. */
export function ComposerModelPicker(props: ComposerModelPickerProps) {
  return <DshComposerModelPicker {...props} />;
}
