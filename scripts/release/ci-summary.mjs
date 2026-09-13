import fs from 'node:fs';
import path from 'node:path';
import { installerName } from './ci-plan.mjs';
import { productVersion } from './version.mjs';

const target = process.env.PACKAGE_TARGET;
const version = productVersion();
const file = path.resolve('apps/desktop/dist', target, 'release-manifest.json');
const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
const rows = [
  `### Amiba ${version} · ${target} · ${process.env.PACKAGE_MODE}`,
  '',
  process.env.INSTALLER_URL
    ? `[Download ${installerName(version, target)}](${process.env.INSTALLER_URL}) — direct installer, no outer ZIP.`
    : 'Installer was not uploaded: see the failed build or verification step.',
  '',
  manifest?.distributable ? 'Release candidate.' : 'Test package: automatic updates disabled.',
  manifest ? `Built from: \`${manifest.sourceCommit}\` · original build: \`${manifest.buildId}\`.` : '',
  '',
  process.env.UPDATES_URL ? `[Update files and integrity manifest](${process.env.UPDATES_URL}) (for CI/updater use).` : '',
  process.env.REPORTS_URL ? `[Diagnostic reports](${process.env.REPORTS_URL}).` : '',
  '',
];
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.join('\n'));
