// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { MediaSettings } from './settings.js';
vi.mock('@amiba/i18n', () => ({useT: () => ({t: (key: string) => key})}));
vi.mock('@amiba/i18n/plugin', () => ({usePluginT: () => ({t: (key: string) => key})}));
beforeAll(() => {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  HTMLElement.prototype.scrollIntoView = () => {};
});
afterEach(cleanup);
function fixture(fail = false) {
  const catalog = {revision: 7, defaults: {}, providers: [{id:'fixture',available:true,description:{
    name:'Fixture', models:[
      {id:'image',name:'Image model',description:'Precise typography and reference images.',operations:['image.generate'],protocols:['image-api']},
      {id:'video',name:'Video model',operations:['video.generate'],protocols:['video-api']},
    ], protocols:[{id:'image-api',operations:['image.generate']},{id:'video-api',operations:['video.generate']}],
  }}]};
  const api = {
    catalog: vi.fn(async () => ({ok:true,value:JSON.stringify(catalog)})),
    setDefault: vi.fn(async () => ({ok:!fail,value:true})),
  };
  render(<MediaSettings api={api as never}/>);
  return api;
}
it('uses the shared searchable dialog and saves the selected native protocol', async () => {
  const api = fixture();
  const trigger = screen.getByRole('button',{name:/^Images/});
  await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false));
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).queryByText('Video model')).toBeNull();
  fireEvent.change(within(dialog).getByTestId('model-picker-input'),{target:{value:'typography'}});
  expect(within(dialog).queryByText('Precise typography and reference images.')).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', {name:'options.models.details.openFor'}));
  const details = screen.getByText('Precise typography and reference images.').closest('[role="dialog"]')!;
  expect(details).toBeTruthy();
  expect(api.setDefault).not.toHaveBeenCalled();
  fireEvent.keyDown(details, {key:'Escape'});
  await waitFor(() => expect(screen.queryByText('Precise typography and reference images.')).toBeNull());
  fireEvent.click(within(dialog).getByRole('option',{name:/Image model/}));
  await waitFor(() => expect(api.setDefault).toHaveBeenCalledWith('image.generate',JSON.stringify({provider:'fixture',model:'image',protocol:'image-api'}),7));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
it('keeps the dialog open on save failure and offers automatic selection', async () => {
  const api = fixture(true);
  const trigger = screen.getByRole('button',{name:/^Video/});
  await waitFor(() => expect(trigger.hasAttribute('disabled')).toBe(false));
  fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('option',{name:/Let the Agent choose/}));
  await waitFor(() => expect(api.setDefault).toHaveBeenCalledWith('video.generate','null',7));
  await waitFor(() => expect(within(screen.getByRole('dialog')).getByText('Could not read or save. Refresh and try again.')).toBeTruthy());
});
