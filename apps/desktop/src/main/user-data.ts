import path from "node:path";

export function resolveUserDataOverride(value: string | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;
  if (!path.isAbsolute(candidate)) {
    throw new Error("AMIBA_USER_DATA_DIR must be an absolute path");
  }
  return path.normalize(candidate);
}
