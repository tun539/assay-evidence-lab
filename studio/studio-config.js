'use strict';

/**
 * Assay Evidence Studio — Editable Product Configuration
 *
 * Edit this file from anywhere (GitHub web editor, phone, VS Code, or CLI)
 * and commit to `main` to deploy automatically.
 *
 * Prefer a visual editor? Open `customize.html` in the live app, preview
 * your edits in real time, then copy/paste the generated file here.
 */
globalThis.STUDIO_CONFIG = {
  brandName: 'Assay Evidence Studio',
  brandMark: '∿',
  heroTitlePrefix: 'Assay',
  heroTitleAccent: 'Evidence Studio',
  heroIntro: 'Explore 18 interactive 3D molecular & gene structures inspired by AlphaFold Server and Cosmos Biology, fit enzyme assays, audit ML predictions, and trace every claim back to primary data.',
  repoUrl: 'https://github.com/tun539/assay-evidence-lab',
  theme: {
    primary: '#18493c',
    primaryHover: '#22624f',
    accent: '#337953',
    background: '#f5f7f2',
    surfaceTint: '#edf5ec',
  },
  workspaceBanner: {
    enabled: true,
    emptyText: 'Capture runs from any of the 10 quantitative labs, compare compatible results with side-by-side SVG bar charts, and export JSON, Markdown, or CSV packets.',
  },
  labs: [
    { id: 'structure', title: '3D Molecular & Gene Structure Studio', href: 'structure.html', description: 'AlphaFold-style 3D cartoon workbench with PDB 8AW3, 10 KEGG gene folds, real PAE maps, audience modes, and local .PDB upload.', savesToWorkspace: true },
    { id: 'dna', title: '3D Gene & DNA Lab (10 genes)', href: 'dna.html', description: 'Explore 10 KEGG genes in shaded 3D duplexes, jump from any codon straight into its AlphaFold residue, export FASTA, and assemble reads.', savesToWorkspace: false },
    { id: 'kinetics', title: 'Kinetics workbench', href: 'kinetics.html', description: 'Hide a substrate concentration, inspect signed residuals, and compare four Michaelis–Menten models.', savesToWorkspace: true },
    { id: 'molecular', title: 'Molecular learning lab', href: 'molecular.html', description: 'Compare random forest, PyTorch MLP, and RL second-dose selection in synchronized 3D playback.', savesToWorkspace: true },
    { id: 'tomography', title: 'Inside the specimen', href: 'tomography.html', description: 'Reconstruct hidden slices across 10 AlphaFold gene proteins from parallel-beam projections across 4–48 angles.', savesToWorkspace: true },
    { id: 'transport', title: 'Molecular transport in 3D', href: 'transport.html', description: 'Follow moving tracers and test five physical models against theory and held-out NLL.', savesToWorkspace: true },
    { id: 'expression', title: 'Gene expression atlas', href: 'expression.html', description: 'Explore 7,129 microarray probes and three classifiers across two Golub cohorts.', savesToWorkspace: true },
    { id: 'research', title: 'Research benchmark', href: 'research.html', description: 'Compare model families, probability reliability, and decision thresholds on 569 specimens.', savesToWorkspace: true },
    { id: 'practical', title: 'Enzyme kinetics practical', href: 'practical.html', description: 'Fit four hypotheses on the published assay or your own CSV and export held-out predictions.', savesToWorkspace: true },
    { id: 'audit', title: 'Cellpose and AlphaFold audit', href: 'audit.html', description: 'Inspect one-to-one instance matching and per-residue pLDDT confidence distributions.', savesToWorkspace: true },
    { id: 'simulation', title: 'Simulation lab', href: 'simulation.html', description: 'Fit a force law, sample a two-state ensemble, and inspect accuracy sweeps.', savesToWorkspace: true },
    { id: 'language', title: 'Language and physics lab', href: 'language.html', description: 'Trace a bilingual command from trained token weights to a 3D scene.', savesToWorkspace: false },
  ],
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.STUDIO_CONFIG;
}
