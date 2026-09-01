import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredConnect {
  id: string;
  provider: string;
  name: string;
  enabled: boolean;
  pairing: boolean;
  owners: string[];
  agentPreset?: string;
  channelId?: string;
  createdAt: string;
  updatedAt: string;
}

interface ConnectorDocument {
  version: 1;
  connects: StoredConnect[];
}

function normalizeConnect(value: unknown): StoredConnect | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.provider !== "string" ||
    typeof row.name !== "string" ||
    typeof row.createdAt !== "string" ||
    typeof row.updatedAt !== "string"
  ) return null;
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    enabled: row.enabled === true,
    pairing: row.pairing === true,
    owners: Array.isArray(row.owners)
      ? row.owners.filter((item): item is string => typeof item === "string")
      : [],
    ...(typeof row.agentPreset === "string" && row.agentPreset
      ? { agentPreset: row.agentPreset }
      : {}),
    ...(typeof row.channelId === "string" && row.channelId
      ? { channelId: row.channelId }
      : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class ConnectorStore {
  readonly path: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.path = join(root, "connects.json");
  }

  private async readDocument(): Promise<ConnectorDocument> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Record<string, unknown>;
      if (parsed.version !== 1) throw new Error("unsupported connector state");
      return {
        version: 1,
        connects: Array.isArray(parsed.connects)
          ? parsed.connects
              .map(normalizeConnect)
              .filter((item): item is StoredConnect => Boolean(item))
          : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: 1, connects: [] };
      throw error;
    }
  }

  private async writeDocument(document: ConnectorDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  private mutate<T>(operation: (document: ConnectorDocument) => T): Promise<T> {
    const result = this.chain.then(async () => {
      const document = await this.readDocument();
      const value = operation(document);
      await this.writeDocument(document);
      return value;
    });
    this.chain = result.then(() => undefined, () => undefined);
    return result;
  }

  list(): Promise<StoredConnect[]> {
    return this.chain.then(async () => (await this.readDocument()).connects);
  }

  create(input: {
    provider: string;
    name: string;
    agentPreset?: string;
  }): Promise<StoredConnect> {
    return this.mutate((document) => {
      const now = new Date().toISOString();
      const connect: StoredConnect = {
        id: `connect-${randomUUID()}`,
        provider: input.provider,
        name: input.name.trim(),
        enabled: true,
        pairing: true,
        owners: [],
        ...(input.agentPreset?.trim() ? { agentPreset: input.agentPreset.trim() } : {}),
        createdAt: now,
        updatedAt: now,
      };
      document.connects.push(connect);
      return connect;
    });
  }

  update(
    id: string,
    patch: Partial<
      Pick<StoredConnect, "name" | "enabled" | "pairing" | "owners" | "agentPreset" | "channelId">
    >,
  ): Promise<StoredConnect> {
    return this.mutate((document) => {
      const index = document.connects.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("connect_not_found");
      const next: StoredConnect = {
        ...document.connects[index]!,
        ...(typeof patch.name === "string" ? { name: patch.name.trim() } : {}),
        ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}),
        ...(typeof patch.pairing === "boolean" ? { pairing: patch.pairing } : {}),
        ...(patch.owners ? { owners: [...new Set(patch.owners)] } : {}),
        ...(patch.agentPreset !== undefined ? { agentPreset: patch.agentPreset } : {}),
        ...(patch.channelId !== undefined ? { channelId: patch.channelId } : {}),
        updatedAt: new Date().toISOString(),
      };
      document.connects[index] = next;
      return next;
    });
  }

  remove(id: string): Promise<boolean> {
    return this.mutate((document) => {
      const before = document.connects.length;
      document.connects = document.connects.filter((item) => item.id !== id);
      return document.connects.length !== before;
    });
  }
}
