import { Context } from '@deepseek-ai/cordis';
import { expect, it } from 'vitest';
import { MediaRemote } from './remote-service.js';
import type { MediaService } from './service.js';
it('registers UI RPC separately from the provider-facing media service', () => {
  const ctx = new Context();
  const media = {} as MediaService;
  ctx.provide('amibaMedia', media);
  expect(() => new MediaRemote(ctx, media)).not.toThrow();
  expect(ctx.amibaMedia).toBe(media);
});
