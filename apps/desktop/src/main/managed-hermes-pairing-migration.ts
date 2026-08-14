import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const PAIRING_MIGRATION_MARKER = ".amiba-pairing-migrated-v1";

export interface PairingMigrationResult {
  migratedPlatforms: string[];
  migratedUsers: number;
  skipped: boolean;
}

const migrationsInFlight = new Map<string, Promise<PairingMigrationResult>>();

async function readObject(file: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

/** Migrate approved messaging identities while ignoring stale pending/rate-limit state. */
async function performPairingMigration(
  legacyHome: string,
  managedHome: string,
): Promise<PairingMigrationResult> {
  const marker = path.join(managedHome, PAIRING_MIGRATION_MARKER);
  try {
    await fs.access(marker);
    return { migratedPlatforms: [], migratedUsers: 0, skipped: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const legacyPairing = path.join(legacyHome, "pairing");
  const managedPairing = path.join(managedHome, "pairing");
  let names: string[] = [];
  try {
    names = (await fs.readdir(legacyPairing)).filter((name) =>
      /^[a-z0-9_-]+-approved\.json$/i.test(name),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const migratedPlatforms: string[] = [];
  let migratedUsers = 0;
  await fs.mkdir(managedPairing, { recursive: true });
  for (const name of names.sort()) {
    const legacy = await readObject(path.join(legacyPairing, name));
    const destination = path.join(managedPairing, name);
    const managed = await readObject(destination);
    const additions = Object.fromEntries(
      Object.entries(legacy).filter(([userId]) => !(userId in managed)),
    );
    if (!Object.keys(additions).length) continue;
    const temporaryPath = `${destination}.tmp-${randomUUID()}`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify({ ...additions, ...managed }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(temporaryPath, destination);
    if (process.platform !== "win32") {
      await fs.chmod(destination, 0o600).catch(() => {});
    }
    migratedPlatforms.push(name.replace(/-approved\.json$/, ""));
    migratedUsers += Object.keys(additions).length;
  }

  await fs.writeFile(marker, "migrated\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return { migratedPlatforms, migratedUsers, skipped: false };
}

export async function migrateLegacyPairingApprovals(
  legacyHome: string,
  managedHome: string,
): Promise<PairingMigrationResult> {
  const key = `${path.resolve(legacyHome)}\0${path.resolve(managedHome)}`;
  const running = migrationsInFlight.get(key);
  if (running) return running;
  const migration = performPairingMigration(legacyHome, managedHome).finally(
    () => migrationsInFlight.delete(key),
  );
  migrationsInFlight.set(key, migration);
  return migration;
}
