import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const folder = path.resolve('release', manifest.id);
await mkdir(folder, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(file, path.join(folder, file));
await copyFile('data/CMUDICT-LICENSE.txt', path.join(folder, 'CMUDICT-LICENSE.txt'));
await writeFile(
  path.join(folder, 'INSTALL.txt'),
  `Context Cards ${manifest.version}\n\nCopy the context-cards folder into your vault's .obsidian/plugins/ directory.\nEnable Context Cards in Obsidian Settings > Community plugins.\nOpen Context Cards settings and check Ollama and AnkiConnect.\n\nSelect a word in Reading Mode or Live Preview, then click Create cards.\nReview the draft, preview both cards, and approve to add to Anki.\n\nBoth cards are stored in one note and one book deck.\nEnable Bury siblings in Anki. Text generation is local; no Markdown notes are created.\n`,
);
const files = {};
for (const name of ['main.js', 'manifest.json', 'styles.css', 'INSTALL.txt', 'CMUDICT-LICENSE.txt'])
  files[`${manifest.id}/${name}`] = new Uint8Array(await readFile(path.join(folder, name)));
await writeFile(
  path.resolve('release', `${manifest.id}-${manifest.version}.zip`),
  zipSync(files, { level: 9 }),
);
console.log(`Packaged release/context-cards-${manifest.version}.zip`);
