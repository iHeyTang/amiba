import { Context } from '@deepseek-ai/cordis';
import SettingsProvider from '@deepseek-ai/dsh-settings';
import { expect, it } from 'vitest';
import { MediaPreferences } from './preferences.js';
class MemorySettings extends SettingsProvider {
  readonly writable = true;
  protected async load() { return {}; }
  protected async persist() {}
}
it('uses official optimistic revisions for default selection and detects stale writes', async () => {
  const ctx = new Context();
  const settings = ctx.plugin(MemorySettings); await settings;
  try {
    const preferences = new MediaPreferences(ctx);
    const first = preferences.snapshot();
    const selection = { provider: 'fixture', model: 'image', protocol: 'native' };
    await preferences.set('image.generate', selection, first.revision);
    expect(preferences.snapshot().defaults['image.generate']).toEqual(selection);
    await expect(preferences.set('image.generate', null, first.revision)).rejects.toThrow();
    await preferences.set('image.generate', null, preferences.snapshot().revision);
    expect(preferences.snapshot().defaults['image.generate']).toBeUndefined();
  } finally { await settings.dispose(); }
});

it("persists independent model switches and clears defaults atomically", async () => {
  const ctx = new Context();
  const settings = ctx.plugin(MemorySettings); await settings;
  try {
    const preferences = new MediaPreferences(ctx);
    await preferences.set('image.generate', {provider:'fixture',model:'image',protocol:'native'}, preferences.snapshot().revision);
    const previous = preferences.snapshot().revision;
    await preferences.setEnabled('fixture','image',false,previous);
    expect(preferences.isEnabled('fixture','image')).toBe(false);
    expect(preferences.isEnabled('other','image')).toBe(true);
    expect(preferences.snapshot().defaults['image.generate']).toBeUndefined();
    await expect(preferences.setEnabled('fixture','image',true,previous)).rejects.toThrow();
    await preferences.setEnabled('fixture','image',true,preferences.snapshot().revision);
    expect(preferences.isEnabled('fixture','image')).toBe(true);
  } finally { await settings.dispose(); }
});
it('persists the confirmation threshold and rejects invalid amounts and stale edits',async()=>{
 const ctx=new Context();const settings=ctx.plugin(MemorySettings);await settings;
 try {const p=new MediaPreferences(ctx);const revision=p.snapshot().revision;expect(p.snapshot().confirmationThresholdCny).toBe(1);
 await p.setThreshold(2,revision);expect(p.snapshot().confirmationThresholdCny).toBe(2);
 await expect(p.setThreshold(3,revision)).rejects.toThrow();await expect(p.setThreshold(0,p.snapshot().revision)).rejects.toThrow();
 } finally {await settings.dispose();}
});
