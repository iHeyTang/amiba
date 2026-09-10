import React from 'react';
import { createRoot } from 'react-dom/client';
import { ModelProviderConfigTab } from '../../dsh-plugin-model-plane/src/client/ModelProviderConfigTab';
import { MediaSettings } from '../src/client/settings';
import '../src/client/style.css';
import './style.css';
if (new URLSearchParams(location.search).get('theme') === 'dark') { document.documentElement.classList.remove('light'); document.documentElement.classList.add('dark'); }
let revision = 1, defaults = {}, disabledModels: string[] = [];
const api = {
  catalog: async () => ({ok:true,value:JSON.stringify({revision,defaults,disabledModels,providers:[{id:'tokendance',available:true,description:{provider:'tokendance',name:'TokenDance',models:[{id:'seedream',name:'Seedream',description:'支持参考图生成，适合视觉创作与图像编辑。',protocols:['ark:image-generations'],operations:['image.generate']},{id:'seedance',name:'Seedance',protocols:['seedance:generations'],operations:['video.generate']},{id:'speech',name:'MiniMax Speech',protocols:['minimax:t2a_v2'],operations:['speech.synthesize']}],protocols:[{id:'ark:image-generations',operations:['image.generate']},{id:'seedance:generations',operations:['video.generate']},{id:'minimax:t2a_v2',operations:['speech.synthesize']}]}}]})}),
  setModelEnabled: async (provider, model, enabled, expected) => {
    if (expected !== revision) return {ok:false};
    const key = JSON.stringify([provider,model]);
    disabledModels = disabledModels.filter(value => value !== key);
    if (!enabled) disabledModels.push(key);
    revision++; return {ok:true,value:true};
  },
  setDefault: async (operation, value, expected) => {if(expected!==revision) return {ok:false}; defaults={...defaults,[operation]:JSON.parse(value)};revision++;return {ok:true,value:true}},
};
let snapshot = {
  revision: 1,
  providers: [{id:'tokendance',displayName:'TokenDance',protocol:'openai-chat-completions',baseURL:'https://tokendance.space',enabled:true,editable:true,source:'builtin',models:[{id:'deepseek-v4-pro',name:'DeepSeek V4 Pro',reasoning:{defaultEffort:'high',efforts:[{id:'low',name:'低'},{id:'high',name:'高'},{id:'max',name:'最高'}]}}]}],
  groups:[],credentials:{},failures:[],
  defaultSelection:{provider:'tokendance',model:'deepseek-v4-pro',reasoningEffort:'high'},
};
const adapter = {
  snapshot:async()=>snapshot,
  setDefaultSelection:async selection=>{snapshot={...snapshot,revision:snapshot.revision+1,defaultSelection:selection};return snapshot},
};
function CatalogSettings() {
  const [inventory, setInventory] = React.useState([]);
  const onModelsChange = React.useCallback((_source, groups) => setInventory(groups), []);
  return <ModelProviderConfigTab adapter={adapter as never} inventory={inventory} assignments={<MediaSettings api={api as never} onModelsChange={onModelsChange}/>}/>;
}
createRoot(document.getElementById('root')!).render(
  <main style={{maxWidth:760,margin:'32px auto',padding:'0 24px'}}>
    <h1 style={{fontSize:22,fontWeight:600,marginBottom:24}}>模型与服务</h1>
    <CatalogSettings/>
    <button style={{marginTop:32}} onClick={()=>{document.documentElement.classList.toggle('dark');document.documentElement.classList.toggle('light')}}>切换主题</button>
  </main>
);
