// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ArtifactPreview, parseMediaResult } from './view.js';
import type { MediaRecord } from '../store.js';
vi.mock('@amiba/ui/plugin', async (importOriginal) => ({ ...await importOriginal<typeof import('@amiba/ui/plugin')>(), usePluginT: () => ({ t: (key: string) => key }), ToolRowFrame: () => null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const record: MediaRecord = { id: 'record', sessionId: 'session', model: 'test', provider: 'fixture', protocol: 'native', operation: 'video.generate', status: 'succeeded', createdAt: 1, updatedAt: 1, artifacts: [] };
it('loads audio on demand in bounded chunks and revokes the preview on unmount', async () => {
  const create = vi.fn(() => 'blob:preview'), revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  const artifact = { id: 'asset', path: '/media/sample.mp3', kind: 'audio' as const, mimeType: 'audio/mpeg', size: 4 };
  const read = vi.fn().mockResolvedValueOnce({ ok: true, value: { data: 'AQI=', nextOffset: 2, size: 4, mimeType: 'audio/mpeg' } }).mockResolvedValueOnce({ ok: true, value: { data: 'AwQ=', nextOffset: null, size: 4, mimeType: 'audio/mpeg' } });
  const view = render(<ArtifactPreview record={record} artifact={artifact} api={{ artifact: read } as never} />);
  expect(read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(view.container.querySelector('audio')?.getAttribute('src')).toBe('blob:preview'));
  expect(read).toHaveBeenNthCalledWith(2, 'session', 'record', 'asset', 2);
  expect(screen.getByRole('link').getAttribute('download')).toBe('sample.mp3');
  view.unmount(); expect(revoke).toHaveBeenCalledWith('blob:preview');
});
it('rejects a chunk with a non-advancing cursor instead of looping', async () => {
  const read = vi.fn().mockResolvedValue({ ok: true, value: { data: 'AQI=', nextOffset: 0, size: 4, mimeType: 'image/png' } });
  render(<ArtifactPreview record={record} artifact={{ id: 'asset', path: '/m.png', kind: 'image', mimeType: 'image/png', size: 4 }} api={{ artifact: read } as never} />);
  await screen.findByText('media.error');
  expect(read).toHaveBeenCalledTimes(1);
});
it('extracts the durable record from tool output', () => {
  expect(parseMediaResult(JSON.stringify({ record, jobId: 'media-1' }))).toEqual(record);
  expect(parseMediaResult('not json')).toBeNull();
});
it('renders durable final delivery inline and opens an accessible image lightbox', async () => {
  const { MediaDelivery } = await import('./delivery.js');
  const { mediaDelivery } = await import('../delivery.js');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:final') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const done = { ...record, artifacts: [{ id: 'asset', path: '/private/media/cat.png', kind: 'image' as const, mimeType: 'image/png', size: 2 }] };
  const delivery = mediaDelivery(done).delivery!;
  expect(delivery.markdown).not.toContain('/private/');
  const code = delivery.markdown.split('\n')[1]!;
  const api = { inspect: vi.fn().mockResolvedValue({ ok: true, value: done }), artifact: vi.fn().mockResolvedValue({ ok: true, value: { data: 'AQI=', size: 2, mimeType: 'image/png', nextOffset: null } }) };
  const view = render(<MediaDelivery code={code} api={api as never} />);
  await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button', { name: 'media.enlarge' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  view.unmount();
  render(<MediaDelivery code={code} api={api as never} />);
  await screen.findByRole('img');
  expect(api.inspect).toHaveBeenCalledTimes(2);
});
it('automatically loads inline audio and video without opening another surface', async () => {
  const { MediaDelivery } = await import('./delivery.js');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:player') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const done = { ...record, artifacts: ['audio', 'video'].map(kind => ({ id: kind, path: '/media/' + kind, kind, mimeType: kind + '/mp4', size: 2 })) };
  const api = { inspect: vi.fn().mockResolvedValue({ ok: true, value: done }), artifact: vi.fn(async (_s, _r, id) => ({ ok: true, value: { data: 'AQI=', size: 2, mimeType: id + '/mp4', nextOffset: null } })) };
  const view = render(<MediaDelivery code={JSON.stringify({sessionId:'session',recordId:'record'})} api={api as never} />);
  await waitFor(() => expect(view.container.querySelectorAll('audio[src],video[controls]')).toHaveLength(2));
});
it('does not advertise delivery for failed or empty records', async () => {
  const { mediaDelivery } = await import('../delivery.js');
  expect(mediaDelivery(record).delivery).toBeUndefined();
  expect(mediaDelivery({...record,status:'failed'}).delivery).toBeUndefined();
});
it('renders subtitle companions as downloads, not audio players',async()=>{
 Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=> 'blob:subtitle')});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});
 const read=vi.fn().mockResolvedValue({ok:true,value:{data:'e30=',nextOffset:null,size:2,mimeType:'application/json'}});
 const view=render(<ArtifactPreview record={record} artifact={{id:'sub',path:'/media/subtitle.json',kind:'file',mimeType:'application/json',size:2}} api={{artifact:read} as never}/>);
 await waitFor(()=>expect(screen.getByRole('link').getAttribute('download')).toBe('subtitle.json'));
 expect(view.container.querySelector('audio')).toBeNull();
});
it('provides bounded viewer zoom, reset, and video controls without image zoom', async () => {
  const { MediaViewer } = await import('./MediaViewer.js');
  const close = vi.fn();
  const view = render(<MediaViewer url="blob:image" kind="image" name="Cat" filename="cat.png" onClose={close}/>);
  fireEvent.click(screen.getByRole('button',{name:'media.zoomIn'}));
  expect(screen.getByText('125%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'media.fit'}));
  expect(screen.getByText('100%')).toBeTruthy();
  expect(screen.getByRole('button',{name:'media.zoomOut'}).hasAttribute('disabled')).toBe(true);
  fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});
  expect(close).toHaveBeenCalledTimes(1);
  view.unmount();
  render(<MediaViewer url="blob:video" kind="video" name="Video" filename="clip.mp4" onClose={close}/>);
  expect(screen.queryByRole('button',{name:'media.zoomIn'})).toBeNull();
  expect(screen.getByRole('dialog').querySelector('video[controls]')).toBeTruthy();
});
