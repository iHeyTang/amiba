import path from 'node:path';

/** Create an older-format durable message without passing through the new sender. */
export function legacyAttachmentFixture(profile) {
  return `ctx.effect(()=>{const watcher=watch(${JSON.stringify(profile)},()=>{
    let request:any;try{request=JSON.parse(readFileSync(${JSON.stringify(path.join(profile,'legacy-attachment.json'))},'utf8'));}catch{return;}
    const session=ctx.sessions.get(request.sessionId);
    if(!session||session.events.some((e:any)=>e.type==='user/message'&&e.data.id==='compat-legacy-attachment'))return;
    session.append('user/message',{id:'compat-legacy-attachment',role:'user',source:{kind:'user'},content:[{type:'text',text:request.text}]},{surfaceOp:'append'});
    console.log('AMIBA_PROBE_LEGACY_ATTACHMENT');
  });return()=>watcher.close();});`;
}
