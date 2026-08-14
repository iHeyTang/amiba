import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const CRON_MIGRATION_MARKER = ".amiba-cron-migrated-v1";
const VOLATILE_JOB_FIELDS = [
  "next_run_at",
  "fire_claim",
  "run_claim",
  "running_at",
  "claimed_at",
] as const;

interface CronFile {
  jobs?: unknown;
}

export interface CronMigrationResult {
  migratedJobIds: string[];
  skipped: boolean;
}

const migrationsInFlight = new Map<string, Promise<CronMigrationResult>>();

async function readCronFile(file: string): Promise<Record<string, unknown>[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as
      | CronFile
      | unknown[];
    const jobs = Array.isArray(parsed) ? parsed : parsed.jobs;
    return Array.isArray(jobs)
      ? jobs.filter(
          (job): job is Record<string, unknown> =>
            typeof job === "object" && job !== null && !Array.isArray(job),
        )
      : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function migratedJob(job: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(job);
  for (const field of VOLATILE_JOB_FIELDS) delete result[field];
  return result;
}

/**
 * Move standalone Hermes cron definitions into Amiba's managed home once.
 * Runtime claims and stale next-run timestamps are intentionally discarded so
 * the managed ticker schedules the next future occurrence instead of replaying
 * missed notifications immediately after migration.
 */
async function performCronMigration(
  legacyHome: string,
  managedHome: string,
): Promise<CronMigrationResult> {
  const marker = path.join(managedHome, CRON_MIGRATION_MARKER);
  try {
    await fs.access(marker);
    return { migratedJobIds: [], skipped: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const legacyJobs = await readCronFile(
    path.join(legacyHome, "cron", "jobs.json"),
  );
  const managedJobsPath = path.join(managedHome, "cron", "jobs.json");
  const managedJobs = await readCronFile(managedJobsPath);
  const existingIds = new Set(
    managedJobs.map((job) => String(job.id || "")).filter(Boolean),
  );
  const additions = legacyJobs
    .filter((job) => {
      const id = String(job.id || "").trim();
      return id && !existingIds.has(id);
    })
    .map(migratedJob);

  if (additions.length) {
    await fs.mkdir(path.dirname(managedJobsPath), { recursive: true });
    const temporaryPath = `${managedJobsPath}.tmp-${randomUUID()}`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(
        {
          jobs: [...managedJobs, ...additions],
          updated_at: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(temporaryPath, managedJobsPath);
    if (process.platform !== "win32") {
      await fs.chmod(managedJobsPath, 0o600).catch(() => {});
    }
  }

  await fs.writeFile(marker, "migrated\n", {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return {
    migratedJobIds: additions.map((job) => String(job.id)),
    skipped: false,
  };
}

export async function migrateLegacyCronJobs(
  legacyHome: string,
  managedHome: string,
): Promise<CronMigrationResult> {
  const key = `${path.resolve(legacyHome)}\0${path.resolve(managedHome)}`;
  const running = migrationsInFlight.get(key);
  if (running) return running;
  const migration = performCronMigration(legacyHome, managedHome).finally(() =>
    migrationsInFlight.delete(key),
  );
  migrationsInFlight.set(key, migration);
  return migration;
}
