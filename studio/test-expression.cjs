'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ExpressionEngine = require('./expression-engine.js');

// Load expression-data.js from either local repo directory or inspected sibling cache during standalone runs
let dataPath = path.join(__dirname, 'expression-data.js');
if (!fs.existsSync(dataPath)) {
  dataPath = path.resolve(__dirname, '../../inspect-expr/expression-data.js');
}
assert.ok(fs.existsSync(dataPath), 'Missing expression-data.js for ExpressionEngine verification');

const ctx = {};
const code = fs.readFileSync(dataPath, 'utf8').replace(/^\s*const\s+expression\s*=/m, 'var expression =');
vm.runInNewContext(code, ctx, { filename: 'expression-data.js' });
const data = ctx.expression;

// 1. Validate raw Golub dimensions
assert.equal(data.probes.length, 7129, 'Expected 7,129 Affymetrix probe sets');
assert.equal(data.selected.length, 25, 'Expected 25 training-selected ANOVA probes');
assert.equal(data.ids.length, 34, 'Expected 34 independent test specimens');
assert.equal(data.labels.length, 34, 'Expected 34 test cohort labels');
assert.equal(data.models.length, 3, 'Expected 3 Golub test-cohort classifiers');

// 2. Cohort replication summary across all 7,129 probes
const summary = ExpressionEngine.computeCohortSummary(data);
assert.equal(summary.nProbes, 7129);
assert.equal(summary.nSelected, 25);
assert.ok(Number.isFinite(summary.pearsonR) && summary.pearsonR > 0.55 && summary.pearsonR < 0.99, `Unexpected cross-cohort r=${summary.pearsonR}`);
assert.ok(Number.isFinite(summary.panelPearsonR) && summary.panelPearsonR > 0.80, `Unexpected 25-probe panel r=${summary.panelPearsonR}`);
assert.ok(summary.panelReplicates >= 24, `Expected >=24/25 panel direction concordance, got ${summary.panelReplicates}`);

// 3. Biological symbol extraction & AlphaFold/KEGG 3D bridge lookup
const cd33 = summary.enriched[1833];
assert.equal(cd33.symbol, 'CD33');
assert.equal(cd33.pathway, 'signaling');

const tp53Idx = data.probes.findIndex(p => p[0] === 'M22898_at');
assert.ok(tp53Idx >= 0, 'M22898_at TP53 probe must exist');
assert.equal(summary.enriched[tp53Idx].bridge?.acc, 'P04637');

const sod1Idx = data.probes.findIndex(p => p[0] === 'X02317_at');
assert.ok(sod1Idx >= 0, 'X02317_at SOD1 probe must exist');
assert.equal(summary.enriched[sod1Idx].bridge?.acc, 'P00441');

const gapdhIdx = data.probes.findIndex(p => p[0] === 'D00763_at');
assert.ok(gapdhIdx >= 0, 'D00763_at GAPDH probe must exist');
assert.equal(summary.enriched[gapdhIdx].bridge?.acc, 'P00359');

// 4. ROC, PR, and dynamic threshold confusion parity
for (const model of data.models) {
  const curves = ExpressionEngine.computeRocAndPr(model.scores, data.labels);
  assert.ok(Math.abs(curves.auc - model.auc) < 1e-4, `${model.name}: ROC AUC mismatch (${curves.auc} vs ${model.auc})`);
  assert.ok(curves.ap > 0.92, `${model.name}: expected PR AP > 0.92, got ${curves.ap}`);

  const probs = ExpressionEngine.normalizeModelProbs(model);
  const atHalf = ExpressionEngine.evaluateAtThreshold(probs, data.labels, 0.5);
  assert.equal(atHalf.tp + atHalf.fp + atHalf.fn + atHalf.tn, 34);
  if (model.name === 'Gaussian naive Bayes') {
    assert.equal(atHalf.fp, model.cm[0][1], 'GNB FP at 0.5 should match reported confusion matrix');
    assert.equal(atHalf.fn, model.cm[1][0], 'GNB FN at 0.5 should match reported confusion matrix');
  }
}

// 5. Leakage comparison & Custom multi-gene signature scoring
const leak = ExpressionEngine.computeLeakageComparison(summary.enriched, data.selected);
assert.equal(leak.k, 25);
assert.ok(leak.leakyMeanAbsTest >= leak.cleanMeanAbsTest, 'Leaky in-sample top-25 should inflate apparent test contrast vs clean ANOVA split');

const sig = ExpressionEngine.scoreCustomSignature(summary.enriched, [1833, 1881, 3846]); // CD33, CST3, HOXA9
assert.equal(sig.size, 3);
assert.equal(sig.concordance, 1);
assert.ok(sig.scoreIndex > 2, `Expected strong composite signature separation index, got ${sig.scoreIndex}`);

console.log(
  `Verified ExpressionEngine: 7,129 Golub probes (r=${summary.pearsonR.toFixed(3)}, ` +
  `${summary.panelReplicates}/25 panel replication), 3 classifier ROC/PR curves (<1e-4 AUC parity), ` +
  `3D AlphaFold probe bridges (TP53/SOD1/GAPDH), and clean-vs-leaky split audit.`
);
