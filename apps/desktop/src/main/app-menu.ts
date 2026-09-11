import type { MenuItemConstructorOptions } from "electron";

/**
 * Application menu template.
 *
 * Keep native editing, accessibility zoom and window commands available.
 * Debugging commands are development-only on macOS and grouped separately
 * from everyday actions so the shipping menu contains no browser machinery.
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
  development?: boolean;
}

export function buildAppMenuTemplate({
  platform,
  appName,
  onOpenSettings,
  development = false,
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
      ...(!isMac
        ? [
            { role: "reload" } as const,
            { role: "forceReload" } as const,
            { role: "toggleDevTools" } as const,
            { type: "separator" } as const,
          ]
        : []),
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
      ...(isMac && development
        ? [
            { type: "separator" } as const,
            {
              label: "Developer",
              submenu: [
                { role: "reload" } as const,
                { role: "forceReload" } as const,
                { role: "toggleDevTools" } as const,
              ],
            },
          ]
        : []),
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
