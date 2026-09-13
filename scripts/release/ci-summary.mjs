import fs from 'node:fs';
import path from 'node:path';
import { installerName } from './ci-plan.mjs';
import { productVersion } from './version.mjs';

const target = process.env.PACKAGE_TARGET;
const version = productVersion();
const file = path.resolve('apps/desktop/dist', target, 'release-manifest.json');
const manifest = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : null;
const name = installerName(version, target);
const rows = [
  `### Amiba ${version} · ${target}`,
  '',
  process.env.INSTALLER_URL ? `[${name}](${process.env.INSTALLER_URL})` : 'Build or verification failed; see job logs.',
  process.env.UPDATE_ZIP_URL ? `[${name.replace(/\.dmg$/, '.zip')}](${process.env.UPDATE_ZIP_URL})` : '',
  '',
  manifest?.distributable ? 'Release candidate.' : 'Test package: automatic updates disabled.',
  '',
];
// Diagnostic details belong in the job log, not in the download list.
console.log(JSON.stringify({ sourceCommit: manifest?.sourceCommit, buildId: manifest?.buildId }));
const footprint = path.resolve('apps/desktop/dist', target, 'package-footprint.json');
if (fs.existsSync(footprint)) console.log(fs.readFileSync(footprint, 'utf8'));
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.filter(row => row !== undefined).join('\n'));
