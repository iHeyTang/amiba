import type { MenuItemConstructorOptions } from "electron";

/**
 * Application menu template.
 *
 * Amiba ran on Electron's implicit default menu until this module existed.
 * That default has no Preferences entry, so the platform-standard ⌘, (Ctrl+,
 * elsewhere) was dead. Building the menu ourselves means we also have to
 * re-declare every role the default provided (Edit's clipboard commands,
 * View's zoom/devtools, Window's minimize/zoom/front) — dropping any of them
 * silently loses the keyboard shortcut that role carries.
 *
 * Kept free of runtime `electron` imports so the template is unit-testable
 * under plain Node; `index.ts` does the `Menu.setApplicationMenu` call.
 *
 * Labels are English on purpose: Electron's role items render English
 * labels regardless of locale, and the main process has no view of the
 * official DSH locale service that owns the product language — a single
 * localized entry among English role items would read worse than none.
 */

/** Platform-standard settings chord: ⌘, on macOS, Ctrl+, elsewhere. */
export const SETTINGS_ACCELERATOR = "CommandOrControl+,";

export interface AppMenuOptions {
  platform: NodeJS.Platform;
  /** Shown as the macOS application-menu title (`app.name`). */
  appName: string;
  onOpenSettings: () => void;
}

export function buildAppMenuTemplate({
  platform,
  appName,
  onOpenSettings,
}: AppMenuOptions): MenuItemConstructorOptions[] {
  const isMac = platform === "darwin";

  const settingsItem: MenuItemConstructorOptions = {
    label: "Settings…",
    accelerator: SETTINGS_ACCELERATOR,
    click: () => onOpenSettings(),
  };

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: "about" },
      { type: "separator" },
      settingsItem,
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [settingsItem, { type: "separator" }, { role: "quit" }],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      ...(isMac
        ? [
            { role: "pasteAndMatchStyle" } as const,
            { role: "delete" } as const,
            { role: "selectAll" } as const,
          ]
        : [
            { role: "delete" } as const,
            { type: "separator" } as const,
            { role: "selectAll" } as const,
          ]),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "reload" },
      { role: "forceReload" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    submenu: isMac
      ? [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
        ]
      : [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
  };

  return isMac
    ? [appMenu, editMenu, viewMenu, windowMenu]
    : [fileMenu, editMenu, viewMenu, windowMenu];
}
