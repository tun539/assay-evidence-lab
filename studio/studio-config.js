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
  heroIntro: 'Fit enzyme data, audit model predictions and inspect protein structures. Follow each result back to its measurements, assumptions and sources.',
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
    { id: 'kinetics', title: 'Kinetics workbench', href: 'kinetics.html', description: 'Hide a substrate concentration, inspect signed residuals, and compare four Michaelis–Menten models.', savesToWorkspace: true },
    { id: 'molecular', title: 'Molecular learning lab', href: 'molecular.html', description: 'Compare random forest, PyTorch MLP, and RL second-dose selection in synchronized 3D playback.', savesToWorkspace: true },
    { id: 'tomography', title: 'Inside the specimen', href: 'tomography.html', description: 'Reconstruct a hidden protein slice from parallel-beam projections across 4–48 angles.', savesToWorkspace: true },
    { id: 'transport', title: 'Molecular transport in 3D', href: 'transport.html', description: 'Follow moving tracers and test five physical models against theory and held-out NLL.', savesToWorkspace: true },
    { id: 'expression', title: 'Gene expression atlas', href: 'expression.html', description: 'Explore 7,129 microarray probes and three classifiers across two Golub cohorts.', savesToWorkspace: true },
    { id: 'research', title: 'Research benchmark', href: 'research.html', description: 'Compare model families, probability reliability, and decision thresholds on 569 specimens.', savesToWorkspace: true },
    { id: 'practical', title: 'Enzyme kinetics practical', href: 'practical.html', description: 'Fit four hypotheses on the published assay or your own CSV and export held-out predictions.', savesToWorkspace: true },
    { id: 'audit', title: 'Cellpose and AlphaFold audit', href: 'audit.html', description: 'Inspect one-to-one instance matching and per-residue pLDDT confidence distributions.', savesToWorkspace: true },
    { id: 'structure', title: 'Ubiquitin and gene products in 3D', href: 'structure.html', description: 'Rotate PDB and AlphaFold Cα traces, inspect contact maps, and measure residue distances.', savesToWorkspace: true },
    { id: 'simulation', title: 'Simulation lab', href: 'simulation.html', description: 'Fit a force law, sample a two-state ensemble, and inspect accuracy sweeps.', savesToWorkspace: true },
    { id: 'dna', title: 'DNA strand lab', href: 'dna.html', description: 'Explore five species, rotate a duplex, export FASTA, and assemble two simulated reads.', savesToWorkspace: false },
    { id: 'language', title: 'Language and physics lab', href: 'language.html', description: 'Trace a bilingual command from trained token weights to a 3D scene.', savesToWorkspace: false },
  ],
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.STUDIO_CONFIG;
}
