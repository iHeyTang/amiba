import path from 'node:path';

/** Commit a real normalized image and reference it in the owning Host session. */
export function messageImageFixture(profile, canonicalProfile, toolImages = false) {
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
          ${toolImages ? `const toolAttachment=await ctx.attachments.saveImage({mediaType:'image/png',name:'tool-only.png',data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADElEQVR4nGNg+A+BAA/5A/3YOXFBAAAAAElFTkSuQmCC','base64')});
          writeFileSync(${JSON.stringify(path.join(profile,'tool-image-ref.json'))},JSON.stringify(toolAttachment));
          imageSession.append('step/start',{turn:11,step:1});
          imageSession.append('tool/call',{turn:11,step:1,callId:'compat-tool-image',name:'read_image',arguments:JSON.stringify({file_path:'compat-tool-image.png'})});
          imageSession.append('tool/result',{turn:11,step:1,message:{id:'compat-tool-image-result',role:'user',source:{kind:'tool',callId:'compat-tool-image'},content:[{type:'tool-result',toolCallId:'compat-tool-image',isError:false,content:[{type:'text',text:'COMPAT_TOOL_IMAGE_META'},{type:'image',attachment},{type:'image',attachment:toolAttachment}]}]}},{surfaceOp:'append'});
          imageSession.append('step/end',{turn:11,step:1});` : ''}
          imageSession.append('turn/end',{turn:11,reason:{kind:'completed'}});
          console.log('AMIBA_PROBE_IMAGE '+attachment.attachmentId);
        })().catch(error=>console.error('AMIBA_PROBE_IMAGE_ERROR',error));
      });
      return ()=>watcher.close();
    });
  `;
}
