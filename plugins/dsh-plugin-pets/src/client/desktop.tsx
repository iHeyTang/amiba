import type { NotificationClient } from "@amiba/dsh-plugin-notification-hub/client";
import { petMessages } from "./desktop-message.js";
import { useEffect, useState, useSyncExternalStore, useMemo } from "react";
import { getPlatform } from "@amiba/app-runtime/platform";
import type {
  DesktopPetActivity,
  DesktopPetLayout,
} from "@amiba/app-runtime/platform";
import { DesktopMessage } from "./DesktopMessage.js";
import { usePluginT } from "@amiba/ui/plugin";
import { petsI18n } from "./i18n.js";
import { PetView } from "./PetView.js";
import type { PetLibraryClient } from "./library.js";
export function useDesktopPet() {
  const api = getPlatform().desktopPet;
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!api) return;
    let alive = true,
      received = false;
    const off = api.onState((state) => {
      received = true;
      setEnabled(state.enabled);
    });
    void api
      .getState()
      .then((state) => {
        if (alive && !received) setEnabled(state.enabled);
      })
      .catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, [api]);
  return { api, enabled };
}
export function DesktopPet({
  library,
  notifications: feed,
}: {
  library: PetLibraryClient;
  notifications: NotificationClient;
}) {
  const { t } = usePluginT(petsI18n);
  const { library: state, loading } = useSyncExternalStore(
    library.subscribe,
    library.getSnapshot,
  );
  const { api, enabled } = useDesktopPet();
  const [layout, setLayout] = useState<DesktopPetLayout | null>(null);
  useEffect(() => api?.onLayout(setLayout), [api]);
  useEffect(() => {
    if (!api || !layout?.editing) return;
    const move = (event: PointerEvent) => {
      if ((event.target as Element)?.closest("[data-pet-resize-control]"))
        void api.setIgnoreMouse(false);
    };
    document.addEventListener("pointermove", move);
    return () => document.removeEventListener("pointermove", move);
  }, [api, layout?.editing]);
  const activity = useMemo(() => {
    let state: DesktopPetActivity & { receivedAt?: number } = {
      phase: "idle",
      restored: true,
      sessionId: "",
      revision: 0,
    };
    const listeners = new Set<() => void>();
    return {
      getSnapshot: () => state,
      subscribe: (f: () => void) => {
        listeners.add(f);
        return () => {
          listeners.delete(f);
        };
      },
      update: (next: DesktopPetActivity) => {
        state = { ...next, receivedAt: Date.now() };
        listeners.forEach((f) => f());
      },
    };
  }, []);
  const notifications = useSyncExternalStore(feed.subscribe, feed.getSnapshot);
  const connection = useSyncExternalStore(feed.subscribe, feed.getConnectionSnapshot);
  const displayNotifications = connection === "connected" ? notifications : [
    ...notifications.filter(n => !n.activity),
    { id: "pet-connection", activity: true, source: "runtime", kind: "info" as const,
      status: "thinking" as const, title: t(connection === "loading" ? "pets.connection.loading" : "pets.connection.reconnecting"),
      body: t("pets.connection.wait"), timestamp: 0 },
  ];
  const latestNotice = petMessages(displayNotifications)[0];
  useEffect(() => {
    activity.update({
      phase: latestNotice?.status ?? "idle",
      title: latestNotice?.title,
      sessionId: latestNotice?.sessionId ?? "",
      revision: latestNotice?.timestamp ?? 0,
      restored: !latestNotice,
    });
  }, [latestNotice?.id, latestNotice?.status, latestNotice?.title, activity]);
  const pet = state.pets.find((p) => p.id === state.activeId);

  useEffect(
    () =>
      api?.onSelect((id) => {
        void library.activate(id);
      }),
    [api, library],
  );
  useEffect(() => {
    if (!api || loading) return;
    if (pet) void api.ready();
    else if (enabled) void api.setEnabled(false);
  }, [api, loading, !!pet, enabled]);
  const desktop = useMemo(
    () =>
      api
        ? {
            api,
            menu: () => {
              void api.menu(
                state.pets.map((p) => ({ id: p.id, name: p.name })),
                state.activeId,
              );
            },
          }
        : undefined,
    [api, state],
  );
  return pet ? (
    <div
      className="fixed inset-0 select-none"
      onPointerMove={(event) => {
        if (event.target === event.currentTarget)
          void api?.setIgnoreMouse(true);
      }}
    >
      <div
        data-desktop-pet-position
        style={{
          position: "absolute",
          left: layout?.x ?? 0,
          top: layout?.y ?? 0,
          width: layout?.size ?? 200,
          height: layout?.size ?? 200,
          visibility: layout ? "visible" : "hidden",
        }}
      >
        <PetView
          config={pet.config}
          name={pet.name}
          activity={activity}
          previewScene={connection === "connected" ? undefined : "loading"}
          desktop={desktop}
          className="h-full w-full select-none"
        />
      </div>
      {layout && api && (
        <DesktopMessage
          active={enabled}
          notifications={displayNotifications}
          dismiss={feed.dismiss}
          layout={layout}
          api={api}
        />
      )}
      {layout?.editing && (
        <div
          data-pet-resize-frame
          style={{
            position: "absolute",
            left: layout.x + layout.visual.x * layout.size,
            top: layout.y + layout.visual.y * layout.size,
            width: layout.visual.width * layout.size,
            height: layout.visual.height * layout.size,
            border: "1px solid hsl(var(--primary, 250 84% 60%))",
            borderRadius: 8,
            pointerEvents: "none",
          }}
        >
          {(["nw", "ne", "sw", "se"] as const).map((corner) => (
            <button
              key={corner}
              data-pet-resize-control={corner}
              aria-label={`${t("pets.resize")} ${corner}`}
              style={{
                position: "absolute",
                width: 14,
                height: 14,
                padding: 0,
                border: "1px solid hsl(var(--primary, 250 84% 60%))",
                borderRadius: 4,
                background: "hsl(var(--background, 0 0% 100%))",
                pointerEvents: "auto",
                touchAction: "none",
                left: corner.includes("w") ? -7 : undefined,
                right: corner.includes("e") ? -7 : undefined,
                top: corner.includes("n") ? -7 : undefined,
                bottom: corner.includes("s") ? -7 : undefined,
                cursor:
                  corner === "nw" || corner === "se"
                    ? "nwse-resize"
                    : "nesw-resize",
              }}
              onPointerDown={(event) => {
                event.preventDefault();
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  /* Pointer may already have ended. */
                }
                void api?.resize(corner);
              }}
              onPointerUp={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
                void api?.resize(null);
              }}
              onPointerCancel={() => void api?.resize(null)}
            />
          ))}
          <button
            data-pet-resize-control="done"
            aria-label={t("pets.resize.finish")}
            style={{
              position: "absolute",
              right: 12,
              top: 12,
              width: 28,
              height: 28,
              borderRadius: 14,
              background: "hsl(var(--background, 0 0% 100%))",
              color: "hsl(var(--foreground, 240 10% 4%))",
              border: "1px solid hsl(var(--border, 240 5% 92%))",
              pointerEvents: "auto",
              cursor: "pointer",
            }}
            onClick={() => void api?.finishResize()}
          >
            ✓
          </button>
        </div>
      )}
    </div>
  ) : null;
}
