import type { MediaRecord } from "./store.js";

/** Stable references keep file bytes out of model context and survive chat reloads. */
export function mediaDelivery(record: MediaRecord) {
  return {
    ...record,
    recovery: {
      phase:
        record.generationStatus === "succeeded" &&
        record.storageStatus !== "saved"
          ? "local_saving_incomplete"
          : record.artifacts.length
            ? "artifact_saved"
            : record.status === "interrupted"
              ? "collection_interrupted"
              : record.status,
      mayHaveCharged: true, // Conservative: a local failure is not billing evidence.
      action: ["interrupted", "queued", "running"].includes(record.status)
        ? "media_resume with recordId (collection only, never resubmit)"
        : record.status === "submission_unknown"
          ? "Resolve the existing submission; do not create a new generation"
          : "inspect",
    },
    ...(record.generationStatus === "succeeded" ||
    (record.status === "succeeded" && record.artifacts.length)
      ? {
          delivery: {
            markdown:
              "```amiba-media\n" +
              JSON.stringify({
                sessionId: record.sessionId,
                recordId: record.id,
              }) +
              "\n```",
            instruction:
              "Include this exact markdown block in your final answer to display the generated media inline. Images open a lightbox; audio and video have inline players. If generationStatus is succeeded, generation has succeeded even when storageStatus is failed. Include this block to deliver saved artifacts and available upstream links; explicitly mention incomplete local saving. Remote links may expire. Use media_resume to retry collection only; never regenerate to fix saving. Do not open a browser/sidebar just for delivery.",
          },
        }
      : {}),
  };
}
