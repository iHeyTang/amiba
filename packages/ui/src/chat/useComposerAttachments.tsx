import { composerAttachmentDraft } from "./composer-attachment-store"
import { deleteUnretainedAttachments, retainDraftAttachments } from "./internal/attachment-ownership"
import { getPlatform } from "@amiba/app-runtime/platform"
/**
 * Composer-attachment hook + `<AttachmentToolbar>` component.
 *
 * Owns the full per-composer attachment lifecycle so every surface
 * (`ChatSurface`, `HomeView`, the Quick-Ask Spotlight popup) shares
 * one implementation:
 *
 *   - State: live `attachments[]`, `attachmentUploading`, `attachmentBusy`,
 *     `attachmentError`.
 *   - Mutations: `addFiles` (stage via the host), `removeAttachment`
 *     (drop chip + best-effort delete on disk).
 *   - Pickers: `openFilePicker()` (native `showOpenFilePicker` with a
 *     hidden `<input type="file">` fallback) and a clipboard `handlePaste`
 *     for ⌘V-ing screenshots straight in.
 *
 * Callers wire the hidden file input via `fileInputProps` on their own
 * `<input>` and render `<AttachmentToolbar>` (or just the underlying
 * `<AttachmentButton>`) anywhere the add control should live.
 *
 * `getSessionId` is supplied by the caller because different surfaces
 * have different session models — composers without an active conversation
 * use a transient upload id, while an existing chat uses its real id. The
 * hook stays out of that decision.
 */
import {
  classify,
  deleteAttachmentFile,
  isAttachmentReadOk,
  readFileAsAttachment,
  type Attachment,
} from "@amiba/app-runtime/core"
import type { ComposerTriggerRuntime, ComposerDraftImageRegistration } from "./composer/triggers/contracts"
import type { ComposerAttachment } from "@amiba/extension-sdk"
import { useT } from "@amiba/i18n"
import { Button } from "../primitives"
import { cn } from "../primitives"
import { shortId } from "@amiba/app-runtime/utils"
import { Plus } from "lucide-react"
import {
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type RefObject,
  type SetStateAction,
} from "react"

/** Official uploads accept arbitrary files; format interpretation belongs to the Agent. */
export const ATTACHMENT_INPUT_ACCEPT = "*/*"

export interface UseComposerAttachmentsOptions {
  /** Stable owner shared by remounts; omitted for disposable composers. */
  draftScope?: object
  /** Reacquire ownership when Home becomes the prepared conversation. */
  draftKey?: string

  registerDraftImage?: ComposerTriggerRuntime["registerDraftImage"]
  /** Queue mirrors can still own the same Host staging file after a chip is removed. */
  isAttachmentRetained?: (attachmentId: string) => boolean

  /**
   * Resolve (or create) the session id the uploaded bytes should be
   * scoped under. Called once per `addFiles` invocation. Surfaces with
   * no active session (e.g. the home page) may return a synthetic id —
   * the attachment adapter uses it as a scoped folder name.
   */
  getSessionId: () => Promise<string> | string
}

export interface UseComposerAttachmentsResult {
  attachments: Attachment[]
  /** Browser-owned images only; never Host staging IDs. */
  draftImages?: readonly ComposerAttachment[]
  getDraftImages?(): readonly ComposerAttachment[]
  fileUploads?: import("@amiba/extension-sdk").ComposerAttachmentsOwner["uploads"]
  retryFileUpload?(id: string): void
  canAddDraftImages?(): boolean
  addDraftImages?(images: readonly ComposerDraftImageRegistration[]): void
  removeDraftImage?(id: ComposerAttachment["id"]): void
  pruneDraftImages?(ids: readonly ComposerAttachment["id"][]): void
  subscribeDraftImages?(listener: () => void): () => void
  setAttachments: Dispatch<SetStateAction<Attachment[]>>
  /** True while any chip is still uploading. */
  attachmentUploading: boolean
  /** True while `addFiles` is running. */
  attachmentBusy: boolean
  /**
   * Manual setter exposed for surfaces with ad-hoc upload paths
   * outside `addFiles` (e.g. extension learn-trace blob upload).
   * Prefer `addFiles` when possible.
   */
  setAttachmentBusy: Dispatch<SetStateAction<boolean>>
  /** Last non-recoverable error message (one per chip ingestion); null when clear. */
  attachmentError: string | null
  setAttachmentError: Dispatch<SetStateAction<string | null>>
  /** Returns true iff at least one ready attachment is queued for the next send. */
  hasReadyAttachment(): boolean
  addFiles(files: File[]): Promise<void>
  removeAttachment(uiId: string): void
  /** Drop ALL attachments (post-send / new chat). */
  clearAttachments(): void
  /** Open the native file picker (or fall back to the hidden input). */
  openFilePicker(): Promise<void>
  /** Wire onto the textarea's `onPaste` to capture pasted screenshots. */
  handlePaste(e: ClipboardEvent<HTMLTextAreaElement>): Promise<void>
  /**
   * True while a dragged-file payload is hovering the drop target. Use
   * for rendering the drag-over visual cue. Cleared on drop / leave.
   */
  dragOver: boolean
  /**
   * Spread onto the wrapper element you want to accept file drops. The
   * handlers gate on `dataTransfer.types.includes("Files")` so they
   * don't fight the textarea's text-paste path.
   */
  dropHandlers: {
    onDragOver: (e: ReactDragEvent<HTMLElement>) => void
    onDragLeave: (e: ReactDragEvent<HTMLElement>) => void
    onDrop: (e: ReactDragEvent<HTMLElement>) => void
  }
  /**
   * Spread onto a hidden `<input>` element the surface renders once.
   * Carries the ref the `openFilePicker` fallback clicks on.
   */
  fileInputProps: {
    ref: RefObject<HTMLInputElement>
    type: "file"
    multiple: true
    accept: string
    className: string
    onChange: (e: ChangeEvent<HTMLInputElement>) => void
  }
}

export function useComposerAttachments(
  opts: UseComposerAttachmentsOptions,
): UseComposerAttachmentsResult {
  const state = useMemo(() => composerAttachmentDraft(opts.draftScope), [opts.draftScope, opts.draftKey])
  const retentionRef = useMemo(() => ({ current: opts.isAttachmentRetained }), [state])
  retentionRef.current = opts.isAttachmentRetained
  const { attachments, busy: attachmentBusy, error: attachmentError } = useSyncExternalStore(state.subscribe, state.getSnapshot, state.getSnapshot)
  const { attachmentState, imageSnapshot, uploads, imageListeners, imageAttachmentIds, draftImages } = state
  const mounted = useMemo(() => ({ current: true }), [state])
  const retained = Boolean(opts.draftScope)
  const setAttachmentBusy = useCallback<Dispatch<SetStateAction<boolean>>>(update => {
    state.update({ busy: typeof update === "function" ? update(state.getSnapshot().busy) : update })
  }, [state])
  const setAttachmentError = useCallback<Dispatch<SetStateAction<string | null>>>(update => {
    state.update({ error: typeof update === "function" ? update(state.getSnapshot().error) : update })
  }, [state])
  // Keep imperative extension reads synchronous while React renders the same
  // attachment list. Functional updates run once against the latest value.
  const setAttachments = useCallback<Dispatch<SetStateAction<Attachment[]>>>(update => {
    const next = typeof update === "function" ? update(attachmentState.current) : update
    if (!mounted.current && !retained) return
    attachmentState.current = next
    retainDraftAttachments(state, next)
    for (const attachment of next) {
      const registration = draftImages.current.get(attachment.uiId)
      if (!registration || !attachment.attachmentId) continue
      const previousId = imageAttachmentIds.current.get(attachment.uiId)
      if (previousId && previousId !== attachment.attachmentId) {
        draftImages.current.delete(attachment.uiId)
        imageAttachmentIds.current.delete(attachment.uiId)
        registration.release()
      } else imageAttachmentIds.current.set(attachment.uiId, attachment.attachmentId)
    }
    const official = getPlatform().agentAttachments;
    const images = official?.drafts ? official.drafts(next.flatMap(a => a.attachmentId ? [a.attachmentId] : [])) : next.flatMap(a => {
      const registration = draftImages.current.get(a.uiId)
      return registration ? [registration.image] : []
    })
    const previous = imageSnapshot.current
    const changed = previous.length !== images.length || images.some((image, i) => image !== previous[i])
    if (changed) imageSnapshot.current = Object.freeze(images)
    const retainedIds = new Set(next.map(a => a.uiId))
    for (const [uiId, registration] of draftImages.current) {
      if (!retainedIds.has(uiId)) {
        draftImages.current.delete(uiId)
        imageAttachmentIds.current.delete(uiId)
        registration.release()
      }
    }
    state.update({ attachments: next })
    if (changed) for (const listener of imageListeners.current) listener()
  }, [state, mounted, retained])
  const getDraftImages = useCallback(() => {
    const adapter = getPlatform().agentAttachments;
    return adapter?.drafts ? adapter.drafts(attachmentState.current.flatMap(a => a.attachmentId ? [a.attachmentId] : [])) : imageSnapshot.current;
  }, [state])
  const [, refreshUploads] = useState(0)
  useEffect(() => getPlatform().agentAttachments?.subscribe?.(() => {
    refreshUploads(value => value + 1)
    for (const listener of imageListeners.current) listener()
  }), [state])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (retained) return
      attachmentState.current = []
      retainDraftAttachments(state, [])
      imageSnapshot.current = Object.freeze([])
      imageListeners.current.clear()
      for (const registration of draftImages.current.values()) registration.release()
      draftImages.current.clear()
      imageAttachmentIds.current.clear()
    }
  }, [state, mounted, retained])
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const fileUploads = getPlatform().agentAttachments?.uploadState?.() ?? {}
  const attachmentUploading = attachments.some(a => !!a.uploading || (a.attachmentId && fileUploads[a.attachmentId]?.status === "uploading"))

  const hasReadyAttachment = useCallback(
    () => attachments.some((a) => a.attachmentId && !a.uploading),
    [attachments],
  )

  const addFiles = useCallback(
    async (files: File[], supplied?: readonly ComposerDraftImageRegistration[]) => {
      if (files.length === 0) return
      uploads.current += 1
      setAttachmentBusy(true)
      setAttachmentError(null)
      const pendingUiIds: string[] = []
      const transferred = new Set<ComposerDraftImageRegistration>()
      try {
        let sessionId: string | undefined
        if (!supplied) {
          sessionId = await opts.getSessionId()
          if (!mounted.current && !retained) return
        }
        const errors: string[] = []
        const pending: Attachment[] = files.map((f, i) => {
          const carried = supplied?.[i]
          const official = carried && getPlatform().agentAttachments?.drafts?.([carried.image.id])[0]
          if (carried && official) {
            const uiId = shortId("att")
            draftImages.current.set(uiId, carried)
            transferred.add(carried)
            return { uiId, name: f.name || "file", mime: f.type, size: f.size,
              kind: classify(f.name || "file", f.type.toLowerCase()), attachmentId: official.id, uploading: false }
          }
          return {
          uiId: shortId("att"),
          name: f.name || "file",
          mime: f.type || "",
          size: f.size,
          kind: classify(f.name || "file", (f.type || "").toLowerCase()),
          uploading: true,
          }
        })
        pendingUiIds.push(...pending.map((p) => p.uiId))
        setAttachments((prev) => [...prev, ...pending])
        if (sessionId === undefined && pending.some(item => item.uploading)) sessionId = await opts.getSessionId()
        if (!mounted.current && !retained) return
        for (let i = 0; i < files.length; i += 1) {
          if (!pending[i].uploading) continue
          const f = files[i]
          const uiId = pending[i].uiId
          const r = await readFileAsAttachment(f, { sessionId: sessionId!, uiId })
          if (isAttachmentReadOk(r)) {
            setAttachments((prev) => {
              if (!prev.some((a) => a.uiId === uiId)) {
                // User removed the chip mid-upload — delete the file
                // that landed on disk anyway so we don't leak.
                if (r.attachment.attachmentId) void deleteAttachmentFile(r.attachment)
                return prev
              }
              return prev.map((a) => (a.uiId === uiId ? r.attachment : a))
            })
          } else {
            errors.push(`${r.name}: ${r.error}`)
            setAttachments((prev) => prev.filter((a) => a.uiId !== uiId))
          }
        }
        if (errors.length > 0) setAttachmentError(errors.join("\n"))
      } catch (e) {
        const msg = String((e as Error)?.message || e)
        setAttachmentError(`Attachment processing error: ${msg}`)
        setAttachments((prev) =>
          prev.filter((a) => !pendingUiIds.includes(a.uiId)),
        )
      } finally {
        for (const registration of supplied ?? []) {
          if (!transferred.has(registration)) registration.release()
        }
        uploads.current -= 1
        setAttachmentBusy(uploads.current > 0)
      }
    },
    [opts],
  )

  const removeAttachment = useCallback((uiId: string) => {
    const target = attachmentState.current.find(a => a.uiId === uiId)
    setAttachments(prev => prev.filter(a => a.uiId !== uiId))
    if (target?.attachmentId && !retentionRef.current?.(target.attachmentId)) deleteUnretainedAttachments([target], [])
  }, [state, setAttachments, retentionRef])

  const canAddDraftImages = useCallback(() => mounted.current && uploads.current === 0, [state, mounted])
  const addDraftImages = useCallback((images: readonly ComposerDraftImageRegistration[]) => {
    void addFiles(images.map(image => image.image.file), images)
  }, [addFiles])
  const removeDraftImage = useCallback((id: ComposerAttachment["id"]) => {
    for (const item of attachmentState.current) {
      if (item.attachmentId === id) removeAttachment(item.uiId)
    }
  }, [state, removeAttachment])
  const pruneDraftImages = useCallback((ids: readonly ComposerAttachment["id"][]) => {
    const available = new Set(ids)
    for (const item of attachmentState.current) {
      if (item.attachmentId && !available.has(item.attachmentId as ComposerAttachment["id"])) removeAttachment(item.uiId)
    }
  }, [state, removeAttachment])
  const subscribeDraftImages = useCallback((listener: () => void) => {
    imageListeners.current.add(listener)
    let active = true
    return () => {
      if (!active) return
      active = false
      imageListeners.current.delete(listener)
    }
  }, [state])

  const clearAttachments = useCallback(() => {
    const previous = attachmentState.current
    setAttachments([])
    deleteUnretainedAttachments(previous.filter(a => !a.attachmentId || !retentionRef.current?.(a.attachmentId)), [])
  }, [state, setAttachments, retentionRef])

  const openFilePicker = useCallback(async () => {
    type WithPicker = Window & {
      showOpenFilePicker?: (opts?: {
        multiple?: boolean
      }) => Promise<FileSystemFileHandle[]>
    }
    const w = window as WithPicker
    if (typeof w.showOpenFilePicker === "function") {
      try {
        const handles = await w.showOpenFilePicker({ multiple: true })
        if (handles.length === 0) return
        const files = await Promise.all(handles.map((h) => h.getFile()))
        if (files.length > 0) void addFiles(files)
        return
      } catch (e) {
        if ((e as DOMException)?.name === "AbortError") return
        console.warn(
          "[composer] showOpenFilePicker failed; using hidden-input fallback:",
          e,
        )
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
      fileInputRef.current.click()
    }
  }, [addFiles])

  const handlePaste = useCallback(
    async (e: ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items
      if (!items || items.length === 0) return
      const files: File[] = []
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i]
        if (it.kind === "file") {
          const f = it.getAsFile()
          if (f) files.push(f)
        }
      }
      if (files.length === 0) return
      e.preventDefault()
      await addFiles(files)
    },
    [addFiles],
  )

  const onChangeFileInput = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files
      if (!list || list.length === 0) return
      void addFiles(Array.from(list))
    },
    [addFiles],
  )

  // Drag-and-drop handlers. We gate every step on
  // `dataTransfer.types.includes("Files")` so a stray text-drag from
  // the same window (selection text, image-as-url) doesn't trigger the
  // overlay. `onDragLeave` uses `currentTarget.contains(relatedTarget)`
  // to suppress the cancel-on-bubble that fires when the cursor moves
  // between children — without it the overlay flickers off and on
  // continuously while the user is still over the drop zone.
  const hasFilePayload = (e: ReactDragEvent<HTMLElement>): boolean =>
    !!e.dataTransfer &&
    Array.from(e.dataTransfer.types || []).includes("Files")

  const onDragOver = useCallback((e: ReactDragEvent<HTMLElement>) => {
    if (!hasFilePayload(e)) return
    e.preventDefault()
    setDragOver((prev) => (prev ? prev : true))
  }, [])

  const onDragLeave = useCallback((e: ReactDragEvent<HTMLElement>) => {
    if (
      e.currentTarget.contains(e.relatedTarget as Node | null)
    ) {
      return
    }
    setDragOver(false)
  }, [])

  const onDrop = useCallback(
    (e: ReactDragEvent<HTMLElement>) => {
      if (!hasFilePayload(e)) return
      e.preventDefault()
      setDragOver(false)
      const files = Array.from(e.dataTransfer.files || [])
      if (files.length > 0) void addFiles(files)
    },
    [addFiles],
  )

  return {
    attachments,
    draftImages: getDraftImages(),
    fileUploads,
    retryFileUpload: id => getPlatform().agentAttachments?.retry?.(id),
    getDraftImages,
    canAddDraftImages,
    addDraftImages,
    removeDraftImage,
    pruneDraftImages,
    subscribeDraftImages,
    setAttachments,
    attachmentUploading,
    attachmentBusy,
    setAttachmentBusy,
    attachmentError,
    setAttachmentError,
    hasReadyAttachment,
    addFiles,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    handlePaste,
    dragOver,
    dropHandlers: {
      onDragOver,
      onDragLeave,
      onDrop,
    },
    fileInputProps: {
      ref: fileInputRef,
      type: "file",
      multiple: true,
      accept: ATTACHMENT_INPUT_ACCEPT,
      className: "hidden",
      onChange: onChangeFileInput,
    },
  }
}

/**
 * Quiet "attach files" control shared by every composer surface.
 */
export interface AttachmentButtonProps {
  onClick: () => void | Promise<void>
  /** Spinner / disabled visual while an upload is in flight. */
  disabled?: boolean
  /** Translated tooltip; falls back to a plain English label. */
  title?: string
  className?: string
}

export function AttachmentButton({
  onClick,
  disabled = false,
  title,
  className,
}: AttachmentButtonProps) {
  const { t } = useT()
  const label = title ?? t("sidepanel.attach")
  return (
    <Button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => void onClick()}
      disabled={disabled}
      title={label}
      aria-label={label}
      variant="ghost"
      size="icon"
      className={cn(
        "h-7 w-7 shrink-0 rounded-full bg-transparent text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground",
        disabled &&
          "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
        className,
      )}
    >
      <Plus className="h-4 w-4" strokeWidth={1.8} />
    </Button>
  )
}
