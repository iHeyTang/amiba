import type {
  FaviconCapability,
  HomeCapabilities,
  HomeShortcutsCapability,
} from "@hermes-x/home-ui";

import { useHomeShortcuts } from "~lib/home-shortcuts/use-home-shortcuts";

export const chromeShortcuts: HomeShortcutsCapability = {
  useController: useHomeShortcuts,
};

export const chromeFavicon: FaviconCapability = {
  resolve(url, size) {
    try {
      return chrome.runtime.getURL(
        `/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${size}`,
      );
    } catch {
      return null;
    }
  },
};

export const chromeHomeCapabilities: HomeCapabilities = {
  shortcuts: chromeShortcuts,
  favicon: chromeFavicon,
};
