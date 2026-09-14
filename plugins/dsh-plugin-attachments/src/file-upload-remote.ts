import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { z } from 'zod';

export interface FileUploadValue {
  receiptId: string;
  file: { attachmentId: string; name: string; bytes: number };
}
export interface EncodedFileUploadRequest { data: string; name?: string }

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    fileUploads: { upload(sessionId: string, request: EncodedFileUploadRequest, signal?: AbortSignal): Promise<RemoteResult<FileUploadValue>> };
  }
  interface TypertRemoteMap {
    'fileUploads/upload': TypertRemoteNamespaceMap['fileUploads']['upload'];
  }
}

const descriptor: TypertRemoteContribution['descriptors'][number] = {
  id:'@amiba/dsh-file-upload#fileUploads/upload',service:'fileUploads',namespace:'fileUploads',method:'upload',
  invocation:{kind:'direct'},scope:{context:'agent',wire:'agentId'},
  parameters:[
    {name:'agent',wire:'agentId',source:'lookup',lookup:'agent',codec:{mode:'strict',typeSymbol:'@deepseek-ai/dsh-session/types#SessionId',schema:z.string()}},
    {name:'request',wire:'request',source:'json',codec:{mode:'strict',typeSymbol:'@amiba/dsh-file-upload#request',schema:z.object({data:z.string(),name:z.string().optional()})}},
  ],
  cancellation:{parameter:'signal'},
  result:{mode:'strict',typeSymbol:'@amiba/dsh-file-upload#value',schema:z.object({receiptId:z.string(),file:z.object({attachmentId:z.string(),name:z.string(),bytes:z.number().int().nonnegative()})})},
};
export const FILE_UPLOAD_REMOTE: TypertRemoteContribution = {package:'@amiba/dsh-file-upload',descriptors:[descriptor]};
export const FILE_UPLOAD_HOST = {package:'@amiba/dsh-file-upload',face:'host' as const,schemas:[],model:{services:[],events:[],objects:[]},invocations:[{...descriptor,implementation:'uploadRemote'}]};
