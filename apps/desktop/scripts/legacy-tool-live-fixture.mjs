import path from 'node:path';

/** Three real Host transitions, driven separately so the renderer sees each form. */
export function legacyToolLiveFixture(profile) {
  const file = name => JSON.stringify(path.join(profile, name));
  return `ctx.effect(()=>{
    let session:any;let started=false,childDone=false,done=false;
    const watcher=watch(${JSON.stringify(profile)},()=>{
      try {
        if(!started&&existsSync(${file('legacy-live-start')})){
          started=true;
          session=ctx.sessions.get(readFileSync(${file('legacy-live-session')},'utf8'));
          if(!session)throw new Error('Missing addressed legacy fixture session');
          session.append('turn/start',{turn:21});
          session.append('user/message',{id:'legacy-live-user',role:'user',source:{kind:'plugin',plugin:'legacy-fixture',form:'relay'},content:[{type:'text',text:'LEGACY_LIVE_INPUT'}]},{surfaceOp:'append'});
          session.append('step/start',{turn:21,step:1});
          session.append('tool/call',{turn:21,step:1,callId:'legacy-live-parent',name:'run_code',arguments:JSON.stringify({code:'LEGACY_PARENT_CODE'})});
          session.append('tool/code-dispatch-start',{rootCallId:'legacy-live-parent',parentCallId:'legacy-live-parent',subCallId:'legacy-live-child',name:'read_file',arguments:{file_path:'legacy-live.txt'}});
        }
        if(started&&!childDone&&existsSync(${file('legacy-live-child-done')})){
          childDone=true;
          session.append('tool/code-dispatch',{rootCallId:'legacy-live-parent',parentCallId:'legacy-live-parent',subCallId:'legacy-live-child',name:'read_file',arguments:{file_path:'legacy-live.txt'},content:[{type:'text',text:'LEGACY_CHILD_RESULT'}],isError:false});
        }
        if(childDone&&!done&&existsSync(${file('legacy-live-done')})){
          done=true;
          session.append('tool/result',{turn:21,step:1,message:{id:'legacy-live-parent-result',role:'user',source:{kind:'tool',callId:'legacy-live-parent'},content:[{type:'tool-result',toolCallId:'legacy-live-parent',isError:false,content:[{type:'text',text:'LEGACY_PARENT_RESULT'}]}]}},{surfaceOp:'append'});
          session.append('step/end',{turn:21,step:1});
          session.append('turn/end',{turn:21,reason:{kind:'completed'}});
        }
      } catch(error){writeFileSync(${file('legacy-live-error.txt')},String(error));}
    });
    return ()=>watcher.close();
  });`;
}
