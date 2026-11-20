import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const prefix = `${manifest.id}/`;
const zip = unzipSync(await readFile(`release/${manifest.id}-${manifest.version}.zip`));
const expected = ['main.js', 'manifest.json', 'styles.css', 'INSTALL.txt', 'CMUDICT-LICENSE.txt'];
assert.deepEqual(
  Object.keys(zip).sort(),
  expected.map((n) => prefix + n).sort(),
  'Unexpected/missing archive entries',
);
for (const name of expected)
  assert.deepEqual(Buffer.from(zip[prefix + name]), await readFile(`release/${prefix}${name}`));
assert.equal(
  JSON.parse(Buffer.from(zip[prefix + 'manifest.json']).toString()).version,
  manifest.version,
);
for (const line of (await readFile('release/SHA256SUMS.txt', 'utf8')).trim().split('\n')) {
  const [hash, name] = line.split('  ');
  const asset = name.endsWith('.zip') ? `release/${name}` : `release/${prefix}${name}`;
  assert.equal(
    createHash('sha256')
      .update(await readFile(asset))
      .digest('hex'),
    hash,
  );
}
console.log(
  `Verified ${manifest.version}: installable archive, exact file allowlist and SHA256 checksums.`,
);
