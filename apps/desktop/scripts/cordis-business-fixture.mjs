import path from 'node:path';

/** Real Host definition + official Client activation; tool events are fixture evidence. */
export function cordisBusinessFixture(profile, canonicalProfile) {
  const code = `
    styles.insert("[data-compat-dynamic] { border-radius: 4px; padding: 4px 8px; }");
    function Card(props) { const [count,setCount]=React.useState(0); return React.createElement('button', {
      'data-compat-dynamic':'', 'data-plugin':props.pluginId, 'data-package':props.packageId,
      'data-run':props.pluginRunId, onClick:()=>setCount(count+1)
    }, 'COMPAT_DYNAMIC '+count); }
    return { inject:['slots'], apply(ctx) {
      ctx.slots.inject('tool.view.cordis',()=>ctx.slots.register({name:'tool.view.cordis',key:'self'},Card));
    }};`;
  return `
    let cordisSession:any, cordisReceipt:any;
    ctx.on('session/created',(s:any)=>{
      if(s.header.origin==='subagent'||!${JSON.stringify([profile,canonicalProfile])}.includes(s.header.cwd)||cordisReceipt)return;
      cordisSession=s;
      cordisReceipt=ctx.dynamicCordisRunner.define({sessionId:s.id,plugin:{kind:'new',idPrefix:'compat'},
        name:'Compatibility business view',purpose:'Local compatibility verification',code:{client:${JSON.stringify(code)}}});
      writeFileSync(${JSON.stringify(path.join(profile,'cordis-definition.json'))},JSON.stringify({...cordisReceipt,sessionId:s.id}));
    });
    ctx.effect(()=>{
      const watcher=watch(${JSON.stringify(profile)},()=>{
        const s=cordisSession;
        if(!s||!existsSync(${JSON.stringify(path.join(profile,'cordis-card.json'))})||s.events.some((e:any)=>e.type==='tool/call'&&e.data.callId==='compat-cordis-call'))return;
        let run:any;
        try { run=JSON.parse(readFileSync(${JSON.stringify(path.join(profile,'cordis-card.json'))},'utf8')); } catch { return; }
        if(typeof run.pluginRunId!=='string')return;
        const meta={pluginId:cordisReceipt.pluginId,packageId:cordisReceipt.packageId,pluginRunId:run.pluginRunId};
        s.append('turn/start',{turn:20});
        s.append('step/start',{turn:20,step:1});
        s.append('tool/call',{turn:20,step:1,callId:'compat-cordis-call',name:'cordis_run',arguments:JSON.stringify({...meta,mode:'run'})});
        s.append('tool/result',{turn:20,step:1,meta,message:{id:'compat-cordis-result',role:'user',source:{kind:'tool',callId:'compat-cordis-call'},content:[{type:'tool-result',toolCallId:'compat-cordis-call',content:[{type:'text',text:'COMPAT_DYNAMIC_OUTPUT'}]}]}},{surfaceOp:'append'});
        s.append('step/end',{turn:20,step:1});
        s.append('turn/end',{turn:20,reason:{kind:'completed'}});
      });
      return()=>watcher.close();
    });
  `;
}
