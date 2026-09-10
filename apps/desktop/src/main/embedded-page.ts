import { BrowserWindow, ipcMain, WebContentsView, type IpcMainInvokeEvent } from "electron";
import { localPageUrl, type EmbeddedPageRequest } from "../shared/embedded-page";

/** Application management surfaces, separate from session/workbench browsers. */
export function createEmbeddedPageHandler() {
  const owners = new Map<number, Map<string, WebContentsView>>();
  return async (event: IpcMainInvokeEvent, input: EmbeddedPageRequest) => {
    const host = BrowserWindow.fromWebContents(event.sender);
    if (!host || host.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) {
      throw new Error("Embedded pages require the owning application window.");
    }
    if (!input || typeof input.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(input.id)) {
      throw new Error("Invalid embedded page id.");
    }
    const ownerId = event.sender.id;
    let pages = owners.get(ownerId);
    if (!pages) {
      pages = new Map();
      owners.set(ownerId, pages);
      const dispose = () => {
        for (const view of pages!.values()) {
          if (!view.webContents.isDestroyed()) view.webContents.close();
        }
        pages!.clear();
      };
      // A renderer reload must not leave a native view floating over the new UI.
      event.sender.on("did-start-navigation", (_e, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) {
          for (const view of pages!.values()) host.contentView.removeChildView(view);
          dispose();
        }
      });
      event.sender.once("destroyed", () => { dispose(); owners.delete(ownerId); });
    }
    const existing = pages.get(input.id);
    if (input.action === "unmount") {
      if (existing) {
        pages.delete(input.id);
        host.contentView.removeChildView(existing);
        existing.webContents.close();
      }
      return;
    }
    if (input.action === "bounds") {
      if (!existing) return;
      const b = input.bounds;
      if (!b) { existing.setVisible(false); return; }
      if (![b.x, b.y, b.width, b.height].every(Number.isFinite)) throw new Error("Invalid bounds.");
      const [width, height] = host.getContentSize();
      const zoom = event.sender.getZoomFactor();
      const x = Math.max(0, Math.min(width, Math.round(b.x * zoom)));
      const y = Math.max(0, Math.min(height, Math.round(b.y * zoom)));
      const w = Math.max(0, Math.min(width - x, Math.round(b.width * zoom)));
      const h = Math.max(0, Math.min(height - y, Math.round(b.height * zoom)));
      existing.setBounds({ x, y, width: w, height: h });
      existing.setVisible(w > 0 && h > 0);
      return;
    }
    if (input.action !== "mount") throw new Error("Unknown embedded page action.");
    if (existing) throw new Error("Embedded page is already mounted.");
    const url = localPageUrl(input.url);
    const view = new WebContentsView({ webPreferences: {
      partition: "persist:amiba-management-pages",
      nodeIntegration: false, contextIsolation: true, sandbox: true,
    } });
    view.setVisible(false);
    pages.set(input.id, view);
    host.contentView.addChildView(view);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    const sameOrigin = (target: string) => {
      try { return new URL(target).origin === url.origin; } catch { return false; }
    };
    view.webContents.on("will-navigate", (e, target) => { if (!sameOrigin(target)) e.preventDefault(); });
    view.webContents.on("will-redirect", (e, target) => { if (!sameOrigin(target)) e.preventDefault(); });
    try { await view.webContents.loadURL(url.href); }
    catch (error) {
      if (pages.get(input.id) === view) {
        pages.delete(input.id);
        host.contentView.removeChildView(view);
        if (!view.webContents.isDestroyed()) view.webContents.close();
        throw error;
      }
    }
  };
}

export function registerEmbeddedPageHandlers(): void {
  ipcMain.handle("embedded-page:request", createEmbeddedPageHandler());
}
