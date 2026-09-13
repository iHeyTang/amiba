import path from 'node:path';

/** Commit a real normalized image and reference it in the owning Host session. */
export function messageImageFixture(profile, canonicalProfile) {
  return `
    let imageSession:any, imageStarted=false;
    ctx.on('session/created',(s:any)=>{
      if(!imageSession && s.header.origin!=='subagent' && ${JSON.stringify([profile,canonicalProfile])}.includes(s.header.cwd)) imageSession=s;
    });
    ctx.effect(()=>{
      const watcher=watch(${JSON.stringify(profile)},()=>{
        if(imageStarted || !imageSession || !existsSync(${JSON.stringify(path.join(profile,'message-image-create'))}))return;
        imageStarted=true;
        void (async()=>{
          const attachment=await ctx.attachments.saveImage({mediaType:'image/png',name:'compat.png',data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64')});
          writeFileSync(${JSON.stringify(path.join(profile,'message-image-ref.json'))},JSON.stringify(attachment));
          imageSession.append('turn/start',{turn:11});
          imageSession.append('user/message',{id:'compat-durable-image',role:'user',source:{kind:'plugin',plugin:'image-fixture',form:'relay'},content:[{type:'text',text:'COMPAT_NATIVE_IMAGE'},{type:'image',attachment}]},{surfaceOp:'append'});
          imageSession.append('turn/end',{turn:11,reason:{kind:'completed'}});
          console.log('AMIBA_PROBE_IMAGE '+attachment.attachmentId);
        })().catch(error=>console.error('AMIBA_PROBE_IMAGE_ERROR',error));
      });
      return ()=>watcher.close();
    });
  `;
}
