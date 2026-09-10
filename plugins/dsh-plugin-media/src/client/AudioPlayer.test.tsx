// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AudioPlayer } from './AudioPlayer.js';
vi.mock('@amiba/ui/plugin', async original => ({...await original<typeof import('@amiba/ui/plugin')>(),usePluginT:()=>({t:(key:string)=>key})}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('plays, seeks and changes speed using custom controls',async()=>{
 const play=vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
 const view=render(<AudioPlayer url="blob:audio" filename="voice.mp3"/>);
 const audio=view.container.querySelector('audio')!;
 Object.defineProperty(audio,'duration',{value:11});fireEvent.loadedMetadata(audio);
 fireEvent.click(screen.getByRole('button',{name:'media.play'}));expect(play).toHaveBeenCalled();
 fireEvent.change(screen.getByRole('slider'),{target:{value:'4'}});expect(audio.currentTime).toBe(4);
 fireEvent.click(screen.getByRole('button',{name:'media.speed'}));fireEvent.click(screen.getByRole('button',{name:'1.5×'}));expect(audio.playbackRate).toBe(1.5);
 expect(audio.hasAttribute('controls')).toBe(false);
 expect(screen.getByRole('link').getAttribute('download')).toBe('voice.mp3');
});
it('shows a playback failure instead of leaving an inert zero-duration control',async()=>{
 vi.spyOn(HTMLMediaElement.prototype,'play').mockRejectedValue(new Error('blocked'));
 render(<AudioPlayer url="blob:audio" filename="voice.mp3"/>);
 fireEvent.click(screen.getByRole('button',{name:'media.play'}));
 expect(await screen.findByRole('alert')).toBeTruthy();
});
