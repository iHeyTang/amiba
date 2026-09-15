import { logoLightBg } from "@amiba/ui";

/**
 * Install the Amiba mark as the tab icon.
 *
 * The shell owns the document title, so it owns the tab identity too: a page
 * that declares no favicon makes the browser draw its own blank document
 * glyph. A page that already carries one (this shell is also mounted into
 * hosts that ship their own) is left exactly as served.
 */
export function installDocumentIcon(): void {
  if (document.querySelector('link[rel~="icon"]')) return;
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = logoLightBg;
  document.head.append(link);
}
