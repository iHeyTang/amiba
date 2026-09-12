import path from 'node:path';

/** Real Host definition + official Client activation; tool events are fixture evidence. */
export function cordisBusinessFixture(profile, canonicalProfile) {
  const code = `
    styles.insert("[data-compat-dynamic] { border-radius: 4px; padding: 4px 8px; }");
    function Card(props) { const [count,setCount]=React.useState(0); const [echo,setEcho]=React.useState(''); if(count>=3)throw new Error('COMPAT_RENDER_FAILURE'); return React.createElement('button', {
      'data-compat-dynamic':'', 'data-plugin':props.pluginId, 'data-package':props.packageId,
      'data-run':props.pluginRunId, 'data-host-echo':echo, onClick:async()=>{ try { const result=await host.call('increment',{text:'RPC_中文😀'}); setCount(result.count); setEcho(result.text); } catch(error) { setEcho('ERROR: '+error.message); } }
    }, 'COMPAT_DYNAMIC '+count); }
    return { inject:['slots'], apply(ctx) {
      ctx.slots.inject('tool.view.cordis',()=>ctx.slots.register({name:'tool.view.cordis',key:'self'},Card));
    }};`;
  const hostCode = `let count=0; return { apply(ctx) {
    ctx.effect(()=>harness.handle('increment',args=>({count:++count,text:args.text,origin:'Host'})));
  }};`;
  return `
    let cordisSession:any, cordisReceipt:any, nextCordisReceipt:any;
    ctx.on('session/created',(s:any)=>{
      if(s.header.origin==='subagent'||!${JSON.stringify([profile,canonicalProfile])}.includes(s.header.cwd)||cordisReceipt)return;
      cordisSession=s;
      cordisReceipt=ctx.dynamicCordisRunner.define({sessionId:s.id,plugin:{kind:'new',idPrefix:'compat'},
        name:'Compatibility business view',purpose:'Local compatibility verification',code:{host:${JSON.stringify(hostCode)},client:${JSON.stringify(code)}}});
      writeFileSync(${JSON.stringify(path.join(profile,'cordis-definition.json'))},JSON.stringify({...cordisReceipt,sessionId:s.id}));
    });
    ctx.effect(()=>{
      const watcher=watch(${JSON.stringify(profile)},()=>{
        const s=cordisSession;
        if(!s)return;
        if(!nextCordisReceipt&&existsSync(${JSON.stringify(path.join(profile,'cordis-update'))})) {
          nextCordisReceipt=ctx.dynamicCordisRunner.define({sessionId:s.id,plugin:{kind:'existing',pluginId:cordisReceipt.pluginId},
            name:'Compatibility business view v2',purpose:'Verify package update',code:{host:${JSON.stringify(hostCode.replace("origin:'Host'", "origin:'Host-v2'"))},client:${JSON.stringify(code.replace("'COMPAT_DYNAMIC '", "'COMPAT_DYNAMIC_V2 '"))}}});
          writeFileSync(${JSON.stringify(path.join(profile,'cordis-next-definition.json'))},JSON.stringify(nextCordisReceipt));
        }
        const appendCard=(receipt:any,file:string,callId:string,turn:number,mode:string)=>{
          if(!receipt||!existsSync(file)||s.events.some((e:any)=>e.type==='tool/call'&&e.data.callId===callId))return;
          let run:any;
          try { run=JSON.parse(readFileSync(file,'utf8')); } catch { return; }
          if(typeof run.pluginRunId!=='string')return;
          const meta={pluginId:receipt.pluginId,packageId:receipt.packageId,pluginRunId:run.pluginRunId};
          s.append('turn/start',{turn});
          s.append('step/start',{turn,step:1});
          s.append('tool/call',{turn,step:1,callId,name:'cordis_run',arguments:JSON.stringify({...meta,mode})});
          s.append('tool/result',{turn,step:1,meta,message:{id:callId+'-result',role:'user',source:{kind:'tool',callId},content:[{type:'tool-result',toolCallId:callId,content:[{type:'text',text:'COMPAT_DYNAMIC_OUTPUT'}]}]}},{surfaceOp:'append'});
          s.append('step/end',{turn,step:1});
          s.append('turn/end',{turn,reason:{kind:'completed'}});
        };
        appendCard(cordisReceipt,${JSON.stringify(path.join(profile,'cordis-card.json'))},'compat-cordis-call',20,'run');
        appendCard(nextCordisReceipt,${JSON.stringify(path.join(profile,'cordis-next-card.json'))},'compat-cordis-next-call',21,'update');
      });
      return()=>watcher.close();
    });
  `;
}
