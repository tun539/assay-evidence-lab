'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const studioDir = __dirname;
const htmlFiles = fs.readdirSync(studioDir).filter(f => f.endsWith('.html')).sort();
assert.equal(htmlFiles.length, 18, `Expected 18 Studio HTML pages, found ${htmlFiles.length}`);

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

// Verify doubled 10-gene catalog, sequences, AlphaFold DB v6 folds (with pLDDT & PAE), and 8 experimental PDBs
const ctx = vm.createContext({ window: {} });
const loadInVm = relPath => {
  const code = fs.readFileSync(path.join(studioDir, relPath), 'utf8');
  // Expose top-level const bindings on the sandbox by converting const -> var for inspection
  const script = code.replace(/^\s*const\s+(dnaRecords|codingDNA|foldIds|bundledFolds|experimental|residues|Mol3D)\s*=/gm, 'var $1 =');
  vm.runInContext(script, ctx, { filename: relPath });
};

loadInVm('dna-data.js');
loadInVm('gene-sequences.js');
loadInVm('fold-catalog.js');
loadInVm('experimental.js');
loadInVm('ubiquitin.js');
loadInVm('mol3d-engine.js');

assert.equal(ctx.dnaRecords.length, 10, `Expected 10 KEGG dnaRecords, got ${ctx.dnaRecords.length}`);
assert.equal(ctx.foldIds.length, 10, `Expected 10 AlphaFold foldIds, got ${ctx.foldIds.length}`);
assert.equal(Object.keys(ctx.codingDNA).length, 10, `Expected 10 codingDNA sequences, got ${Object.keys(ctx.codingDNA).length}`);

for (let i = 0; i < 10; i++) {
  const rec = ctx.dnaRecords[i];
  const acc = ctx.foldIds[i];
  const seq = ctx.codingDNA[rec.id];
  assert.ok(seq && seq.length >= 300 && /^[ACGT]+$/.test(seq), `${rec.id}: invalid coding DNA sequence`);
  assert.ok(seq.startsWith(rec.seq), `${rec.id}: dnaRecords 60 bp excerpt must prefix full codingDNA`);

  const foldPath = `folds/${acc}.js`;
  assert.ok(fs.existsSync(path.join(studioDir, foldPath)), `Missing AlphaFold bundle ${foldPath}`);
  loadInVm(foldPath);
  const fold = ctx.bundledFolds[acc];
  assert.ok(fold, `${acc}: failed to register in bundledFolds`);
  assert.ok(Array.isArray(fold.rows) && fold.rows.length >= 90, `${acc}: expected >= 90 Cα rows`);
  assert.ok(typeof fold.plddtMean === 'number' && fold.plddtMean > 30 && fold.plddtMean <= 100, `${acc}: missing valid plddtMean`);
  assert.ok(typeof fold.rows[0][5] === 'number', `${acc}: missing per-residue pLDDT column`);
  assert.ok(fold.paeSize === 48 && Array.isArray(fold.pae) && fold.pae.length === 48 * 48, `${acc}: expected flat 48x48 PAE matrix`);
}

// Verify 8 experimental PDB structures (7 in experimental + 1UBQ in ubiquitin.js)
const expectedExp = ['8AW3', '1GFL', '1MBO', '1BNA', '1GCN', '1CRN', '2RBG'];
for (const pdb of expectedExp) {
  assert.ok(ctx.experimental[pdb], `Missing experimental PDB model ${pdb}`);
}
assert.ok(Array.isArray(ctx.residues) && ctx.residues.length === 76, '1UBQ ubiquitin must have 76 residues');

// Verify flagship PDB 8AW3 multi-entity integrity
const m8aw3 = ctx.experimental['8AW3'];
assert.equal(m8aw3.chains.length, 3, '8AW3 must include 3 chains (2 proteins + 1 tRNA)');
assert.equal(m8aw3.ligands.length, 2, '8AW3 must include 2 Zn2+ ion ligands');
assert.equal(m8aw3.iptm, 0.78, '8AW3 must preserve AlphaFold Server reference ipTM = 0.78');
assert.equal(m8aw3.ptm, 0.75, '8AW3 must preserve AlphaFold Server reference pTM = 0.75');

// Verify 1MBO ligand atoms and 1BNA duplex chains
assert.ok(ctx.experimental['1MBO'].ligands.length >= 40, '1MBO must include Heme + O2 ligand atoms');
assert.equal(ctx.experimental['1BNA'].chains.length, 2, '1BNA must include 2 antiparallel DNA strands');

// Verify Mol3D engine exports and PDB parser
assert.ok(ctx.Mol3D && typeof ctx.Mol3D.createViewer === 'function', 'Mol3D.createViewer must be exported');
assert.ok(typeof ctx.Mol3D.parsePDB === 'function', 'Mol3D.parsePDB must be exported');

// Verify all 10 fold scripts are loaded on structure.html, linked.html, tomography.html, and transport.html
for (const page of ['structure.html', 'linked.html', 'tomography.html', 'transport.html']) {
  const html = fs.readFileSync(path.join(studioDir, page), 'utf8');
  for (const acc of ctx.foldIds) {
    assert.ok(html.includes(`folds/${acc}.js`), `${page}: missing script tag for folds/${acc}.js`);
  }
}

console.log(
  `Verified ${htmlFiles.length} Studio HTML pages, ${jsFiles.length} JS scripts, ` +
  `10 KEGG + AlphaFold DB v6 gene folds (with pLDDT & 48x48 PAE), and 8 experimental PDB complexes (including 8AW3).`
);
