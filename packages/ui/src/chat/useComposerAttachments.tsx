/**
 * Composer-attachment hook + `<AttachmentToolbar>` component.
 *
 * Owns the full per-composer attachment lifecycle so every surface
 * (`ChatSurface`, `HomeView`, the Quick-Ask Spotlight popup) shares
 * one implementation:
 *
 *   - State: live `attachments[]`, `attachmentUploading`, `attachmentBusy`,
 *     `attachmentError`.
 *   - Mutations: `addFiles` (upload via backplane), `removeAttachment`
 *     (drop chip + best-effort delete on disk).
 *   - Pickers: `openFilePicker()` (native `showOpenFilePicker` with a
 *     hidden `<input type="file">` fallback) and a clipboard `handlePaste`
 *     for ⌘V-ing screenshots straight in.
 *
 * Callers wire the hidden file input via `fileInputProps` on their own
 * `<input>` and render `<AttachmentToolbar>` (or just the underlying
 * `<AttachmentButton>`) anywhere the paperclip should live.
 *
 * `getSessionId` is supplied by the caller because different surfaces
 * have different session models — main panel uses `sessions.ensureActive`,
 * the home page invents a transient id, the Quick-Ask popup uses its
 * own ephemeral session. The hook stays out of that decision.
 */
import {
  classify,
  deleteAttachmentFile,
  isAttachmentReadOk,
  readFileAsAttachment,
  type Attachment,
} from "@amiba/core"
import { useT } from "@amiba/i18n"
import { Button } from "../primitives"
import { cn } from "../primitives"
import { shortId } from "@amiba/utils"
import { Paperclip } from "lucide-react"
import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type RefObject,
  type SetStateAction,
} from "react"

/**
 * Stable input `accept` list. Mirrors the ChatSurface original so we
 * keep the same file-type acceptance across surfaces. Empty string is
 * also valid (Chromium accepts any file then), but the list nudges
 * users toward formats the agent's tools actually read.
 */
export const ATTACHMENT_INPUT_ACCEPT =
  "image/*,application/pdf,text/*,.md,.csv,.json,.yaml,.yml,.toml,.xml,.html,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.cpp,.h,.hpp,.cs,.swift,.kt,.scala,.sql,.sh,.zsh,.bash,.fish,.dockerfile,.env"

export interface UseComposerAttachmentsOptions {
  /**
   * Resolve (or create) the session id the uploaded bytes should be
   * scoped under. Called once per `addFiles` invocation. Surfaces with
   * no active session (e.g. the home page) may return a synthetic id —
   * the backplane just uses it as a folder name.
   */
  getSessionId: () => Promise<string> | string
}

export interface UseComposerAttachmentsResult {
  attachments: Attachment[]
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
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachmentBusy, setAttachmentBusy] = useState(false)
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const attachmentUploading = attachments.some((a) => !!a.uploading)

  const hasReadyAttachment = useCallback(
    () => attachments.some((a) => a.path && !a.uploading),
    [attachments],
  )

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setAttachmentBusy(true)
      setAttachmentError(null)
      const pendingUiIds: string[] = []
      try {
        const sessionId = await opts.getSessionId()
        const errors: string[] = []
        const pending: Attachment[] = files.map((f) => ({
          uiId: shortId("att"),
          name: f.name || "file",
          mime: f.type || "",
          size: f.size,
          kind: classify(f.name || "file", (f.type || "").toLowerCase()),
          uploading: true,
        }))
        pendingUiIds.push(...pending.map((p) => p.uiId))
        setAttachments((prev) => [...prev, ...pending])
        for (let i = 0; i < files.length; i += 1) {
          const f = files[i]
          const uiId = pending[i].uiId
          const r = await readFileAsAttachment(f, { sessionId, uiId })
          if (isAttachmentReadOk(r)) {
            setAttachments((prev) => {
              if (!prev.some((a) => a.uiId === uiId)) {
                // User removed the chip mid-upload — delete the file
                // that landed on disk anyway so we don't leak.
                if (r.attachment.path) void deleteAttachmentFile(r.attachment)
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
        setAttachmentBusy(false)
      }
    },
    [opts],
  )

  const removeAttachment = useCallback((uiId: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.uiId === uiId)
      if (target?.path) void deleteAttachmentFile(target)
      return prev.filter((a) => a.uiId !== uiId)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((prev) => {
      for (const a of prev) {
        if (a.path) void deleteAttachmentFile(a)
      }
      return []
    })
  }, [])

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
 * Paperclip "attach files" button. Style + size match the
 * ChatSurface original so all three surfaces look identical.
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
      onClick={() => void onClick()}
      disabled={disabled}
      title={label}
      aria-label={label}
      variant="ghost"
      size="icon"
      className={cn(
        "h-6 w-6 shrink-0 rounded-full border border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        disabled &&
          "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
        className,
      )}
    >
      <Paperclip className="h-3 w-3" />
    </Button>
  )
}
