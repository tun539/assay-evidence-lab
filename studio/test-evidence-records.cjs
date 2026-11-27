'use strict';

const assert = require('node:assert/strict');

// Minimal in-memory localStorage mock for Node testing
const store = new Map();
globalThis.localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
  clear() { store.clear(); },
};

const evidenceRecords = require('./evidence-records.js');

// 1. Empty workspace defaults
assert.deepEqual(evidenceRecords.read(), []);
assert.equal(evidenceRecords.count(), 0);
assert.equal(evidenceRecords.readNote(), '');

// 2. Capture and read back
const first = evidenceRecords.capture({
  kind: 'measured',
  title: 'Condition-specific Vmax and Km · 0.56 ppm',
  dataset: 'Puromycin · galactosyltransferase initial rates',
  method: 'Leave one concentration out',
  metric: 'Held-out RMSE',
  unit: 'counts/min/min',
  value: 7.21,
  source: 'https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/Puromycin.html',
  details: { comparisonKey: 'puromycin-holdout-0.56', concentrationPpm: 0.56, model: 'split_both' },
});
assert.ok(first.id);
assert.equal(evidenceRecords.read().length, 1);
assert.equal(evidenceRecords.count(), 1);

// 3. Merge sample packet + verify direct compatibility with kinetics workbench capture
const sample = evidenceRecords.samplePacket();
assert.equal(evidenceRecords.merge(sample), 2);
assert.equal(evidenceRecords.merge(sample), 0); // idempotent deduplication
assert.equal(evidenceRecords.count(), 3);

const runs3 = evidenceRecords.read();
const peers = evidenceRecords.compatibleIds(first, runs3);
assert.equal(peers.length, 2);
assert.ok(peers.includes('sample-puromycin-shared-056'));
assert.ok(peers.includes('sample-puromycin-vmax-056'));

// 4. Compatible comparison math & detail diffs
const sharedRun = runs3.find(r => r.id === 'sample-puromycin-shared-056');
const vmaxRun = runs3.find(r => r.id === 'sample-puromycin-vmax-056');
const comp = evidenceRecords.compare(sharedRun, vmaxRun);
assert.equal(comp.comparable, true);
assert.deepEqual(comp.mismatches, []);
assert.ok(Math.abs(comp.delta - (9.6115 - 23.4097)) < 1e-9);
assert.ok(Math.abs(comp.percentChange - ((9.6115 - 23.4097) / 23.4097) * 100) < 1e-9);
assert.equal(comp.detailDiffs.find(d => d.key === 'model').same, false);
assert.equal(comp.detailDiffs.find(d => d.key === 'concentrationPpm').same, true);

// 5. Incompatible comparison (different kind / dataset / comparisonKey)
const sim = evidenceRecords.capture({
  kind: 'simulated',
  title: 'Assay 1 · 0.56 ppm',
  dataset: 'Synthetic Michaelis–Menten task',
  method: 'Gaussian decoder',
  metric: 'Observed second rate',
  unit: 'counts/min/min',
  value: 142.5,
  source: 'ml/molecular.py',
  details: { comparisonKey: 'episode-1-dose-0.56', episode: 1 },
});
const incomp = evidenceRecords.compare(sharedRun, sim);
assert.equal(incomp.comparable, false);
assert.ok(incomp.mismatches.includes('evidence type'));
assert.ok(incomp.mismatches.includes('dataset'));
assert.equal(incomp.delta, null);
assert.deepEqual(evidenceRecords.compatibleIds(sim, evidenceRecords.read()), []);

// 6. Badge binding helper
const fakeBadge = { textContent: '' };
const refreshBadge = evidenceRecords.bindBadge(fakeBadge, 'Evidence workspace');
assert.equal(fakeBadge.textContent, 'Evidence workspace (4)');

// 7. Invalid packets and invalid runs rejected
assert.throws(() => evidenceRecords.merge({ schema: 'wrong/1', runs: [] }), /Invalid evidence packet/);
assert.throws(() => evidenceRecords.capture({
  kind: 'unknown', title: 'Bad', dataset: 'X', method: 'Y', metric: 'Z', unit: 'u', value: 1, source: 's', details: {},
}), /Expected up to 100 valid/);
assert.throws(() => evidenceRecords.capture({
  kind: 'measured', title: 'NaN', dataset: 'X', method: 'Y', metric: 'Z', unit: 'u', value: Number.NaN, source: 's', details: {},
}), /Expected up to 100 valid/);

// 8. Persisted review note
evidenceRecords.saveNote('Condition-specific Vmax reduces held-out RMSE at 0.56 ppm.');
assert.equal(evidenceRecords.readNote(), 'Condition-specific Vmax reduces held-out RMSE at 0.56 ppm.');

// 9. CSV and Markdown exports
const allRuns = evidenceRecords.read();
const csv = evidenceRecords.toCsv(allRuns);
assert.ok(csv.startsWith('id,saved_at,kind,title,dataset,method,metric,value,unit,source\n'));
assert.equal(csv.trim().split('\n').length, allRuns.length + 1);

const md = evidenceRecords.toMarkdown(allRuns, evidenceRecords.readNote());
assert.ok(md.includes('# Assay Evidence Packet'));
assert.ok(md.includes('## Review note'));
assert.ok(md.includes('Condition-specific Vmax reduces held-out RMSE at 0.56 ppm.'));
assert.ok(md.includes('| Type | Title | Dataset | Method | Metric | Value | Unit | Saved |'));

// 10. Remove, clear, and badge update
evidenceRecords.remove(sim.id);
assert.equal(evidenceRecords.count(), 3);
refreshBadge();
assert.equal(fakeBadge.textContent, 'Evidence workspace (3)');

evidenceRecords.clear();
assert.deepEqual(evidenceRecords.read(), []);
refreshBadge();
assert.equal(fakeBadge.textContent, 'Evidence workspace');

console.log('All evidence-records tests passed (capture, count, compatibleIds, compare, merge, badge, validation, note, CSV/Markdown export, remove/clear).');
