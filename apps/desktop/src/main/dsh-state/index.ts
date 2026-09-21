/**
 * Main-process DSH state subscription layer ("DSH 状态订阅层").
 *
 * Owns the single-subscriber pattern for the cross-window state the windows
 * render, and broadcasts ONE snapshot under ONE IPC contract
 * (`dsh-state:*` / preload `window.amiba.dshState`):
 *
 *   - pet library      ← `amibaPets/list` polled every 2s (pets-source)
 *   - notification feed ← `amibaNotifications/watch` long-poll (notification-source)
 *   - session activity ← session journal + global events mux (activity-source)
 *   - session index    ← `session events + reconnect / 30s reconciliation,
 *                        used for the cross-window sessions.revision bump that
 *                        makes every window refresh its history immediately
 *
 * The layer lives in the main process next to the DSH runtime client it
 * subscribes through (`dshRuntime`), so closing any window — including the
 * main window — never interrupts the sources. Windows are pure views: they
 * subscribe to the snapshot pushes and route mutations back through the same
 * contract.
 */

import { BrowserWindow, ipcMain } from "electron";
import { mainStore } from "../storage";
import { ActivitySource } from "./activity";
import {
  NotificationSource,
  PetsSource,
} from "./sources";
import { dshRuntimeClient, sessionIndex } from "../session-index";
import type { DshStateSnapshot } from "../../shared/dsh-state";

/**
 * Mirrors `SESSION_KEYS.revision` in `packages/app-runtime/src/core/sessions.ts`
 * (the renderer's SessionsStore watches that key and refreshes its index).
 * The main process cannot import `@amiba/app-runtime/core` (it would pull the
 * React wallpaper module into the Electron main bundle), so the literal is
 * shared here and cross-referenced from both sides.
 */
export const SESSIONS_REVISION_KEY = "sessions.revision";

export class DshStateLayer {
  /** Content key of the last broadcast snapshot (dedupe gate). */
  private lastContentKey = "";
  private lastSessionSignature = "";
  private readonly pets = new PetsSource(dshRuntimeClient);
  private readonly notifications = new NotificationSource(dshRuntimeClient);
  private readonly sessions = sessionIndex;
  private readonly activity: ActivitySource;

  private snapshot: DshStateSnapshot | null = null;
  private started = false;
  private registered = false;
  private readonly offPets: () => void;
  private readonly offNotifications: () => void;
  private readonly offActivity: () => void;
  private readonly offSessions: () => void;

  constructor() {
    this.activity = new ActivitySource(dshRuntimeClient, this.sessions);
    this.offPets = this.pets.onChange(() => this.rebroadcast());
    this.offNotifications = this.notifications.onChange(() => this.rebroadcast());
    this.offActivity = this.activity.onChange(() => this.rebroadcast());
    // Session-index changes trigger the cross-window `sessions.revision`
    // bump so every window's SessionsStore refreshes without waiting for its
    // next surface refresh tick (Quick-Ask minting a session used to leave
    // the main window's history stale until the next manual refresh). The
    // bump is signature-gated: the index emits only changed rows, but the
    // storage marker only fires when the visible session set / running flags
    // actually changed.
    this.offSessions = this.sessions.onChange((rows) => {
      const signature = rows
        .filter((row) => !row.blank)
        .map((row) => `${row.sessionId}:${row.running ? 1 : 0}`)
        .sort()
        .join("|");
      if (signature === this.lastSessionSignature) return;
      this.lastSessionSignature = signature;
      void mainStore.set({ [SESSIONS_REVISION_KEY]: Date.now() }).catch(() => {});
    });
  }

  /** Start the sources (idempotent). Call once at app ready. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.pets.start();
    this.notifications.start();
    this.registerIpc();
  }

  /** Latest merged snapshot, or null before the sources produced one. */
  getSnapshot(): DshStateSnapshot | null {
    return this.snapshot;
  }

  private buildSnapshot(): DshStateSnapshot | null {
    const library = this.pets.getSnapshot();
    const notifications = this.notifications.getSnapshot();
    const activity = this.activity.getSnapshot();
    if (!library) return null;
    return {
      pets: library.pets,
      activeId: library.activeId,
      notifications: notifications.rows,
      connection: notifications.connection,
      activity,
      revision: this.snapshot?.revision ?? 0,
    };
  }

  private rebroadcast(): void {
    const built = this.buildSnapshot();
    if (!built) return;
    // Revision is bumped only when the content actually changed; source
    // emitters may fire for unchanged state (activity keep-alives).
    const contentKey = JSON.stringify({
      pets: built.pets,
      activeId: built.activeId,
      notifications: built.notifications,
      connection: built.connection,
      activity: {
        phase: built.activity.phase,
        title: built.activity.title,
        sessionId: built.activity.sessionId,
        restored: built.activity.restored,
      },
    });
    if (this.snapshot && this.lastContentKey === contentKey) return;
    this.lastContentKey = contentKey;
    const snapshot: DshStateSnapshot = {
      ...built,
      revision: (this.snapshot?.revision ?? 0) + 1,
    };
    this.snapshot = snapshot;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      try {
        win.webContents.send("dsh-state:snapshot", snapshot);
      } catch {
        // A frame can be disposed between the check and the send (window
        // teardown, a dev reload). That window misses this snapshot and pulls
        // the current one when it (re)subscribes.
      }
    }
  }

  // -------------------------------------------------------------------------
  // IPC — the single contract every window subscribes through
  // -------------------------------------------------------------------------

  private registerIpc(): void {
    if (this.registered) return;
    this.registered = true;
    ipcMain.handle("dsh-state:get", () => this.getSnapshot());
    ipcMain.handle("dsh-state:activate-pet", (_event, id: unknown) => {
      if (id !== null && (typeof id !== "string" || id.length > 200)) {
        throw new Error("Invalid pet id");
      }
      return this.pets.activate(id as string | null);
    });
    ipcMain.handle("dsh-state:dismiss", (_event, id: unknown) => {
      if (typeof id !== "string" || id.length > 200) {
        throw new Error("Invalid notification id");
      }
      return this.notifications.dismiss(id);
    });
    ipcMain.handle(
      "dsh-state:mark-read",
      (_event, reads: unknown) => {
        if (!Array.isArray(reads)) throw new Error("Invalid read markers");
        const markers = reads
          .filter(
            (item): item is { sessionId: string; readAt: number } =>
              !!item &&
              typeof item === "object" &&
              typeof (item as { sessionId?: unknown }).sessionId === "string" &&
              typeof (item as { readAt?: unknown }).readAt === "number",
          )
          .slice(0, 1000);
        return this.notifications.markSessionsRead(markers);
      },
    );
    ipcMain.handle("dsh-state:resync", () => this.notifications.resync());
  }

  /** Teardown for app shutdown. */
  dispose(): void {
    this.offPets();
    this.offNotifications();
    this.offActivity();
    this.offSessions();
    this.pets.dispose();
    this.notifications.dispose();
    this.activity.dispose();
    this.started = false;
  }
}

export const dshState = new DshStateLayer();