import { readFile, access, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
for (const file of ['index.html', '404.html', 'sw.js', 'offline.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'p/demo-profile/index.html']) {
  await access(path.join('out', file));
}
const html = await readFile('out/index.html', 'utf8');
assert(html.includes('Облік DEMO'), 'Missing demo branding');
assert(!html.includes('chatgpt.site'), 'Old hosting URL remains in exported page');
assert(html.includes(`${base}/manifest.webmanifest`), 'Manifest base path mismatch');
const manifest = JSON.parse(await readFile('out/manifest.webmanifest', 'utf8'));
assert.equal(manifest.start_url, './');
assert.equal(manifest.scope, './');
for (const icon of manifest.icons) {
  assert(icon.src.startsWith('./'), 'Icon URL must be scope-relative');
  await access(path.join('out', icon.src));
}
const assetURLs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
for (const url of assetURLs) {
  if (!url.includes('/_next/')) continue;
  assert(url.startsWith(`${base}/_next/`), `Incorrect asset prefix: ${url}`);
  const relative = url.slice(base.length + 1).split('?')[0];
  await access(path.join('out', relative));
}
await writeFile('out/.nojekyll', '');
console.log('PASS: export files, branding, manifest, icon files, and asset paths');
