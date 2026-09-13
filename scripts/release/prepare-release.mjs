import { root, productVersion } from './version.mjs';
import { gh, preflightRelease } from './release-policy.mjs';
import { releaseSettings } from './config.mjs';

export function checkReleaseConfiguration(env, macSigning = 'signed') {
  if (!['signed', 'unsigned'].includes(macSigning)) throw new Error('Invalid macOS signing mode');
  const missing = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter(key => !env[key]?.trim());
  if (macSigning === 'signed' && missing.length) throw new Error(`Release configuration missing: ${missing.join(', ')}. No version was changed. Configure repository Actions secrets, then run Release again.`);
  releaseSettings({ ...env, AMIBA_GITHUB_REPOSITORY: env.GITHUB_REPOSITORY }, 'darwin-arm64');
}

// Release consumes a version already reviewed and merged through a PR.
// This function must never create commits or update branch refs.
export function prepareRelease({ env, macSigning = 'signed', directory = root, request = gh, preflight = preflightRelease }) {
  checkReleaseConfiguration(env, macSigning);
  if (env.GITHUB_REF !== 'refs/heads/main' || !/^\d+$/.test(env.GITHUB_RUN_ID || '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) throw new Error('Release preparation requires a main workflow run');
  const repo = env.GITHUB_REPOSITORY;
  const version = productVersion(directory);
  const head = JSON.parse(request(['api', `repos/${repo}/git/ref/heads/main`])).object.sha;
  if (head !== env.GITHUB_SHA) throw new Error('main changed since this run started. Start a new Release from current main.');
  preflight(repo, version, head);
  return { version, commit: head };
}
