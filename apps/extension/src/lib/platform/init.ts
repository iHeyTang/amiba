import { hasPlatform, setPlatform } from "@hermes-x/platform"

import { createChromeAdapter } from "./chrome-adapter"

/**
 * Side-effect module that wires the Chrome PlatformAdapter exactly once.
 *
 * Every React entry (sidepanel/options/newtab/tabs/chat) imports this BEFORE
 * any other import that might transitively reach @hermes-x/i18n or
 * @hermes-x/theme — both call getPlatform() at hook time and will throw if
 * the adapter hasn't been installed yet.
 */
if (!hasPlatform()) {
  setPlatform(createChromeAdapter())
}
