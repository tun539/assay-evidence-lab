'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const TransportEngine = require('./transport-engine.js');

// 1. Verify all 8 transport modes & 6 compartment presets are defined
assert.equal(TransportEngine.TRANSPORT_MODES.length, 8, 'Expected 8 generative 3D transport regimes');
assert.equal(TransportEngine.COMPARTMENT_PRESETS.length, 6, 'Expected 6 biological compartment presets');

// 2. Verify Stokes–Einstein macromolecule catalog both standalone and with live AlphaFold/PDB bundles
const standaloneCatalog = TransportEngine.getMacromoleculeCatalog();
assert.equal(standaloneCatalog.length, 14, 'Expected 14 macromolecular tracers in standalone mode');
for (let i = 1; i < standaloneCatalog.length; i++) {
  assert.ok(standaloneCatalog[i].rgNm >= standaloneCatalog[i - 1].rgNm, 'Macromolecules must sort ascending by Rg');
  const dPrev = TransportEngine.stokesEinsteinD(standaloneCatalog[i - 1].rhNm, 160);
  const dCurr = TransportEngine.stokesEinsteinD(standaloneCatalog[i].rhNm, 160);
  assert.ok(dCurr <= dPrev + 1e-12, 'Stokes–Einstein diffusivity D must decrease monotonically with Rh');
}

// Verify live VM resolution against top-level const foldIds / bundledFolds / experimental
const sandbox = vm.createContext({ window: {} });
for (const rel of ['dna-data.js', 'fold-catalog.js', 'experimental.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf8'), sandbox, { filename: rel });
}
const foldFiles = fs.readdirSync(path.join(__dirname, 'folds')).filter(f => f.endsWith('.js'));
for (const ff of foldFiles) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'folds', ff), 'utf8'), sandbox, { filename: ff });
}
vm.runInContext(fs.readFileSync(path.join(__dirname, 'transport-engine.js'), 'utf8'), sandbox, { filename: 'transport-engine.js' });
const browserCatalog = sandbox.TransportEngine.getMacromoleculeCatalog();
assert.equal(browserCatalog.length, 14, 'Expected 14 macromolecular tracers resolved from live browser consts');
for (const item of browserCatalog) {
  assert.ok(Number.isFinite(item.rgNm) && item.rgNm > 0.8 && item.rgNm < 6.0, `${item.id}: invalid Rg ${item.rgNm}`);
  assert.ok(Number.isFinite(item.rhNm) && item.rhNm > 1.0 && item.rhNm < 8.0, `${item.id}: invalid Rh ${item.rhNm}`);
}
const tp53 = browserCatalog.find(m => m.id === 'P04637');
const sod1 = browserCatalog.find(m => m.id === 'P00441');
assert.ok(tp53.rgNm > sod1.rgNm * 1.8, `TP53 extended Rg (${tp53.rgNm} nm) must exceed compact SOD1 (${sod1.rgNm} nm)`);

// 3. Analytical EA-MSD parity across Brownian, Drift, Harmonic Trap, Anisotropic, and Wave
for (const cfg of [
  { mode: 'free', D: 0.25, strength: 0 },
  { mode: 'drift', D: 0.20, strength: 0.9 },
  { mode: 'trap', D: 0.25, strength: 1.2 },
  { mode: 'axis', D: 0.20, strength: 1.5 },
  { mode: 'wave', D: 0.20, strength: 1.2 },
]) {
  const res = TransportEngine.runExperiment({ ...cfg, count: 240, seed: 41, sigmaLoc: 0, blurR: 0 });
  const finalRow = res.stats.at(-1);
  const relErr = Math.abs(finalRow[1] - finalRow[2]) / Math.max(0.1, finalRow[2]);
  assert.ok(
    relErr < 0.16,
    `${cfg.mode}: empirical MSD ${finalRow[1].toFixed(3)} deviated from theory ${finalRow[2].toFixed(3)} (relErr=${relErr.toFixed(3)})`
  );
}

// 4. Viscoelastic fBm vs. Transient-Trap CTRW biophysical separation (AnDi Challenge physics)
const fbmRun = TransportEngine.runExperiment({
  mode: 'fbm', D: 0.22, strength: 0.50, count: 144, seed: 19, sigmaLoc: 0, blurR: 0,
});
const ctrwRun = TransportEngine.runExperiment({
  mode: 'ctrw', D: 0.22, strength: 0.55, count: 144, seed: 19, sigmaLoc: 0, blurR: 0,
});

// Both are subdiffusive (α̂ < 0.80)
assert.ok(fbmRun.ta.alphaHat < 0.72 && fbmRun.ta.alphaHat > 0.35, `fBm α̂ expected ~0.50, got ${fbmRun.ta.alphaHat}`);
assert.ok(ctrwRun.ta.alphaHat < 0.82, `CTRW EA α̂ expected subdiffusive < 0.82, got ${ctrwRun.ta.alphaHat}`);

// fBm has anti-persistent negative VACF at lag 1 (ρ₁ = 2^(0.5-1) - 1 ≈ -0.293) and back-scattering > 95°
assert.ok(fbmRun.correlations.vacfLag1 < -0.18, `fBm must show viscoelastic recoil C_v(Δt) < -0.18, got ${fbmRun.correlations.vacfLag1}`);
assert.ok(fbmRun.correlations.meanAngleDeg > 98, `fBm mean turning angle must exceed 98°, got ${fbmRun.correlations.meanAngleDeg}`);

// CTRW exhibits Weak Ergodicity Breaking (TA-MSD linear α_TA ≈ 1 >> α_EA, high EB, and leptokurtic Non-Gaussian α₂ > 0.3)
assert.ok(ctrwRun.ta.ebAt10 > fbmRun.ta.ebAt10 * 3.0 && ctrwRun.ta.ebAt10 > 0.25,
  `CTRW EB (${ctrwRun.ta.ebAt10.toFixed(3)}) must strongly exceed ergodic fBm EB (${fbmRun.ta.ebAt10.toFixed(3)})`);
assert.ok(ctrwRun.vanHove.alpha2 > 0.35 && Math.abs(fbmRun.vanHove.alpha2) < 0.20,
  `CTRW Van Hove α₂ (${ctrwRun.vanHove.alpha2.toFixed(3)}) must be strongly non-Gaussian vs Gaussian fBm (${fbmRun.vanHove.alpha2.toFixed(3)})`);
assert.ok(ctrwRun.ta.alphaTaHat > 0.82, `CTRW individual TA-MSD stays linear in lag (got α_TA=${ctrwRun.ta.alphaTaHat.toFixed(3)})`);

// 5. Michalet–Berglund / Vestergaard Covariance-Based Estimator (CVE) vs. biased Naive OLS under 55 nm localization error + R=1/6 blur
const noisyRun = TransportEngine.runExperiment({
  mode: 'free', D: 0.20, count: 144, seed: 77, sigmaLoc: 0.055, blurR: 1 / 6,
});
const cveErr = Math.abs(noisyRun.cve.dCve - 0.20);
const naiveErr = Math.abs(noisyRun.cve.dNaive1 - 0.20);
assert.ok(
  cveErr < 0.025 && naiveErr > 0.045 && cveErr < naiveErr * 0.4,
  `CVE D̂ (${noisyRun.cve.dCve.toFixed(4)}) must beat biased Naive D̂ (${noisyRun.cve.dNaive1.toFixed(4)}) under σ=55 nm, R=1/6`
);
assert.ok(
  Math.abs(noisyRun.cve.sigmaLocHat - 0.055) < 0.008,
  `CVE σ̂_loc (${noisyRun.cve.sigmaLocHat.toFixed(4)} μm) must recover true 0.055 μm within 8 nm`
);

// 6. Spot-On 2-state Bound ⇌ Free jump-length mixture recovery
const twoStateRun = TransportEngine.runExperiment({
  mode: 'two_state', D: 0.35, strength: 0.50, count: 144, seed: 33, sigmaLoc: 0.015, blurR: 0,
});
assert.ok(
  Math.abs(twoStateRun.spotOn.fBoundHat - 0.50) < 0.12,
  `Spot-On bound fraction f̂_bound (${twoStateRun.spotOn.fBoundHat.toFixed(3)}) must recover true 0.50 within 0.12`
);
assert.ok(
  twoStateRun.spotOn.ks2State < twoStateRun.spotOn.ks1State * 0.5,
  `2-state Maxwell CDF KS error (${twoStateRun.spotOn.ks2State.toFixed(4)}) must halve 1-state KS error (${twoStateRun.spotOn.ks1State.toFixed(4)})`
);

// 7. Virtual 3D FRAP mobile fraction separation (Free vs Harmonic Confinement)
const freeFrap = TransportEngine.runExperiment({ mode: 'free', D: 0.30, count: 120, seed: 12, bleachRadius: 0.75 });
const trapFrap = TransportEngine.runExperiment({ mode: 'trap', D: 0.20, strength: 2.2, count: 120, seed: 12, bleachRadius: 0.85 });
assert.ok(freeFrap.frap.mobileFraction > 0.88, `Free diffusion FRAP mobile fraction should approach 1 (got ${freeFrap.frap.mobileFraction})`);
assert.ok(trapFrap.frap.immobileFraction > 0.50, `Confined trap must retain large apparent immobile fraction (got ${trapFrap.frap.immobileFraction})`);

// 8. 7-Model Held-Out Trajectory Inference (`fitMotion`) identifies true generating physics!
const freeNull = TransportEngine.runExperiment({ mode: 'free', D: 0.25, strength: 0, count: 120, seed: 41 });
const isoFit = freeNull.fits.find(f => f.model === 'Isotropic diffusion');
assert.ok(isoFit.deltaLoss < 0.0005, `Isotropic diffusion must match top raw NLL within 5e-4 on Brownian null (got ${isoFit.deltaLoss})`);
assert.equal(isoFit.deltaAic, 0, 'Occam AIC / Akaike weight must select 1-parameter Isotropic diffusion on Brownian null');

const identTests = [
  [{ mode: 'drift', D: 0.20, strength: 1.1, count: 120, seed: 41 }, 'Constant drift'],
  [{ mode: 'wave', D: 0.20, strength: 1.3, count: 120, seed: 41 }, 'Periodic flow'],
  [{ mode: 'trap', D: 0.25, strength: 1.4, count: 120, seed: 41 }, 'Restoring force'],
  [{ mode: 'axis', D: 0.20, strength: 1.8, count: 120, seed: 41 }, 'Axis-dependent diffusion'],
  [{ mode: 'fbm', D: 0.22, strength: 0.45, count: 120, seed: 41 }, 'Viscoelastic memory (fBm)'],
  [{ mode: 'two_state', D: 0.35, strength: 0.50, count: 120, seed: 41 }, 'Two-state bound/free'],
];
for (const [opts, expectedWinner] of identTests) {
  const run = TransportEngine.runExperiment(opts);
  assert.equal(run.fits.length, 7, 'fitMotion must evaluate all 7 candidate models');
  const wSum = run.fits.reduce((s, r) => s + r.weight, 0);
  assert.ok(Math.abs(wSum - 1) < 1e-6, 'Predictive Akaike weights must sum to 1');
  assert.equal(
    run.fits[0].model,
    expectedWinner,
    `Mode "${opts.mode}": expected held-out NLL winner "${expectedWinner}", got "${run.fits[0].model}"`
  );
  assert.equal(run.fits[0].deltaAic, 0, `Mode "${opts.mode}": winner must also lead held-out AIC`);
}

console.log(
  'Verified TransportEngine: 8 3D transport regimes, 14 AlphaFold/PDB Stokes–Einstein tracers, ' +
  'AnDi fBm vs CTRW ergodicity/non-Gaussian separation, Michalet–Berglund CVE & CRLB, Spot-On 2-state CDF, ' +
  'Virtual 3D FRAP, First-Passage survival, and 7-model held-out NLL identification.'
);
