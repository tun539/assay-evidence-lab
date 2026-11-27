'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const studioDir = __dirname;
const htmlFiles = fs.readdirSync(studioDir).filter(f => f.endsWith('.html')).sort();
assert.equal(htmlFiles.length, 17, `Expected 17 Studio HTML pages, found ${htmlFiles.length}`);

for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(studioDir, file), 'utf8');
  assert.ok(html.includes('Assay Evidence Studio'), `${file}: must reference Assay Evidence Studio`);
  assert.ok(!html.includes('Assay Evidence Lab'), `${file}: contains legacy "Assay Evidence Lab" string`);
  assert.ok(html.includes('studio-nav.css'), `${file}: missing studio-nav.css`);
  assert.ok(html.includes('studio-nav.js'), `${file}: missing studio-nav.js`);
  assert.ok(html.includes('favicon.svg'), `${file}: missing favicon.svg`);
  assert.ok(html.includes('class="studio-header"'), `${file}: missing unified .studio-header`);
  assert.ok(!html.includes('%3B'), `${file}: contains malformed encoded semicolon URL (%3B)`);

  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1]);
  for (const ref of refs) {
    if (/^(?:https?:|#|mailto:)/.test(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean || clean === 'assay-evidence-studio.zip') continue;
    assert.ok(
      fs.existsSync(path.join(studioDir, clean)),
      `${file}: broken local asset reference "${ref}"`
    );
  }
}

const jsFiles = fs.readdirSync(studioDir).filter(f => f.endsWith('.js')).sort();
for (const file of jsFiles) {
  const code = fs.readFileSync(path.join(studioDir, file), 'utf8');
  assert.doesNotThrow(() => new vm.Script(code, { filename: file }), `${file}: JS syntax error`);
}

console.log(`Verified ${htmlFiles.length} Studio HTML pages (unified header, favicon, branding, asset links) and ${jsFiles.length} JS scripts.`);
