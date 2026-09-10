import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudioPlayer } from '../src/client/AudioPlayer';
import { MediaAccountingSummary } from '../src/client/accounting';
import '../src/client/style.css';
import './style.css';
function Preview() {
 const [url,setUrl]=useState('');
 useEffect(()=>{let objectUrl='';fetch('/sample.mp3').then(r=>r.blob()).then(blob=>{objectUrl=URL.createObjectURL(blob);setUrl(objectUrl);});return()=>URL.revokeObjectURL(objectUrl);},[]);
 return <main style={{maxWidth:720,margin:'100px auto'}}><p style={{marginBottom:24}}>音频已生成成功</p>{url && <AudioPlayer url={url} filename="sample.mp3"/>}<div className="amiba-media-meta amiba-media-meta-saved" style={{marginTop:12}}><div className="amiba-media-outcome"><p>生成成功 · 已保存到本地</p></div><MediaAccountingSummary accounting={{usage:{characters:64},cost:undefined}}/></div><p style={{marginTop:40}}>下一条对话的位置保持不变。</p></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
