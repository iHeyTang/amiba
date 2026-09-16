import path from "node:path";

export function resolveUserDataOverride(
  value: string | undefined,
): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (!path.isAbsolute(candidate)) {
    throw new Error("AMIBA_USER_DATA_DIR must be an absolute path");
  }
  return path.normalize(candidate);
}

/** Resolve before taking Electron's single-instance lock or opening any stores. */
export function resolveDesktopUserData(
  override: string | undefined,
  defaultDirectory: string,
  isPackaged: boolean,
): string {
  return (
    resolveUserDataOverride(override) ??
    (isPackaged ? defaultDirectory : `${defaultDirectory}-dev`)
  );
}

/** Preview must not compete with the installed app for OS entry points. */
export function desktopOsIntegrationEnabled(
  isPackaged: boolean,
  devOptIn: string | undefined,
): boolean {
  return isPackaged || devOptIn === "1";
}
