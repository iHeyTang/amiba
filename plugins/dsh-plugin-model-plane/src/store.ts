import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export interface ModelPlaneStore {
  get(key: string): Promise<Record<string, unknown>>;
  set(patch: Record<string, unknown>): Promise<void>;
}

function documentOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Durable JSON store scoped to the active DSH home. */
export class DshModelPlaneStore implements ModelPlaneStore {
  readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.path = join(root, "registry.json");
  }

  private async readDocument(): Promise<Record<string, unknown>> {
    try {
      return documentOf(JSON.parse(await readFile(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  async get(key: string): Promise<Record<string, unknown>> {
    await this.chain;
    const document = await this.readDocument();
    return key in document ? { [key]: document[key] } : {};
  }

  set(patch: Record<string, unknown>): Promise<void> {
    const result = this.chain.then(async () => {
      const document = { ...(await this.readDocument()), ...patch };
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporary, this.path);
    });
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
