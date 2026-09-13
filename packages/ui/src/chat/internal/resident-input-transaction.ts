import type { Attachment } from "@amiba/app-runtime/core";
import type { SubmitReceipt } from "@amiba/app-runtime/protocol";
import type { ComposerDraftSource } from "../composer-draft-store";
import type { ComposerDraftImageRegistration, ComposerTriggerController, ResidentInputSubmissionState, ResidentTurnRequest, SubmitOutcome, CommandClaim } from "../composer/triggers/contracts";
import { CommandClaimStore, argsAfter } from "../composer/triggers/claim";
import { commandImages } from "../composer/command-attachments";
import { expandMentionPartsAsync } from "../composer/expandMentions";
import type { TriggerProvider } from "../composer/providers/types";

export interface ResidentInputTransactionDeps {
  sessionId: string;
  source: Pick<ComposerDraftSource, "getDocument" | "setDisplayText" | "readInputDraft">;
  claims: CommandClaimStore;
  available(): boolean;
  controller(): ComposerTriggerController | undefined;
  providers(): TriggerProvider[];
  images(): readonly ComposerDraftImageRegistration[];
  prepare(images: readonly ComposerDraftImageRegistration[], signal: AbortSignal): Promise<{ attachments: readonly Attachment[]; release(): void }>;
  consume(images: readonly ComposerDraftImageRegistration[]): void;
  send(request: ResidentTurnRequest): Promise<SubmitReceipt>;
  submitClaim(claim: CommandClaim, args: string, images: Parameters<CommandClaim["submit"]>[2]): Promise<SubmitOutcome>;
  changed(): void;
}

/** Uses the native document, codecs and claims; never reparses visible reference labels. */
export function createResidentInputTransaction(deps: ResidentInputTransactionDeps) {
  let state: ResidentInputSubmissionState = Object.freeze({ pending: false, notice: null });
  let attempt: { controller: AbortController; dispatched: boolean; document: ReturnType<ComposerDraftSource["getDocument"]> } | undefined;
  const publish = (pending: boolean, notice: string | null) => {
    if (state.pending === pending && state.notice === notice) return;
    state = Object.freeze({ pending, notice }); deps.changed();
  };
  return {
    getSnapshot: () => state,
    clearNotice() { publish(state.pending, null); },
    draftChanged() {
      deps.claims.watch(deps.source.readInputDraft().draft);
      if (attempt && !attempt.dispatched && deps.source.getDocument() !== attempt.document) attempt.controller.abort();
      if (!attempt) publish(false, null);
    },
    cancel() { if (attempt && !attempt.dispatched) attempt.controller.abort(); },
    submit(): boolean {
      if (attempt || !deps.available()) return false;
      const document = deps.source.getDocument();
      const draft = deps.source.readInputDraft().draft;
      const images = [...deps.images()];
      if (!draft.trim() && !images.length) return false;
      const current = { controller: new AbortController(), dispatched: false, document };
      attempt = current;
      const signal = current.controller.signal;
      const check = () => {
        signal.throwIfAborted();
        if (!deps.available() || deps.source.getDocument() !== document) throw new DOMException("Input changed before submission", "AbortError");
      };
      const consume = () => {
        if (deps.source.getDocument() === document) { deps.claims.release(); deps.source.setDisplayText(""); }
        deps.consume(images);
      };
      publish(true, null);
      deps.claims.setAttemptPhase("adjudicating");
      void (async () => {
        let prepared: Awaited<ReturnType<ResidentInputTransactionDeps["prepare"]>> | undefined;
        try {
          const claim = deps.claims.get();
          if (claim) {
            deps.claims.setAttemptPhase("submitting");
            prepared = await deps.prepare(images, signal);
            const bytes = await commandImages(claim, prepared.attachments);
            check(); current.dispatched = true;
            const result = await deps.submitClaim(claim, argsAfter(draft, claim.token), bytes);
            if (result.kind === "success") consume();
            publish(true, result.text ?? (result.kind === "success" ? null : "Command failed."));
            return;
          }
          const controller = deps.controller();
          if (draft.trim().startsWith("/")) {
            if (!controller) throw new Error("The command runtime is unavailable.");
            const result = await controller.adjudicate(draft.trim(), signal, { images: images.length });
            check();
            if (result !== undefined) {
              if (result !== "handled" && "claim" in result) deps.claims.begin(result.claim);
              return;
            }
          }
          const resolver = controller ?? { serializeReference: async () => { throw new Error("The reference runtime is unavailable."); } };
          const text = await expandMentionPartsAsync(document.parts, deps.providers(), resolver, signal);
          check();
          prepared = await deps.prepare(images, signal);
          check();
          deps.claims.setAttemptPhase("submitting");
          const result = await deps.send({ sessionId: deps.sessionId, text, attachments: prepared.attachments, signal, onDispatch: () => { current.dispatched = true; } });
          if (result.kind === "accepted") {
            if (result.command?.kind !== "error") consume();
            publish(true, result.command?.text ?? null);
          } else publish(true, result.kind === "unconfirmed" ? `Submission was not confirmed. Check the conversation before retrying. ${result.error}` : result.error);
        } catch (error) {
          if (!(error instanceof Error && error.name === "AbortError")) publish(true, error instanceof Error ? error.message : String(error));
        } finally {
          prepared?.release();
          attempt = undefined;
          deps.claims.setAttemptPhase(null);
          publish(false, state.notice);
        }
      })();
      return true;
    },
  };
}
