// Runs inside the real Host fixture, against the installed attachment service.
export const fileStorageFixture = `
if (!fileStorageChecked) {
  fileStorageChecked = true;
  void (async () => {
    const service = ctx.get('attachments');
    const image = await service.saveImage({data:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==','base64'),mediaType:'image/png'});
    const imageRead = await service.readImage(image);
    const bytes = Buffer.from([0,255,42,128,7]);
    const ref = await service.saveFile({data:bytes,name:'../compat-host-file.bin'});
    const second = await service.saveFileStream({name:'compat-stream.bin',data:(async function*(){yield bytes.subarray(0,2);yield bytes.subarray(2);})()});
    const chunks = []; for await (const chunk of service.readFileStream(ref)) chunks.push(chunk);
    const uploads = ctx.get('fileUploads');
    const agent = ctx.agents.get(s.id);
    if (!agent) throw new Error('file upload fixture requires live Agent');
    let filePromptAttempts = 0;
    let nativeModelAttempts = 0;
    const originalFollowup = agent.followup;
    agent.followup = function(message) {
      if (message.content.some(part=>part.type==='text'&&part.text==='COMPAT_NATIVE_MODEL_FILE')) {
        const file=message.content.find(part=>part.type==='file');
        if(!file || file.attachment.name!=='native-model.txt')throw new Error('Missing native model file');
        console.log('AMIBA_PROBE_NATIVE_MODEL '+JSON.stringify({attempt:++nativeModelAttempts,content:message.content}));
        if(nativeModelAttempts===1)throw new Error('NATIVE_MODEL_RETRY');
        return originalFollowup.call(this,message);
      }
      if (!String(message.source?.rpcId ?? '').startsWith('compat-file-model-')) return originalFollowup.call(this,message);
      filePromptAttempts++;
      console.log('AMIBA_PROBE_FILE_MODEL '+JSON.stringify({attempt:filePromptAttempts,source:message.source,content:message.content}));
      if (filePromptAttempts===1) throw new Error('COMPAT_FILE_MODEL_RETRY');
      agent.session.append('user/message',message,{surfaceOp:'append'});
    };
    ctx.effect(()=>()=>{agent.followup=originalFollowup;});
    const upload = await uploads.upload(agent,{data:bytes.toString('base64'),name:'receipt.bin'},new AbortController().signal);
    const receiptResolved = uploads.resolve(agent,upload.receiptId)?.attachmentId===ref.attachmentId;
    const failed = uploads.bindPrompt(agent,[upload.receiptId],'file-fixture-failed'); failed[Symbol.dispose]();
    uploads.retirePrompt(agent,'file-fixture-failed');
    const rollbackPreserved = !!uploads.resolve(agent,upload.receiptId);
    const accepted = uploads.bindPrompt(agent,[upload.receiptId],'file-fixture-accepted'); accepted.commit(); accepted[Symbol.dispose]();
    uploads.retirePrompt(agent,'file-fixture-accepted');
    const committedRetired = uploads.resolve(agent,upload.receiptId)===undefined;
    const commandUpload = await uploads.upload(agent,{data:bytes.toString('base64'),name:'command.bin'},new AbortController().signal);
    ctx.commands.register({name:'compat-file-receipt',description:'File receipt fixture',input:{hint:'file',attachments:true},handler:({attachments})=>{
      const file = attachments[0];
      if (attachments.length!==1||file.type!=='file'||file.attachment.attachmentId!==ref.attachmentId||file.attachment.name!=='command.bin') return {kind:'error',text:'Unexpected file block'};
      return {kind:'success',text:'COMPAT_FILE_RECEIPT_OK'};
    }});
    let nativeFileAttempts=0;
    ctx.commands.register({name:'compat-native-file',description:'Native file command fixture',input:{hint:'file',attachments:true},handler:async({attachments})=>{
      if(attachments.length!==1||attachments[0].type!=='file'||attachments[0].attachment.name!=='native-command.txt')return {kind:'error',text:'Unexpected native file'};
      const chunks=[];for await(const chunk of service.readFileStream(attachments[0].attachment))chunks.push(chunk);
      if(Buffer.concat(chunks).toString('utf8')!=='COMPAT_NATIVE_FILE')return {kind:'error',text:'Wrong native bytes'};
      const result=++nativeFileAttempts===1?{kind:'error',text:'NATIVE_FILE_RETRY'}:{kind:'success',text:'NATIVE_FILE_OK'};
      console.log('AMIBA_PROBE_NATIVE_FILE '+JSON.stringify({attempt:nativeFileAttempts,name:attachments[0].attachment.name,content:Buffer.concat(chunks).toString('utf8'),result}));
      return result;
    }});
    const modelHandle = await new Promise((resolve,reject)=>ctx.inject(['llm','fs','attachments','tokenMeter'],async scope=>{
      try {
        const adapterUrl='COMPAT_LLM_MODULE_URL';
        const { LlmAdapter }=await import(adapterUrl);
        class FileFixtureAdapter extends LlmAdapter {
          async *stream(options) {
            const content=options.messages.filter(m=>m.role==='user').flatMap(m=>m.content);
            const handle=content.find(part=>part.type==='text'&&part.text.includes('native-model.txt')&&part.text.includes('official-files'));
            if(!handle || content.some(part=>part.type==='file'))throw new Error('Model did not receive the projected file handle');
            console.log('AMIBA_PROBE_NATIVE_MODEL_HANDLE '+JSON.stringify(handle));
            const text='COMPAT_NATIVE_MODEL_REPLY';
            yield {type:'block-start',index:0,blockType:'text'};
            yield {type:'text-delta',index:0,text};
            yield {type:'block-end',index:0,block:{type:'text',text}};
            yield {type:'finish',reason:{kind:'stop'}};
          }
        }
        const off=scope.llm.registerAdapter(['compat-native-file'],new FileFixtureAdapter());
        scope.effect(()=>()=>off());
        const text=scope.llm.fileRequestText(ref);
        const tokens=scope.tokenMeter.measure({events:[{seq:0,type:'user/message',surfaceOp:'append',data:{role:'user',content:[{type:'file',attachment:ref}]}}]}).surfaceTokens;
        if(tokens!==Math.ceil(text.length/4)+8)throw new Error('File token pricing differs from the actual model handle');
        resolve(text);
      } catch(error) { reject(error); }
    }));
    console.log('AMIBA_PROBE_FILE_STORAGE '+JSON.stringify({
      modelHandle,
      commandReceiptId:commandUpload.receiptId, commandSessionId:agent.id,
      receiptResolved, rollbackPreserved, committedRetired,
      ref, sameDigest:ref.attachmentId===second.attachmentId,
      data:Buffer.concat(chunks).toString('base64'),
      imagePreserved:image.width===1&&image.height===1&&imageRead.data.byteLength>0,
      pathHasName:service.fileHostPath(ref).endsWith('/compat-host-file.bin')||service.fileHostPath(ref).endsWith('\\\\compat-host-file.bin'),
    }));
  })().catch(error=>console.error('AMIBA_PROBE_FILE_STORAGE_FAILED',error));
}
`;
