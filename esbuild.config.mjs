import esbuild from 'esbuild';
import { readFile } from 'node:fs/promises';
const dictionaryLicense = await readFile('data/CMUDICT-LICENSE.txt', 'utf8');
const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  target: 'es2022',
  platform: 'node',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  sourcemap: process.argv.includes('--watch') ? 'inline' : false,
  banner: { js: `/* Context Cards — local-first vocabulary capture for Obsidian.\n\nBundled CMUdict notice:\n${dictionaryLicense.replaceAll('*/', '* /')}\n*/` },
});
if (process.argv.includes('--watch')) await context.watch();
else {
  await context.rebuild();
  await context.dispose();
}
