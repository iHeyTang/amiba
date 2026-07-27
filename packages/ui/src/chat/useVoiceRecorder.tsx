/* eslint-disable react-refresh/only-export-components */

/**
 * Push-and-toggle voice recorder hook for the Composer.
 *
 * Click once to start (allocates MediaRecorder + requests mic
 * permission), click again to stop. `stop()` resolves with the recorded
 * Blob, ready to be POSTed to `transcribeAudio` from `@amiba/core`.
 *
 * The hook intentionally keeps the captured stream alive only for the
 * duration of a recording — tracks are stopped on `stop()` / unmount so
 * the OS mic indicator turns off as soon as the user finishes speaking.
 *
 * Browser support: MediaRecorder is available in Electron's Chromium
 * unconditionally; `audio/webm;codecs=opus` is the default container
 * because it's small, well-supported by every STT provider we ship, and
 * gives ffmpeg/faster-whisper a stable demux path on the server side.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import { useT } from "@amiba/i18n"
import { Button } from "../primitives"
import { cn } from "../primitives"
import { Loader2, Mic } from "lucide-react"

const DEFAULT_MIME = "audio/webm;codecs=opus"

function pickMimeType(preferred?: string): string {
  // MediaRecorder may not advertise `isTypeSupported` in some shells
  // (older Electron, jest jsdom). Treat absence as "trust the default".
  if (typeof MediaRecorder === "undefined") return DEFAULT_MIME
  if (
    typeof MediaRecorder.isTypeSupported === "function" &&
    preferred &&
    MediaRecorder.isTypeSupported(preferred)
  ) {
    return preferred
  }
  if (
    typeof MediaRecorder.isTypeSupported === "function" &&
    MediaRecorder.isTypeSupported(DEFAULT_MIME)
  ) {
    return DEFAULT_MIME
  }
  return ""
}

export interface UseVoiceRecorderOptions {
  /** Override the device id (from `navigator.mediaDevices.enumerateDevices`). */
  deviceId?: string
  /** Override the container/codec. Defaults to `audio/webm;codecs=opus`. */
  mimeType?: string
  /** Hard ceiling on a single recording, in milliseconds. Default 120 s. */
  maxDurationMs?: number
}

export interface VoiceRecorder {
  recording: boolean
  /** Last error from `start()` or `stop()`. Cleared when `start()` succeeds. */
  error: string | null
  /** Begin recording. Resolves once the stream is open. */
  start: () => Promise<void>
  /** Stop and return the recorded blob. Rejects if not currently recording. */
  stop: () => Promise<Blob>
  /** Cancel without producing a blob (no transcription). */
  cancel: () => void
}

export function useVoiceRecorder(
  opts: UseVoiceRecorderOptions = {},
): VoiceRecorder {
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const stopResolveRef = useRef<((blob: Blob) => void) | null>(null)
  const stopRejectRef = useRef<((err: Error) => void) | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const teardown = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    const stream = streamRef.current
    streamRef.current = null
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop()
        } catch {
          /* swallow — the track is going away regardless */
        }
      }
    }
    recorderRef.current = null
    chunksRef.current = []
  }, [])

  const start = useCallback(async () => {
    if (recorderRef.current) return // already recording — no-op
    setError(null)
    try {
      const constraints: MediaStreamConstraints = {
        audio: opts.deviceId
          ? { deviceId: { exact: opts.deviceId } }
          : true,
        video: false,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const mimeType = pickMimeType(opts.mimeType)
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream)
      recorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.onerror = (e) => {
        const err = (e as unknown as { error?: DOMException }).error
        const message = err?.message || "MediaRecorder error"
        setError(message)
        if (stopRejectRef.current) {
          stopRejectRef.current(new Error(message))
          stopRejectRef.current = null
          stopResolveRef.current = null
        }
        setRecording(false)
        teardown()
      }
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        })
        const resolve = stopResolveRef.current
        stopResolveRef.current = null
        stopRejectRef.current = null
        teardown()
        setRecording(false)
        if (resolve) resolve(blob)
      }

      recorder.start()
      setRecording(true)

      // Hard cap so a forgotten recording can't run indefinitely.
      const maxMs = opts.maxDurationMs ?? 120_000
      timeoutRef.current = setTimeout(() => {
        if (recorderRef.current && recorderRef.current.state === "recording") {
          recorderRef.current.stop()
        }
      }, maxMs)
    } catch (e) {
      teardown()
      const msg = String((e as Error)?.message || e)
      setError(msg)
      setRecording(false)
      throw new Error(msg)
    }
  }, [opts.deviceId, opts.mimeType, opts.maxDurationMs, teardown])

  const stop = useCallback((): Promise<Blob> => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state !== "recording") {
      return Promise.reject(new Error("not recording"))
    }
    return new Promise<Blob>((resolve, reject) => {
      stopResolveRef.current = resolve
      stopRejectRef.current = reject
      try {
        recorder.stop()
      } catch (e) {
        stopResolveRef.current = null
        stopRejectRef.current = null
        teardown()
        setRecording(false)
        reject(new Error(String((e as Error)?.message || e)))
      }
    })
  }, [teardown])

  const cancel = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === "recording") {
      // Discard onstop handler's resolution — we throw away the blob.
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        /* swallow */
      }
    }
    stopResolveRef.current = null
    stopRejectRef.current = null
    teardown()
    setRecording(false)
  }, [teardown])

  // Make sure a navigated-away mic doesn't keep the OS indicator on.
  useEffect(() => {
    return () => {
      cancel()
    }
  }, [cancel])

  return { recording, error, start, stop, cancel }
}

/**
 * Microphone button rendered in the Composer's bottom action row. Sits
 * directly to the left of the send button — STT is an input-source for
 * the textarea, conceptually next to "submit", not next to attachments.
 *
 * Two visual states:
 *   - idle      → bare Mic glyph; a quiet surface appears only on hover.
 *   - recording → Mic glyph kept (semantic continuity) over a green
 *                 "breathing" pulse — soft 2.5s ease-in-out opacity
 *                 cycle, no flashing. Click still toggles stop; the icon
 *                 just doesn't morph into a stop square (the old red
 *                 square read as "warning / error" rather than "live").
 */
export interface MicrophoneButtonProps {
  recording: boolean
  /**
   * Audio capture has stopped and we're waiting for the transcript to
   * come back. Renders a spinner in place of the mic glyph (clicks are
   * implicitly suppressed — STT round-trips are short enough that letting
   * the user cancel would just race the success path).
   */
  transcribing?: boolean
  /** Click handler. Receives no args — caller drives start/stop. */
  onClick: () => void
  /** Force-disable independent of `transcribing` (e.g. unavailable mic). */
  disabled?: boolean
  /** Tooltip override (idle state). */
  title?: string
  /** Tooltip override (recording state). */
  recordingTitle?: string
  className?: string
}

export function MicrophoneButton({
  recording,
  transcribing = false,
  onClick,
  disabled = false,
  title,
  recordingTitle,
  className,
}: MicrophoneButtonProps) {
  const { t } = useT()
  const idleLabel = title ?? t("composer.voice.startRecording")
  const stopLabel = recordingTitle ?? t("composer.voice.stopRecording")
  const transcribingLabel = t("composer.voice.transcribing")
  const label = transcribing
    ? transcribingLabel
    : recording
      ? stopLabel
      : idleLabel
  // ``transcribing`` is a passive wait — disabling the button avoids a
  // click during the STT round-trip racing with the success path.
  const effectivelyDisabled = disabled || transcribing
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={effectivelyDisabled}
      title={label}
      aria-label={label}
      aria-pressed={recording}
      aria-busy={transcribing}
      variant="ghost"
      size="icon"
      className={cn(
        "h-7 w-7 shrink-0 rounded-full bg-transparent text-muted-foreground/80 hover:bg-muted/60 hover:text-foreground",
        recording
          ? // Breathing green: slower than Tailwind's stock `animate-pulse`
            // (2.5s vs 2s) and combined with a tinted bg so the active
            // state reads as a steady "live" light, not a frantic blink.
            "animate-pulse bg-emerald-500/10 text-emerald-600 [animation-duration:2500ms] hover:bg-emerald-500/15 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
          : transcribing
            ? // Same emerald palette as recording so the recording →
              // transcribing → done transition reads as one continuous
              // flow, just dialled down because waiting isn't an action.
              // Cursor-wait reinforces.
              "cursor-wait bg-emerald-500/5 text-emerald-600 hover:bg-emerald-500/5 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-400"
            : "",
        // ``transcribing`` already applies its own (non-muted) styling
        // above; only the bare ``disabled`` case needs the muted look.
        disabled &&
          !transcribing &&
          "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground",
        className,
      )}
    >
      {transcribing ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Mic className="h-3.5 w-3.5" />
      )}
    </Button>
  )
}
