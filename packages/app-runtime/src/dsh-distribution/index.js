export const AMIBA_DSH_BUNDLES = Object.freeze({
  core: "@amiba/dsh-bundle-amiba-core",
  web: "@amiba/dsh-bundle-amiba-web",
  desktop: "@amiba/dsh-bundle-amiba-desktop",
});

const OFFICIAL_BASE = "@deepseek-ai/dsh-base";
const OFFICIAL_HEADLESS = "@deepseek-ai/dsh-headless";
const OFFICIAL_WEB = "@deepseek-ai/dsh-web-app";

const MANAGED_BUNDLES = new Set([
  OFFICIAL_BASE,
  OFFICIAL_HEADLESS,
  OFFICIAL_WEB,
  ...Object.values(AMIBA_DSH_BUNDLES),
]);

export function amibaDshProfileName(surface) {
  return `amiba-${surface}`;
}

export function amibaDshProfileBundles(surface, additional = []) {
  const custom = additional.filter((bundle) => !MANAGED_BUNDLES.has(bundle));
  if (surface === "headless") {
    return [
      OFFICIAL_BASE,
      OFFICIAL_HEADLESS,
      ...custom,
      AMIBA_DSH_BUNDLES.core,
    ];
  }
  return [
    OFFICIAL_BASE,
    OFFICIAL_WEB,
    ...custom,
    AMIBA_DSH_BUNDLES.core,
    AMIBA_DSH_BUNDLES.web,
    ...(surface === "desktop" ? [AMIBA_DSH_BUNDLES.desktop] : []),
  ];
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

/** Preserve third-party layers while fixing Amiba-owned layers in place. */
export function amibaDshProfileManifest(surface, current) {
  const source = current === undefined ? {} : record(current);
  if (!source) throw new Error("Amiba DSH profile manifest must be an object");
  const dsh = record(source.dsh) ?? {};
  const profile = record(dsh.profile) ?? {};
  const configured = profile.bundles;
  if (
    configured !== undefined &&
    (!Array.isArray(configured) ||
      configured.some((item) => typeof item !== "string"))
  ) {
    throw new Error("Amiba DSH profile bundles must be a string array");
  }
  return {
    ...source,
    name:
      typeof source.name === "string"
        ? source.name
        : `dsh-profile-${amibaDshProfileName(surface)}`,
    private: source.private !== false,
    dependencies: record(source.dependencies) ?? {},
    dsh: {
      ...dsh,
      profile: {
        ...profile,
        bundles: amibaDshProfileBundles(surface, configured ?? []),
        // Patch lifecycle is reload-on-startup, not live HMR. DSH's default
        // for custom profiles is `"live"`, which loads cordis-plugin-hmr and
        // chokidar watchers into every production runtime for no benefit
        // (plugin patches are frozen in packaged builds). `"startup"` applies
        // managed patches once at boot and drops the watchers.
        patchReload: "startup",
      },
    },
  };
}
