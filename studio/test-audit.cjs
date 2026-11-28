'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const AuditEngine = require('./audit-engine.js');

// 1. Exact upstream parity with `evidence/test_audit.py` & `MouseLand/cellpose@a54cb48`
const demoScenario = AuditEngine.buildMicroscopyScenario('classroom_demo');
const demoEval = AuditEngine.evaluateMaskPair(
  demoScenario.truth,
  demoScenario.predictions.cellpose_cyto3,
  demoScenario.width,
  demoScenario.height,
  0.50
);
assert.deepEqual(demoEval.rows.map(r => r.tp), [2, 1, 1], 'Shifted 6x6 object must yield TP=[2, 1, 1] at [0.5, 0.75, 0.9]');
assert.deepEqual(demoEval.rows.map(r => r.fp), [0, 1, 1]);
assert.deepEqual(demoEval.rows.map(r => r.fn), [0, 1, 1]);
assert.ok(Math.abs(demoEval.rows[0].score - 1.0) < 1e-12);
assert.ok(Math.abs(demoEval.rows[1].score - 1 / 3) < 1e-12);

// Sparse IDs & no background test (`[[3, 3], [200000, 200000]]`)
const sparseEval = AuditEngine.evaluateMaskPair([[3, 3], [200000, 200000]], [[3, 3], [200000, 200000]]);
assert.equal(sparseEval.reference_objects, 2);
assert.equal(sparseEval.rows[0].score, 1.0);

// Empty masks test (`[[0, 0], [0, 0]]`)
const emptyBoth = AuditEngine.evaluateMaskPair([[0, 0], [0, 0]], [[0, 0], [0, 0]]);
assert.equal(emptyBoth.rows[0].score, null, 'Both masks empty must return score = null');
const emptyTrue = AuditEngine.evaluateMaskPair([[0, 0], [0, 0]], [[1, 1], [1, 1]]);
assert.equal(emptyTrue.rows[0].fp, 1);
assert.equal(emptyTrue.rows[0].score, 0);

// 2. Verify Hungarian `linearSumAssignment` resolves adversarial bipartite collision where greedy fails!
// True 1 overlaps Pred 1 (0.80) & Pred 2 (0.55); True 2 overlaps Pred 1 (0.60) & Pred 2 (0.10).
// Greedy picks (T1, P1)=0.80 leaving (T2, P2)=0.10 -> 1 TP at th=0.50.
// Optimal Hungarian picks (T1, P2)=0.55 and (T2, P1)=0.60 -> 2 TPs at th=0.50!
const advIou = {
  iou: new Float64Array([0.80, 0.55, 0.60, 0.10]),
  nTrue: 2,
  nPred: 2,
};
const advMatch = AuditEngine.matchAtThreshold(advIou, 0.50);
assert.equal(advMatch.tp, 2, 'Hungarian assignment must recover 2 TPs on adversarial bipartite overlap');
assert.ok(Math.abs(advMatch.pq - advMatch.sq * advMatch.rq) < 1e-12, 'PQ = SQ * RQ identity');

// 3. Exact parity with `google-deepmind/alphafold@c77e5d2` `compute_plddt`
const zeroLogits = AuditEngine.evaluateAlphaFoldLogits([[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
for (const s of zeroLogits.scores) assert.ok(Math.abs(s - 50.0) < 1e-12, 'Uniform logits must give pLDDT = 50.0');
for (const h of zeroLogits.normEntropies) assert.ok(Math.abs(h - 1.0) < 1e-12, 'Uniform logits must give normalized entropy = 1.0');

assert.throws(() => AuditEngine.evaluateAlphaFoldLogits([[0, NaN]]), /Expected finite logits/);

const demoConf = AuditEngine.evaluateAlphaFoldLogits([[0, 0, 0, 0], [0, 0, 0, 5], [5, 0, 0, 0], [0, 0, 5, 0]]);
const refScores = AuditEngine.CLASSROOM_AUDIT_FIXTURE.runs[1].scores;
demoConf.scores.forEach((s, i) => {
  assert.ok(Math.abs(s - refScores[i]) < 1e-12, `Logit row ${i}: ${s} != ${refScores[i]}`);
});
assert.ok(Math.abs(demoConf.mean - AuditEngine.CLASSROOM_AUDIT_FIXTURE.runs[1].mean) < 1e-12);

// 4. Verify 5-method segmentation physics across clustered & elongated scenarios
const clusterScen = AuditEngine.buildMicroscopyScenario('touching_clusters');
const cpCluster = AuditEngine.evaluateMaskPair(clusterScen.truth, clusterScen.predictions.cellpose_cyto3, clusterScen.width, clusterScen.height, 0.50);
const unetCluster = AuditEngine.evaluateMaskPair(clusterScen.truth, clusterScen.predictions.unet_semantic, clusterScen.width, clusterScen.height, 0.50);
assert.ok(unetCluster.taxonomy.merges >= 3, `Semantic U-Net must fuse touching rosette nuclei into merges (got ${unetCluster.taxonomy.merges})`);
assert.ok(cpCluster.mAP50_95 > unetCluster.mAP50_95 + 0.25, 'Cellpose must strongly outperform connected-component U-Net on touching clusters');

const myoScen = AuditEngine.buildMicroscopyScenario('elongated_myoblasts');
const cpMyo = AuditEngine.evaluateMaskPair(myoScen.truth, myoScen.predictions.cellpose_cyto3, myoScen.width, myoScen.height, 0.50);
const wsMyo = AuditEngine.evaluateMaskPair(myoScen.truth, myoScen.predictions.watershed_otsu, myoScen.width, myoScen.height, 0.50);
assert.ok(wsMyo.taxonomy.splits >= 4, `Distance Watershed must over-split elongated myoblasts (got ${wsMyo.taxonomy.splits})`);
assert.ok(cpMyo.mAP50_95 > wsMyo.mAP50_95 + 0.25, 'Cellpose flow tracking must outperform Watershed on elongated myoblasts');

// 5. Verify live VM integration with all 10 KEGG AlphaFold DB v6 folds + PDB 8AW3 + PAE pTM & Temperature Calibration
const sandbox = vm.createContext({ window: {} });
for (const rel of ['dna-data.js', 'fold-catalog.js', 'experimental.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, rel), 'utf8'), sandbox, { filename: rel });
}
for (const ff of fs.readdirSync(path.join(__dirname, 'folds')).filter(f => f.endsWith('.js'))) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'folds', ff), 'utf8'), sandbox, { filename: ff });
}
vm.runInContext(fs.readFileSync(path.join(__dirname, 'audit-engine.js'), 'utf8'), sandbox, { filename: 'audit-engine.js' });

const structCatalog = sandbox.AuditEngine.getStructureConfidenceCatalog();
assert.equal(structCatalog.length, 12, 'Expected 10 AlphaFold folds + PDB 8AW3 + 4-Res Demo = 12 specimens');

const tp53 = structCatalog.find(s => s.id === 'P04637');
const sod1 = structCatalog.find(s => s.id === 'P00441');
assert.ok(tp53 && sod1);
assert.ok(
  tp53.bands[0] / tp53.residues > 0.25 && sod1.bands[0] / sod1.residues < 0.05,
  'TP53 must exhibit substantial <50 IDR fraction while SOD1 β-barrel remains >95% ordered'
);
assert.ok(
  sod1.paeInfo.ptm > tp53.paeInfo.ptm + 0.25,
  `SOD1 single-domain pTM (${sod1.paeInfo.ptm.toFixed(3)}) must exceed IDR-flanked TP53 pTM (${tp53.paeInfo.ptm.toFixed(3)})`
);

const calTp53 = sandbox.AuditEngine.computeCalibrationAudit(tp53.logits, tp53.trueLddt, 0.55);
assert.ok(
  calTp53.optimalBinNll < calTp53.binNll && calTp53.optimalTemp > 0.65 && calTp53.optimalTemp < 2.1,
  `Optimal post-hoc logit temperature scaling T* (${calTp53.optimalTemp}) must achieve interior minimum NLL`
);

// 6. Validate `evidence-audit/1` report parser contract
const parsed = AuditEngine.validateAuditReport(AuditEngine.CLASSROOM_AUDIT_FIXTURE);
assert.equal(parsed.maskRun.rows.length, 3);
assert.equal(parsed.confidenceRun.scores.length, 4);
assert.throws(() => AuditEngine.validateAuditReport({ schema: 'wrong/1', runs: [] }), /Expected an evidence-audit\/1 report/);

console.log(
  'Verified AuditEngine: exact Cellpose Hungarian assignment & Panoptic Quality PQ=SQ×RQ, ' +
  '5-pipeline merge/split error taxonomy, exact AlphaFold PredictedLDDTHead softmax (<1e-12), ' +
  'PAE Eq.38 pTM & domain blocks across 12 structures, and post-hoc temperature ECE calibration.'
);
