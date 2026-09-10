import { expect, it } from 'vitest';
import { needsConfirmation, validEstimate } from './cost-policy.js';
import type { MediaRequest } from './contracts.js';
const request: MediaRequest={model:'fixture',protocol:'native',operation:'image.generate',parameters:{}};
it('lets low-cost work through, but gates high quotes and unpriced costly scenarios',()=>{
 expect(needsConfirmation(request,undefined)).toBe(false);
 expect(needsConfirmation({...request,operation:'video.generate'},undefined)).toBe(true);
 expect(needsConfirmation({...request,parameters:{n:3}},undefined)).toBe(true);
 expect(needsConfirmation({...request,operation:'speech.synthesize',parameters:{text:'a'.repeat(501)}},undefined)).toBe(true);
 expect(needsConfirmation(request,{maximum:.5,currency:'CNY',source:'fixture'})).toBe(false);
 expect(needsConfirmation(request,{maximum:1,currency:'CNY',source:'fixture'})).toBe(true);
 expect(needsConfirmation(request,{maximum:.5,currency:'USD',source:'fixture'})).toBe(true);
 expect(needsConfirmation(request,{maximum:2,currency:'CNY',source:'fixture'},3)).toBe(false);
});
it('rejects expired or malformed estimates instead of displaying invented prices',()=>{
 for(const quote of [{maximum:-1},{maximum:NaN},{maximum:1,minimum:2},{maximum:1,validUntil:1}]) expect(validEstimate({currency:'CNY',source:'fixture',...quote})).toBeUndefined();
});
