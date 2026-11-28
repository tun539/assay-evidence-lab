'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseAssay, compareCurves } = require('./fit.js');
const KineticsAnalytics = require('./kinetics-analytics.js');

const input = fs.readFileSync(path.join(__dirname, '../kinetics/puromycin.csv'), 'utf8');
const rows = parseAssay(input);
const fits = compareCurves(rows);
const reference = require('../kinetics/fits.json');

// 1. Original 2-model practical solver parity against SciPy
for (const [key, ref] of [['shared', 'shared'], ['separate', 'split_both']]) {
  assert.equal(fits[key].predictions.length, 23);
  assert.equal(fits[key].folds.length, 6);
  assert.ok(Math.abs(fits[key].pooled - reference[ref].rmse) < 0.001);
  fits[key].folds.forEach((fold, i) =>
    assert.ok(Math.abs(Math.sqrt(fold.mse) - reference[ref].fold_rmse[i]) < 0.001)
  );
  assert.ok(Math.abs(fits[key].balanced - Math.sqrt(fits[key].folds.reduce((s, f) => s + f.mse, 0) / 6)) < 1e-12);
}

// 2. Full 6-model KineticsAnalytics engine parity against SciPy across all 4 MM models & 24 folds
const indexedRows = rows.map((r, i) => ({ id: String(i + 1), ...r }));
const analysis = KineticsAnalytics.analyzeDataset(indexedRows, { id: 'puromycin' });
assert.equal(analysis.models.length, 6);
assert.ok(Math.abs(analysis.pure.sPure - 9.975) < 0.02, `Unexpected pure replicate error: ${analysis.pure.sPure}`);

for (const mId of ['shared', 'split_vmax', 'split_km', 'split_both']) {
  const got = analysis.summaryByModel[mId];
  assert.ok(
    Math.abs(got.pooled.rmse - reference[mId].rmse) < 0.002,
    `${mId} pooled RMSE ${got.pooled.rmse} != SciPy ${reference[mId].rmse}`
  );
  analysis.foldFits.forEach((f, idx) => {
    const fRmse = f.models[mId].metrics.rmse;
    assert.ok(
      Math.abs(fRmse - reference[mId].fold_rmse[idx]) < 0.002,
      `${mId} fold ${idx} RMSE ${fRmse} != SciPy ${reference[mId].fold_rmse[idx]}`
    );
  });
  assert.ok(got.ood.rmse > got.interp.rmse, `${mId} expected OOD RMSE > In-Domain RMSE on Puromycin`);
  assert.ok(got.pooled.ccc > 0.7 && got.pooled.ccc <= 1.0);
}

// On monotonic Puromycin data, Haldane substrate inhibition cleanly collapses to Ki = Infinity (no overfitting)
assert.equal(analysis.summaryByModel.haldane_both.fullFit.treated.ki, Infinity);
assert.equal(analysis.summaryByModel.haldane_both.fullFit.untreated.ki, Infinity);
assert.ok(analysis.summaryByModel.haldane_both.deltaAicc > 5, 'Monotonic data should penalize unused Ki parameters');

// Verify Akaike weights sum to 1 and split_vmax leads the canonical n=1 MM family on AICc
const weightSum = Object.values(analysis.summaryByModel).reduce((s, m) => s + m.akaikeWeight, 0);
assert.ok(Math.abs(weightSum - 1) < 1e-9);
assert.ok(analysis.summaryByModel.split_vmax.aicc < analysis.summaryByModel.split_both.aicc);

// 3. Curated mechanistic benchmarks recover ground-truth model winners across all 5 datasets
const benchmarks = KineticsAnalytics.getBenchmarks(indexedRows);
assert.equal(Object.keys(benchmarks).length, 5);

const nonComp = KineticsAnalytics.analyzeDataset(benchmarks.noncompetitive.rows, benchmarks.noncompetitive);
assert.equal(
  Object.values(nonComp.summaryByModel).sort((a, b) => a.aicc - b.aicc)[0].id,
  'split_vmax',
  'Non-competitive pure-Vmax benchmark should select split_vmax by AICc'
);

const comp = KineticsAnalytics.analyzeDataset(benchmarks.competitive.rows, benchmarks.competitive);
assert.equal(
  Object.values(comp.summaryByModel).sort((a, b) => a.aicc - b.aicc)[0].id,
  'split_km',
  'Competitive pure-Km benchmark should select split_km by AICc'
);

const coop = KineticsAnalytics.analyzeDataset(benchmarks.cooperative.rows, benchmarks.cooperative);
assert.equal(
  Object.values(coop.summaryByModel).sort((a, b) => a.aicc - b.aicc)[0].id,
  'hill_both',
  'Cooperative Hill n=2.2 benchmark should select hill_both by AICc'
);
assert.ok(coop.summaryByModel.hill_both.pooled.rmse < coop.summaryByModel.split_both.pooled.rmse * 0.25);

const hald = KineticsAnalytics.analyzeDataset(benchmarks.haldane.rows, benchmarks.haldane);
assert.equal(
  Object.values(hald.summaryByModel).sort((a, b) => a.aicc - b.aicc)[0].id,
  'haldane_both',
  'Haldane substrate-inhibition benchmark should select haldane_both by AICc'
);
assert.ok(hald.summaryByModel.haldane_both.akaikeWeight > 0.999);
assert.ok(hald.summaryByModel.haldane_both.pooled.rmse < hald.summaryByModel.split_both.pooled.rmse * 0.15);
assert.ok(hald.summaryByModel.haldane_both.pooled.rmse < hald.summaryByModel.hill_both.pooled.rmse * 0.15);
assert.ok(Math.abs(hald.summaryByModel.haldane_both.fullFit.untreated.ki - 0.35) < 0.04);
assert.ok(Math.abs(hald.summaryByModel.haldane_both.fullFit.treated.ki - 1.80) < 0.20);
assert.ok(Number.isFinite(hald.summaryByModel.haldane_both.fullFit.untreated.sOpt));

// 4. Reject invalid CSV inputs
assert.throws(() => parseAssay(input.replace('0.02,76', '0.02,NaN')));
assert.throws(() => parseAssay('conc,rate,state\n1,3,treated'));

console.log(
  'All 4 MM models × 6 folds match SciPy reference (<0.002), Hill cooperativity, Haldane substrate inhibition & all 5 curated OOD benchmarks verified!'
);
