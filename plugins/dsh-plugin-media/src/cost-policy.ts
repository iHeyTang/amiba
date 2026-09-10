import type { MediaEstimate, MediaRequest } from './contracts.js';
export const MEDIA_CONFIRM_QUESTION = 'amiba.media.confirm';
export const CONFIRM_GENERATION = '确认生成';
/** Only provider quotes count as money; never infer prices from model names. */
export function validEstimate(value?: MediaEstimate): MediaEstimate | undefined {
  if (!value || !Number.isFinite(value.maximum) || value.maximum < 0 || !/^[A-Z]{3}$/.test(value.currency) || !value.source?.trim()) return undefined;
  if (value.minimum !== undefined && (!Number.isFinite(value.minimum) || value.minimum < 0 || value.minimum > value.maximum)) return undefined;
  if (value.validUntil !== undefined && (!Number.isFinite(value.validUntil) || value.validUntil <= Date.now())) return undefined;
  return value;
}
export function needsConfirmation(request: MediaRequest, estimate: MediaEstimate | undefined, thresholdCny = 1) {
  if (!Number.isFinite(thresholdCny) || thresholdCny <= 0 || thresholdCny > 1000) thresholdCny = 1;
  if (estimate) return estimate.currency !== 'CNY' || estimate.maximum >= thresholdCny;
  const p = request.parameters;
  const nested = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const count = Math.max(Number(p.n ?? 1), Number(p.num_images ?? 1), Number(nested(p.sequential_image_generation_options).max_images ?? 1));
  const text = String(p.text ?? nested(p.req_params).text ?? '');
  return request.operation === 'video.generate' || request.operation === 'audio.generate'
    || (request.operation === 'image.generate' && (count > 1 || p.sequential_image_generation === 'auto' || p.size === '4K'))
    || (request.operation === 'speech.synthesize' && text.length > 500);
}
/** Avoid exposing embedded reference data in the confirmation card. */
export function reviewParameters(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/^data:/.test(value)) return '[内嵌参考媒体]';
    if (/^https?:\/\//.test(value)) { try { return new URL(value).origin + '/…'; } catch { return '[参考链接]'; } }
    return value.length > 2000 ? value.slice(0, 2000) + '…' : value;
  }
  if (Array.isArray(value)) return value.map(reviewParameters);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,reviewParameters(v)]));
  return value;
}

export class MediaReviewStopped extends Error {
  constructor(readonly changes?: string) { super('No generation submitted. ' + (changes ? `Revise the plan using this user feedback: ${changes}` : 'User cancelled or did not approve. Do not submit again unless requested.')); }
}
