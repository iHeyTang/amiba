import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MediaViewer } from '../src/client/MediaViewer';
import '../src/client/style.css';
import './style.css';
function Preview() {
  const [url, setUrl] = useState(new URLSearchParams(location.search).get('asset') || '');
  const [open, setOpen] = useState(true);
  const kind = new URLSearchParams(location.search).get('kind') === 'video' ? 'video' : 'image';
  return <main style={{maxWidth:960,margin:"40px auto",padding:24}}><h1 style={{fontSize:24,marginBottom:32}}>图片生成测试</h1><p style={{marginBottom:24}}>帮我生成一张窗台上看日落的橘猫。</p><p style={{marginBottom:24}}>图片已生成，使用 Seedream 5.0 lite，2K 分辨率。</p>{url && kind === "image" && <img src={url} alt="Inline result" style={{width:420,borderRadius:12,marginBottom:24}}/>}<input aria-label="Preview file" type="file" accept="image/*,video/*" onChange={e => { if(e.target.files?.[0]) { setUrl(URL.createObjectURL(e.target.files[0])); setOpen(true); } }}/><button onClick={() => setOpen(true)}>Open preview</button>{url && open && <MediaViewer url={url} name="Seedream 5.0 lite" kind={kind} filename="cat.jpg" onClose={() => setOpen(false)}/>}</main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
