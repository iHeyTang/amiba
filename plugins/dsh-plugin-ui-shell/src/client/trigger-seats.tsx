/**
 * Amiba's two occupants of the official `conversation.input.overlay` seat,
 * registered as CELL SHADOWS of the official ones.
 *
 * The mechanism is the sanctioned one, not a workaround: `SlotEntry.priority`
 * is documented as "Cell shadowing rank (ascending, default 0, lowest
 * renders; same id + same priority throws)", and `SlotCore.entriesOfSlot`
 * keeps the FIRST entry per cell in ascending-priority order. Registering
 * `slash-menu` and `command-popup` at `priority: -1` therefore makes exactly
 * one entry render per cell, and it is Amiba's — while
 * `@deepseek-ai/dsh-client-ui-input-trigger` and
 * `@deepseek-ai/dsh-client-ui-commands` stay ENABLED so their SERVICES
 * (`inputTriggers`, `commandUi`) are live. Amiba wanted the pipeline, not the
 * pixels.
 *
 * Why not the pixels: both official components are styled from CSS modules
 * written against `--dsw-*`, which only `dsh-client-ui-theme` defines (the
 * one row Amiba must exclude — its host half writes a boot palette that
 * fights Amiba's). The popup is worse: its risk gate is `RiskConfirmation`
 * from `dsh-client-ui-primitives`, whose 23 CSS modules ship STUBBED to `{}`,
 * so no token bridge could have styled it at all.
 */

import { CommandPopup, OfficialTriggerMenu } from "@amiba/ui";
import type { CommandPopupController, ComposerTriggerController } from "@amiba/ui";
import type { ReactNode } from "react";

/** Slot id of the official trigger menu — the cell Amiba shadows. */
export const SLASH_MENU_ENTRY_ID = "slash-menu";
/** Slot id of the official popupSelect shell — the cell Amiba shadows. */
export const COMMAND_POPUP_ENTRY_ID = "command-popup";
/**
 * Shadowing rank. Strictly below the official entries' implicit `0`, so the
 * ledger elects Amiba's entry for each cell.
 */
export const SHADOW_PRIORITY = -1;

/** Injected face of Amiba's `slash-menu` shadow. */
export interface AmibaSlashMenuInjected {
  controller: ComposerTriggerController | undefined;
  labels: Record<string, string>;
  /**
   * Copy for a group still fetching. Deliberately UNSET by Amiba's seat: the
   * shared `TriggerMenu` already renders a centred loading state while every
   * group is pending, which is the empty-state behaviour the session-less
   * mount has always had. Keeping the two mounts identical beats adding a
   * per-group spinner to one of them.
   */
  loadingLabel?: string;
}

export function AmibaSlashMenuSeat({
  controller,
  labels,
  loadingLabel,
}: AmibaSlashMenuInjected): ReactNode {
  if (controller === undefined) return null;
  return (
    <OfficialTriggerMenu
      controller={controller}
      labels={labels}
      loadingLabel={loadingLabel}
    />
  );
}

/** Injected face of Amiba's `command-popup` shadow. */
export interface AmibaCommandPopupInjected {
  popup: CommandPopupController | undefined;
  retry: (() => void) | undefined;
}

export function AmibaCommandPopupSeat({
  popup,
  retry,
}: AmibaCommandPopupInjected): ReactNode {
  if (popup === undefined) return null;
  return <CommandPopup onRetry={retry} popup={popup} />;
}
