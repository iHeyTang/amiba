import type { ChatEngineClient, SubmitPayload, SubmitReceipt } from "@amiba/app-runtime/protocol";

/** Admission is independent of terminal stream events and legacy fire-and-forget. */
export function nativeSubmissionAdmission(client: Pick<ChatEngineClient, "submit" | "submitWithReceipt">, payload: SubmitPayload,
  callbacks: { accepted(): void; failed(message: string): void }) {
  let state: "pending" | "accepted" | "failed" | "legacy" = client.submitWithReceipt ? "pending" : "legacy";
  let notice: string | undefined;
  const settle = (receipt: SubmitReceipt) => {
    if (state !== "pending") return;
    if (receipt.kind === "accepted") { state = "accepted"; callbacks.accepted(); }
    else {
      state = "failed";
      notice = receipt.kind === "unconfirmed" ? `${receipt.error} Check the conversation before retrying.` : receipt.error;
      callbacks.failed(notice);
    }
  };
  return {
    get protectsQueue() { return state === "pending" || state === "failed"; },
    get notice() { return notice; },
    start() {
      if (!client.submitWithReceipt) { client.submit(payload); return; }
      let result: Promise<SubmitReceipt>;
      try { result = client.submitWithReceipt(payload); }
      catch (error) { settle({ kind: "unconfirmed", error: String(error) }); return; }
      void result.then(settle, error => settle({ kind: "unconfirmed", error: error instanceof Error ? error.message : String(error) }))
        .catch(error => console.warn("[native-submit] admission callback failed", error));
    },
  };
}
