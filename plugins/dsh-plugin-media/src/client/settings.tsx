import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { useEffect, useState } from 'react';
import { usePluginT, ModelPickerDialog, ModelIcon, ModelIdentityName, type ModelPickerGroup } from '@amiba/ui/plugin';
import { ChevronDown } from 'lucide-react';
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import type { MediaDescription, MediaOperation } from '../contracts.js';
import type { MediaDefaults, MediaSelection } from '../preferences.js';
import type {} from '../remote.js';
type Api = ClientContext['remote']['amibaMediaUi'];
interface Catalog { confirmationThresholdCny?: number; providers: Array<{ id: string; available: boolean; description?: MediaDescription }>; defaults: MediaDefaults; disabledModels?: string[]; revision: number }
const copy = {
  'zh-CN': { 'media.threshold': '预计费用达到此金额时确认', 'media.thresholdHint': '费用未知的视频、音乐、批量图片或长语音也会先确认。', 'media.picker': '选择模型', 'media.search': '搜索服务商或模型…', 'media.settings': '媒体生成', 'media.defaults': '默认生成模型', 'media.image.generate': '图片生成', 'media.video.generate': '视频生成', 'media.speech.synthesize': '语音合成', 'media.audio.generate': '音乐生成', 'media.auto': '由 Agent 按需选择', 'media.refresh': '刷新能力', 'media.unavailable': '尚不可用，请检查服务商配置', 'media.empty': '配置支持媒体生成的服务商后，即可在对话中生成图片、视频或配音。', 'media.error': '读取或保存失败，请刷新后重试。', 'media.loading': '正在读取媒体能力…' },
  en: { 'media.threshold': 'Confirm when estimated cost reaches', 'media.thresholdHint': 'Unpriced video, music, batch images and long speech also require confirmation.', 'media.picker': 'Choose model', 'media.search': 'Search providers or models…', 'media.settings': 'Media generation', 'media.defaults': 'Default generation models', 'media.image.generate': 'Images', 'media.video.generate': 'Video', 'media.speech.synthesize': 'Speech', 'media.audio.generate': 'Music', 'media.auto': 'Let the Agent choose', 'media.refresh': 'Refresh capabilities', 'media.unavailable': 'Unavailable; check provider settings', 'media.empty': 'Configure a media provider to generate images, video or voiceovers in your conversation.', 'media.error': 'Could not read or save. Refresh and try again.', 'media.loading': 'Loading media capabilities…' },
};
export function MediaSettings({ api, onModelsChange }: { api: Api } & Partial<PropsRuntime<"amiba.models.extension">>) {
  const { t } = usePluginT(copy);
  const [active, setActive] = useState<MediaOperation | null>(null);
  const [catalog, setCatalog] = useState<Catalog>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function refresh() {
    setBusy(true); setError(false);
    try { const result = await api.catalog(); if (!result.ok) throw new Error(); setCatalog(JSON.parse(result.value)); }
    catch { setError(true); } finally { setBusy(false); }
  }
  function enabled(provider: string, model: string) {
    return !catalog?.disabledModels?.includes(JSON.stringify([provider, model]));
  }
  async function setEnabled(provider: string, model: string, value: boolean) {
    if (!catalog || busy) return;
    setBusy(true); setError(false);
    try {
      const result = await api.setModelEnabled(provider, model, value, catalog.revision);
      if (!result.ok) throw new Error();
      await refresh();
    } catch { setError(true); } finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [api]);
  useEffect(() => {
    if (!catalog) return;
    onModelsChange?.('media', catalog.providers.map(provider => ({
      id: provider.id, name: provider.description?.name ?? provider.id, available: provider.available,
      models: (provider.description?.inventory ?? provider.description?.models ?? []).map(model => ({
        id: model.id, name: model.name, description: model.description,
        supported: model.supported ?? model.operations.length > 0,
        enabled: enabled(provider.id, model.id), pending: busy,
        onEnabledChange: provider.description?.models.some(row => row.id === model.id)
          ? (value: boolean) => { void setEnabled(provider.id, model.id, value); } : undefined,
        outputModalities: [...new Set(model.operations.map(operation => operation === 'image.generate' ? 'image' : operation === 'video.generate' ? 'video' : 'audio'))],
      })),
    })));
  }, [catalog, busy, onModelsChange]);
  useEffect(() => () => onModelsChange?.('media', []), [onModelsChange]);

  async function select(operation: MediaOperation, value: string) {
    if (!catalog) return;
    setBusy(true); setError(false);
    try { const result = await api.setDefault(operation, value === 'auto' ? 'null' : value, catalog.revision); if (!result.ok) throw new Error(); await refresh(); setActive(null); }
    catch { setError(true); } finally { setBusy(false); }
  }
  function choicesFor(operation: MediaOperation): Array<MediaSelection & { label: string; description?: string; providerName: string }> {
    const saved = catalog?.defaults[operation];
    return (catalog?.providers ?? []).filter(provider => provider.available).flatMap(provider =>
      provider.description?.models.flatMap(model => model.operations.includes(operation) && enabled(provider.id, model.id)
        ? model.protocols.filter(protocol => provider.description!.protocols.some(row => row.id === protocol && row.operations.includes(operation)))
          .sort((a, b) => Number(b === saved?.protocol) - Number(a === saved?.protocol)).slice(0, 1)
          .map(protocol => ({ provider: provider.id, model: model.id, protocol, label: model.name, description: model.description, providerName: provider.description!.name }))
        : []) ?? []);
  }
  const choices = active ? choicesFor(active) : [];
  const groups: ModelPickerGroup[] = (catalog?.providers ?? []).map(provider => ({
    id: provider.id, provider: provider.id, label: provider.description?.name ?? provider.id,
    models: choices.filter(choice => choice.provider === provider.id).map(choice => ({model: choice.model, label: choice.label, description: choice.description})),
  })).filter(group => group.models.length > 0);
  return <div aria-label={t('media.settings')}>
    <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-xs">
      <label htmlFor="media-confirm-threshold">{t('media.threshold')}</label>
      <div className="flex items-center gap-2"><span>¥</span><input id="media-confirm-threshold" type="number" min="0.01" max="1000" step="0.1" key={catalog?.revision} defaultValue={catalog?.confirmationThresholdCny ?? 1} disabled={busy || !catalog} className="w-20 rounded-md border border-input bg-background px-2 py-1" onBlur={async event => {
        const value = Number(event.currentTarget.value);
        if (!catalog || value === (catalog.confirmationThresholdCny ?? 1)) return;
        setBusy(true); setError(false);
        try { const response = await api.setConfirmationThreshold(value, catalog.revision); if (!response.ok) throw new Error(); await refresh(); } catch { setError(true); } finally { setBusy(false); }
      }}/></div>
    </div>
    <p className="px-4 pb-3 text-[11px] text-muted-foreground">{t('media.thresholdHint')}</p>
    {(['image.generate','video.generate','speech.synthesize','audio.generate'] as const).map(operation => {
      const saved = catalog?.defaults[operation];
      const selected = choicesFor(operation).find(choice => choice.provider === saved?.provider && choice.model === saved?.model && choice.protocol === saved?.protocol);
      return <div key={operation} data-model-assignment={operation} className="grid items-center gap-3 border-t border-border/60 bg-background px-4 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
        <span id={`media-${operation}-label`} className="text-xs font-medium text-foreground">{t(`media.${operation}`)}</span>
        <button type="button" aria-labelledby={`media-${operation}-label media-${operation}-value`}
          disabled={busy || !catalog} onClick={() => setActive(operation)}
          className="flex h-9 min-w-0 items-center gap-2.5 rounded-md border border-input bg-background px-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
          {saved && <ModelIcon className="h-4 w-4 shrink-0 text-muted-foreground" model={saved.model} provider={saved.provider} />}
          <span id={`media-${operation}-value`} className="min-w-0 flex-1 text-xs">
            {selected ? <ModelIdentityName className="flex" displayName={selected.label} model={selected.model} variant="standard" />
              : <span className="block truncate">{saved ? `${saved.model} — ${t('media.unavailable')}` : t('media.auto')}</span>}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        </button>
      </div>;
    })}
    <ModelPickerDialog
      open={active !== null}
      onOpenChange={open => { if (!open && !busy) { setActive(null); setError(false); } }}
      title={active ? `${t('media.picker')} · ${t(`media.${active}`)}` : t('media.picker')}
      searchPlaceholder={t('media.search')}
      groups={groups}
      selected={active ? catalog?.defaults[active] ?? undefined : undefined}
      saving={busy}
      status="ready"
      errorMessage={error ? t('media.error') : undefined}
      resetOption={{ label: t('media.auto'), selected: active ? !catalog?.defaults[active] : false,
        onSelect: () => { if (active && !busy) void select(active, 'auto'); } }}
      onSelect={(provider, model) => {
        const choice = choices.find(item => item.provider === provider && item.model === model);
        if (active && choice && !busy) void select(active, JSON.stringify({provider: choice.provider, model: choice.model, protocol: choice.protocol}));
      }}
    />
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2">
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">
        {error ? <p role="alert" className="text-destructive">{t('media.error')}</p>
          : !catalog ? <p role="status">{t('media.loading')}</p>
          : catalog.providers.length === 0 ? <p>{t('media.empty')}</p>
          : catalog.providers.some(provider => !provider.available) ? <p>{t('media.unavailable')}</p>
          : null}
      </div>
      <button type="button" className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={busy} onClick={() => void refresh()}>{t('media.refresh')}</button>
    </div>
  </div>;
}
