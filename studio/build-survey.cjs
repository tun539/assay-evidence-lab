'use strict';

// Regenerate studio/survey-data.js across all 10 KEGG + AlphaFold DB v6 proteins × 3 tilt spans × 4 angle counts (120 runs)
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const context = vm.createContext({
  console,
  performance: require('node:perf_hooks').performance,
});
context.globalThis = context;
context.window = context;

const sources = [
  'dna-data.js',
  'fold-catalog.js',
  ...fs.readdirSync(path.join(__dirname, 'folds')).sort().map(f => 'folds/' + f),
  'experimental.js',
  'tomography-engine.js',
];

for (const src of sources) {
  const code = read(src).replace(/^\s*const\s+(dnaRecords|foldIds|bundledFolds|experimental)\s*=/gm, 'var $1 =');
  vm.runInContext(code, context, { filename: src });
}

const rows = vm.runInContext(`
(() => {
  const E = TomographyEngine;
  const out = [];
  const N = 64;
  const B = E.defaultBinsForGrid(N);
  for (let idx = 0; idx < foldIds.length; idx++) {
    const id = foldIds[idx];
    const gene = dnaRecords[idx].gene;
    const spec = E.loadSpecimenGeometry(id);
    const slice = E.sampleSlice(spec, 0, N, 'uniform');
    const dftTrue = E.dft2dReal(slice, N);
    const mean = Number((slice.reduce((s, v) => s + v, 0) / slice.length).toFixed(6));
    for (const span of [90, 120, 180]) {
      for (const angles of [4, 8, 24, 48]) {
        const op = E.getRadonOperator(N, B, angles, span, 0);
        const sino = op.project(slice);
        const feats = E.extractSinogramFeatures(sino, angles, B);
        const sirt = E.reconstruct(op, sino, { solver: 'sirt', passes: 20, target: slice, recordHistory: true });
        const tv = E.reconstruct(op, sino, { solver: 'tv_fista', passes: 20, tvLambda: 0.008, recordHistory: false });
        const fbp = E.reconstruct(op, sino, { solver: 'fbp_ramlak', passes: 1, recordHistory: false });
        const tvRmse = Math.sqrt(slice.reduce((s, v, i) => s + (v - tv.estimate[i]) ** 2, 0) / slice.length);
        const fbpRmse = Math.sqrt(slice.reduce((s, v, i) => s + (v - fbp.estimate[i]) ** 2, 0) / slice.length);
        const dftSirt = E.dft2dReal(sirt.estimate, N);
        const frc = E.computeFRCFromDFTs(dftTrue, dftSirt, N, spec.widthAngstrom);
        out.push({
          id,
          gene,
          widthAng: Number(spec.widthAngstrom.toFixed(1)),
          span,
          angles,
          mean,
          error: Number(sirt.rmseHistory.at(-1).toFixed(6)),
          tvError: Number(tvRmse.toFixed(6)),
          fbpError: Number(fbpRmse.toFixed(6)),
          frc0143: Number(frc.res0143.toFixed(2)),
          sinoMean: Number(feats.sinoMean.toFixed(6)),
          sinoContrast: Number(feats.sinoContrast.toFixed(6)),
          sinoSupportFrac: Number(feats.sinoSupportFrac.toFixed(6)),
          sinoRoughness: Number(feats.sinoRoughness.toFixed(6)),
        });
      }
    }
  }
  return out;
})()
`, context);

fs.writeFileSync(
  path.join(__dirname, 'survey-data.js'),
  'const surveyRows = ' + JSON.stringify(rows) + ';\n'
);
console.log(`Generated ${rows.length} deterministic tomography survey rows across ${context.foldIds.length} proteins.`);
