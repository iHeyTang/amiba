export const targets = ['darwin-arm64', 'darwin-x64', 'win32-x64'];
export function releaseSettings(env, target) {
  if (!targets.includes(target)) throw new Error(`Unsupported target: ${target}`);
  const repo = env.AMIBA_GITHUB_REPOSITORY;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Set AMIBA_GITHUB_REPOSITORY=owner/repository');
  const sources = (env.AMIBA_UPDATE_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const source of sources) {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('CDN sources must be HTTPS directory URLs without credentials, query or fragment');
  }
  sources.push(`https://github.com/${repo}/releases/latest/download`);
  return { repo, sources: [...new Set(sources.map(s => s.replace(/\/$/, '') + '/'))], channel: `latest-${target.split('-')[1]}` };
}
