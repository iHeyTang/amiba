#!/usr/bin/env node
// Amiba integration helper. Validates through DSH's own skill loader.
import { realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem';

export async function validateDshSkill(directory) {
  const root = await realpath(directory);
  const warnings = [];
  const abort = new AbortController();
  const provider = new FileSystemSkillProvider({
    get: () => undefined,
    logger: { warn: message => warnings.push(message) },
  }, { signal: abort.signal, invalidate() {} }, {
    providerName: 'amiba-skill-validation', includeDefaultRoots: false, watch: false,
  });
  try {
    const definition = await provider.get({
      source: 'custom',
      locator: { path: join(root, 'SKILL.md'), directory: root },
    }, {});
    if (!definition) throw new Error(warnings.join('\n') || 'DSH could not load SKILL.md');
    if (definition.name !== basename(root)) throw new Error('Skill name must match its directory name');
    if (definition.name.length >= 64) throw new Error('Skill name must be under 64 characters');
    if (!definition.content.trim()) throw new Error('Skill body must not be empty');
    return { name: definition.name, invocation: definition.invocation };
  } finally { abort.abort(); await provider.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.argv[2]) throw new Error('Usage: node validate_dsh.mjs <skill-directory>');
    console.log(JSON.stringify(await validateDshSkill(process.argv[2])));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
