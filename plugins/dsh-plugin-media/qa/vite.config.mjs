import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const tailwind = require('tailwindcss');
const config = require('./tailwind.config.js');
export default defineConfig({ root: fileURLToPath(new URL('.',import.meta.url)), server:{host:'127.0.0.1',port:5197,fs:{allow:[fileURLToPath(new URL('../../../..',import.meta.url))]}}, css:{postcss:{plugins:[tailwind({...config,content:[fileURLToPath(new URL('../../dsh-plugin-model-plane/src/client/**/*.tsx',import.meta.url)),fileURLToPath(new URL('../src/client/**/*.tsx',import.meta.url)),fileURLToPath(new URL('../../../packages/ui/src/**/*.tsx',import.meta.url))]})]}} });
