import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const installed=path.join(root,'packages/app-runtime/resources/dsh-runtime/app/node_modules/@deepseek-ai/dsh-client-ui-trajectory');
const work=await mkdtemp(path.join(tmpdir(),'amiba-trajectory-patch-'));
after(()=>rm(work,{recursive:true,force:true}));
assert.equal(JSON.parse(await readFile(path.join(installed,'package.json'),'utf8')).version,'0.1.1-rc.2');
for(const file of ['lib/client.js','lib/types/client/trajectory-record.d.ts','lib/types/client/TrajectoryView.d.ts','lib/types/client/trajectory-contract.d.ts','lib/types/client/index.d.ts']) {
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

const requireUi=createRequire(path.join(root,'packages/ui/package.json'));
const React=requireUi('react');
const jsxRuntime=requireUi('react/jsx-runtime');
const {renderToStaticMarkup}=requireUi('react-dom/server');
const renderStart=patched.indexOf('\t\tconst TrajectoryImagesContext =');
const renderEnd=patched.indexOf('\t\tfunction AssistantToolCalls(',renderStart);
assert.ok(renderStart>=0&&renderEnd>renderStart);
const css=new Proxy({}, {get:(_target,key)=>String(key)});
const imageComponents=new Function('react','react_jsx_runtime','TrajectoryTable_module_css_default','_deepseek_ai_dsh_client_ui_primitives',
  patched.slice(renderStart,renderEnd)+'\nreturn {TrajectoryImagesContext,SourceBlocks,PanelImage,MessageImages};')(React,jsxRuntime,css,{});
const {TrajectoryImagesContext,SourceBlocks,PanelImage,MessageImages}=imageComponents;
function draw(Component,props,renderer=null) {
  return renderToStaticMarkup(React.createElement(TrajectoryImagesContext.Provider,{value:renderer},React.createElement(Component,props)));
}
test('unoccupied trajectory image context preserves inline markup and metadata fallback',()=>{
  const durable=sourceBlock({type:'image',attachment});
  const inline={type:'image',content:'',imageSrc:'data:image/png;base64,AAAA',imageAlt:'old image'};
  assert.equal(draw(MessageImages,{blocks:[durable,inline]}),draw(MessageImages,{blocks:[inline]}));
  assert.equal(draw(PanelImage,{block:durable}),'');
  const withMetadata=draw(SourceBlocks,{blocks:[durable]});
  assert.ok(withMetadata.includes('&quot;attachmentId&quot;'));
  assert.ok(withMetadata.includes('durable'));
  assert.ok(!withMetadata.includes('<img'));
});
test('groups durable occurrences in order while preserving intervening legacy images',()=>{
  const requests=[];
  const durable=sourceBlock({type:'image',attachment});
  const inline={type:'image',content:'',imageSrc:'data:image/png;base64,AAAA'};
  const html=draw(MessageImages,{blocks:[durable,durable,inline,durable],preview:true},owner=>{
    requests.push(owner);
    return React.createElement('span',{'data-count':owner.images.length},'gallery');
  });
  assert.deepEqual(requests.map(owner=>owner.images.length),[2,1]);
  assert.ok(requests.every(owner=>owner.align==='start'&&owner.compact===true));
  assert.equal(requests[0].images[0].attachment,attachment);
  assert.equal(requests[0].images[1].attachment,attachment);
  assert.ok(html.indexOf('data-count="2"')<html.indexOf('<img'));
  assert.ok(html.indexOf('<img')<html.indexOf('data-count="1"'));
});
test('source details dispatch the durable reference while retaining block labels',()=>{
  const requests=[];
  const html=draw(SourceBlocks,{blocks:[sourceBlock({type:'image',attachment})]},owner=>{
    requests.push(owner);return React.createElement('span',null,'detail gallery');
  });
  assert.equal(requests.length,1);
  assert.equal(requests[0].compact,false);
  assert.equal(requests[0].images[0].attachment,attachment);
  assert.ok(html.includes('Block #1 image'));
  assert.ok(html.includes('detail gallery'));
});
