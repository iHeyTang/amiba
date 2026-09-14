// Adapted from deepseek-harness c291e796, MIT; see ../LICENSE.deepseek.
// HTTP/browser transport is wired separately from this Host authority.
/** Host file-upload service: streamed intake and Agent-scoped staged receipts. */

import { FILE_UPLOAD_HOST } from './file-upload-remote.js'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileAttachmentRef } from './official-file-storage/types.js'
import type { createOfficialFileStorage } from './official-file-storage/index.js'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { Remote, TypertLookupFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
interface EncodedFileUploadRequest { data: string; name?: string }
export type FileUploadReceiptId = string;
export interface FileUploadValue { receiptId: FileUploadReceiptId; file: FileAttachmentRef }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host storage and staged-receipt service for browser file uploads. */
    fileUploads: FileUploads
  }
}

/** Host error; the rc.2 transport adapter must explicitly map this at its boundary. */
export class FileUploadError extends Error {
  constructor(readonly code: string, message: string, readonly data: Record<string, unknown>, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FileUploadError'
  }
}

interface StagedFileUpload {
  readonly file: FileAttachmentRef
  /** Prompt that accepted this receipt; absent until successful admission. */
  requestId?: string
}

/** Resolve or resume the ordinary Agent that owns one Session identity. */
export type AgentResolver = (sessionId: SessionId) => Promise<Agent>

/** Prompt receipt binding that restores its previous owners unless delivery commits it. */
export interface PromptFileBinding extends Disposable {
  /** Keep the receipt bindings until queue or history observation retires them. */
  commit(): void
}

class PromptFileBindingGuard implements PromptFileBinding {
  private settled = false

  constructor(private readonly rollback: () => void) {}

  commit(): void {
    this.settled = true
  }

  [Symbol.dispose](): void {
    if (this.settled) return
    this.settled = true
    this.rollback()
  }
}

/** Host service owning upload storage and Agent-scoped staged receipts. */
export class FileUploads extends TypertRemoteService {
  static inject = ['agents', 'attachments']

  private readonly stagedFiles = new WeakMap<Session, Map<FileUploadReceiptId, StagedFileUpload>>()
  private readonly agentResolution: { resolver: AgentResolver | undefined } = { resolver: undefined }

  /** @param ctx - Host context carrying Agent and attachment services. */
  constructor(ctx: Context, private readonly storage: ReturnType<typeof createOfficialFileStorage>) {
    super(ctx, 'fileUploads')
    ctx.on('session/event', (session, event) => { this.observeSessionEvent(session, event) })
    ctx.on('session/disposed', (session) => { this.stagedFiles.delete(session) })
    ctx.inject(['typert'], scope => {
      const registry = scope.get('typert')
      if (!registry || !('register' in registry) || typeof registry.register !== 'function') throw new Error('File upload requires the Host Typert registry')
      const register = registry.register.bind(registry)
      scope.effect(() => register(FILE_UPLOAD_HOST), 'file upload remote contract')
    })
    ctx.inject(['commands'], scope => {
      const commands = scope.get('commands') as { registerFileReceiptResolver?: (resolve: (agent: Agent, receiptId: string) => FileAttachmentRef | undefined) => () => void } | undefined
      if (typeof commands?.registerFileReceiptResolver !== 'function') return
      scope.effect(() => commands.registerFileReceiptResolver!((agent, receiptId) => this.resolve(agent, receiptId)), 'file upload command receipt resolver')
    })
  }

  /**
   * Register the ordinary-Session resolver used when a raw upload addresses a cold Session.
   * @param resolve - resolver that returns the exact live Agent or throws a Remote error.
   * @returns disposer removing this resolver.
   */
  registerAgentResolver(resolve: AgentResolver): () => void {
    if (this.agentResolution.resolver !== undefined) throw new Error('file-upload: Agent resolver is already registered')
    this.agentResolution.resolver = resolve
    return () => {
      if (this.agentResolution.resolver === resolve) this.agentResolution.resolver = undefined
    }
  }

  /**
   * Persist one encoded upload and stage it under the Agent receiver selected by Typert.
   * @param agent - receiving Agent resolved from the Remote Agent scope.
   * @param request - canonical base64 bytes and optional display name.
   * @param signal - caller cancellation before storage begins.
   * @returns the staged receipt and durable file reference.
   */
  async uploadRemote(agent: Agent, request: EncodedFileUploadRequest, signal: AbortSignal): Promise<FileUploadValue> {
    try { return await this.upload(agent, request, signal) }
    catch (error) {
      if (error instanceof FileUploadError) throw new TypertLookupFailure({code:error.code,message:error.message,details:error.data})
      throw error
    }
  }

  @Remote('upload')
  upload(agent: Agent, request: EncodedFileUploadRequest, signal: AbortSignal): Promise<FileUploadValue> {
    signal.throwIfAborted()
    return this.commit(agent, async () => this.storage.admitEncodedFile({
      data: request.data,
      ...(request.name === undefined ? {} : { name: request.name }),
    }))
  }

  /**
   * Persist raw chunks for one Session without aggregating the upload.
   * @param request - Session identity, ordered bytes, cancellation, and optional display name.
   * @returns the staged receipt and durable file reference.
   */
  async uploadStream(request: {
    readonly sessionId: SessionId
    readonly data: AsyncIterable<Uint8Array>
    readonly signal?: AbortSignal
    readonly name?: string
  }): Promise<FileUploadValue> {
    const agent = await this.resolveAgent(request.sessionId)
    return this.commit(agent, async () => this.storage.saveFileStream({
      data: request.data,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      ...(request.name === undefined ? {} : { name: request.name }),
    }))
  }

  /**
   * Resolve one staged receipt inside its receiving Agent scope.
   * @param agent - receiving Agent.
   * @param receiptId - opaque receipt minted for one completed upload.
   * @returns durable file reference, or `undefined` for an unknown or foreign receipt.
   */
  resolve(agent: Agent, receiptId: FileUploadReceiptId): FileAttachmentRef | undefined {
    this.assertAgentScope(agent)
    return this.stagedFiles.get(agent.session)?.get(receiptId)?.file
  }

  /**
   * Bind receipts while one prompt enters an Agent inbox.
   * Disposal restores every prior binding unless the caller commits successful delivery.
   * @param agent - receiving Agent.
   * @param receiptIds - distinct staged receipts referenced by the prompt.
   * @param requestId - prompt identity later observed in queue or history.
   * @returns binding kept after commit until queue or history observation retires its receipts.
   */
  bindPrompt(
    agent: Agent,
    receiptIds: readonly FileUploadReceiptId[],
    requestId: string,
  ): PromptFileBinding {
    this.assertAgentScope(agent)
    const staged = this.stagedFiles.get(agent.session)
    const bound = receiptIds.map((receiptId) => {
      const upload = staged?.get(receiptId)
      if (upload === undefined) throw fileNotStaged()
      return { upload, previous: upload.requestId }
    })
    for (const { upload } of bound) upload.requestId = requestId
    return new PromptFileBindingGuard(() => {
      for (const { upload, previous } of bound) {
        if (previous === undefined) delete upload.requestId
        else upload.requestId = previous
      }
    })
  }

  /**
   * Retire every receipt accepted by one removed queue occurrence.
   * @param agent - receiving Agent.
   * @param requestId - prompt identity carried by the queue occurrence.
   */
  retirePrompt(agent: Agent, requestId: string): void {
    this.assertAgentScope(agent)
    this.retire(agent.session, requestId)
  }

  private async commit(agent: Agent, save: () => Promise<FileAttachmentRef>): Promise<FileUploadValue> {
    this.assertOrdinaryAgent(agent)
    let file: FileAttachmentRef
    try {
      file = await save()
    } catch (error) {
      if (this.storage.isAttachmentError(error)) {
        throw new FileUploadError('session/attachment-invalid', error.message, { reason: error.code })
      }
      throw new FileUploadError(
        'gateway/internal',
        `failed to store file upload: ${String(error)}`,
        {},
        { cause: error },
      )
    }
    if (this.ctx.agents.get(agent.id) !== agent) {
      throw new FileUploadError(
        'session/not-found',
        `session "${agent.id}" was disposed before its file upload completed`,
        { sessionId: agent.id },
      )
    }
    let staged = this.stagedFiles.get(agent.session)
    if (staged === undefined) {
      staged = new Map()
      this.stagedFiles.set(agent.session, staged)
    }
    const receiptId = randomUUID() as FileUploadReceiptId
    staged.set(receiptId, { file })
    return { receiptId, file }
  }

  private async resolveAgent(sessionId: SessionId): Promise<Agent> {
    const live = this.ctx.agents.get(sessionId)
    if (live !== undefined) return live
    const resolver = this.agentResolution.resolver
    if (resolver === undefined) {
      throw new FileUploadError('session/not-found', `session "${sessionId}" is not attached`, { sessionId })
    }
    return resolver(sessionId)
  }

  private assertAgentScope(agent: Agent): void {
    if (scopeOf(agent.ctx) !== agent) throw new Error('file-upload: operation requires the Agent\'s own scope')
  }

  private assertOrdinaryAgent(agent: Agent): void {
    this.assertAgentScope(agent)
    if (agent.session.header.origin === 'subagent') {
      throw new FileUploadError(
        'subagent/attachment-invalid',
        'subagent conversations do not accept file uploads',
        { reason: 'SUBAGENT_FILE_UNSUPPORTED' },
      )
    }
  }

  private observeSessionEvent(session: Session, event: SessionEvent): void {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user'
      || !('rpcId' in event.data.source)) return
    if (typeof event.data.source.rpcId === 'string') this.retire(session, event.data.source.rpcId)
  }

  private retire(session: Session, requestId: string): void {
    const staged = this.stagedFiles.get(session)
    if (staged === undefined) return
    for (const [receiptId, upload] of staged) {
      if (upload.requestId === requestId) staged.delete(receiptId)
    }
    if (staged.size === 0) this.stagedFiles.delete(session)
  }
}

function fileNotStaged(): FileUploadError {
  return new FileUploadError(
    'session/attachment-invalid',
    'File was not uploaded for this session.',
    { reason: 'FILE_NOT_STAGED' },
  )
}

export default FileUploads
