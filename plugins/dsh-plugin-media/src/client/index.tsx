import { GenerationConfirmation } from "./GenerationConfirmation.js";
import { MEDIA_CONFIRM_QUESTION } from "../cost-policy.js";
import { mediaMarkdown } from './delivery.js';
import { MediaSettings } from './settings.js';
import type {} from '@amiba/dsh-plugin-ui-shell/client';
import type { Context as ClientContext } from "@deepseek-ai/cordis";
import { MEDIA_REMOTE } from '../remote.js';
import { MediaToolview } from './view.js';
import css from './style.css?inline';
export const name = 'amiba-media-client';
export const inject = ['slots', 'remote'];
export async function apply(ctx: ClientContext) {
  const unmount = await ctx.remote.$mount(MEDIA_REMOTE);
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const fiber = ctx.inject(['slots', 'remote.amibaMediaUi'], child => {
    const confirmation = child.slots.inject('amiba.conversation.question', () => child.slots.register({ name: 'amiba.conversation.question', key: MEDIA_CONFIRM_QUESTION }, GenerationConfirmation));
    const resume = child.slots.inject('tool.call.toolview', () => child.slots.register({ name: 'tool.call.toolview', key: 'media_resume', inject: () => ({ api: child.remote.amibaMediaUi }) }, MediaToolview));
    const dispose = child.slots.inject('tool.call.toolview', () => child.slots.register({ name: 'tool.call.toolview', key: 'media_generate', inject: () => ({ api: child.remote.amibaMediaUi }) }, MediaToolview));
    const settings = child.slots.inject('amiba.models.extension', () => child.slots.register({ name: 'amiba.models.extension', id: 'media', inject: () => ({ api: child.remote.amibaMediaUi }) }, MediaSettings));
    const markdown = child.slots.inject('amiba.markdown.extension', () => child.slots.register({ name: 'amiba.markdown.extension', id: 'amiba.media.delivery', inject: () => ({ extension: mediaMarkdown(child.remote.amibaMediaUi) }) }, () => null));
    return () => { confirmation(); dispose(); resume(); settings(); markdown(); };
  });
  await fiber;
  return async () => { await fiber.dispose(); style.remove(); await unmount(); };
}
