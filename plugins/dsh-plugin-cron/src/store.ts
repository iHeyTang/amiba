import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import type { CronTask } from "./types.js";

/**
 * Durable JSON store for cron task definitions, scoped to the active DSH
 * home (same pattern as the Model Plane registry: one file, serialized
 * writers, atomic rename).
 */
export class DshCronStore {
  readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.path = join(root, "tasks.json");
  }

  private async readDocument(): Promise<{ tasks: CronTask[] }> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as unknown;
      const tasks =
        parsed && typeof parsed === "object" && Array.isArray((parsed as { tasks?: unknown }).tasks)
          ? ((parsed as { tasks: CronTask[] }).tasks)
          : [];
      return { tasks };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { tasks: [] };
      throw error;
    }
  }

  async list(): Promise<CronTask[]> {
    await this.chain;
    return (await this.readDocument()).tasks;
  }

  /** Serialize a read-modify-write of the whole task list. */
  mutate(update: (tasks: CronTask[]) => CronTask[]): Promise<CronTask[]> {
    const result = this.chain.then(async () => {
      const document = await this.readDocument();
      const next = update(document.tasks);
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify({ tasks: next }, null, 2)}\n`, {
        mode: 0o600,
      });
      await rename(temporary, this.path);
      return next;
    });
    this.chain = result.catch(() => undefined);
    return result;
  }
}
