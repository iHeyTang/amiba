/**
 * Bing wallpaper background + credit chip — shared by the home surface
 * (full-bleed immersive backdrop) and the desktop chat view (right-pane
 * background). Lives in chat-ui rather than home-ui so both surfaces
 * can consume it without a circular dependency (home-ui already
 * depends on chat-ui).
 *
 * All visual layers sit at `-z-10`; the parent must set `isolate` so
 * the negative-z stack doesn't escape into ancestor stacking contexts.
 */

import { ImageIcon as ImageBadgeIcon, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { Wallpaper, WallpaperController } from "@hermes-x/core";
import { useT } from "@hermes-x/i18n";
import { cn } from "../primitives";
interface WallpaperBackdropProps {
  controller: WallpaperController;
  /**
   * Whether to paint a soft gradient overlay over the wallpaper. Off by
   * default; the home page turns it on when its bottom dashboard
   * (cron-run reader) is expanded so the cards above the photo have a
   * calmer tone to sit on. Chat surfaces leave it off — the chat
   * bubbles already render on solid surfaces above the image.
   */
  dim?: boolean;
}

/**
 * Layered backdrop: a solid theme-colour base (always painted so the
 * page never flashes transparent while the image is loading), the
 * lazy-loaded Bing image, and an optional dim overlay. All three are
 * `-z-10` so content stacked above them paints normally.
 */
export function WallpaperBackdrop({
  controller,
  dim = false,
}: WallpaperBackdropProps) {
  const { wallpaper, enabled } = controller;
  return (
    <>
      <div aria-hidden className="absolute inset-0 -z-10 bg-background" />
      {enabled && wallpaper ? <WallpaperImage wallpaper={wallpaper} /> : null}
      <div
        aria-hidden
        className={cn(
          "absolute inset-0 -z-10",
          "bg-gradient-to-b from-background/70 via-background/25 to-background/75",
          "transition-opacity duration-500 ease-out",
          dim ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  );
}

function WallpaperImage({ wallpaper }: { wallpaper: Wallpaper }) {
  // Fade in only after the image actually finishes loading; before that
  // the base background shows through.
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      src={wallpaper.url}
      alt=""
      aria-hidden
      onLoad={() => setLoaded(true)}
      className={cn(
        "absolute inset-0 -z-10 h-full w-full object-cover",
        "transition-opacity duration-700 ease-out",
        loaded ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

interface WallpaperCreditProps {
  controller: WallpaperController;
  /**
   * Pre-computed text/hover colour class that adapts to the wallpaper
   * mode; supplied by the parent so the credit chip shares its tonal
   * adaptation logic with the rest of the TopBar action group.
   */
  ambientClass: string;
}

/**
 * Compact credit chip with a hover-revealed "{title} · Bing" link and
 * a "cycle to next image" button. Default state is a single icon so
 * the chip disappears into the action row when not in use.
 */
export function WallpaperCredit({
  controller,
  ambientClass,
}: WallpaperCreditProps) {
  const { t } = useT();
  const { wallpaper, cycle, cycling } = controller;
  if (!wallpaper) return null;
  const text = wallpaper.title || wallpaper.copyright;
  if (!text) return null;
  return (
    <div
      title={wallpaper.copyright || text}
      className={cn(
        "group/credit inline-flex h-8 items-center overflow-hidden rounded-full",
        "text-[11px] transition-colors duration-200 hover:bg-white/10",
        ambientClass,
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">
        <ImageBadgeIcon className="h-4 w-4" />
      </span>
      {/*
        Animate to natural content width via the grid 0fr → 1fr trick.
        `max-width` keyframes would clip mid-transition because we can't
        precompute the text width; the grid track approach lets the inner
        content drive the animated end-state.
      */}
      <div
        className={cn(
          "grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out",
          "group-hover/credit:grid-cols-[1fr]",
          "group-focus-within/credit:grid-cols-[1fr]",
        )}
      >
        <div className="flex items-center overflow-hidden">
          {wallpaper.copyrightLink ? (
            <a
              href={wallpaper.copyrightLink}
              target="_blank"
              rel="noreferrer"
              className="whitespace-nowrap px-1 hover:underline"
            >
              {text} · Bing
            </a>
          ) : (
            <span className="whitespace-nowrap px-1">{text} · Bing</span>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              void cycle();
            }}
            disabled={cycling}
            aria-label={t("newtab.wallpaper.cycle")}
            title={t("newtab.wallpaper.cycle")}
            className={cn(
              "ml-0.5 mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
              "transition-colors hover:bg-white/15",
              "text-inherit",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            <RefreshCw
              className={cn("h-3 w-3", cycling && "animate-spin")}
            />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Pick a tailwind text-colour class set that stays legible over the
 * current wallpaper. ``null`` when no wallpaper is rendered (theme
 * default applies). Surfaces that overlay text directly on the
 * wallpaper image should run this helper to keep contrast stable
 * regardless of whether today's photo is a snowy ridgeline or a
 * midnight city.
 */
export function wallpaperAmbientTextClass(
  controller: WallpaperController,
): string {
  const ambient =
    controller.enabled &&
    controller.wallpaper !== null &&
    controller.mode !== null;
  if (!ambient) return "text-foreground";
  return controller.mode === "light"
    ? "text-neutral-900 [&_p]:drop-shadow-[0_1px_1px_rgba(255,255,255,0.4)]"
    : "text-white [&_p]:drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]";
}
