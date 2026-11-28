'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const studioDir = __dirname;
const ctx = vm.createContext({
  console,
  performance: require('node:perf_hooks').performance,
});
ctx.globalThis = ctx;
ctx.window = ctx;

function loadScript(relPath) {
  const raw = fs.readFileSync(path.join(studioDir, relPath), 'utf8');
  const script = raw.replace(
    /^\s*const\s+(dnaRecords|foldIds|bundledFolds|experimental|surveyRows)\s*=/gm,
    'var $1 ='
  );
  vm.runInContext(script, ctx, { filename: relPath });
}

loadScript('dna-data.js');
loadScript('fold-catalog.js');
for (const f of fs.readdirSync(path.join(studioDir, 'folds')).sort()) {
  loadScript('folds/' + f);
}
loadScript('experimental.js');
loadScript('tomography-engine.js');
loadScript('survey-data.js');

const E = ctx.TomographyEngine;
assert.ok(E, 'TomographyEngine must register on globalThis');

// 1. Verify all 16 specimens load and produce normalized [0, 1] slices
const catalog = E.getSpecimenCatalog();
assert.equal(catalog.length, 16, `Expected 16 specimens (10 AlphaFold + 4 PDB + 2 Phantoms), got ${catalog.length}`);
for (const item of catalog) {
  const geom = E.loadSpecimenGeometry(item.id);
  const slice = E.sampleSlice(geom, 0, 64, 'uniform');
  assert.equal(slice.length, 64 * 64);
  const maxVal = Math.max(...slice);
  const minVal = Math.min(...slice);
  assert.ok(minVal >= -1e-12 && maxVal <= 1.5, `${item.id}: unexpected slice range [${minVal}, ${maxVal}]`);
  assert.ok(maxVal > 0.15, `${item.id}: central slice should contain non-trivial density`);
}

// 2. Exact inner-product adjointness: ⟨Ax, y⟩ == ⟨x, Aᵀy⟩ to machine precision!
{
  const N = 64, B = 94, angles = 24;
  const op = E.getRadonOperator(N, B, angles, 180, 0);
  const x = Float64Array.from({ length: N * N }, (_, i) => Math.sin(i * 0.13) ** 2);
  const y = Float64Array.from({ length: angles * B }, (_, j) => Math.cos(j * 0.07) + 1.2);
  const Ax = op.project(x);
  const ATy = op.backproject(y);
  let dot1 = 0, dot2 = 0;
  for (let j = 0; j < Ax.length; j++) dot1 += Ax[j] * y[j];
  for (let i = 0; i < ATy.length; i++) dot2 += x[i] * ATy[i];
  const relErr = Math.abs(dot1 - dot2) / Math.max(1, Math.abs(dot1));
  assert.ok(relErr < 1e-6, `Radon operator adjointness failed: relErr = ${relErr}`);
}

// 3. Monotonic angular & tilt-wedge improvement on AlphaFold SOD1 (P00441)
{
  const r4 = E.runExperiment({ specimenId: 'P00441', angles: 4, spanDeg: 180, passes: 20, solver: 'sirt', compareAllSolvers: false });
  const r24 = E.runExperiment({ specimenId: 'P00441', angles: 24, spanDeg: 180, passes: 20, solver: 'sirt', compareAllSolvers: false });
  const r48 = E.runExperiment({ specimenId: 'P00441', angles: 48, spanDeg: 180, passes: 20, solver: 'sirt', compareAllSolvers: false });
  assert.ok(r24.metrics.rmse < r4.metrics.rmse, '24 views must beat 4 views');
  assert.ok(r48.metrics.rmse < r24.metrics.rmse, '48 views must beat 24 views');
  assert.ok(r48.metrics.frc0143 < r4.metrics.frc0143, '48 views must achieve finer (smaller Å) FRC_0.143 resolution than 4 views');

  const r90 = E.runExperiment({ specimenId: 'P00441', angles: 24, spanDeg: 90, passes: 20, solver: 'sirt', compareAllSolvers: false });
  assert.ok(r24.metrics.rmse < r90.metrics.rmse, '180° full tilt must outperform 90° missing-wedge scan');
  assert.ok(r90.metrics.anisotropyRatio > 1.3, `Expected missing-wedge anisotropy > 1.3 at 90°, got ${r90.metrics.anisotropyRatio}`);
}

// 4. Verify all 6 solvers on Shepp–Logan & Cryo-ET low-dose noisy protein slice
{
  const denseClean = E.runExperiment({ specimenId: 'P68871', angles: 48, spanDeg: 180, passes: 25, solver: 'fbp_ramlak', compareAllSolvers: true });
  assert.equal(denseClean.leaderboard.length, 6, 'Leaderboard must compare all 6 canonical solvers');
  for (const row of denseClean.leaderboard) {
    assert.ok(Number.isFinite(row.rmse) && row.rmse < 0.08, `${row.id}: high RMSE ${row.rmse} at 48 clean views`);
    assert.ok(row.ssim > 0.72 && row.ssim <= 1.0, `${row.id}: invalid SSIM ${row.ssim}`);
  }

  // Under low-dose shot noise (12 e⁻/Å²) & sparse views (16), CS-TV & WBP-Hann must beat unregularized Ram-Lak FBP!
  const noisy = E.runExperiment({
    specimenId: 'P68871',
    angles: 16,
    spanDeg: 120,
    passes: 20,
    dose: 12,
    tvLambda: 0.016,
    solver: 'tv_fista',
    compareAllSolvers: true,
  });
  const byId = Object.fromEntries(noisy.leaderboard.map(r => [r.id, r]));
  assert.ok(
    byId.tv_fista.rmse < byId.fbp_ramlak.rmse,
    `CS-TV (${byId.tv_fista.rmse}) must beat unregularized FBP-RamLak (${byId.fbp_ramlak.rmse}) under low-dose 12 e⁻/Å² + 120° wedge`
  );
  assert.ok(
    byId.wbp_hann.rmse < byId.fbp_ramlak.rmse,
    `Hann WBP (${byId.wbp_hann.rmse}) must suppress shot noise better than unapodized Ram-Lak (${byId.fbp_ramlak.rmse})`
  );
}

// 5. Verify CTF phase-flipping improves corrupted Cryo-EM weak-phase reconstructions
{
  const rawCtf = E.runExperiment({ specimenId: 'P00441', angles: 36, spanDeg: 180, passes: 20, ctfMode: 'cryo_ctf', defocusUm: 2.2, solver: 'sirt', compareAllSolvers: false });
  const flippedCtf = E.runExperiment({ specimenId: 'P00441', angles: 36, spanDeg: 180, passes: 20, ctfMode: 'ctf_flipped', defocusUm: 2.2, solver: 'sirt', compareAllSolvers: false });
  assert.ok(
    flippedCtf.metrics.frc0143 <= rawCtf.metrics.frc0143 + 0.05 && flippedCtf.metrics.rmse <= rawCtf.metrics.rmse,
    `Phase-flipped CTF (${flippedCtf.metrics.rmse}) should improve upon uncorrected CTF (${rawCtf.metrics.rmse})`
  );
}

// 6. Verify Inverse-Crime audit (Kaipio & Somersalo 2007), L-Curve, Leave-One-Tilt-Out & 96×96 High-Res mode
{
  const matched = E.runExperiment({ specimenId: '1MBO', angles: 36, spanDeg: 180, passes: 20, honestForward: false, solver: 'sart', compareAllSolvers: false });
  const shifted = E.runExperiment({ specimenId: '1MBO', angles: 36, spanDeg: 180, passes: 20, honestForward: true, solver: 'sart', compareAllSolvers: false });
  assert.ok(shifted.metrics.rmse > matched.metrics.rmse, 'Honest shifted fine-grid forward model must reveal non-zero discretization error vs matched inverse-crime grid');

  const lcurve = E.computeTVLCurve(matched.op, matched.reconInput, matched.target, 12);
  assert.equal(lcurve.points.length, 7);
  assert.ok(lcurve.points[0].tvNorm > lcurve.points.at(-1).tvNorm, 'Higher TV lambda must decrease ||∇x||_2,1 norm');

  const loto = E.computeLeaveOneTiltOut(64, 94, 24, 180, matched.reconInput, 'sirt', 14, 0.01, matched.physWidth);
  assert.ok(Number.isFinite(loto.projRmse) && loto.shells.length === 14);

  const hiRes = E.runExperiment({ specimenId: '8AW3', N: 96, angles: 24, spanDeg: 180, passes: 12, solver: 'sirt', compareAllSolvers: false });
  assert.equal(hiRes.estimate.length, 96 * 96);
  assert.equal(hiRes.frc.shells[0].frc, 1.0);
}

// 7. Verify 120-row 10-Gene Survey & Projection-Only vs Oracle Leave-One-Protein-Out predictors
assert.equal(ctx.surveyRows.length, 120, `Expected 120 surveyRows (10 genes × 3 spans × 4 angles), got ${ctx.surveyRows.length}`);
for (const learner of ['mean', 'proj_knn', 'neighbor']) {
  const ev = E.evaluateProteinHoldout(ctx.surveyRows, 'P04637', 180, learner);
  assert.equal(ev.rows.length, 4);
  assert.equal(ev.trainCount, 36);
  assert.ok(Number.isFinite(ev.mae) && ev.mae < 0.03, `Holdout learner ${learner} MAE out of bounds: ${ev.mae}`);
}

console.log(
  'All Tomography Workbench unit tests passed: 16 specimens, exact Radon adjointness, ' +
  '6 solvers (SIRT/SART/FBP-RamLak/WBP-Hann/MLEM/CS-TV), FRC_0.143 & SSIM, CTF phase-flipping, ' +
  'Inverse-Crime audit, L-Curve, Leave-One-Tilt-Out CV, and 120-run 10-Gene Holdout ML!'
);
