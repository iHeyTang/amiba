import type {} from "@deepseek-ai/dsh-user-questions";
import { MEDIA_CONFIRM_QUESTION, CONFIRM_GENERATION, MediaReviewStopped, validEstimate, needsConfirmation, reviewParameters } from "./cost-policy.js";
import { resultUrl } from "./result-links.js";
import { mediaDelivery } from "./delivery.js";
import type { MediaPreferences } from "./preferences.js";
import { resolveMediaAssets } from "./assets.js";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { JobOutcome } from "@deepseek-ai/dsh-jobs";
import {
  MediaError,
  type MediaExecution,
  type MediaProvider,
  type MediaRequest,
} from "./contracts.js";
import { MediaRegistry } from "./registry.js";
import { MediaStore, type MediaRecord } from "./store.js";
import { persistArtifact } from "./artifacts.js";
declare module "@deepseek-ai/dsh-jobs" {
  interface JobKindMap {
    media: "media";
  }
}
export class MediaService extends MediaRegistry {
  private readonly reserving = new Set<string>();
  private readonly active = new Set<string>();
  constructor(
    private readonly ctx: Context,
    readonly store: MediaStore,
    readonly preferences?: MediaPreferences,
  ) {
    super();
  }
  isEnabled(provider: string, model: string) {
    return this.preferences?.isEnabled(provider, model) ?? true;
  }
  private assertEnabled(provider: string, model: string) {
    if (!this.isEnabled(provider, model))
      throw new MediaError(
        "INVALID_REQUEST",
        "Media model is disabled by the user",
      );
  }
  override async validate(
    provider: MediaProvider,
    request: MediaRequest,
    signal: AbortSignal,
  ) {
    this.assertEnabled(provider.id, request.model);
    await super.validate(provider, request, signal);
    this.assertEnabled(provider.id, request.model);
  }
  async describe(provider: string, signal?: AbortSignal) {
    const { inventory: _inventory, ...description } =
      await this.get(provider).describe(signal);
    return {
      ...description,
      models: description.models.filter((model) =>
        this.isEnabled(provider, model.id),
      ),
    };
  }
  async generate(
    owner: Agent,
    providerId: string,
    request: MediaRequest,
    signal: AbortSignal,
  ) {
    const provider = this.get(providerId);
    await this.validate(provider, request, signal);
    request = {
      ...request,
      parameters: await resolveMediaAssets(
        this.store,
        owner.session.id,
        request.parameters,
      ),
    };
    request = await provider.prepare(request, signal);
    signal.throwIfAborted();
    const reservation = JSON.stringify([owner.session.id, request.operation]);
    if (this.reserving.has(reservation))
      throw new MediaError(
        "INVALID_REQUEST",
        "Another media submission is being prepared; do not submit in parallel",
      );
    this.reserving.add(reservation);
    try {
      const unresolved = (await this.store.list(owner.session.id)).find(
        (row) =>
          row.operation === request.operation &&
          !row.retryAuthorizedAt &&
          [
            "submitting",
            "queued",
            "running",
            "interrupted",
            "submission_unknown",
          ].includes(row.status),
      );
      if (unresolved)
        throw new MediaError(
          "INVALID_REQUEST",
          `A possibly paid media request already exists: ${unresolved.id} (${unresolved.status}). Inspect or resume this record; switching model, protocol or parameters must not create another charge. If recovery is impossible, the user can explicitly allow another generation in the original media tool details.`,
        );
      let estimate;
      try { estimate = validEstimate(await provider.estimate?.(structuredClone(request), AbortSignal.any([signal, AbortSignal.timeout(15000)]))); }
      catch { signal.throwIfAborted(); }
      if (needsConfirmation(request, estimate, this.preferences?.snapshot().confirmationThresholdCny ?? 1)) {
        const price = estimate ? `预计 ${estimate.minimum !== undefined && estimate.minimum !== estimate.maximum ? `${estimate.minimum}–` : ""}${estimate.maximum} ${estimate.currency}` : '费用未知';
        const answer = await this.ctx.userQuestions.ask({
          agent: owner, signal,
          questions: [{ id: MEDIA_CONFIRM_QUESTION, header: '确认生成',
            question: `${request.model} · ${price}。确认后将提交一次可能收费的生成请求。`,
            detail: JSON.stringify({ provider: providerId, model: request.model, operation: request.operation, price, parameters: reviewParameters(request.parameters) }),
            options: [{ label: CONFIRM_GENERATION }, { label: '调整参数' }, { label: '取消' }],
          }],
        }).catch(cause => {
          if (cause && typeof cause === 'object' && cause.code === 'ASK_CANCELLED') throw new MediaReviewStopped();
          throw cause;
        });
        const response = answer.answers.find(row => row.id === MEDIA_CONFIRM_QUESTION);
        if (!response || response.selected.length !== 1 || response.selected[0] !== CONFIRM_GENERATION || response.custom?.trim()) {
          throw new MediaReviewStopped(response?.custom?.trim() || (response?.selected.includes('调整参数') ? 'Ask the user what parameters to adjust.' : undefined));
        }
        signal.throwIfAborted();
        this.assertEnabled(providerId, request.model);
        if (estimate?.validUntil && estimate.validUntil <= Date.now()) throw new MediaError('INVALID_REQUEST', 'Quote expired during confirmation. No generation submitted; obtain a fresh estimate.');
      }
      const now = Date.now();
      const record: MediaRecord = {
        id: randomUUID(),
        sessionId: owner.session.id,
        provider: providerId,
        model: request.model,
        protocol: request.protocol,
        operation: request.operation,
        status: "submitting",
        generationStatus: "pending",
        createdAt: now,
        updatedAt: now,
        artifacts: [],
      };
      await this.store.write(record);
      return this.start(owner, provider, record, request);
    } finally {
      this.reserving.delete(reservation);
    }
  }
  async inspect(sessionId: string, id: string) {
    const record = await this.store.read(sessionId, id);
    if (
      !this.active.has(id) &&
      (["submitting", "queued", "running"].includes(record.status) || record.storageStatus === "saving")
    ) {
      record.status =
        record.task || (await this.store.stagedSources(record))
          ? "interrupted"
          : "submission_unknown";
      if (record.generationStatus === "succeeded") {
        record.storageStatus = "failed";
        record.storageError =
          "Local saving was interrupted; resume collection only.";
      }
      if (record.generationStatus === "succeeded") delete record.error;
      else
        record.error =
          "No active local execution. Resume saved results or remote queries; do not repeat generation automatically.";
    }
    return record;
  }
  async authorizeNewGeneration(sessionId: string, id: string) {
    if (this.active.has(id))
      throw new Error("Wait for the existing media job to stop");
    const record = await this.inspect(sessionId, id);
    if (!["interrupted", "submission_unknown"].includes(record.status))
      throw new Error("This record does not require retry authorization");
    record.retryAuthorizedAt = Date.now();
    await this.store.write(record);
    return record;
  }
  async resume(owner: Agent, id: string) {
    const record = await this.store.read(owner.session.id, id);
    if (
      record.status === "succeeded" ||
      record.status === "failed" ||
      record.status === "cancelled" ||
      record.status === "expired"
    )
      return { record };
    let staged = await this.store.stagedSources(record);
    if (
      !staged &&
      record.generationStatus === "succeeded" &&
      record.remoteArtifacts?.length === record.resultCount &&
      record.remoteArtifacts?.every((row, i) => row.index === i)
    ) {
      staged = record.remoteArtifacts.map(({ kind, url, mimeType }) => ({
        kind,
        url,
        mimeType,
      }));
      await this.store.stageSources(record, staged);
    }
    if (!record.task && !staged)
      throw new Error(
        "No remote task reference is available. Do not repeat generation automatically.",
      );
    const provider = staged ? undefined : this.get(record.provider);
    if (!staged && !provider?.queryTask)
      throw new Error("Provider cannot query this task");
    return this.start(owner, provider, record);
  }
  private start(
    owner: Agent,
    provider: MediaProvider | undefined,
    record: MediaRecord,
    request?: MediaRequest,
  ) {
    if (this.active.has(record.id))
      throw new Error("This media task is already being observed");
    const abort = new AbortController();
    this.active.add(record.id);
    try {
      const jobId = this.ctx.jobs.start({
        kind: "media",
        label: `${record.operation}: ${record.model}`,
        owner,
        run: () => ({
          cancel: () => abort.abort(),
          done: this.run(provider, record, abort.signal, request).finally(() =>
            this.active.delete(record.id),
          ),
        }),
      });
      return {
        record,
        jobId,
        instruction:
          "Use job_output for completion. media_describe with recordId inspects durable state; media_resume with recordId resumes querying only. Stopping the local job does not cancel remote generation.",
      };
    } catch (error) {
      this.active.delete(record.id);
      throw error;
    }
  }
  private async save(record: MediaRecord) {
    record.updatedAt = Date.now();
    await this.store.write(record);
  }
  private async run(
    provider: MediaProvider | undefined,
    record: MediaRecord,
    signal: AbortSignal,
    request?: MediaRequest,
  ): Promise<JobOutcome> {
    let receivedResult = false;
    try {
      if (request) this.assertEnabled(record.provider, request.model);
      const staged = request ? null : await this.store.stagedSources(record);
      let result: MediaExecution = staged
        ? { status: "succeeded", artifacts: staged }
        : request
          ? await provider!.generate(request, signal)
          : await provider!.queryTask!(record.task!, signal);
      const saveAccounting = async () => {
        if (result.accounting !== undefined) {
          record.accounting = { ...record.accounting, ...result.accounting };
          await this.save(record);
        }
      };
      await saveAccounting();
      receivedResult = true;
      while (result.status === "queued" || result.status === "running") {
        record.task = result.task;
        record.status = result.status;
        record.generationStatus =
          result.status === "running" ? "running" : "pending";
        await this.save(record);
        if (!provider?.queryTask)
          throw new Error(
            "Provider returned a task without a query implementation",
          );
        await delay(4000, undefined, { signal });
        // Query failures never restart generation; the durable reference remains resumable.
        result = await provider.queryTask(record.task, signal);
        await saveAccounting();
      }
      if (result.status !== "succeeded") {
        if (!("message" in result))
          throw new Error("Unexpected nonterminal media result");
        record.status = result.status;
        record.generationStatus = result.status;
        record.error = result.message;
        await this.save(record);
        return {
          status: "failed",
          detail: result.message,
          output: JSON.stringify(mediaDelivery(record)),
        };
      }
      record.generationStatus = "succeeded";
      record.storageStatus = "saving";
      delete record.storageError;
      record.resultCount = result.artifacts.length;
      record.remoteArtifacts = result.artifacts.flatMap((source, index) => {
        const url = resultUrl(source.url);
        return url
          ? [{ index, kind: source.kind, url, mimeType: source.mimeType }]
          : [];
      });
      await this.save(record);
      if (!result.artifacts.length)
        throw new Error("Provider returned no generated artifacts");
      if (result.warnings) record.warnings = result.warnings;
      if (!staged) await this.store.stageSources(record, result.artifacts);
      for (const source of result.artifacts.slice(record.artifacts.length)) {
        const artifact = await persistArtifact(
          this.store,
          record.sessionId,
          source,
          signal,
        );
        record.artifacts.push(artifact);
        await this.save(record);
      }
      record.status = "succeeded";
      record.storageStatus = "saved";
      delete record.storageError;
      delete record.error;
      await this.save(record);
      return {
        status: "completed",
        output: JSON.stringify(mediaDelivery(record)),
      };
    } catch (error) {
      if (record.generationStatus === "succeeded") {
        record.status = "interrupted";
        record.storageStatus = "failed";
        record.storageError = signal.aborted
          ? "Local saving stopped; upstream generation already succeeded."
          : error instanceof Error
            ? error.message
            : "Could not save generated media locally";
        delete record.error;
        await this.save(record);
        return {
          status: "completed",
          detail:
            "Generation succeeded; local saving failed. Deliver saved artifacts or upstream result links; resume collection only.",
          output: JSON.stringify(mediaDelivery(record)),
        };
      }
      record.generationStatus = "unknown";
      record.status =
        error instanceof MediaError && error.code === "SUBMISSION_UNKNOWN"
          ? "submission_unknown"
          : record.task ||
              signal.aborted ||
              (await this.store.stagedSources(record))
            ? "interrupted"
            : receivedResult
              ? "submission_unknown"
              : "failed";
      record.error = signal.aborted
        ? "Local observation stopped; remote generation may continue. Resume using the saved task reference."
        : error instanceof Error
          ? error.message
          : "Media execution failed";
      await this.save(record);
      return {
        status: signal.aborted ? "killed" : "failed",
        detail: record.error,
        output: JSON.stringify(mediaDelivery(record)),
      };
    }
  }
}
