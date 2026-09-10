import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canReuseAddedDependencies} from './reuse-dependencies.mjs';
test('only reuses exact, already-installed additions without changing the existing graph', async()=>{
  const before={private:true,dependencies:{a:'1.0.0'}};
  const installed=async()=> '2.0.0-rc.2';
  assert.equal(await canReuseAddedDependencies(before,{private:true,dependencies:{a:'1.0.0',b:'2.0.0-rc.2'}},installed),true);
  for(const dependencies of [{a:'1.0.1'},{b:'2.0.0-rc.2'},{a:'1.0.0',b:'^2.0.0'},{a:'1.0.0',b:'2.0.0-rc.1'}])
    assert.equal(await canReuseAddedDependencies(before,{private:true,dependencies},installed),false);
  assert.equal(await canReuseAddedDependencies(before,{...before,overrides:{a:'2'}},installed),false);
});
