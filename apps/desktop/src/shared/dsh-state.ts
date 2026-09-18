import type {
  DesktopPetActivity,
  DesktopPetData,
} from "@amiba/app-runtime/platform";

/**
 * Shared contract for the main-process DSH state subscription layer.
 *
 * The main process owns the DSH runtime connection (`dshRuntime`), so it is
 * the natural owner of the state the windows merely render: the pet library,
 * the notification-hub feed, and a window-independent session-activity
 * signal. Every window (pet page, main window, Quick-Ask) consumes the same
 * snapshot through `window.amiba.dshState` instead of booting its own DSH
 * client / plugin graph for these data — a window can close and reopen
 * without interrupting the sources, which live in the main process.
 *
 * The snapshot is a superset of the old `DesktopPetData` the main window's
 * pets plugin used to forward to the pet page; the forwarder is gone and the
 * main-process layer now produces it directly from DSH plugin remotes.
 */
export interface DshStateSnapshot {
  /** Pet library rows (structural subset of `@amiba/dsh-plugin-pets/model`). */
  pets: DesktopPetData["pets"];
  activeId: string | null;
  /** Notification feed rows (structural subset of the hub model). */
  notifications: DesktopPetData["notifications"];
  connection: DesktopPetData["connection"];
  /** Window-independent session activity (most recently active session). */
  activity: DesktopPetActivity;
  /** Monotonic snapshot revision; bumped on every broadcast change. */
  revision: number;
}

export interface DshStateReadMarker {
  sessionId: string;
  readAt: number;
}

/**
 * One subscription + mutation contract for every Amiba window. Main holds
 * the single snapshot and pushes full snapshots on change; `subscribe`
 * listeners receive the latest revision. Mutations are applied by the main
 * process through the same DSH client that produced the snapshot.
 */
export interface DshStateBridge {
  /** Latest snapshot, or `null` before the layer has produced one. */
  get(): Promise<DshStateSnapshot | null>;
  /** Subscribe to snapshot pushes (fires immediately on first subscribe). */
  subscribe(listener: (snapshot: DshStateSnapshot) => void): () => void;
  /** `amibaPets/activate` — switch the active desktop pet. */
  activatePet(id: string | null): Promise<void>;
  /** `amibaNotifications/dismiss` — dismiss a notification bubble. */
  dismissNotification(id: string): Promise<void>;
  /** `amibaNotifications/markSessionsRead` — mark sessions read. */
  markSessionsRead(reads: DshStateReadMarker[]): Promise<void>;
  /** `amibaNotifications/cancelWatch` + re-watch from the current cursor. */
  resyncNotifications(): Promise<void>;
}