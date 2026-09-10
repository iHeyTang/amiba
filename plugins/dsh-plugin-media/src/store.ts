import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
  open,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type {
  MediaAccounting,
  MediaKind,
  MediaOperation,
  MediaTaskReference,
  MediaArtifactSource,
} from "./contracts.js";
export interface MediaArtifact {
  id: string;
  kind: MediaKind;
  mimeType: string;
  path: string;
  size: number;
}
export interface MediaRecord {
  id: string;
  sessionId: string;
  provider: string;
  model: string;
  protocol: string;
  operation: MediaOperation;
  status:
    | "submitting"
    | "queued"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired"
    | "interrupted"
    | "submission_unknown";
  createdAt: number;
  updatedAt: number;
  task?: MediaTaskReference;
  artifacts: MediaArtifact[];
  error?: string;
  warnings?: string[];
  accounting?: MediaAccounting;
  generationStatus?:
    | "pending"
    | "running"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "expired"
    | "unknown";
  storageStatus?: "saving" | "saved" | "failed";
  storageError?: string;
  resultCount?: number;
  remoteArtifacts?: Array<{
    index: number;
    kind: MediaKind;
    url: string;
    mimeType?: string;
  }>;
  /** Set only by an explicit user action in the media UI, never by an agent tool parameter. */
  retryAuthorizedAt?: number;
}
const validId = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Invalid media ID");
  return id;
};
/** Session directories are hashes, never paths supplied by clients or providers. */
export class MediaStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  directory(sessionId: string) {
    if (!sessionId) throw new Error("A media session is required");
    return join(
      this.root,
      createHash("sha256").update(sessionId).digest("hex"),
    );
  }
  async list(sessionId: string): Promise<MediaRecord[]> {
    let files: string[];
    try {
      files = await readdir(this.directory(sessionId));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return Promise.all(
      files
        .filter((f) => /^[0-9a-f-]{36}\.json$/.test(f))
        .map((f) => this.read(sessionId, f.slice(0, -5))),
    );
  }
  async write(record: MediaRecord) {
    const directory = this.directory(record.sessionId);
    await mkdir(directory, { recursive: true });
    const destination = join(directory, `${validId(record.id)}.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, destination);
  }
  async read(sessionId: string, id: string): Promise<MediaRecord> {
    const record = JSON.parse(
      await readFile(
        join(this.directory(sessionId), `${validId(id)}.json`),
        "utf8",
      ),
    ) as MediaRecord;
    if (record.id !== id || record.sessionId !== sessionId)
      throw new Error("Media record does not belong to this session");
    return record;
  }
  async stageSources(record: MediaRecord, sources: MediaArtifactSource[]) {
    const directory = this.directory(record.sessionId);
    const rows = [];
    for (const source of sources) {
      if (!!source.bytes === !!source.url)
        throw new Error("Artifact must have one source");
      if (source.bytes) {
        if (!source.bytes.length || source.bytes.length > 256 * 1024 * 1024)
          throw new Error("Invalid artifact size");
        const file = `${randomUUID()}.pending`;
        await writeFile(join(directory, file), source.bytes, {
          mode: 0o600,
          flag: "wx",
        });
        rows.push({ kind: source.kind, mimeType: source.mimeType, file });
      } else
        rows.push({
          kind: source.kind,
          mimeType: source.mimeType,
          url: source.url,
        });
    }
    const destination = join(directory, `${validId(record.id)}.sources.json`);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(rows), { mode: 0o600 });
    await rename(temporary, destination);
  }
  async stagedSources(
    record: MediaRecord,
  ): Promise<MediaArtifactSource[] | null> {
    let text: string;
    try {
      text = await readFile(
        join(
          this.directory(record.sessionId),
          `${validId(record.id)}.sources.json`,
        ),
        "utf8",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    const rows = JSON.parse(text) as Array<{
      kind: MediaKind;
      mimeType?: string;
      file?: string;
      url?: string;
    }>;
    return Promise.all(
      rows.map(async (row) => {
        if (!row.file)
          return { kind: row.kind, mimeType: row.mimeType, url: row.url };
        if (!/^[0-9a-f-]{36}\.pending$/.test(row.file))
          throw new Error("Invalid staged artifact");
        return {
          kind: row.kind,
          mimeType: row.mimeType,
          bytes: await readFile(
            join(this.directory(record.sessionId), row.file),
          ),
        };
      }),
    );
  }
  async readArtifactChunk(
    sessionId: string,
    artifact: MediaArtifact,
    offset: number,
    length: number,
  ) {
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > artifact.size ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 32 * 1024 * 1024
    )
      throw new Error("Invalid artifact range");
    if (
      resolve(artifact.path) !==
      join(
        this.directory(sessionId),
        `${validId(artifact.id)}.${artifact.path.split(".").pop()}`,
      )
    )
      throw new Error("Invalid artifact path");
    const { constants } = await import("node:fs");
    const file = await open(
      artifact.path,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size !== artifact.size)
        throw new Error("Artifact file changed");
      const buffer = Buffer.alloc(Math.min(length, artifact.size - offset));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      if (bytesRead !== buffer.length) throw new Error("Artifact is truncated");
      return buffer;
    } finally {
      await file.close();
    }
  }
  async saveArtifact(
    sessionId: string,
    kind: MediaKind,
    mimeType: string,
    bytes: Uint8Array,
  ): Promise<MediaArtifact> {
    const id = randomUUID();
    const extensions: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/webm": "webm",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/flac": "flac",
      "audio/ogg": "ogg",
      "application/json": "json",
    };
    const extension = extensions[mimeType];
    if (
      !extension ||
      !(
        mimeType.startsWith(`${kind}/`) ||
        (kind === "file" && mimeType === "application/json")
      )
    )
      throw new Error(`Unsupported generated media format: ${mimeType}`);
    const directory = this.directory(sessionId);
    await mkdir(directory, { recursive: true });
    const path = join(directory, `${id}.${extension}`);
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
    return { id, kind, mimeType, path, size: bytes.length };
  }
}
