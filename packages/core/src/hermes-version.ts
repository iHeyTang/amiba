/**
 * Explicit Hermes Agent compatibility contract for this Amiba release.
 *
 * Features may rely on upstream metadata and APIs introduced in this version;
 * callers must reject older or unverifiable runtimes instead of growing
 * provider-specific compatibility branches.
 */
export const MINIMUM_HERMES_VERSION = "0.19.0";

export interface ParsedHermesVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
  normalized: string;
}

export interface HermesVersionCompatibility {
  compatible: boolean;
  installed: string;
  required: string;
  reason: "unsupported" | "unverifiable" | null;
}

export class HermesVersionCompatibilityError extends Error {
  readonly code = "hermes_version_unsupported";
  readonly installed: string;
  readonly required: string;
  readonly reason: HermesVersionCompatibility["reason"];

  constructor(result: HermesVersionCompatibility) {
    const installed = result.installed || "unknown";
    const detail =
      result.reason === "unverifiable"
        ? `Could not verify the installed Hermes version. Amiba requires Hermes ${result.required} or newer.`
        : `Hermes ${installed} is not supported. Amiba requires Hermes ${result.required} or newer.`;
    super(detail);
    this.name = "HermesVersionCompatibilityError";
    this.installed = installed;
    this.required = result.required;
    this.reason = result.reason;
  }
}

export function parseHermesVersion(value: unknown): ParsedHermesVersion | null {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/(?:^|[^\d])v?(\d+)\.(\d+)\.(\d+)([A-Za-z+-][0-9A-Za-z.-]*)?/);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  const suffix = match[4] ?? "";
  return {
    major,
    minor,
    patch,
    // Build metadata (`+local`) does not make a stable release a prerelease.
    prerelease: Boolean(suffix && !suffix.startsWith("+")),
    normalized: `${major}.${minor}.${patch}${suffix}`,
  };
}

export function compareHermesVersions(
  left: ParsedHermesVersion,
  right: ParsedHermesVersion,
): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease !== right.prerelease) {
    return left.prerelease ? -1 : 1;
  }
  return 0;
}

export function getHermesVersionCompatibility(
  installed: unknown,
  required = MINIMUM_HERMES_VERSION,
): HermesVersionCompatibility {
  const installedText = typeof installed === "string" ? installed.trim() : "";
  const parsedInstalled = parseHermesVersion(installedText);
  const parsedRequired = parseHermesVersion(required);
  if (!parsedInstalled || !parsedRequired) {
    return {
      compatible: false,
      installed: installedText,
      required,
      reason: "unverifiable",
    };
  }
  const compatible =
    compareHermesVersions(parsedInstalled, parsedRequired) >= 0;
  return {
    compatible,
    installed: parsedInstalled.normalized,
    required: parsedRequired.normalized,
    reason: compatible ? null : "unsupported",
  };
}

export function assertSupportedHermesVersion(installed: unknown): void {
  const result = getHermesVersionCompatibility(installed);
  if (!result.compatible) throw new HermesVersionCompatibilityError(result);
}
