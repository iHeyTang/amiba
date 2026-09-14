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
    const modelHandle = await new Promise((resolve,reject)=>ctx.inject(['llm','fs','attachments'],scope=>{
      try { resolve(scope.llm.fileRequestText(ref)); } catch(error) { reject(error); }
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
