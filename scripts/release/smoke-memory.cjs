// Runs with the packaged standalone Node; never downloads a model or calls an API.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const runtime = process.argv[2];
const fromRuntime = createRequire(path.join(runtime, 'app/package.json'));
// Minimal ONNX Identity graph: float32[2] X -> Y, opset 13, IR 8.
// This fixture tests the native inference backend without shipping/downloading weights.
const integer = (field, value) => Buffer.from([field << 3, value]);
const bytes = (field, value) => { const data = Buffer.isBuffer(value) ? value : Buffer.from(value); assert.ok(data.length < 128); return Buffer.concat([Buffer.from([(field << 3) | 2, data.length]), data]); };
const concat = (...parts) => Buffer.concat(parts);
const valueInfo = name => concat(bytes(1, name), bytes(2, bytes(1, concat(integer(1, 1), bytes(2, bytes(1, integer(1, 2)))))));
const graph = concat(bytes(1, concat(bytes(1, 'X'), bytes(2, 'Y'), bytes(4, 'Identity'))), bytes(2, 'amiba-smoke'), bytes(11, valueInfo('X')), bytes(12, valueInfo('Y')));
const model = concat(integer(1, 8), bytes(7, graph), bytes(8, integer(2, 13)));
(async () => {
  const fromTransformers = createRequire(fromRuntime.resolve('@huggingface/transformers'));
  const ort = fromTransformers('onnxruntime-node');
  const session = await ort.InferenceSession.create(model, { executionProviders: ['cpu'] });
  try { const result = await session.run({ X: new ort.Tensor('float32', Float32Array.from([3, 7]), [2]) }); assert.deepEqual(Array.from(result.Y.data), [3, 7]); }
  finally { await session.release(); }
  const transformers = fromRuntime('@huggingface/transformers');
  transformers.env.allowRemoteModels = false;
  assert.equal(typeof transformers.pipeline, 'function');
  const memos = await import(pathToFileURL(fromRuntime.resolve('@memtensor/memos-local-plugin/dist/adapters/deepseek-harness/index.js')).href);
  assert.equal(typeof memos.apply, 'function');
  console.log('Verified packaged memory: native ONNX CPU inference, Transformers and MemOS adapter load; no model download');
// Let native inference pools finish their cleanup; forced process.exit races ONNX 1.22 on Intel Mac.
})().catch(error => { console.error(error); process.exitCode = 1; });
