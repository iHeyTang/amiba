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
    console.log('AMIBA_PROBE_FILE_STORAGE '+JSON.stringify({
      ref, sameDigest:ref.attachmentId===second.attachmentId,
      data:Buffer.concat(chunks).toString('base64'),
      imagePreserved:image.width===1&&image.height===1&&imageRead.data.byteLength>0,
      pathHasName:service.fileHostPath(ref).endsWith('/compat-host-file.bin')||service.fileHostPath(ref).endsWith('\\\\compat-host-file.bin'),
    }));
  })().catch(error=>console.error('AMIBA_PROBE_FILE_STORAGE_FAILED',error));
}
`;
