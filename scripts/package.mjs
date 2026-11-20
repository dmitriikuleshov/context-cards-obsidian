import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (![pkg.version, lock.version, lock.packages[''].version].every((v) => v === manifest.version))
  throw new Error('Manifest, package and lockfile versions must match.');
const folder = path.resolve('release', manifest.id);
await mkdir(folder, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(file, path.join(folder, file));
await copyFile('data/CMUDICT-LICENSE.txt', path.join(folder, 'CMUDICT-LICENSE.txt'));
await writeFile(
  path.join(folder, 'INSTALL.txt'),
  `Context Cards ${manifest.version}\n\n${await readFile('docs/INSTALL.txt', 'utf8')}`,
);
const files = {};
for (const name of ['main.js', 'manifest.json', 'styles.css', 'INSTALL.txt', 'CMUDICT-LICENSE.txt'])
  files[`${manifest.id}/${name}`] = new Uint8Array(await readFile(path.join(folder, name)));
await writeFile(
  path.resolve('release', `${manifest.id}-${manifest.version}.zip`),
  zipSync(files, { level: 9 }),
);
const assets = [
  `${manifest.id}-${manifest.version}.zip`,
  ...['main.js', 'manifest.json', 'styles.css', 'CMUDICT-LICENSE.txt'].map(
    (name) => `${manifest.id}/${name}`,
  ),
];
const sums = await Promise.all(
  assets.map(
    async (name) =>
      `${createHash('sha256')
        .update(await readFile(path.join('release', name)))
        .digest('hex')}  ${path.basename(name)}`,
  ),
);
await writeFile('release/SHA256SUMS.txt', sums.join('\n') + '\n');
console.log(`Packaged release/context-cards-${manifest.version}.zip`);
