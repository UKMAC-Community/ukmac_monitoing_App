// Writes what a UI-only update needs to know (see src-tauri/src/services/ui_update.rs):
//   - public/ukmac-ui.json: this UI's version and the fingerprint of the native side (Rust code) it was built against, served with the UI;
//   - src-tauri/native-fingerprint.txt: the same fingerprint, built into the app by build.rs.
// A UI-only update is only ever applied to an app whose native fingerprint is the same, so a UI that expects a new Rust command, or a new
// database step, is never put on an older app. The fingerprint leaves out the version number, so a release that changes only the UI keeps it.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const tauri = join(root, 'src-tauri');

/** Every file under a folder, as paths relative to the root with / separators, in a fixed order. */
function filesUnder(folder, keep) {
  if (!existsSync(folder)) return [];
  const out = [];
  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path, keep));
    else if (keep(name)) out.push(path);
  }
  return out;
}

const hash = createHash('sha256');
const add = (label, text) => hash.update(`${label}\n${text.replace(/\r\n/g, '\n')}\n--\n`);

const files = [
  ...filesUnder(join(tauri, 'src'), (name) => name.endsWith('.rs')),
  ...filesUnder(join(tauri, 'capabilities'), (name) => name.endsWith('.json')),
  join(tauri, 'build.rs'),
];
for (const file of files) add(relative(tauri, file).split(sep).join('/'), readFileSync(file, 'utf8'));
// The dependencies, without this app's own version line.
add('Cargo.toml', readFileSync(join(tauri, 'Cargo.toml'), 'utf8').replace(/^version = ".*"$/m, ''));
// The configuration, without its version.
const config = JSON.parse(readFileSync(join(tauri, 'tauri.conf.json'), 'utf8'));
delete config.version;
add('tauri.conf.json', JSON.stringify(config));

const fingerprint = hash.digest('hex').slice(0, 32);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public', 'ukmac-ui.json'), JSON.stringify({ version, fingerprint }) + '\n');
writeFileSync(join(tauri, 'native-fingerprint.txt'), fingerprint + '\n');
console.log(`UI ${version}, native ${fingerprint}`);
