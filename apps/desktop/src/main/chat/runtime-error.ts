import type { ChatRuntimeError } from "@amiba/core";

type ErrorLike = {
  message?: unknown;
  status?: unknown;
  hint?: unknown;
};

/** Convert arbitrary thrown values into Electron structured-clone-safe data. */
export function toChatRuntimeError(err: unknown): ChatRuntimeError {
  const candidate =
    (typeof err === "object" && err !== null) || typeof err === "function"
      ? (err as ErrorLike)
      : undefined;
  const message =
    typeof candidate?.message === "string" && candidate.message.trim()
      ? candidate.message
      : String(err);
  const status =
    typeof candidate?.status === "number" && Number.isFinite(candidate.status)
      ? candidate.status
      : undefined;

  let hint: string | undefined;
  if (typeof candidate?.hint === "string") {
    hint = candidate.hint;
  } else if (typeof candidate?.hint === "function") {
    try {
      const value = candidate.hint.call(err);
      if (typeof value === "string") hint = value;
    } catch {
      // A broken optional hint must never hide the primary error.
    }
  }

  return {
    message,
    ...(status === undefined ? {} : { status }),
    ...(hint ? { hint } : {}),
  };
}
