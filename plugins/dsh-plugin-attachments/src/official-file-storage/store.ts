// Adapted from deepseek-ai/deepseek-harness c291e796. MIT; see ../../LICENSE.deepseek.
import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { chmod, link, mkdir, open, unlink } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { AttachmentError } from "./error.js";
const durableHomes = new Set<string>();
async function syncDirectory(path: string): Promise<void> {
  /* v8 ignore next -- Windows cannot open directory handles; NTFS metadata journaling owns entry durability there. */
  if (process.platform === 'win32') return
  /* v8 ignore start -- Windows cannot exercise directory fsync; POSIX behavior tests enforce this peer. */
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  /* v8 ignore stop */
}

/**
 * Create one private directory tree and persist every ancestor entry up to a
 * caller-vouched durable boundary. The walk deliberately ignores what mkdir
 * reports as newly created: a concurrent first save can create a level this
 * process then merely observes, so "already existed" is not "already durable"
 * — the entry may still be unsynced in the creator, and a crash would drop a
 * directory the session checkpoint already references. Re-syncing a durable
 * entry is harmless; skipping an unsynced one is not.
 * @param path - absolute directory to create.
 * @param boundary - absolute ancestor the caller vouches is already durable.
 */
async function ensureDurableDirectory(path: string, boundary: string): Promise<void> {
  const target = resolve(path)
  const stop = resolve(boundary)
  await mkdir(target, { recursive: true, mode: 0o700 })
  await chmod(target, 0o700)
  let level = target
  while (level !== stop) {
    const parent = dirname(level)
    await syncDirectory(parent)
    /* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */
    if (parent === level) return
    level = parent
  }
}

/**
 * Establish this process's proof that one DSH_HOME entry and every ancestor
 * below the filesystem root are durable. Mere existence is insufficient: a
 * concurrent process may have created the directory but not synced its parent.
 */
async function ensureDurableHome(path: string): Promise<string> {
  const home = resolve(path)
  if (!durableHomes.has(home)) {
    await ensureDurableDirectory(home, parse(home).root)
    durableHomes.add(home)
  }
  return home
}

export async function publishImmutableObject(
  root: string,
  target: string,
  data: Uint8Array,
  sha256: string,
): Promise<void> {
  const staged = await stageImmutableObject(root, (function* (): Iterable<Uint8Array> {
    yield data
  })())
  if (staged.sha256 !== sha256) {
    await removeTemporary(staged.path)
    throw new AttachmentError('Attachment bytes do not match their publication digest.', 'ATTACHMENT_CORRUPT')
  }
  await publishStagedObject(root, target, staged)
}

/** Digest and byte count produced while streaming one immutable object to disk. */
export interface StreamedImmutableObject {
  readonly sha256: string
  readonly bytes: number
}

/**
 * Stream one immutable object from bounded chunks into a staging file, then
 * publish it at a digest-derived target without collecting the complete object in memory.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param data - exact object bytes in order.
 * @param targetFor - derive the final absolute target from the completed digest and byte count.
 * @param signal - optional cancellation for source reads and storage writes.
 * @returns digest and exact byte count of the published object.
 */
export async function publishImmutableObjectStream(
  root: string,
  data: AsyncIterable<Uint8Array>,
  targetFor: (sha256: string, bytes: number) => string,
  signal?: AbortSignal,
): Promise<StreamedImmutableObject> {
  const staged = await stageImmutableObject(root, data, signal)
  let target: string
  try {
    target = targetFor(staged.sha256, staged.bytes)
  } catch (error) {
    /* v8 ignore start -- The local target callback constructs a validated reference from this function's digest. */
    await removeTemporary(staged.path)
    throw error
    /* v8 ignore stop */
  }
  await publishStagedObject(root, target, staged)
  return { sha256: staged.sha256, bytes: staged.bytes }
}

/**
 * Publish another durable hard-link name for an existing immutable object.
 * @param root - absolute versioned attachment root.
 * @param source - existing content-addressed object below `root`.
 * @param target - new alias below `root`.
 * @param sha256 - expected object digest for an existing-target race.
 */
export async function publishImmutableAlias(
  root: string,
  source: string,
  target: string,
  sha256: string,
): Promise<void> {
  const parent = dirname(target)
  try {
    const boundary = await ensureDurableHome(dirname(dirname(resolve(root))))
    await ensureDurableDirectory(parent, boundary)
    try {
      await link(source, target)
    } catch (error) {
      /* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (await digestFile(target) !== sha256) {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    }
    await chmod(target, 0o400)
    const stop = resolve(root)
    for (let level = parent; level !== stop; level = dirname(level)) {
      await syncDirectory(level)
      /* v8 ignore next -- filesystem-root guard: targets sit below root, so the walk reaches `stop` first. */
      if (dirname(level) === level) break
    }
  } catch (error) {
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unable to persist attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
}

interface StagedImmutableObject extends StreamedImmutableObject {
  readonly path: string
  readonly boundary: string
}

async function stageImmutableObject(
  root: string,
  data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  signal?: AbortSignal,
): Promise<StagedImmutableObject> {
  const staging = join(root, 'tmp')
  // Establish DSH_HOME itself against the filesystem root once per process.
  // Every process performs that proof independently, so observing a directory
  // another process created can never be mistaken for durable publication.
  const boundary = await ensureDurableHome(dirname(dirname(resolve(root))))
  await ensureDurableDirectory(staging, boundary)
  const temporary = join(staging, randomUUID())
  let handle
  try {
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    const hash = createHash('sha256')
    let bytes = 0
    for await (const chunk of data) {
      signal?.throwIfAborted()
      await handle.writeFile(chunk)
      hash.update(chunk)
      bytes += chunk.byteLength
    }
    signal?.throwIfAborted()
    await handle.sync()
    signal?.throwIfAborted()
    await handle.close()
    handle = undefined
    return { path: temporary, boundary, sha256: hash.digest('hex'), bytes }
  } catch (error) {
    /* v8 ignore next -- A descriptor remains open only when write, sync, or close fails. */
    if (handle !== undefined) await handle.close().catch(
      /* v8 ignore next -- Close failure is superseded by the storage operation that entered cleanup. */
      () => {},
    )
    await removeTemporary(temporary)
    if (error instanceof AttachmentError || signal?.aborted === true) throw error
    throw new AttachmentError('Unable to persist attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
}

async function publishStagedObject(
  root: string,
  target: string,
  staged: StagedImmutableObject,
): Promise<void> {
  const parent = dirname(target)
  try {
    await ensureDurableDirectory(parent, staged.boundary)
    try {
      await link(staged.path, target)
    } catch (error) {
      /* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (await digestFile(target) !== staged.sha256) {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    }
    // Windows shares the read-only attribute across hard links and refuses to
    // unlink either name once it is set, so discard the staging name first.
    await unlink(staged.path)
    // The target remains the sole link for a new object; this also restores
    // read-only mode when the deduplication path observes an existing object.
    await chmod(target, 0o400)
    // Persist the target entry and close every concurrent parent-creation
    // window before the reference can reach a session checkpoint. The dedup
    // path repeats these syncs because it may observe another writer's link
    // before that writer reaches its own durability boundary.
    const stop = resolve(root)
    for (let level = parent; level !== stop; level = dirname(level)) {
      await syncDirectory(level)
      /* v8 ignore next -- filesystem-root guard: targets sit below root, so the walk reaches `stop` first. */
      if (dirname(level) === level) break
    }
  } catch (error) {
    await removeTemporary(staged.path)
    if (error instanceof AttachmentError) throw error
    throw new AttachmentError('Unable to persist attachment.', 'ATTACHMENT_WRITE_FAILED', { cause: error })
  }
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk)
  return hash.digest('hex')
}

async function removeTemporary(path: string): Promise<void> {
  await unlink(path).catch(
    /* v8 ignore next -- Cleanup can observe a staging name already removed after successful linking. */
    (cleanupError: unknown) => {
      /* v8 ignore next -- Any cleanup failure except an absent staging name must remain visible. */
      if (!(cleanupError instanceof Error && 'code' in cleanupError && cleanupError.code === 'ENOENT')) throw cleanupError
    },
  )
}
