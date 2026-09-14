import { Service, type Context } from '@deepseek-ai/cordis';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { EncodedFileUploadRequest, FileUploadValue } from '../file-upload-remote.js';
import { FILE_UPLOAD_REMOTE } from '../file-upload-remote.js';

export interface FileUploadService {
  /** Background streaming carrier availability; encoded Remote remains usable. */
  readonly available: boolean;
  upload(sessionId:string,data:Blob|Uint8Array|ReadableStream<Uint8Array>,name?:string,signal?:AbortSignal,onProgress?:(progress:{loaded:number;total?:number})=>void):Promise<RemoteResult<FileUploadValue>>;
}
declare module '@deepseek-ai/cordis' { interface Context { fileUpload: FileUploadService } }

export class FileUploadRuntime extends Service implements FileUploadService {
  readonly available = false;
  private readonly carrier: { upload(sessionId:string,request:EncodedFileUploadRequest,signal?:AbortSignal):Promise<RemoteResult<FileUploadValue>> };
  constructor(ctx:Context) {
    super(ctx,'fileUpload');
    // Service calls inherit the consumer context; retain the namespace owner's authority.
    this.carrier={upload:(sessionId,request,signal)=>ctx.remote.fileUploads.upload(sessionId,request,signal)};
  }
  async upload(sessionId:string,data:Blob|Uint8Array|ReadableStream<Uint8Array>,name?:string,signal?:AbortSignal,_onProgress?:(progress:{loaded:number;total?:number})=>void):Promise<RemoteResult<FileUploadValue>> {
    signal?.throwIfAborted();
    if (!(data instanceof Uint8Array) && !(data instanceof Blob)) throw new Error('Stream file upload requires a background carrier.');
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer());
    signal?.throwIfAborted();
    const parts:string[]=[];
    for(let offset=0;offset<bytes.length;offset+=32768) parts.push(String.fromCharCode(...bytes.subarray(offset,offset+32768)));
    const request={data:btoa(parts.join('')),...(name===undefined?{}:{name})};
    return this.carrier.upload(sessionId,request,signal);
  }
}

export function applyFileUpload(ctx:Context):void {
  ctx.inject(['remote'], scope => {
    if(scope.get('fileUpload')) return;
    let disposed=false; let unmount:(()=>void|Promise<void>)|undefined;
    scope.effect(() => () => {disposed=true;return unmount?.();});
    void scope.remote.$mount(FILE_UPLOAD_REMOTE).then(off => {
      if(disposed){void off();return;}
      unmount=off;
      scope.inject(['remote.fileUploads'], uploadScope => {
        if(!uploadScope.get('fileUpload')) new FileUploadRuntime(uploadScope);
      });
    }).catch(error => console.error('File upload Remote registration failed', error));
  });
}
