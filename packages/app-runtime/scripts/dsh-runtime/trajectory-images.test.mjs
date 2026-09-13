import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const installed=path.join(root,'packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-ui-trajectory');
const work=await mkdtemp(path.join(tmpdir(),'amiba-trajectory-patch-'));
after(()=>rm(work,{recursive:true,force:true}));
assert.equal(JSON.parse(await readFile(path.join(installed,'package.json'),'utf8')).version,'0.1.1-rc.2');
for(const file of ['lib/client.js','lib/types/client/trajectory-record.d.ts']) {
  await mkdir(path.dirname(path.join(work,file)),{recursive:true});
  await writeFile(path.join(work,file),await readFile(path.join(installed,file)));
}
const patch=path.join(root,'patches/@deepseek-ai__dsh-client-ui-trajectory@0.1.1-rc.2.patch');
const args=['--batch','-p1','-i',patch];
const checked=spawnSync('patch',['--dry-run','--forward',...args],{cwd:work,encoding:'utf8'});
if(checked.status===0) {
  const result=spawnSync('patch',['--forward',...args],{cwd:work,encoding:'utf8'});
  assert.equal(result.status,0,result.stdout+result.stderr);
} else {
  const applied=spawnSync('patch',['--dry-run','--reverse',...args],{cwd:work,encoding:'utf8'});
  assert.equal(applied.status,0,checked.stdout+checked.stderr);
}
const patched=await readFile(path.join(work,'lib/client.js'),'utf8');
// Execute the shipped projection functions after applying the actual dependency patch.
// No duplicate implementation or regex-based emulation of their behavior.
const start=patched.indexOf('\t\tfunction trajectoryImageAttachment(');
const end=patched.indexOf('\t\tfunction enclosingUserTurn(',start);
assert.ok(start>=0&&end>start);
const {sourceBlock,assistantSourceBlock}=new Function(patched.slice(start,end)+'\nreturn {sourceBlock,assistantSourceBlock};')();
const attachment={attachmentId:'durable',mediaType:'image/png',bytes:90,width:2,height:1,name:'image.png',originalDimensions:{width:4,height:2}};

test('preserves the original reference in ordinary and assistant trajectory records',()=>{
  for(const result of [sourceBlock({type:'image',attachment}),assistantSourceBlock({kind:'image',attachment})]) {
    assert.equal(result.attachment,attachment);
    assert.equal(result.type,'image');
    assert.ok(result.content.includes('durable'),'existing metadata fallback must remain readable');
    assert.equal(result.imageSrc,undefined);
  }
});
test('keeps occurrence order, text and inline image behavior unchanged',()=>{
  const uri='data:image/png;base64,AAAA';
  const result=[{type:'text',text:'before'},{type:'image',attachment},{type:'image',url:uri},{type:'image',attachment},{type:'text',text:'after'}].map(sourceBlock);
  assert.deepEqual(result.filter(block=>block.attachment).map(block=>block.attachment),[attachment,attachment]);
  assert.deepEqual(result[0],{type:'text',content:'before'});
  assert.deepEqual(result[2],{type:'image',content:'',imageSrc:uri});
  assert.deepEqual(result[4],{type:'text',content:'after'});
});
test('does not mint references from staging, inline data, wrong block types or invalid metadata',()=>{
  for(const invalid of [{attachmentId:'staging'},{...attachment,width:0},{...attachment,bytes:1.5},{...attachment,mediaType:['image/png']},{...attachment,originalDimensions:{width:0,height:1}}]) {
    assert.equal(sourceBlock({type:'image',attachment:invalid}).attachment,undefined);
    assert.equal(assistantSourceBlock({kind:'image',attachment:invalid}).attachment,undefined);
  }
  assert.equal(sourceBlock({type:'other',attachment}).attachment,undefined);
  assert.equal(sourceBlock({type:'image',data:'AAAA',mediaType:'image/png'}).attachment,undefined);
  assert.equal(sourceBlock({type:'image',url:'javascript:alert(1)'}).imageSrc,undefined);
});
test('retains assistant tool-call navigation and other-block forwarding',()=>{
  assert.deepEqual(assistantSourceBlock({kind:'tool-call',callId:'call',name:'read',argsRaw:'{}'}),{type:'tool-call',content:'{}',callId:'call',toolName:'read'});
  assert.equal(assistantSourceBlock({kind:'other',block:{type:'image',attachment}}).attachment,attachment);
});
