/**
 * Synthetic stores for the standalone desktop pet page.
 *
 * The pet page never boots the DSH shell, so it cannot call the pets remote
 * service or subscribe to the notification feed directly. Instead the MAIN
 * window's pets plugin forwards live snapshots (`DesktopPetData`) over IPC;
 * these tiny stores present those snapshots with the same surface
 * (`PetLibraryClient`, `NotificationClient`) the shell-hosted `DesktopPet`
 * component expects, and route the few interactions the pet page needs
 * (activate pet, dismiss bubble) back through the bridge.
 */
import type {
  DesktopPetBridge,
  DesktopPetData,
} from "@amiba/app-runtime/platform";
import type { NotificationClient } from "@amiba/dsh-plugin-notification-hub/client";
import type { AmibaNotification, SessionRead } from "@amiba/dsh-plugin-notification-hub/model";
import type { PetLibrary, PetRecord } from "@amiba/dsh-plugin-pets/model";

type LibrarySnapshot = {
  loading: boolean;
  library: PetLibrary;
  error: string | null;
};

export function createPetPageLibrary(api: DesktopPetBridge) {
  let state: LibrarySnapshot = {
    loading: true,
    library: { version: 1, activeId: null, pets: [] },
    error: null,
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const accept = (data: DesktopPetData) => {
    const next: LibrarySnapshot = {
      loading: false,
      library: {
        version: 1,
        activeId: data.activeId,
        pets: data.pets as PetRecord[],
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
  const offData = api.onData(accept);
  // Ask the source for a snapshot immediately; the main window's plugin also
  // pushes on every change, so this only matters for the mount race.
  void api.requestData();
  return {
    getSnapshot: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    refresh: () => api.requestData(),
    activate: async (id: string | null) => {
      await api.activate(id);
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

export function createPetPageFeed(api: DesktopPetBridge) {
  let rows: AmibaNotification[] = [];
  let connection: "loading" | "connected" | "reconnecting" = "loading";
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const accept = (data: DesktopPetData) => {
    rows = data.notifications as AmibaNotification[];
    connection = data.connection;
    emit();
  };
  const offData = api.onData(accept);
  return {
    getSnapshot: () => rows,
    getConnectionSnapshot: () => connection,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dismiss: (id: string) => api.dismiss(id),
    // Read-mark sync is handled by the main window's plugin (it owns the real
    // feed); the pet page needs no-op stubs to match NotificationClient.
    markSessionsRead: (_reads: readonly SessionRead[]) => {},
    resync: () => {},
    dispose: () => {
      offData();
      listeners.clear();
    },
  };
}