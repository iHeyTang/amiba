import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canReuseAddedDependencies,patchSetDigest,canReusePatchSet} from './reuse-dependencies.mjs';
test('only reuses exact, already-installed additions without changing the existing graph', async()=>{
  const before={private:true,dependencies:{a:'1.0.0'}};
  const installed=async()=> '2.0.0-rc.2';
  assert.equal(await canReuseAddedDependencies(before,{private:true,dependencies:{a:'1.0.0',b:'2.0.0-rc.2'}},installed),true);
  for(const dependencies of [{a:'1.0.1'},{b:'2.0.0-rc.2'},{a:'1.0.0',b:'^2.0.0'},{a:'1.0.0',b:'2.0.0-rc.1'}])
    assert.equal(await canReuseAddedDependencies(before,{private:true,dependencies},installed),false);
  assert.equal(await canReuseAddedDependencies(before,{...before,overrides:{a:'2'}},installed),false);
});

test('patch upgrades, removals and legacy trees cannot reuse already patched files', async()=>{
  const files={first:"old diff",second:"another diff",moved:"old diff"};
  const read=async file=>files[file];
  const before=await patchSetDigest({"a@1":"first","b@2":"second"},read);
  const reordered=await patchSetDigest({"b@2":"second","a@1":"moved"},read);
  assert.equal(before,reordered);
  assert.equal(canReusePatchSet({patchSetHash:before},reordered),true);
  assert.equal(canReusePatchSet({},before),false);
  files.first="new diff";
  assert.equal(canReusePatchSet({patchSetHash:before},await patchSetDigest({"a@1":"first","b@2":"second"},read)),false);
  assert.equal(canReusePatchSet({patchSetHash:before},await patchSetDigest({"b@2":"second"},read)),false);
  assert.equal(canReusePatchSet({patchSetHash:before},await patchSetDigest({"a@3":"moved","b@2":"second"},read)),false);
});
