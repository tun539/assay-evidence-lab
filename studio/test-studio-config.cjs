'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');

// Minimal in-memory localStorage mock
const store = new Map();
globalThis.localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
  clear() { store.clear(); },
};

const defaultConfig = require('./studio-config.js');
const studioRuntime = require('./studio-runtime.js');

// 1. Default configuration loads cleanly
assert.equal(defaultConfig.brandName, 'Assay Evidence Studio');
assert.equal(defaultConfig.labs.length, 12);
assert.equal(studioRuntime.hasPreview(), false);
assert.equal(studioRuntime.get().brandName, 'Assay Evidence Studio');

// 2. Sanitization blocks unsafe links and invalid hex colors
const sanitized = studioRuntime.sanitize({
  brandName: '  My Bio Lab  ',
  theme: { primary: '#123456', accent: 'not-a-color' },
  labs: [
    { id: 'bad', title: 'Evil', href: 'javascript:alert(1)', description: 'blocked' },
    { id: 'good', title: 'Custom Kinetics', href: 'kinetics.html', description: 'Safe link', savesToWorkspace: true },
  ],
});
assert.equal(sanitized.brandName, 'My Bio Lab');
assert.equal(sanitized.theme.primary, '#123456');
assert.equal(sanitized.theme.accent, defaultConfig.theme.accent);
assert.equal(sanitized.labs.length, 1);
assert.equal(sanitized.labs[0].href, 'kinetics.html');

// 3. Save preview, read override, apply theme variables, and clear preview
studioRuntime.savePreview({ brandName: 'Custom Lab Preview', theme: { primary: '#16425b' } });
assert.equal(studioRuntime.hasPreview(), true);
assert.equal(studioRuntime.get().brandName, 'Custom Lab Preview');

const cssVars = new Map();
studioRuntime.applyTheme(studioRuntime.get(), { style: { setProperty: (k, v) => cssVars.set(k, v) } });
assert.equal(cssVars.get('--studio-primary'), '#16425b');

studioRuntime.clearPreview();
assert.equal(studioRuntime.hasPreview(), false);
assert.equal(studioRuntime.get().brandName, 'Assay Evidence Studio');

// 4. Serialize produces valid, executable studio-config.js that round-trips cleanly
const code = studioRuntime.serialize({
  ...defaultConfig,
  brandName: 'Roundtrip Lab',
  heroTitlePrefix: 'Custom',
  heroTitleAccent: 'Science Hub',
});
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(code, sandbox);
assert.equal(sandbox.STUDIO_CONFIG.brandName, 'Roundtrip Lab');
assert.equal(sandbox.STUDIO_CONFIG.heroTitleAccent, 'Science Hub');
assert.equal(sandbox.STUDIO_CONFIG.labs.length, 12);

// 5. GitHub edit URL helper
assert.equal(
  studioRuntime.githubEditUrl(defaultConfig),
  'https://github.com/tun539/assay-evidence-lab/edit/main/studio/studio-config.js'
);

console.log('All studio-config tests passed (defaults, XSS/hex sanitization, preview lifecycle, theme vars, JS serialization round-trip).');
