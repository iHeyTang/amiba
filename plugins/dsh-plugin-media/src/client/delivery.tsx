import { MediaOutcome } from "./outcome.js";
import { MediaAccountingSummary } from "./accounting.js";
import { usePluginT } from '@amiba/ui/plugin';
import { useEffect, useState } from 'react';
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import type { MediaRecord } from '../store.js';
import { ArtifactPreview } from './view.js';

const copy = { 'zh-CN': { loading: '正在加载媒体…', pending: '正在生成媒体…', empty: '暂无可预览的媒体', retry: '媒体读取失败，点击重试', label: '生成的媒体' }, en: { loading: 'Loading media…', pending: 'Generating media…', empty: 'No media available', retry: 'Could not load media. Retry', label: 'Generated media' } };

type Api = ClientContext['remote']['amibaMediaUi'];
export function MediaDelivery({ code, api }: { code: string; api: Api }) {
  const { t } = usePluginT(copy);
  const [record, setRecord] = useState<MediaRecord>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    setRecord(undefined); setError(false);
    const read = async () => {
      try {
        const ref = JSON.parse(code);
        if (typeof ref.sessionId !== 'string' || typeof ref.recordId !== 'string') throw new Error('Invalid media reference');
        const result = await api.inspect(ref.sessionId, ref.recordId);
        if (!result.ok) throw new Error('Media unavailable');
        if (!active) return;
        setRecord(result.value);
        if (['submitting', 'queued', 'running'].includes(result.value.status) || result.value.storageStatus === 'saving') timer = setTimeout(read, 3000);
      } catch { if (active) setError(true); }
    };
    void read();
    return () => { active = false; clearTimeout(timer); };
  }, [api, code, attempt]);
  return <div className="amiba-media-result" aria-label={t('label')}>
    {error ? <button type="button" onClick={() => setAttempt(value => value + 1)}>{t('retry')}</button> : !record ? <span role="status">{t('loading')}</span> : <>
      {record.artifacts.map(artifact => <ArtifactPreview key={artifact.id} api={api} record={record} artifact={artifact} autoLoad />)}
      <div className={`amiba-media-meta${record.storageStatus === 'saved' ? ' amiba-media-meta-saved' : ''}`}>
        <MediaOutcome record={record}/>
        <MediaAccountingSummary accounting={record.accounting ?? {}}/>
      </div>
      {!record.artifacts.length && record.generationStatus !== "succeeded" && <p role="status">{record.error || (['submitting', 'queued', 'running'].includes(record.status) ? t('pending') : t('empty'))}</p>}
    </>}
  </div>;
}
export function mediaMarkdown(api: Api) {
  return { id: 'amiba.media.delivery', version: '1', order: 50, plugins: { renderers: [{ language: 'amiba-media', component: ({ code, isIncomplete }: { code: string; isIncomplete?: boolean }) => isIncomplete ? <span role="status">…</span> : <MediaDelivery code={code} api={api} /> }] } };
}
