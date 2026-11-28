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
  heroIntro: 'Explore 18 interactive 3D molecular & gene structures inspired by AlphaFold Server and Cosmos Biology, audit 6-model enzyme kinetics & OOD holdouts, run MACE/BioEmu force-field & ensemble simulations, reconstruct Cryo-ET tomograms across 6 solvers, and trace every claim back to primary data.',
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
    { id: 'kinetics', title: 'Kinetics & OOD benchmark workbench', href: 'kinetics.html', description: 'Audit 6 rate laws (Michaelis–Menten, Hill cooperativity & Haldane substrate inhibition) across 9 diagnostic graphs and OOD holdouts.', savesToWorkspace: true },
    { id: 'simulation', title: 'Simulation & ML force-field workbench', href: 'simulation.html', description: 'Audit 5 MLIP force fields (MACE/GP/Committee), symplectic phase space, vibrational spectra, 2D Ramachandran & Müller–Brown landscapes, and 3D BioEmu ensembles.', savesToWorkspace: true },
    { id: 'tomography', title: 'Inside the specimen · Cryo-ET & tomography', href: 'tomography.html', description: 'Reconstruct 16 AlphaFold, PDB & Shepp–Logan specimens across 6 solvers (SIRT, SART, FBP, WBP, MLEM, CS-TV), FRC 0.143 resolution, and missing-wedge audits.', savesToWorkspace: true },
    { id: 'molecular', title: 'Molecular learning lab', href: 'molecular.html', description: 'Compare random forest, PyTorch MLP, and RL second-dose selection in synchronized 3D playback.', savesToWorkspace: true },
    { id: 'transport', title: 'Molecular transport in 3D', href: 'transport.html', description: 'Follow moving tracers and test five physical models against theory and held-out NLL.', savesToWorkspace: true },
    { id: 'expression', title: 'Gene expression atlas', href: 'expression.html', description: 'Explore 7,129 microarray probes and three classifiers across two Golub cohorts.', savesToWorkspace: true },
    { id: 'research', title: 'Research benchmark', href: 'research.html', description: 'Compare model families, probability reliability, and decision thresholds on 569 specimens.', savesToWorkspace: true },
    { id: 'practical', title: 'Enzyme kinetics practical', href: 'practical.html', description: 'Fit four hypotheses on the published assay or your own CSV and export held-out predictions.', savesToWorkspace: true },
    { id: 'audit', title: 'Cellpose and AlphaFold audit', href: 'audit.html', description: 'Inspect one-to-one instance matching and per-residue pLDDT confidence distributions.', savesToWorkspace: true },
    { id: 'language', title: 'Language and physics lab', href: 'language.html', description: 'Trace a bilingual command from trained token weights to a 3D scene.', savesToWorkspace: false },
  ],
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.STUDIO_CONFIG;
}
