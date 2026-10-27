/* Copyright (C) 2026 Darkmine Pty Ltd — SPDX-License-Identifier: GPL-3.0-or-later */
import { readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = resolve(root, '.baselode-local.json');
const args = process.argv.slice(2);
const supplied = args.find(arg => !arg.startsWith('--'));
const saved = existsSync(config) ? JSON.parse(readFileSync(config, 'utf8')).path : null;
if (!supplied && !saved) throw new Error('Supply the local baselode package directory: npm run baselode:local -- /path/to/baselode/javascript/packages/baselode');
const target = realpathSync(resolve(root, supplied || saved));
const pkg = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8'));
if (pkg.name !== 'baselode') throw new Error('The selected directory must contain the baselode package.json');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this script through npm run');
function npm(argv, cwd) {
  const result = spawnSync(process.execPath, [npmCli, ...argv], { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
npm(['run', 'build'], target);
const installed = resolve(root, 'node_modules/baselode');
// Rebuild the branch on every launch, but keep an existing correct link.
// Reinstalling here needlessly resolves the viewer's floating dependencies.
if (!existsSync(installed) || realpathSync(installed) !== target) {
  npm(['install', '--no-save', '--package-lock=false', '--install-links=false', '--no-audit', '--no-fund', target], root);
}
if (realpathSync(installed) !== target) throw new Error('Local Baselode link verification failed');
writeFileSync(config, JSON.stringify({ path: target }, null, 2) + '\n');
console.log(`Using local Baselode: ${target}`);
if (!args.includes('--prepare-only')) npm(['run', 'dev', '--', '--force'], root);
