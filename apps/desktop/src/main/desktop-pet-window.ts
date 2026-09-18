import { app, BrowserWindow, ipcMain, Menu, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import type { DesktopPetActivity } from "../shared/desktop-pet";
const directory = path.dirname(fileURLToPath(import.meta.url));
export function clampPetPosition(
  point: { x: number; y: number },
  area: { x: number; y: number; width: number; height: number },
  size = 200,
) {
  return {
    x: Math.round(
      Math.max(area.x, Math.min(point.x, area.x + area.width - size)),
    ),
    y: Math.round(
      Math.max(area.y, Math.min(point.y, area.y + area.height - size)),
    ),
  };
}
export async function installDesktopPetWindow(
  main: () => BrowserWindow | null,
  openMain: () => void,
  openConversation: (sessionId: string) => void = () => openMain(),
) {
  const file = path.join(app.getPath("userData"), "desktop-pet.json");
  let size = 200;
  let language = app.getLocale().startsWith("zh") ? "zh-CN" : "en";
  let messageAnchor: { x: number; y: number; size: number } | undefined;
  let editing = false;
  let visual = { x: 0, y: 0, width: 1, height: 1 };
  let displayId: number | undefined;
  let bottomPinned = false;
  let enabled = false,
    position: { x: number; y: number } | undefined;
  try {
    const saved = JSON.parse(await readFile(file, "utf8"));
    enabled = saved.enabled === true;
    if (Number.isFinite(saved.size)) size = Math.max(100, Math.min(600, Math.round(saved.size)));
    if (Number.isFinite(saved.x) && Number.isFinite(saved.y))
      position = { x: saved.x, y: saved.y };
  } catch {
    /* First launch. */
  }
  let win: BrowserWindow | null = null,
    ready = false;
  let activity: DesktopPetActivity = {
    phase: "idle",
    restored: true,
    sessionId: "",
    revision: 0,
  };
  let dragTimer: ReturnType<typeof setInterval> | undefined;
  let writing = Promise.resolve();
  const save = () => {
    const data = JSON.stringify({ enabled, size, ...position });
    writing = writing
      .then(async () => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file + ".tmp", data);
        await rename(file + ".tmp", file);
      })
      .catch((error) => console.error("[desktop-pet] save failed", error));
    return writing;
  };
  const broadcast = () => {
    for (const w of BrowserWindow.getAllWindows())
      w.webContents.send("desktop-pet:state", { enabled });
  };
  const stopDrag = () => {
    if (dragTimer) {
      clearInterval(dragTimer);
      dragTimer = undefined;
      // Drag/resize flip the full-screen transparent window into interactive
      // mode (`setIgnoreMouseEvents(false)`). Restore pass-through the moment
      // the gesture ends — otherwise the pet window keeps swallowing clicks
      // across the whole display, and if the renderer missed the pointer-up
      // (it can, while it lags behind the cursor) the interval would keep
      // chasing the mouse with no way to stop it.
      if (win && !win.isDestroyed())
        win.setIgnoreMouseEvents(true, { forward: true });
      void save();
    }
  };
  // A full-screen transparent always-on-top window forces the window server
  // to composite the whole display every frame — the dominant cost of both
  // idle and drag animation. Keep the window to a canvas around the pet
  // square plus the message-bubble stack, and follow the pet when it is
  // dragged (the window is invisible, so moving it is indistinguishable from
  // moving the pet). The bubble is at most 240px wide and stacks upward from
  // the pet, so a fixed generous canvas works at any pet position.
  const SIDE_MARGIN = 24; // horizontal cushion around the pet square
  const BUBBLE_HEADROOM = 320; // message stack space above the pet
  const BOTTOM_CUSHION = 48; // room for a bubble below the pet
  const MIN_WINDOW_WIDTH = 264; // 240 bubble + 12 px margins each side
  const windowGeometry = (display: Electron.Display) => {
    const area = display.bounds;
    return {
      width: Math.min(
        area.width,
        Math.max(size + SIDE_MARGIN * 2, MIN_WINDOW_WIDTH),
      ),
      height: Math.min(area.height, size + BUBBLE_HEADROOM + BOTTOM_CUSHION),
    };
  };
  const windowOrigin = (display: Electron.Display) => {
    const area = display.bounds, g = windowGeometry(display);
    if (!position) return { x: area.x, y: area.y };
    return {
      x: Math.max(
        area.x,
        Math.min(position.x - SIDE_MARGIN, area.x + area.width - g.width),
      ),
      y: Math.max(
        area.y,
        Math.min(position.y - BUBBLE_HEADROOM, area.y + area.height - g.height),
      ),
    };
  };
  const syncWindow = (display: Electron.Display) => {
    if (!win) return;
    displayId = display.id;
    const g = windowGeometry(display), o = windowOrigin(display);
    const b = win.getBounds();
    if (
      b.x !== o.x ||
      b.y !== o.y ||
      b.width !== g.width ||
      b.height !== g.height
    )
      win.setBounds({ ...o, ...g });
  };
  const layout = () => {
    if (!win || !position) return;
    const host = win.getBounds();
    const anchor = messageAnchor ?? { ...position, size };
    win.webContents.send("desktop-pet:layout", {
      anchor: { x: anchor.x - host.x, y: anchor.y - host.y, size: anchor.size },
      x: position.x - host.x, y: position.y - host.y, size, editing, visual,
    });
  };
  const place = (point: { x: number; y: number }, display = screen.getDisplayNearestPoint(point), updateAnchor = true) => {
    const area = display.bounds;
    const gap = editing ? 10 : 2;
    const maxY = area.y + area.height - (visual.y + visual.height) * size - gap;
    position = {
      x: Math.max(area.x - visual.x * size + gap,
        Math.min(point.x, area.x + area.width - (visual.x + visual.width) * size - gap)),
      y: Math.max(area.y - visual.y * size + gap, Math.min(point.y, maxY)),
    };
    if (win) syncWindow(display);
    if (updateAnchor) messageAnchor = { ...position, size };
    layout();
    return point.y >= maxY;
  };
  const relocate = () => {
    if (!win || !position) return;
    displayId = undefined;
    place(position);
    void save();
  };
  const create = () => {
    if (win && !win.isDestroyed()) return win;
    const display = position
      ? screen.getDisplayNearestPoint(position)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    position = clampPetPosition(
      position ?? {
        x: display.workArea.x + display.workArea.width - 232,
        y: display.workArea.y + display.workArea.height - 232,
      },
      display.bounds,
      size,
    );
    messageAnchor = { ...position, size };
    const g = windowGeometry(display), o = windowOrigin(display);
    const w = (win = new BrowserWindow({
      x: o.x,
      y: o.y,
      width: g.width,
      height: g.height,
      // Dragging is handled by cursor deltas, never by the native window manager.
      movable: false,
      ...(process.platform === "darwin" ? { type: "panel" } : {}),
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      focusable: false,
      show: false,
      webPreferences: {
        preload: path.join(directory, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    }));
    displayId = display.id;
    // Keep Amiba a foreground app: Electron's default process-type transform
    // temporarily hides every window and the Dock icon on macOS.
    w.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    });
    w.setIgnoreMouseEvents(true, { forward: true });
    w.on("closed", () => {
      stopDrag();
      win = null;
      ready = false;
    });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", (event) => event.preventDefault());
    // The pet window now boots a small standalone page (renderer/pet) that
    // renders the pet from data forwarded by the main window's pets plugin —
    // it does not run the DSH shell at all.
    const url = process.env.ELECTRON_RENDERER_URL;
    if (url) {
      const base = url.endsWith("/") ? url : `${url}/`;
      void w.loadURL(new URL("pet/index.html", base).href);
    } else void w.loadFile(path.join(directory, "../renderer/pet/index.html"));
    return w;
  };
  const setEnabled = async (value: boolean) => {
    enabled = value;
    if (enabled) {
      const w = create();
      if (ready) w.showInactive();
      startPointerTracking();
    } else {
      stopPointerTracking();
      stopDrag();
      win?.hide();
    }
    broadcast();
    await save();
    return { enabled };
  };
  const contents = (window: BrowserWindow | null) =>
    window && !window.isDestroyed() ? window.webContents : undefined;
  const trusted = (sender: Electron.WebContents) =>
    sender === contents(main()) || sender === contents(win);
  const own = (sender: Electron.WebContents) => sender === contents(win);
  ipcMain.handle("desktop-pet:open-conversation", (event, sessionId) => {
    if (trusted(event.sender) && typeof sessionId === "string" && sessionId.trim() && sessionId.length <= 200) openConversation(sessionId);
  });
  ipcMain.handle("desktop-pet:language", (event, value) => {
    if (event.sender === contents(main()) && (value === "en" || value === "zh-CN")) language = value;
  });
  ipcMain.handle("desktop-pet:get", (event) => {
    if (!trusted(event.sender)) throw new Error("Unsupported desktop pet host");
    return { enabled };
  });
  ipcMain.handle("desktop-pet:enable", (event, value) => {
    if (!trusted(event.sender) || typeof value !== "boolean")
      throw new Error("Invalid desktop pet request");
    return setEnabled(value);
  });
  ipcMain.handle("desktop-pet:ready", (event) => {
    if (own(event.sender)) {
      ready = true;
      layout();
      event.sender.send("desktop-pet:activity", { ...activity, restored: true });
      if (enabled) win?.showInactive();
    }
  });
  ipcMain.handle("desktop-pet:ignore", (event, ignore) => {
    if (own(event.sender) && !dragTimer)
      win?.setIgnoreMouseEvents(ignore === true, { forward: true });
  });
  ipcMain.handle("desktop-pet:drag", (event, active) => {
    if (!own(event.sender) || !win) return;
    stopDrag();
    if (!active) return;
    if (!position) return;
    const cursor = screen.getCursorScreenPoint(), start = { ...position };
    win.setIgnoreMouseEvents(false);
    dragTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      bottomPinned = place(
        { x: start.x + p.x - cursor.x, y: start.y + p.y - cursor.y },
        screen.getDisplayNearestPoint(p),
      );
    }, 16);
  });
  // -- Standalone pet page data source ------------------------------
  // The pet page (renderer/pet) has no DSH shell. Pet library, notification
  // feed and session activity now come from the MAIN-PROCESS DSH state
  // subscription layer (`dsh-state:*`), which owns the DSH runtime client and
  // broadcasts one snapshot to every window — the pet page no longer depends
  // on the main window's plugin instance for its data.
  ipcMain.handle("desktop-pet:visual", (event, box) => {
    if (!own(event.sender) || !box || ![box.x, box.y, box.width, box.height].every(Number.isFinite)
      || box.width <= 0 || box.height <= 0 || Math.max(...Object.values(box).map(Number).map(Math.abs)) > 4) return;
    visual = { x: box.x, y: box.y, width: box.width, height: box.height };
    if (position) {
      const display = screen.getAllDisplays().find(d => d.id === displayId) ?? screen.getDisplayNearestPoint(position);
      place({ ...position, y: bottomPinned ? display.bounds.y + display.bounds.height : position.y }, display, false);
    }
  });
  ipcMain.handle("desktop-pet:finish-resize", async (event) => {
    if (!own(event.sender)) return;
    stopDrag(); editing = false; layout(); await save();
    win?.setIgnoreMouseEvents(true, { forward: true });
  });
  ipcMain.handle("desktop-pet:resize", (event, corner) => {
    if (!own(event.sender) || !win || !editing || !position) return;
    stopDrag();
    if (!["nw", "ne", "sw", "se"].includes(corner)) return;
    const start = { ...position }, initialSize = size, cursor = screen.getCursorScreenPoint();
    const west = corner.includes("w"), north = corner.includes("n");
    const anchorX = start.x + (visual.x + (west ? visual.width : 0)) * size;
    const anchorY = start.y + (visual.y + (north ? visual.height : 0)) * size;
    const shape = { ...visual };
    win.setIgnoreMouseEvents(false);
    bottomPinned = false;
    dragTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      const dx = (p.x - cursor.x) * (west ? -1 : 1), dy = (p.y - cursor.y) * (north ? -1 : 1);
      size = Math.round(Math.max(100, Math.min(600,
        initialSize + (dx * shape.width + dy * shape.height) / (shape.width ** 2 + shape.height ** 2))));
      place({ x: anchorX - (shape.x + (west ? shape.width : 0)) * size,
        y: anchorY - (shape.y + (north ? shape.height : 0)) * size });
    }, 16);
  });
  ipcMain.handle("desktop-pet:activity", (event, next: DesktopPetActivity) => {
    if (
      event.sender !== contents(main()) ||
      !next ||
      ![
        "idle",
        "thinking",
        "responding",
        "tooling",
        "waiting",
        "completed",
        "failed",
        "interrupted",
      ].includes(next.phase)
    )
      return;
    activity = {
      phase: next.phase,
      title: typeof next.title === "string" ? next.title.trim().slice(0, 500) : undefined,
      restored: next.restored === true,
      sessionId: String(next.sessionId).slice(0, 200),
      revision: Number.isFinite(next.revision) ? next.revision : 0,
    };
    win?.webContents.send("desktop-pet:activity", activity);
  });
  ipcMain.handle(
    "desktop-pet:menu",
    (event, pets: { id: string; name: string }[], activeId: string | null) => {
      if (!own(event.sender) || !win || !Array.isArray(pets)) return;
      stopDrag();
      const zh = language === "zh-CN";
      Menu.buildFromTemplate([
        {
          label: zh ? "切换宠物" : "Switch pet",
          submenu: pets
            .slice(0, 100)
            .filter(
              (p) =>
                p && typeof p.id === "string" && typeof p.name === "string",
            )
            .map((p) => ({
              label: p.name.slice(0, 80),
              type: "radio" as const,
              checked: p.id === activeId,
              click: () => win?.webContents.send("desktop-pet:select", p.id),
            })),
        },
        {
          label: zh ? "调整大小…" : "Resize…",
          click: () => { editing = true; if (position) place(position); layout(); },
        },
        { label: zh ? "回到 Amiba" : "Open Amiba", click: openMain },
        { type: "separator" },
        {
          label: zh ? "关闭桌面宠物" : "Hide desktop pet",
          click: () => void setEnabled(false),
        },
      ]).popup({ window: win });
    },
  );
  // Native screen coordinates continue updating outside the transparent
  // window. The timer only lives while the pet is ENABLED: previously it ran
  // unconditionally for the app's whole lifetime, waking the main process
  // 30×/s (with an empty body) even when the pet was hidden.
  //
  // Even while enabled, the gaze value only changes when the cursor moves —
  // and the renderer animates toward the last value it saw. Send a message
  // only when the value actually changed, plus a sparse keep-alive so a
  // stationary cursor keeps the pet looking at it (the renderer resets the
  // look when the native stream goes silent). Idle cost drops from 30 Hz to
  // a handful of messages per second.
  let pointerTimer: ReturnType<typeof setInterval> | undefined;
  let lastPointer: { x: number; y: number } | null = null;
  let lastPointerSentAt = 0;
  const startPointerTracking = () => {
    if (pointerTimer) return;
    pointerTimer = setInterval(() => {
      if (!enabled || !ready || !win || win.isDestroyed() || !win.isVisible())
        return;
      try {
        const cursor = screen.getCursorScreenPoint();
        const bounds = { ...position!, width: size, height: size };
        const display = screen.getDisplayMatching(win.getBounds()).bounds;
        const point = {
          x: Math.tanh((cursor.x - bounds.x - bounds.width / 2) / Math.max(size, display.width / 4)),
          y: Math.tanh((cursor.y - bounds.y - bounds.height / 2) / Math.max(size, display.height / 4)),
        };
        const now = performance.now();
        const unchanged = lastPointer &&
          Math.abs(point.x - lastPointer.x) < 1e-4 &&
          Math.abs(point.y - lastPointer.y) < 1e-4;
        if (unchanged && now - lastPointerSentAt < 200) return;
        lastPointer = point;
        lastPointerSentAt = now;
        win.webContents.send("desktop-pet:pointer", point);
      } catch {
        lastPointer = null;
        if (win && !win.isDestroyed()) win.webContents.send("desktop-pet:pointer", null);
      }
    }, 33);
  };
  const stopPointerTracking = () => {
    if (pointerTimer) clearInterval(pointerTimer);
    pointerTimer = undefined;
  };
  app.on("before-quit", stopPointerTracking);
  screen.on("display-removed", relocate);
  screen.on("display-metrics-changed", relocate);
  app.on("before-quit", stopDrag);
  if (enabled) {
    // The pet renderer boots the full DSH shell, so creating its window
    // during app startup makes two complete renderer boots compete for CPU
    // right at first paint and visibly stalls the launch. Start it only once
    // the main window has finished loading; the pet still appears as soon as
    // its own renderer calls `desktop-pet:ready`.
    const startPet = () => {
      if (!enabled) return;
      create();
      startPointerTracking();
    };
    const startWhenMainIsInteractive = () => {
      const host = main();
      if (!host || host.isDestroyed()) {
        setTimeout(startWhenMainIsInteractive, 250);
        return;
      }
      if (host.webContents.isLoadingMainFrame()) {
        const finish = () => startPet();
        host.webContents.once("did-finish-load", finish);
        host.webContents.once("did-fail-load", finish);
      } else {
        // Main window already interactive: still give its first paint a head
        // start before paying for the second renderer boot.
        setTimeout(startPet, 350);
      }
    };
    startWhenMainIsInteractive();
  }
}
