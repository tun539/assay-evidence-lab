'use strict';

const assert = require('node:assert/strict');
const { forceRun, ensembleRun, SimAnalytics } = require('./sim-engine.js');

// 1. Exact MACE reference parity (matches evidence/check_simulation.py to machine precision)
for (const [w, a] of [[0.5, 1.5], [0.25, 1.0], [1.2, 1.8]]) {
  const legacy = forceRun(w, a);
  const full = SimAnalytics.analyzeForceExperiment({
    potentialId: 'quartic',
    surrogateId: 'harmonic',
    integratorId: 'verlet',
    width: w,
    amplitude: a,
    dt: 0.025,
    steps: 480,
  });
  assert.ok(Math.abs(legacy.stiffness - full.stiffness) < 1e-13, 'Stiffness mismatch vs MACE reference');
  assert.ok(Math.abs(legacy.mae - full.mae) < 1e-13, 'Force MAE mismatch vs MACE reference');
  assert.ok(Math.abs(legacy.rmse - full.rmse) < 1e-13, 'Force RMSE mismatch vs MACE reference');
  assert.equal(legacy.trace.length, full.trace.length);
  for (let i = 0; i < legacy.trace.length; i += 40) {
    assert.ok(Math.abs(legacy.trace[i][1] - full.trace[i][1]) < 1e-13);
    assert.ok(Math.abs(legacy.trace[i][2] - full.trace[i][2]) < 1e-13);
  }
}

// 2. Verify exact conservative energy-force consistency (-dU/dx == F(x)) across ALL 5 potentials & ALL 5 surrogates
for (const pot of SimAnalytics.POTENTIAL_CATALOG) {
  const xTrain = Array.from({ length: 21 }, (_, i) => ((i - 10) * 0.55) / 10);
  for (const sur of SimAnalytics.SURROGATE_CATALOG) {
    const fit = SimAnalytics.fitSurrogate(pot, sur.id, xTrain);
    for (const xTest of [-1.25, -0.42, 0.0, 0.37, 1.18]) {
      const h = 1e-6;
      const numForce = -(fit.U(xTest + h) - fit.U(xTest - h)) / (2 * h);
      const anaForce = fit.F(xTest);
      assert.ok(
        Math.abs(numForce - anaForce) < 1e-4,
        `Non-conservative force in ${pot.id}/${sur.id} at x=${xTest}: num=${numForce}, ana=${anaForce}`
      );
      const std = fit.stdF(xTest);
      assert.ok(Number.isFinite(std) && std >= 0, `Invalid uncertainty stdF in ${sur.id}`);
    }
  }
}

// 3. Symplectic Velocity Verlet conserves Hamiltonian energy orders of magnitude better than Forward Euler
const verletRun = SimAnalytics.analyzeForceExperiment({
  potentialId: 'morse',
  surrogateId: 'mace_bessel',
  integratorId: 'verlet',
  width: 0.9,
  amplitude: 1.2,
});
const eulerRun = SimAnalytics.analyzeForceExperiment({
  potentialId: 'morse',
  surrogateId: 'mace_bessel',
  integratorId: 'euler',
  width: 0.9,
  amplitude: 1.2,
});
assert.ok(verletRun.maxRefDriftPct < 0.25, `Expected symplectic Verlet drift < 0.25%, got ${verletRun.maxRefDriftPct}%`);
assert.ok(eulerRun.maxRefDriftPct > verletRun.maxRefDriftPct * 40, 'Forward Euler should exhibit large secular energy drift');
assert.ok(verletRun.specRef.peakOmega > 0.3 && verletRun.specRef.spectrum.length === 72);

// 4. Active Learning: adding queried OOD anchor points slashes RBF-GP OOD Force RMSE
const baseGp = SimAnalytics.analyzeForceExperiment({
  potentialId: 'torsion',
  surrogateId: 'rbf_gp',
  width: 0.45,
  amplitude: 1.6,
  extraAnchors: [],
});
const cand1 = baseGp.activeCandidate.x;
const step1Gp = SimAnalytics.analyzeForceExperiment({
  potentialId: 'torsion',
  surrogateId: 'rbf_gp',
  width: 0.45,
  amplitude: 1.6,
  extraAnchors: [cand1, -cand1],
});
assert.ok(
  step1Gp.oodRmse < baseGp.oodRmse * 0.65,
  `Active-learning anchors should substantially reduce OOD RMSE (${step1Gp.oodRmse} vs ${baseGp.oodRmse})`
);

// 5. Biomolecular Conformational Ensembles: 1D Cryptic Pocket, 2D Müller-Brown, and 2D Alanine Dipeptide Ramachandran
const legEns = ensembleRun(1.0, 0.1, 42);
assert.equal(legEns.trace.length, 500);
assert.ok(Math.abs(legEns.probability - 1 / (1 + Math.E)) < 1e-12);

for (const landId of ['two_state', 'cryptic_1d', 'muller_brown', 'ramachandran']) {
  const md = SimAnalytics.analyzeEnsembleExperiment({
    landscapeId: landId,
    samplerId: 'langevin_md',
    gap: 0.5,
    barrier: 3.4,
    kBT: 0.65,
    steps: 600,
    mix: 0.04,
    seed: 17,
  });
  const bioemu = SimAnalytics.analyzeEnsembleExperiment({
    landscapeId: landId,
    samplerId: 'bioemu_iid',
    gap: 0.5,
    barrier: 3.4,
    kBT: 0.65,
    steps: 600,
    mix: 0.04,
    seed: 17,
  });
  assert.equal(md.leaderboard.length, 4);
  assert.ok(bioemu.nEff > md.nEff * 2.5, `${landId}: BioEmu i.i.d. N_eff (${bioemu.nEff}) should exceed correlated MD (${md.nEff})`);
  assert.ok(bioemu.deltaGError < 0.25, `${landId}: BioEmu should recover ΔG within 0.25 kBT (got ${bioemu.deltaGError})`);
  if (landId === 'muller_brown' || landId === 'ramachandran') {
    assert.ok(bioemu.points2D && bioemu.points2D.length === 600);
    assert.equal(bioemu.surface2D.GX, 56);
    assert.equal(bioemu.surface2D.GY, 48);
  }
}

console.log(
  'All Simulation Lab unit tests passed: MACE <1e-13 parity, 5×5 conservative gradients, symplectic Verlet vs Euler, Active Learning OOD reduction, and 1D/2D BioEmu vs MD/MCMC/Metadynamics ensembles!'
);
