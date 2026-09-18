/**
 * Synthetic stores for the standalone desktop pet page.
 *
 * The pet page never boots the DSH shell AND no longer depends on the main
 * window's pets plugin: pet library, notification feed and session activity
 * are produced by the MAIN-PROCESS DSH state subscription layer
 * (`window.amiba.dshState`) and broadcast as one snapshot. These tiny stores
 * present that snapshot with the same surface (`PetLibraryClient`,
 * `NotificationClient`) the shell-hosted `DesktopPet` component expects, and
 * route the few interactions the pet page needs (activate pet, dismiss
 * bubble, read markers) back through the same contract — they work whether or
 * not the main window exists.
 */
import type {
  DshStateBridge,
  DshStateSnapshot,
} from "../../shared/dsh-state";
import type { NotificationClient } from "@amiba/dsh-plugin-notification-hub/client";
import type { AmibaNotification, SessionRead } from "@amiba/dsh-plugin-notification-hub/model";
import type { PetLibrary, PetRecord } from "@amiba/dsh-plugin-pets/model";

type LibrarySnapshot = {
  loading: boolean;
  library: PetLibrary;
  error: string | null;
};

export function createPetPageLibrary(api: DshStateBridge) {
  let state: LibrarySnapshot = {
    loading: true,
    library: { version: 1, activeId: null, pets: [] },
    error: null,
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const accept = (snapshot: DshStateSnapshot) => {
    const next: LibrarySnapshot = {
      loading: false,
      library: {
        version: 1,
        activeId: snapshot.activeId,
        pets: snapshot.pets as PetRecord[],
      },
      error: null,
    };
    if (
      state.loading ||
      state.error ||
      JSON.stringify(next.library) !== JSON.stringify(state.library)
    ) {
      state = next;
      emit();
    }
  };
  const offData = api.subscribe(accept);
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    refresh: async () => {
      // Pull the layer's latest snapshot immediately (it is pushed on every
      // source change; this is the mount/lazy-surface re-pull path).
      const snapshot = await api.get();
      if (snapshot) accept(snapshot);
    },
    activate: async (id: string | null) => {
      // The layer applies `amibaPets/activate` and broadcasts the refreshed
      // library; the next snapshot lands through `accept`.
      await api.activatePet(id);
      return state.library;
    },
    // The pet page never edits the library; keep the surface complete so
    // `DesktopPet`'s prop type is satisfied without stubbing in the UI.
    save: async () => state.library,
    remove: async () => state.library,
    studio: async () => "",
    dispose: () => {
      offData();
      listeners.clear();
    },
  };
}

export function createPetPageFeed(api: DshStateBridge) {
  let rows: AmibaNotification[] = [];
  let connection: "loading" | "connected" | "reconnecting" = "loading";
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const accept = (snapshot: DshStateSnapshot) => {
    rows = snapshot.notifications as AmibaNotification[];
    connection = snapshot.connection;
    emit();
  };
  const offData = api.subscribe(accept);
  return {
    getSnapshot: () => rows,
    getConnectionSnapshot: () => connection,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dismiss: (id: string) => api.dismissNotification(id),
    // The layer owns the real feed (and the DSH hub is the read ledger), so
    // read markers now flow all the way to the hub instead of being no-ops.
    markSessionsRead: (reads: readonly SessionRead[]) =>
      api.markSessionsRead(reads.map(({ sessionId, readAt }) => ({ sessionId, readAt }))),
    resync: () => api.resyncNotifications(),
    dispose: () => {
      offData();
      listeners.clear();
    },
  };
}