export const AMIBA_DSH_BUNDLES: Readonly<{
  core: "@amiba/dsh-bundle-amiba-core";
  web: "@amiba/dsh-bundle-amiba-web";
  desktop: "@amiba/dsh-bundle-amiba-desktop";
}>;

export type AmibaDshSurface = "headless" | "web" | "desktop";

export function amibaDshProfileName(surface: AmibaDshSurface): string;

export function amibaDshProfileBundles(
  surface: AmibaDshSurface,
  additional?: readonly string[],
): string[];

export function amibaDshProfileManifest(
  surface: AmibaDshSurface,
  current?: unknown,
): Record<string, unknown>;
