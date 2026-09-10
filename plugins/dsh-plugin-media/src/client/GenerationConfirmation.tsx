import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@amiba/dsh-plugin-ui-shell/client';
type AmibaConversationQuestionOwner = PropsRuntime<'amiba.conversation.question'>;
import { useState } from 'react';
import { ComposerDockSheet } from '@amiba/ui/plugin';
import { CONFIRM_GENERATION } from '../cost-policy.js';
export function GenerationConfirmation({request,inFlight,error,respond,cancel}:AmibaConversationQuestionOwner) {
  const question=request.questions[0];
  const [editing,setEditing]=useState(false);
  const [changes,setChanges]=useState('');
  let plan: {provider:string;model:string;price:string;parameters:unknown} | undefined;
  try { plan=JSON.parse(question?.detail ?? ''); } catch { /* retained questions may lack structured detail */ }
  if (!question) return null;
  const rows: Array<[string,string]> = [];
  const labels: Record<string,string> = {duration:'时长（秒）',resolution:'分辨率',size:'尺寸',ratio:'画幅',aspect_ratio:'画幅',n:'数量',num_images:'数量',max_images:'最多图片数',voice_id:'音色',speaker:'音色',speed:'语速'};
  let prompt = '';
  function collect(value: unknown) {
    if (!value || typeof value !== 'object') return;
    for (const [key,item] of Object.entries(value)) {
      if (labels[key] && ['string','number'].includes(typeof item)) rows.push([labels[key]!,String(item)]);
      if (!prompt && ['prompt','text'].includes(key) && typeof item === 'string') prompt=item;
      else if (item && typeof item === 'object') collect(item);
    }
  }
  collect(plan?.parameters);
  return <ComposerDockSheet><section className="amiba-media-confirm">
    <header><strong>生成方案</strong><span>{plan?.price ?? '费用未知'}</span></header>
    <p>{plan ? `${plan.provider} · ${plan.model}` : question.question}</p>
    {rows.length > 0 && <dl className="amiba-media-confirm-specs">{rows.map(([key,value],index)=><div key={index}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
    {prompt && <p className="amiba-media-confirm-prompt">{prompt.slice(0,300)}{prompt.length>300?'…':''}</p>}
    <details><summary>查看生成参数</summary><pre>{JSON.stringify(plan?.parameters ?? {},null,2)}</pre></details>
    <p className="amiba-media-confirm-hint">确认后提交一次生成请求；预计费用不等于最终扣费。</p>
    {editing && <textarea aria-label="调整生成方案" placeholder="例如：改为 3 秒、降低分辨率，或换更便宜的模型" value={changes} onChange={event=>setChanges(event.target.value)} disabled={inFlight}/>}
    {error && <p role="alert">{error}</p>}
    <footer>{editing && <button type="button" disabled={inFlight} onClick={()=>{setEditing(false);setChanges('');}}>返回原方案</button>}<button type="button" disabled={inFlight} onClick={cancel}>取消</button>
      {editing ? <button type="button" disabled={inFlight || !changes.trim()} onClick={()=>respond([{id:question.id,selected:['调整参数'],custom:changes}])}>更新方案</button> : <button type="button" disabled={inFlight} onClick={()=>setEditing(true)}>调整参数</button>}
      <button type="button" className="amiba-media-confirm-submit" disabled={inFlight || editing} onClick={()=>respond([{id:question.id,selected:[CONFIRM_GENERATION]}])}>确认生成</button>
    </footer>
  </section></ComposerDockSheet>;
}
