import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

import { EMPTY_STEWARD_STATE, type StewardState, type StewardTask } from "./types.js";

function isTask(value: unknown): value is StewardTask {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.sessionId === "string";
}

function normalize(parsed: unknown): StewardState | null {
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  if (row.version !== 1 || !Array.isArray(row.tasks)) return null;
  return {
    version: 1,
    ...(typeof row.stewardSessionId === "string" ? { stewardSessionId: row.stewardSessionId } : {}),
    ...(typeof row.basePreset === "string" ? { basePreset: row.basePreset } : {}),
    ...(typeof row.extensionVersion === "number" ? { extensionVersion: row.extensionVersion } : {}),
    tasks: row.tasks.filter(isTask),
  };
}

/**
 * Durable JSON state for the steward: one file, serialized writers, atomic
 * rename (same pattern as the cron and model-plane stores). A corrupt file
 * degrades to the empty state with one warning rather than blocking boot.
 */
export class StewardStore {
  readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    root: string,
    private readonly warn: (message: string) => void = () => undefined,
  ) {
    this.path = join(root, "state.json");
  }

  private async readDocument(): Promise<StewardState> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...EMPTY_STEWARD_STATE, tasks: [] };
      throw error;
    }
    try {
      const state = normalize(JSON.parse(raw));
      if (state) return state;
      this.warn(`steward state at ${this.path} has an unexpected shape; starting empty`);
    } catch (error) {
      this.warn(`steward state at ${this.path} is not valid JSON (${String(error)}); starting empty`);
    }
    return { ...EMPTY_STEWARD_STATE, tasks: [] };
  }

  async read(): Promise<StewardState> {
    await this.chain;
    return this.readDocument();
  }

  /** Serialize a read-modify-write of the whole state. */
  mutate(update: (state: StewardState) => StewardState): Promise<StewardState> {
    const result = this.chain.then(async () => {
      const next = update(await this.readDocument());
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
      return next;
    });
    this.chain = result.catch(() => undefined);
    return result;
  }
}
