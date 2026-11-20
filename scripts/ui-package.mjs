// Packs the built screens (dist/ukmac-monitoring/browser) into the signed package a UI-only update downloads, with the manifest
// (ui-latest.json) that points at it. Run after `npm run build`:
//   node scripts/ui-package.mjs <out folder> <base url the files will be served from>
// The signing key is read from TAURI_SIGNING_PRIVATE_KEY (its text) or TAURI_SIGNING_PRIVATE_KEY_PATH, as for the normal updates.
// See src-tauri/src/services/ui_update.rs.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const [out, base] = process.argv.slice(2);
if (!out || !base) {
  console.error('usage: node scripts/ui-package.mjs <out folder> <base url>');
  process.exit(1);
}
const dist = process.env.UI_DIST ?? join(root, 'dist', 'ukmac-monitoring', 'browser');
const described = JSON.parse(readFileSync(join(dist, 'ukmac-ui.json'), 'utf8'));
mkdirSync(out, { recursive: true });
const name = `ui-${described.version}.tar.gz`;
const file = resolve(out, name);
// Files at the top of the package (no leading folder), as the app unpacks them.
execFileSync('tar', ['-czf', file, '-C', dist, '.'], { stdio: 'inherit' });

const env = { ...process.env };
const args = ['tauri', 'signer', 'sign'];
if (env.TAURI_SIGNING_PRIVATE_KEY_PATH && existsSync(env.TAURI_SIGNING_PRIVATE_KEY_PATH)) args.push('-f', env.TAURI_SIGNING_PRIVATE_KEY_PATH);
else if (env.TAURI_SIGNING_PRIVATE_KEY) args.push('-k', env.TAURI_SIGNING_PRIVATE_KEY);
else {
  console.error('No signing key: set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH');
  process.exit(1);
}
args.push('-p', env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '', file);
execFileSync('npx', args, { stdio: ['ignore', 'ignore', 'inherit'] });
const signature = readFileSync(`${file}.sig`, 'utf8').trim();

const manifest = {
  version: described.version,
  fingerprint: described.fingerprint,
  url: `${base.replace(/\/$/, '')}/${name}`,
  signature,
  notes: process.env.UI_NOTES ?? '',
};
writeFileSync(join(out, 'ui-latest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${name} (${described.version}, native ${described.fingerprint})`);
