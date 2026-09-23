import { mergeConfig } from 'vite';
import { defineConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    css: { include: [/background\.css/] },
    server: { deps: { inline: ['@deepseek-ai/dsh-client-ui-primitives'] } },
  },
}));
