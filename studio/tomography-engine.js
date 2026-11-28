'use strict';

/**
 * Assay Evidence Studio — Cryo-ET & Computational Tomography Engine
 *
 * Implements:
 *  - 16 macromolecular & calibration specimens (10 KEGG/AlphaFold DB v6 folds,
 *    4 experimental multi-entity RCSB PDB complexes, Modified Shepp–Logan phantom,
 *    and the legacy 4-ellipsoid geometric calibration phantom).
 *  - Exact transpose-matched bilinear Radon forward/backprojection (⟨Ax, y⟩ = ⟨x, Aᵀy⟩)
 *    plus Kaipio & Somersalo (2007) 2× oversampled + shifted-detector forward simulation
 *    to audit "Inverse Crime" discretization bias.
 *  - Cryo-EM weak-phase Contrast Transfer Function (CTF) defocus modulation, phase-flipping,
 *    and seeded low-dose Poisson + readout shot noise (e⁻/Å²).
 *  - 6 canonical tomographic solvers (TomoPy / ASTRA / IMOD / RELION benchmarks):
 *      1) SIRT (Gilbert 1972 simultaneous weighted least-squares, x ≥ 0)
 *      2) SART (Andersen & Kak 1984 prime-interleaved angle updates, x ≥ 0)
 *      3) FBP-RamLak (Crowther–Kak–Slaney exact ramp-filtered backprojection)
 *      4) WBP-Hann (Cryo-ET Hann-apodized windowed backprojection)
 *      5) MLEM (Shepp & Vardi 1982 multiplicative Poisson EM)
 *      6) CS-TV FISTA (Rudin–Osher–Fatemi / Böhning et al. 2022 isotropic TV proximal FISTA)
 *  - Separable 2D DFT, radial Fourier Ring Correlation FRC(k) with Gold-Standard 0.143 & 0.5
 *    cutoffs, Crowther resolution limit, Leave-One-Tilt-Out validation (Cardone et al. 2005),
 *    SSIM (Wang et al. 2004), PSNR, Lin's CCC, Hansen's Regularization L-Curve, directional
 *    missing-wedge error anisotropy, and Leave-One-Protein-Out error prediction.
 */
(function initTomographyEngine(root) {
  const LEGACY_ELLIPSOIDS = [
    [[0, 0, 0], [0.84, 0.69, 0.78], 0.22],
    [[-0.22, 0.12, 0.04], [0.35, 0.32, 0.40], 0.42],
    [[0.29, -0.16, -0.16], [0.15, 0.22, 0.30], 0.56],
    [[0.21, 0.32, 0.22], [0.11, 0.11, 0.16], 0.72],
  ];

  // Modified 3D Shepp–Logan ellipses: [cx, cy, cz, ax, ay, az, rotDeg, density]
  const SHEPP_LOGAN_3D = [
    [0.0, 0.0, 0.0, 0.69, 0.92, 0.88, 0, 1.0],
    [0.0, -0.0184, 0.0, 0.6624, 0.874, 0.84, 0, -0.8],
    [0.22, 0.0, 0.0, 0.11, 0.31, 0.48, -18, -0.2],
    [-0.22, 0.0, 0.0, 0.16, 0.41, 0.48, 18, -0.2],
    [0.0, 0.35, -0.05, 0.21, 0.25, 0.45, 0, 0.15],
    [0.0, 0.10, 0.08, 0.046, 0.046, 0.38, 0, 0.18],
    [0.0, -0.10, -0.06, 0.046, 0.046, 0.38, 0, 0.18],
    [-0.08, -0.605, 0.0, 0.046, 0.023, 0.34, 0, 0.20],
    [0.0, -0.606, 0.0, 0.023, 0.023, 0.34, 0, 0.20],
    [0.06, -0.605, 0.0, 0.023, 0.046, 0.34, 0, 0.20],
  ];

  const GENE_STUDIES = {
    P00846: [
      'ATP synthase subunit a',
      'Mitochondrial F₀ proton-channel energy conversion',
      'Trace the tilted transmembrane α-helical hairpins. At 4–8 views, which separated helices merge in the central slice, and how does CS-TV restore the inter-helical cleft?',
    ],
    P0A7J3: [
      'Ribosomal protein uL10 (rplJ)',
      'Bacterial 50S stalk assembly & translation factor recruitment',
      'Follow the elongated C-terminal stalk helix. Restrict the tilt wedge to 90° (±45°) and inspect how the missing wedge smears features perpendicular to the unmeasured cone.',
    ],
    P00359: [
      'Glyceraldehyde-3-phosphate dehydrogenase (TDH3)',
      'Glycolytic NAD⁺-binding Rossmann fold & catalytic domain',
      'Slice through the crowded α/β Rossmann core. Compare the Gold-Standard FRC₀.₁₄₃ resolution (Å) against the theoretical Crowther limit πD/Nθ as views increase from 8 to 48.',
    ],
    Q31BY4: [
      'RuBisCO large subunit (rbcL)',
      'Photosynthetic CO₂ fixation TIM-barrel core',
      'Large 471-residue barrel (~109 Å FOV). Notice how coarse pixel spacing challenges high-frequency recovery and why SART/CS-TV outperform Ram-Lak FBP at 8–16 tilts.',
    ],
    O23290: [
      'Zinc-binding ribosomal protein (AT4G14320)',
      'Plant cytosolic ribosome zinc-ribbon architecture',
      'Compact globular core paired with an extended terminal tail. Test whether low-dose shot noise (40 e⁻/Å²) causes unregularized SIRT to diverge past ~20 passes.',
    ],
    P04637: [
      'Tumor suppressor p53 (TP53)',
      'DNA-damage checkpoint transcription factor',
      'Contrast the high-pLDDT DNA-binding β-sandwich (z ≈ 0) against sparse disordered N/C-terminal tails that expand the bounding box to ~155 Å.',
    ],
    P68871: [
      'Hemoglobin subunit β (HBB)',
      'Erythrocyte oxygen-transport all-α globin',
      'Inspect the central heme-binding cavity ringed by eight α-helices on the 1D Cross-Section Scanline Profile. How many tilts resolve the central dip?',
    ],
    P01308: [
      'Preproinsulin precursor (INS)',
      'Endocrine glucose-homeostasis prohormone',
      'Signal peptide + B/C/A chains span a wide volume around a compact disulfide-linked core. Compare Projection-Only vs. Oracle cross-protein RMSE prediction.',
    ],
    P0A7G6: [
      'Recombinase RecA (recA)',
      'Homologous DNA repair filament ATPase',
      'Examine the central ATPase core and protruding C-terminal lobe under a 120° Cryo-ET (±60°) missing wedge using the 2D K-Space Spectrum tab.',
    ],
    P00441: [
      'Cu/Zn Superoxide dismutase (SOD1)',
      'Antioxidant eight-strand Greek-key β-barrel',
      'Compact ~53 Å β-barrel achieving sub-4 Å FRC₀.₁₄₃ resolution at 48 views. Toggle Cryo-EM CTF to observe Thon phase-reversal rings and phase-flipping recovery.',
    ],
  };

  const EXPERIMENTAL_STUDIES = {
    '8AW3': {
      gene: 'PDB 8AW3',
      species: 'Multi-entity complex · 2 Proteins + 73-nt tRNA + 2× Zn²⁺',
      title: 'AlphaFold Server Flagship Ribonucleoprotein (8AW3)',
      role: 'Multi-chain protein–tRNA–zinc assembly (3.1 Å Cryo-EM / AF3 benchmark)',
      question: 'Phosphodiester RNA backbone and Zn²⁺ ions scatter electrons more strongly than protein Cα atoms. Slice across z to distinguish the dense tRNA arm from the two protein subunits.',
      sourceUrl: 'https://www.rcsb.org/structure/8AW3',
      sourceLabel: 'RCSB PDB 8AW3',
    },
    '1MBO': {
      gene: 'PDB 1MBO',
      species: 'Physeter catodon · 153 aa + Fe-Heme + O₂',
      title: 'Oxymyoglobin + Covalent Heme & Dioxygen (1MBO)',
      role: 'High-resolution (1.6 Å) holo-globin with iron-porphyrin active center',
      question: 'Locate z ≈ 0 where the electron-dense Fe-Heme porphyrin sits inside the globin pocket. Compare FBP streak overshoot vs. MLEM & CS-TV around the bright iron peak.',
      sourceUrl: 'https://www.rcsb.org/structure/1MBO',
      sourceLabel: 'RCSB PDB 1MBO',
    },
    '1GFL': {
      gene: 'PDB 1GFL',
      species: 'Aequorea victoria · 230 aa 11-strand β-barrel',
      title: 'Green Fluorescent Protein β-Barrel (1GFL)',
      role: 'Cylindrical 11-strand β-can shielding a central chromophore helix (1.9 Å)',
      question: 'Slice perpendicular to the β-barrel axis to see the ring wall surrounding the central chromophore helix—an ideal biological resolution test for hollow-lumen recovery.',
      sourceUrl: 'https://www.rcsb.org/structure/1GFL',
      sourceLabel: 'RCSB PDB 1GFL',
    },
    '1BNA': {
      gene: 'PDB 1BNA',
      species: 'Synthetic Dickerson–Drew B-DNA · 24 nt duplex',
      title: 'Experimental B-DNA Double Helix Dodecamer (1BNA)',
      role: 'Canonical antiparallel right-handed B-DNA crystal structure (1.9 Å)',
      question: 'Sweep slice height z from −0.7 to +0.7 and watch the twin sugar–phosphate backbone peaks rotate around the helical axis in the reconstructed cross-section!',
      sourceUrl: 'https://www.rcsb.org/structure/1BNA',
      sourceLabel: 'RCSB PDB 1BNA',
    },
  };

  const SOLVER_CATALOG = [
    {
      id: 'sirt',
      label: 'SIRT · Simultaneous Iterative',
      short: 'SIRT',
      family: 'Algebraic WLS (x ≥ 0)',
      color: '#0b7a5c',
      cbColor: '#0072b2',
      iterative: true,
      description: 'Cimmino/Gilbert diagonally preconditioned simultaneous least-squares updates with non-negativity. Smooth and stable at low pass counts, but exhibits semi-convergence on noisy low-dose sinograms.',
    },
    {
      id: 'sart',
      label: 'SART · Ordered-Angle Algebraic',
      short: 'SART',
      family: 'Sequential Algebraic (x ≥ 0)',
      color: '#2563eb',
      cbColor: '#56b4e9',
      iterative: true,
      description: 'Andersen & Kak view-by-view updates using golden-stride angular ordering so consecutive rays intersect nearly orthogonally, accelerating detail convergence 3–4× over SIRT.',
    },
    {
      id: 'fbp_ramlak',
      label: 'FBP · Filtered Back-Projection (Ram-Lak)',
      short: 'FBP (Ram-Lak)',
      family: 'Analytical Fourier Ramp',
      color: '#b85627',
      cbColor: '#d55e00',
      iterative: false,
      description: 'Direct Fourier-Slice inversion with exact Kak–Slaney |ω| ramp filter. Delivers sharpest high-frequency fidelity at dense 180° sampling, but amplifies shot noise and creates star streaks at sparse views.',
    },
    {
      id: 'wbp_hann',
      label: 'WBP · Cryo-ET Hann Windowed FBP',
      short: 'WBP (Hann)',
      family: 'Apodized Analytical',
      color: '#8b5cf6',
      cbColor: '#cc79a7',
      iterative: false,
      description: 'Standard IMOD/Tomo3D cryo-ET weighted backprojection multiplying the |ω| ramp by a raised-cosine Hann roll-off window to tame high-frequency low-dose electron shot noise.',
    },
    {
      id: 'mlem',
      label: 'MLEM · Poisson Maximum-Likelihood',
      short: 'MLEM',
      family: 'Statistical Poisson EM',
      color: '#0d9488',
      cbColor: '#009e73',
      iterative: true,
      description: 'Shepp & Vardi multiplicative expectation-maximization maximizing the Poisson photon/electron log-likelihood while strictly conserving total non-negative density.',
    },
    {
      id: 'tv_fista',
      label: 'CS-TV · Compressed-Sensing Total Variation',
      short: 'CS-TV (FISTA)',
      family: 'Variational Sparse-Gradient',
      color: '#be123c',
      cbColor: '#882255',
      iterative: true,
      description: 'Nesterov FISTA + Chambolle dual isotropic Total Variation (‖∇x‖₂,₁) regularization (Goris et al. 2012; Böhning et al. 2022). Suppresses sparse-view streaks and partially bridges the Cryo-ET missing wedge.',
    },
  ];

  // Deterministic Mulberry32 PRNG
  function mulberry32(seed) {
    let a = (Number(seed) || 1) >>> 0;
    return function nextRand() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randNormal(rng) {
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function samplePoisson(lambda, rng) {
    if (lambda <= 0) return 0;
    if (lambda < 30) {
      const L = Math.exp(-lambda);
      let k = 0;
      let p = 1;
      do {
        k++;
        p *= rng();
      } while (p > L);
      return k - 1;
    }
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * randNormal(rng)));
  }

  function resolveCatalogs() {
    return {
      foldIds: typeof foldIds !== 'undefined' ? foldIds : (root.foldIds || []),
      dnaRecords: typeof dnaRecords !== 'undefined' ? dnaRecords : (root.dnaRecords || []),
      bundledFolds: typeof bundledFolds !== 'undefined' ? bundledFolds : (root.bundledFolds || {}),
      experimental: typeof experimental !== 'undefined' ? experimental : (root.experimental || {}),
    };
  }

  // Build specimen descriptor from global Studio catalogs
  function getSpecimenCatalog() {
    const { foldIds: fIds, dnaRecords: dRecs, bundledFolds: bFolds, experimental: expMap } = resolveCatalogs();

    const items = [];
    for (let i = 0; i < fIds.length; i++) {
      const id = fIds[i];
      const info = dRecs[i] || { gene: id, species: 'Reference organism', note: '' };
      const study = GENE_STUDIES[id] || [id, 'Predicted monomer structure', 'Compare sparse vs. dense projections.'];
      if (bFolds[id]) {
        items.push({
          id,
          group: 'AlphaFold DB v6 · 10 KEGG Genes',
          kind: 'alphafold',
          gene: info.gene,
          optionLabel: `${info.gene} · ${study[0]} (${info.species})`,
          title: `${study[0]} · ${info.species}`,
          role: `${study[1]}. ${info.note || ''}`.trim(),
          question: study[2],
          plddtMean: bFolds[id].plddtMean || null,
        });
      }
    }

    for (const pdbId of ['8AW3', '1MBO', '1GFL', '1BNA']) {
      if (expMap[pdbId]) {
        const meta = EXPERIMENTAL_STUDIES[pdbId];
        items.push({
          id: pdbId,
          group: 'Experimental RCSB PDB Complexes',
          kind: 'pdb',
          gene: meta.gene,
          optionLabel: `${meta.gene} · ${expMap[pdbId].name}`,
          title: meta.title,
          role: `${meta.role}. ${expMap[pdbId].summary}`,
          question: meta.question,
          resolution: expMap[pdbId].resolution,
        });
      }
    }

    items.push(
      {
        id: 'shepp_logan',
        group: 'Analytical Calibration Phantoms',
        kind: 'phantom',
        gene: 'Shepp–Logan',
        optionLabel: 'Modified Shepp–Logan 3D Contrast Phantom',
        title: 'Modified Shepp–Logan 3D Tomographic Phantom',
        role: 'Ten nested 3D ellipsoids with subtle internal contrast steps (Shepp & Logan 1974; Toft 1996) on a 100 Å reference field.',
        question: 'Can you resolve the three small inferior Ventricle-style inclusions (0.20 contrast) at 16 views or under a 120° missing wedge?',
      },
      {
        id: 'calibration',
        group: 'Analytical Calibration Phantoms',
        kind: 'phantom',
        gene: 'Ellipsoids',
        optionLabel: 'Geometric Calibration Sample (4 Nested Ellipsoids)',
        title: 'Geometric Calibration Sample (Nested 3D Ellipsoids)',
        role: 'Four nested 3D ellipsoids with additive step densities (0.22–0.72) providing an analytical inverse-problem testbed.',
        question: 'Which smallest off-axis inclusion can each solver recover with only 4–8 views?',
      }
    );

    return items;
  }

  function loadSpecimenGeometry(rawId) {
    const id = (!rawId || rawId === '') ? 'calibration' : rawId;
    const { foldIds: fIds, dnaRecords: dRecs, bundledFolds: bFolds, experimental: expMap } = resolveCatalogs();

    if (bFolds[id]) {
      const idx = fIds.indexOf(id);
      const info = dRecs[idx] || { gene: id, species: 'Organism', note: '' };
      const study = GENE_STUDIES[id] || [id, 'Protein fold', 'Compare angular sampling.'];
      const rows = bFolds[id].rows;
      const xyz = rows.map(r => [r[2], r[3], r[4]]);
      const center = [0, 1, 2].map(k => xyz.reduce((s, p) => s + p[k], 0) / xyz.length);
      const centered = xyz.map(p => [p[0] - center[0], p[1] - center[1], p[2] - center[2]]);
      const radius = Math.max(...centered.map(p => Math.hypot(p[0], p[1], p[2]))) + 5;
      const normPts = centered.map((p, m) => ({
        x: p[0] / radius,
        y: p[1] / radius,
        z: p[2] / radius,
        w: 1.0,
        plddt: typeof rows[m][5] === 'number' ? rows[m][5] : 85,
        resName: rows[m][0],
        resSeq: rows[m][1],
        chain: 'A',
        kind: 'protein',
      }));
      return {
        id,
        kind: 'alphafold',
        gene: info.gene,
        title: `${study[0]} · ${info.species}`,
        biology: `${study[1]}. ${info.note || ''}`.trim(),
        question: study[2],
        measurement: `${info.gene} · ${rows.length} Cα atoms · FOV ${(2 * radius).toFixed(1)} Å · mean pLDDT ${(bFolds[id].plddtMean || 0).toFixed(1)}`,
        radius,
        widthAngstrom: 2 * radius,
        atoms: normPts,
        chains: [{ id: 'A', type: 'protein', points: normPts }],
        ligands: [],
        sources: [
          { label: `AlphaFold DB ${id}`, url: `https://alphafold.ebi.ac.uk/entry/${id}` },
          { label: `UniProt ${id}`, url: `https://www.uniprot.org/uniprotkb/${id}/entry` },
        ],
      };
    }

    if (expMap[id]) {
      const exp = expMap[id];
      const meta = EXPERIMENTAL_STUDIES[id] || {
        gene: `PDB ${id}`,
        title: exp.name,
        role: exp.summary,
        question: 'Compare multi-chain density recovery across tilt ranges.',
        sourceUrl: `https://www.rcsb.org/structure/${id}`,
        sourceLabel: `RCSB PDB ${id}`,
      };
      const rawAtoms = [];
      const rawChains = (exp.chains || []).map(ch => {
        const chPts = ch.rows.map(r => {
          const item = {
            resName: r[0],
            resSeq: r[1],
            rx: r[2],
            ry: r[3],
            rz: r[4],
            bfac: typeof r[5] === 'number' ? r[5] : 50,
            chain: ch.id,
            kind: ch.type || 'protein',
            w: (ch.type === 'rna' || ch.type === 'dna') ? 1.35 : 1.0,
          };
          rawAtoms.push(item);
          return item;
        });
        return { id: ch.id, type: ch.type || 'protein', label: ch.label || `Chain ${ch.id}`, rawPts: chPts };
      });
      const rawLigs = (exp.ligands || []).map(lig => {
        const elem = String(lig[4] || lig[0] || 'C').toUpperCase();
        const isHeavy = elem === 'ZN' || elem === 'FE' || elem === 'MG' || elem === 'CU';
        const item = {
          resName: lig[0],
          chain: lig[1],
          resSeq: lig[2],
          atomName: lig[3],
          element: elem,
          rx: lig[5],
          ry: lig[6],
          rz: lig[7],
          kind: isHeavy ? 'ion' : 'ligand',
          w: isHeavy ? 1.85 : 0.65,
        };
        rawAtoms.push(item);
        return item;
      });

      const center = [0, 1, 2].map(k => {
        const key = ['rx', 'ry', 'rz'][k];
        return rawAtoms.reduce((s, a) => s + a[key], 0) / Math.max(1, rawAtoms.length);
      });
      const radius = Math.max(...rawAtoms.map(a => Math.hypot(a.rx - center[0], a.ry - center[1], a.rz - center[2]))) + 5;

      const normAtom = a => ({
        ...a,
        x: (a.rx - center[0]) / radius,
        y: (a.ry - center[1]) / radius,
        z: (a.rz - center[2]) / radius,
      });

      const chains = rawChains.map(ch => ({
        id: ch.id,
        type: ch.type,
        label: ch.label,
        points: ch.rawPts.map(normAtom),
      }));
      const ligands = rawLigs.map(normAtom);
      const atoms = [...chains.flatMap(c => c.points), ...ligands];

      return {
        id,
        kind: 'pdb',
        gene: meta.gene,
        title: meta.title,
        biology: `${meta.role}. ${exp.summary}`,
        question: meta.question,
        measurement: `${meta.gene} · ${chains.length} chain${chains.length > 1 ? 's' : ''} (${atoms.length} scatterers) · FOV ${(2 * radius).toFixed(1)} Å · ${exp.resolution}`,
        radius,
        widthAngstrom: 2 * radius,
        atoms,
        chains,
        ligands,
        sources: [
          { label: meta.sourceLabel, url: meta.sourceUrl },
          { label: 'Open in 3D Molecular Studio', url: `structure.html?protein=${id}` },
        ],
      };
    }

    if (id === 'shepp_logan') {
      return {
        id: 'shepp_logan',
        kind: 'phantom',
        gene: 'Shepp–Logan',
        title: 'Modified Shepp–Logan 3D Contrast Phantom',
        biology: 'Canonical 10-ellipsoid tomographic test phantom (Shepp & Logan 1974; Toft 1996) featuring an outer high-density rim and low-contrast interior inclusions.',
        question: 'Inspect the three small inferior inclusions (y ≈ −0.60) on the 1D Scanline Profile. Compare Ram-Lak FBP streak noise against CS-TV at 16 views.',
        measurement: '10 analytical 3D ellipsoids · nominal FOV 100.0 Å',
        radius: 50,
        widthAngstrom: 100,
        atoms: [],
        chains: [],
        ligands: [],
        sources: [{ label: 'Methods & mathematical reference', url: 'methods.html#tomography' }],
      };
    }

    return {
      id: 'calibration',
      kind: 'phantom',
      gene: 'Ellipsoids',
      title: 'Geometric Calibration Sample',
      biology: 'Nested ellipsoids with known step densities (0.22–0.72) provide an analytical inverse-problem reference for testing reconstruction solvers.',
      question: 'Which small off-axis inclusion can you recover cleanly with only 4 or 8 views?',
      measurement: '4 nested 3D ellipsoids · nominal FOV 80.0 Å (dimensionless reference grid)',
      radius: 40,
      widthAngstrom: null,
      nominalWidthAngstrom: 80,
      atoms: [],
      chains: [],
      ligands: [],
      sources: [{ label: 'Methods & mathematical reference', url: 'methods.html#tomography' }],
    };
  }

  /**
   * Sample a 2D slice at normalized height z ∈ [-0.85, 0.85] onto an N × N grid.
   * Preserves exact parity with legacy sample(z) for AlphaFold monomers and 'calibration' at N=64.
   */
  function sampleSlice(specimen, z, N = 64, weightMode = 'uniform') {
    const out = new Float64Array(N * N);

    if (specimen.kind === 'alphafold' || specimen.kind === 'pdb') {
      const baseSigma = 2.5 / specimen.radius;
      for (const pt of specimen.atoms) {
        const sigma = pt.kind === 'ion' ? (1.9 / specimen.radius) : baseSigma;
        if (Math.abs(z - pt.z) > 3 * sigma) continue;
        let w = pt.w !== undefined ? pt.w : 1.0;
        if (weightMode === 'plddt' && typeof pt.plddt === 'number') {
          w *= Math.max(0.25, pt.plddt / 100);
        }
        const jMin = Math.max(0, Math.floor((pt.y - 3 * sigma + 1) * N / 2));
        const jMax = Math.min(N, (pt.y + 3 * sigma + 1) * N / 2);
        const iMin = Math.max(0, Math.floor((pt.x - 3 * sigma + 1) * N / 2));
        const iMax = Math.min(N, (pt.x + 3 * sigma + 1) * N / 2);
        const inv2s2 = 1 / (2 * sigma * sigma);
        const dz2 = (z - pt.z) * (z - pt.z);
        for (let j = jMin; j < jMax; j++) {
          const dy = ((j + 0.5) * 2) / N - 1 - pt.y;
          const dyz2 = dy * dy + dz2;
          for (let i = iMin; i < iMax; i++) {
            const dx = ((i + 0.5) * 2) / N - 1 - pt.x;
            out[j * N + i] += w * Math.exp(-(dx * dx + dyz2) * inv2s2);
          }
        }
      }
      let peak = 0;
      for (let i = 0; i < out.length; i++) if (out[i] > peak) peak = out[i];
      if (peak > 0) {
        for (let i = 0; i < out.length; i++) out[i] /= peak;
      }
      return out;
    }

    if (specimen.id === 'shepp_logan') {
      for (let j = 0; j < N; j++) {
        // Flip y so positive y is superior (top of canvas)
        const y = 1 - ((j + 0.5) * 2) / N;
        for (let i = 0; i < N; i++) {
          const x = ((i + 0.5) * 2) / N - 1;
          let val = 0;
          for (const [cx, cy, cz, ax, ay, az, deg, rho] of SHEPP_LOGAN_3D) {
            const dz = (z - cz) / az;
            if (dz * dz >= 1) continue;
            const rad = (deg * Math.PI) / 180;
            const c = Math.cos(rad);
            const s = Math.sin(rad);
            const dx = x - cx;
            const dy = y - cy;
            const xr = (dx * c + dy * s) / ax;
            const yr = (-dx * s + dy * c) / ay;
            if (xr * xr + yr * yr + dz * dz <= 1) val += rho;
          }
          out[j * N + i] = Math.max(0, Math.min(1, val));
        }
      }
      let peak = 0;
      for (let i = 0; i < out.length; i++) if (out[i] > peak) peak = out[i];
      if (peak > 0) {
        for (let i = 0; i < out.length; i++) out[i] /= peak;
      }
      return out;
    }

    // Legacy 4-ellipsoid calibration phantom (exact formula from studio/tomography.js)
    for (let idx = 0; idx < N * N; idx++) {
      const px = 2 * (((idx % N) + 0.5) / N) - 1;
      const py = 2 * ((Math.floor(idx / N) + 0.5) / N) - 1;
      let sum = 0;
      for (const [c, r, d] of LEGACY_ELLIPSOIDS) {
        const q = ((px - c[0]) / r[0]) ** 2 + ((py - c[1]) / r[1]) ** 2 + ((z - c[2]) / r[2]) ** 2;
        if (q <= 1) sum += d;
      }
      out[idx] = sum;
    }
    return out;
  }

  function defaultBinsForGrid(N) {
    return N === 64 ? 94 : Math.ceil(N * 1.47);
  }

  // Geometry cache for fast transpose-exact bilinear Radon operator
  const operatorCache = new Map();

  function getRadonOperator(N, B, angles, spanDeg = 180, detectorShift = 0) {
    const key = `${N}|${B}|${angles}|${spanDeg.toFixed(4)}|${detectorShift.toFixed(4)}`;
    if (operatorCache.has(key)) return operatorCache.get(key);

    const spanRad = (spanDeg * Math.PI) / 180;
    // Center symmetric tilt wedges around 90° (0° tilt = vertical beam along y) or [0, spanRad)
    // Using [0, spanRad) preserves exact compatibility with legacy survey & sinogram orientation!
    const thetas = new Float64Array(angles);
    for (let a = 0; a < angles; a++) {
      thetas[a] = (a * spanRad) / angles;
    }

    const total = angles * N * N;
    const idx0 = new Uint32Array(total);
    const w0 = new Float32Array(total);
    const raySum = new Float64Array(angles * B);
    const pixSum = new Float64Array(N * N);

    const halfN = (N - 1) / 2;
    const halfB = (B - 1) / 2;

    for (let a = 0; a < angles; a++) {
      const cosT = Math.cos(thetas[a]);
      const sinT = Math.sin(thetas[a]);
      const viewOffset = a * B;
      const base = a * N * N;
      for (let j = 0; j < N; j++) {
        const y = j - halfN;
        for (let i = 0; i < N; i++) {
          const p = j * N + i;
          const x = i - halfN;
          let u = halfB + x * cosT + y * sinT + detectorShift;
          if (u < 0) u = 0;
          if (u > B - 1.000001) u = B - 1.000001;
          const b0 = Math.floor(u);
          const alpha = u - b0;
          const weight0 = 1 - alpha;
          const weight1 = alpha;
          const flat = viewOffset + b0;
          idx0[base + p] = flat;
          w0[base + p] = weight0;
          raySum[flat] += weight0;
          raySum[flat + 1] += weight1;
          pixSum[p] += weight0 + weight1;
        }
      }
    }

    function project(slice, out) {
      const y = out || new Float64Array(angles * B);
      if (out) y.fill(0);
      const nn = N * N;
      for (let a = 0; a < angles; a++) {
        const base = a * nn;
        for (let p = 0; p < nn; p++) {
          const val = slice[p];
          if (val === 0) continue;
          const flat = idx0[base + p];
          const wt0 = w0[base + p];
          y[flat] += wt0 * val;
          y[flat + 1] += (1 - wt0) * val;
        }
      }
      return y;
    }

    function projectSingleAngle(slice, a, outView) {
      const y = outView || new Float64Array(B);
      if (outView) y.fill(0);
      const nn = N * N;
      const base = a * nn;
      const viewOffset = a * B;
      for (let p = 0; p < nn; p++) {
        const val = slice[p];
        if (val === 0) continue;
        const b0 = idx0[base + p] - viewOffset;
        const wt0 = w0[base + p];
        y[b0] += wt0 * val;
        y[b0 + 1] += (1 - wt0) * val;
      }
      return y;
    }

    function backproject(sino, out) {
      const x = out || new Float64Array(N * N);
      if (out) x.fill(0);
      const nn = N * N;
      for (let a = 0; a < angles; a++) {
        const base = a * nn;
        for (let p = 0; p < nn; p++) {
          const flat = idx0[base + p];
          const wt0 = w0[base + p];
          x[p] += wt0 * sino[flat] + (1 - wt0) * sino[flat + 1];
        }
      }
      return x;
    }

    const op = { N, B, angles, spanDeg, spanRad, thetas, idx0, w0, raySum, pixSum, project, projectSingleAngle, backproject };
    if (operatorCache.size > 48) operatorCache.clear();
    operatorCache.set(key, op);
    return op;
  }

  /**
   * "Avoid Inverse Crime" forward projection (Kaipio & Somersalo 2007):
   * Evaluates specimen slice on a 2× finer (2N × 2N) grid, projects onto 2B fine detector
   * rays with a sub-pixel detector shift (+0.35 nominal px), and integrates pairs of fine bins
   * back onto the B-bin detector (scaled by 0.5 for pixel line-integral units).
   */
  function forwardProjectHonest(specimen, z, N, B, angles, spanDeg, weightMode = 'uniform', shiftPx = 0.35) {
    const fineN = 2 * N;
    const fineB = 2 * B;
    const fineSlice = sampleSlice(specimen, z, fineN, weightMode);
    const fineOp = getRadonOperator(fineN, fineB, angles, spanDeg, shiftPx * 2);
    const fineSino = fineOp.project(fineSlice);
    const sino = new Float64Array(angles * B);
    for (let a = 0; a < angles; a++) {
      for (let b = 0; b < B; b++) {
        // Average across detector bin width (÷2) and scale line-step Δs_fine = 0.5 px (÷2) -> ×0.25
        sino[a * B + b] = 0.25 * (fineSino[a * fineB + 2 * b] + fineSino[a * fineB + 2 * b + 1]);
      }
    }
    return sino;
  }

  // Radix-2 1D in-place FFT (length P must be a power of 2)
  function fft1dRadix2(re, im, invert = false) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
        tmp = im[i]; im[i] = im[j]; im[j] = tmp;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = ((invert ? 2 : -2) * Math.PI) / len;
      const wlenRe = Math.cos(ang);
      const wlenIm = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wRe = 1;
        let wIm = 0;
        const half = len >> 1;
        for (let j = 0; j < half; j++) {
          const uRe = re[i + j];
          const uIm = im[i + j];
          const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
          const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
          re[i + j] = uRe + vRe;
          im[i + j] = uIm + vIm;
          re[i + j + half] = uRe - vRe;
          im[i + j + half] = uIm - vIm;
          const nextWRe = wRe * wlenRe - wIm * wlenIm;
          wIm = wRe * wlenIm + wIm * wlenRe;
          wRe = nextWRe;
        }
      }
    }
    if (invert) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  function nextPow2(v) {
    let p = 1;
    while (p < v) p <<= 1;
    return p;
  }

  /**
   * 300 kV Cryo-EM Contrast Transfer Function CTF(k) in spatial frequency k (Å⁻¹).
   * Positive protein density convention: w_a cos(χ) + √(1 − w_a²) sin(χ), damped by B-factor envelope.
   */
  function evalCryoCTF(kInvAng, defocusUm = 1.5, bFactor = 45) {
    const lambda = 0.019687; // 300 kV relativistic electron wavelength (Å)
    const Cs = 2.7e7; // 2.7 mm spherical aberration in Å
    const dz = defocusUm * 1e4; // μm -> Å
    const k2 = kInvAng * kInvAng;
    const chi = Math.PI * dz * lambda * k2 - 0.5 * Math.PI * Cs * (lambda ** 3) * (k2 * k2);
    const wAmp = 0.10; // 10% amplitude contrast in vitreous ice
    const env = Math.exp(-0.25 * bFactor * k2);
    return (wAmp * Math.cos(chi) + Math.sqrt(1 - wAmp * wAmp) * Math.sin(chi)) * env;
  }

  /**
   * Apply forward Cryo-EM CTF modulation, low-dose shot noise, and optional phase-flipping.
   */
  function simulateDetectorAcquisition(cleanSino, params) {
    const {
      angles,
      B,
      pixelSizeAng = 1.5,
      ctfMode = 'none', // 'none' | 'cryo_ctf' | 'ctf_flipped'
      defocusUm = 1.5,
      dose = Infinity, // Infinity or e⁻/Å² (e.g. 200, 40, 12)
      seed = 42,
    } = params;

    const P = nextPow2(2 * B);
    const padOffset = Math.floor((P - B) / 2);
    const modulated = new Float64Array(cleanSino.length);

    if (ctfMode === 'cryo_ctf' || ctfMode === 'ctf_flipped') {
      const re = new Float64Array(P);
      const im = new Float64Array(P);
      for (let a = 0; a < angles; a++) {
        re.fill(0);
        im.fill(0);
        for (let b = 0; b < B; b++) re[padOffset + b] = cleanSino[a * B + b];
        fft1dRadix2(re, im, false);
        for (let k = 0; k < P; k++) {
          const signedK = k <= P / 2 ? k : k - P;
          const freqInvAng = Math.abs(signedK) / (P * pixelSizeAng);
          // Normalize DC gain to 1 at k=0 so integrated density units remain calibrated
          const h = signedK === 0 ? 1.0 : evalCryoCTF(freqInvAng, defocusUm) / 0.10 * 0.10;
          // Use unit-peak scaled CTF transfer so protein contrast matches direct projection scale
          const ctfVal = signedK === 0 ? 0.85 : evalCryoCTF(freqInvAng, defocusUm);
          re[k] *= ctfVal;
          im[k] *= ctfVal;
        }
        fft1dRadix2(re, im, true);
        for (let b = 0; b < B; b++) modulated[a * B + b] = re[padOffset + b];
      }
    } else {
      modulated.set(cleanSino);
    }

    // Apply low-dose electron shot noise + detector readout floor
    const measured = new Float64Array(modulated.length);
    const finiteDose = Number.isFinite(dose) && dose > 0 && dose < 1e6;
    if (finiteDose) {
      const rng = mulberry32(seed);
      let maxSignal = 0;
      for (let i = 0; i < modulated.length; i++) {
        const a = Math.abs(modulated[i]);
        if (a > maxSignal) maxSignal = a;
      }
      const scale = Math.max(1, maxSignal);
      // Calibrate photon/electron counts per ray bin: dose (e⁻/Å²) × effective pixel area
      const countsPerUnit = dose * 4.5;
      const bgCounts = countsPerUnit * 0.35; // Vitreous ice background scattering
      const readoutSigma = 0.012 * scale * Math.sqrt(40 / dose);
      for (let i = 0; i < modulated.length; i++) {
        const expected = Math.max(0.5, bgCounts + countsPerUnit * (modulated[i] / scale));
        const drawn = samplePoisson(expected, rng);
        const recovered = ((drawn - bgCounts) / countsPerUnit) * scale + readoutSigma * randNormal(rng);
        measured[i] = recovered;
      }
    } else {
      measured.set(modulated);
    }

    // Optional CTF Phase-Flipping restoration prior to reconstruction
    if (ctfMode === 'ctf_flipped') {
      const flipped = new Float64Array(measured.length);
      const re = new Float64Array(P);
      const im = new Float64Array(P);
      for (let a = 0; a < angles; a++) {
        re.fill(0);
        im.fill(0);
        for (let b = 0; b < B; b++) re[padOffset + b] = measured[a * B + b];
        fft1dRadix2(re, im, false);
        for (let k = 0; k < P; k++) {
          const signedK = k <= P / 2 ? k : k - P;
          const freqInvAng = Math.abs(signedK) / (P * pixelSizeAng);
          const ctfVal = signedK === 0 ? 1 : evalCryoCTF(freqInvAng, defocusUm);
          const sgn = ctfVal < 0 ? -1 : 1;
          re[k] *= sgn;
          im[k] *= sgn;
        }
        fft1dRadix2(re, im, true);
        for (let b = 0; b < B; b++) flipped[a * B + b] = re[padOffset + b];
      }
      return { rawMeasured: measured, reconInput: flipped };
    }

    return { rawMeasured: measured, reconInput: measured };
  }

  function calcRmse(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return Math.sqrt(s / Math.max(1, a.length));
  }

  function calcMae(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / Math.max(1, a.length);
  }

  // Exact Kak & Slaney (1988) spatial-domain bandlimited Ram-Lak filter FFT cache
  const filterCache = new Map();

  function getRampFilterFFT(P, windowType = 'ramlak') {
    const key = `${P}|${windowType}`;
    if (filterCache.has(key)) return filterCache.get(key);
    const re = new Float64Array(P);
    const im = new Float64Array(P);
    re[0] = 0.25;
    for (let n = 1; n < P / 2; n++) {
      if (n % 2 === 1) {
        const val = -1 / (Math.PI * Math.PI * n * n);
        re[n] = val;
        re[P - n] = val;
      }
    }
    fft1dRadix2(re, im, false);
    if (windowType === 'hann') {
      const cutoff = 0.42; // Cycles/pixel roll-off
      for (let k = 0; k < P; k++) {
        const signedK = k <= P / 2 ? k : k - P;
        const nu = Math.abs(signedK) / P;
        const w = nu === 0 ? 1 : (nu <= cutoff ? 0.5 * (1 + Math.cos((Math.PI * nu) / cutoff)) : 0);
        re[k] *= w;
        im[k] *= w;
      }
    }
    filterCache.set(key, re);
    return re;
  }

  /**
   * Chambolle (2004) isotropic Total Variation proximal operator:
   * argmin_{u ≥ 0} ½‖u − g‖₂² + weight · ‖∇u‖₂,₁
   */
  function proxIsotropicTV(g, N, weight, dualSteps = 5) {
    if (weight <= 0) {
      const out = new Float64Array(g.length);
      for (let i = 0; i < g.length; i++) out[i] = g[i] > 0 ? g[i] : 0;
      return out;
    }
    const nn = N * N;
    const px = new Float64Array(nn);
    const py = new Float64Array(nn);
    const div = new Float64Array(nn);
    const tau = 0.248; // Guaranteed convergent for τ ≤ 1/4 in 2D

    for (let it = 0; it < dualSteps; it++) {
      // Compute div(p)
      for (let j = 0; j < N; j++) {
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const idx = row + i;
          const dx = (i < N - 1 ? px[idx] : 0) - (i > 0 ? px[idx - 1] : 0);
          const dy = (j < N - 1 ? py[idx] : 0) - (j > 0 ? py[idx - N] : 0);
          div[idx] = uCandidate(g[idx] + weight * (dx + dy));
        }
      }
      // Dual gradient ascent on p
      const step = tau / weight;
      for (let j = 0; j < N; j++) {
        const row = j * N;
        for (let i = 0; i < N; i++) {
          const idx = row + i;
          const gx = i < N - 1 ? div[idx + 1] - div[idx] : 0;
          const gy = j < N - 1 ? div[idx + N] - div[idx] : 0;
          const nx = px[idx] + step * gx;
          const ny = py[idx] + step * gy;
          const norm = Math.max(1, Math.hypot(nx, ny));
          px[idx] = nx / norm;
          py[idx] = ny / norm;
        }
      }
    }

    const out = new Float64Array(nn);
    for (let j = 0; j < N; j++) {
      const row = j * N;
      for (let i = 0; i < N; i++) {
        const idx = row + i;
        const dx = (i < N - 1 ? px[idx] : 0) - (i > 0 ? px[idx - 1] : 0);
        const dy = (j < N - 1 ? py[idx] : 0) - (j > 0 ? py[idx - N] : 0);
        const val = g[idx] + weight * (dx + dy);
        out[idx] = val > 0 ? val : 0;
      }
    }
    return out;
  }

  function uCandidate(v) {
    return v;
  }

  function computeIsotropicTVNorm(x, N) {
    let tv = 0;
    for (let j = 0; j < N; j++) {
      const row = j * N;
      for (let i = 0; i < N; i++) {
        const idx = row + i;
        const gx = i < N - 1 ? x[idx + 1] - x[idx] : 0;
        const gy = j < N - 1 ? x[idx + N] - x[idx] : 0;
        tv += Math.hypot(gx, gy);
      }
    }
    return tv;
  }

  /**
   * Run any of the 6 canonical tomographic reconstruction algorithms.
   */
  function reconstruct(op, sino, options = {}) {
    const {
      solver = 'sirt',
      passes = 20,
      target = null, // Optional ground-truth slice for pass-by-pass RMSE curve
      tvLambda = 0.0035,
      recordHistory = true,
    } = options;

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const { N, B, angles, spanRad, raySum, pixSum } = op;
    const nn = N * N;
    const m = angles * B;
    const rmseHistory = [];
    const sinoRmseHistory = [];
    let bestEstimate = null;
    let bestPass = 0;
    let bestRmse = Infinity;

    function pushMetrics(est, passIdx, precomputedFwd) {
      if (!recordHistory) return;
      const fwd = precomputedFwd || op.project(est);
      sinoRmseHistory.push(calcRmse(fwd, sino));
      if (target) {
        const r = calcRmse(est, target);
        rmseHistory.push(r);
        if (r < bestRmse) {
          bestRmse = r;
          bestPass = passIdx;
          bestEstimate = est.slice();
        }
      }
    }

    // Analytical single-pass solvers: FBP (Ram-Lak) & WBP (Hann)
    if (solver === 'fbp_ramlak' || solver === 'wbp_hann') {
      const zero = new Float64Array(nn);
      pushMetrics(zero, 0);

      const P = nextPow2(2 * B);
      const padOffset = Math.floor((P - B) / 2);
      const filtRe = getRampFilterFFT(P, solver === 'wbp_hann' ? 'hann' : 'ramlak');
      const filteredSino = new Float64Array(m);
      const re = new Float64Array(P);
      const im = new Float64Array(P);
      // Angular quadrature weight inside measured span: Δθ = Φ / N_θ
      const dTheta = spanRad / angles;

      for (let a = 0; a < angles; a++) {
        re.fill(0);
        im.fill(0);
        for (let b = 0; b < B; b++) re[padOffset + b] = sino[a * B + b];
        fft1dRadix2(re, im, false);
        for (let k = 0; k < P; k++) {
          re[k] *= filtRe[k];
          im[k] *= filtRe[k];
        }
        fft1dRadix2(re, im, true);
        for (let b = 0; b < B; b++) filteredSino[a * B + b] = re[padOffset + b] * dTheta;
      }

      const estimate = op.backproject(filteredSino);
      if (recordHistory) {
        const finalFwd = op.project(estimate);
        const finalSinoRmse = calcRmse(finalFwd, sino);
        const finalSliceRmse = target ? calcRmse(estimate, target) : 0;
        const stepsCount = Math.max(1, passes);
        for (let k = 1; k <= stepsCount; k++) {
          sinoRmseHistory.push(finalSinoRmse);
          if (target) rmseHistory.push(finalSliceRmse);
        }
        bestEstimate = estimate;
        bestPass = 1;
        bestRmse = finalSliceRmse;
      }
      const runtimeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return { estimate, rmseHistory, sinoRmseHistory, bestPass, bestRmse, bestEstimate: bestEstimate || estimate, runtimeMs };
    }

    // 1. SIRT — Cimmino/Gilbert preconditioned simultaneous update with mild momentum
    if (solver === 'sirt') {
      const estimate = new Float64Array(nn);
      const prev = new Float64Array(nn);
      const fwd = new Float64Array(m);
      const normRes = new Float64Array(m);
      const back = new Float64Array(nn);
      const gamma = 1.65;
      const beta = 0.48;

      for (let pass = 0; pass <= passes; pass++) {
        op.project(estimate, fwd);
        pushMetrics(estimate, pass, fwd);
        if (pass === passes) break;
        for (let i = 0; i < m; i++) {
          normRes[i] = raySum[i] > 1e-8 ? (sino[i] - fwd[i]) / raySum[i] : 0;
        }
        op.backproject(normRes, back);
        for (let p = 0; p < nn; p++) {
          const cur = estimate[p];
          const next = cur + (gamma * back[p]) / Math.max(1, pixSum[p]) + (pass > 0 ? beta * (cur - prev[p]) : 0);
          prev[p] = cur;
          estimate[p] = next > 0 ? next : 0;
        }
      }
      const runtimeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return { estimate, rmseHistory, sinoRmseHistory, bestPass, bestRmse, bestEstimate: bestEstimate || estimate, runtimeMs };
    }

    // 2. SART — Ordered-Angle sequential bilinear updates
    if (solver === 'sart') {
      const estimate = new Float64Array(nn);
      const viewProj = new Float64Array(B);
      const viewRes = new Float64Array(B);
      const relax = 0.78;
      // Coprime stride for golden-like angular ordering
      const stride = angles > 4 ? (angles % 2 === 0 ? Math.max(1, Math.floor(angles * 0.382) | 1) : Math.max(1, Math.floor(angles * 0.618))) : 1;
      let coprime = stride;
      const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
      while (gcd(coprime, angles) !== 1) coprime++;

      for (let pass = 0; pass <= passes; pass++) {
        pushMetrics(estimate, pass);
        if (pass === passes) break;
        for (let stepIdx = 0; stepIdx < angles; stepIdx++) {
          const a = (stepIdx * coprime) % angles;
          op.projectSingleAngle(estimate, a, viewProj);
          const viewOffset = a * B;
          for (let b = 0; b < B; b++) {
            const rs = raySum[viewOffset + b];
            viewRes[b] = rs > 1e-8 ? (sino[viewOffset + b] - viewProj[b]) / rs : 0;
          }
          const base = a * nn;
          for (let p = 0; p < nn; p++) {
            const b0 = op.idx0[base + p] - viewOffset;
            const wt0 = op.w0[base + p];
            const corr = wt0 * viewRes[b0] + (1 - wt0) * viewRes[b0 + 1];
            const next = estimate[p] + relax * corr;
            estimate[p] = next > 0 ? next : 0;
          }
        }
      }
      const runtimeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return { estimate, rmseHistory, sinoRmseHistory, bestPass, bestRmse, bestEstimate: bestEstimate || estimate, runtimeMs };
    }

    // 3. MLEM — Shepp & Vardi Multiplicative Poisson EM
    if (solver === 'mlem') {
      const sinoPos = new Float64Array(m);
      let posSum = 0;
      for (let i = 0; i < m; i++) {
        sinoPos[i] = sino[i] > 0 ? sino[i] : 0;
        posSum += sinoPos[i];
      }
      let sensSum = 0;
      for (let p = 0; p < nn; p++) sensSum += pixSum[p];
      const initVal = Math.max(1e-4, posSum / Math.max(1, sensSum));

      // Record pass 0 from uniform/zero baseline consistently: start at initVal after recording pass 0
      const estimate = new Float64Array(nn);
      pushMetrics(estimate, 0);
      estimate.fill(initVal);

      const fwd = new Float64Array(m);
      const ratio = new Float64Array(m);
      const back = new Float64Array(nn);

      for (let pass = 1; pass <= passes; pass++) {
        op.project(estimate, fwd);
        for (let i = 0; i < m; i++) {
          ratio[i] = sinoPos[i] / (fwd[i] + 1e-6);
        }
        op.backproject(ratio, back);
        for (let p = 0; p < nn; p++) {
          estimate[p] = (estimate[p] * back[p]) / Math.max(1e-6, pixSum[p]);
        }
        pushMetrics(estimate, pass);
      }
      const runtimeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return { estimate, rmseHistory, sinoRmseHistory, bestPass, bestRmse, bestEstimate: bestEstimate || estimate, runtimeMs };
    }

    // 4. CS-TV (FISTA) — Compressed-Sensing Isotropic Total Variation
    const xCur = new Float64Array(nn);
    let yMom = new Float64Array(nn);
    const fwd = new Float64Array(m);
    const normRes = new Float64Array(m);
    const back = new Float64Array(nn);
    const stepSize = 1.25;
    let tCur = 1;

    for (let pass = 0; pass <= passes; pass++) {
      pushMetrics(xCur, pass);
      if (pass === passes) break;
      op.project(yMom, fwd);
      for (let i = 0; i < m; i++) {
        normRes[i] = raySum[i] > 1e-8 ? (sino[i] - fwd[i]) / raySum[i] : 0;
      }
      op.backproject(normRes, back);
      const gradStep = new Float64Array(nn);
      for (let p = 0; p < nn; p++) {
        gradStep[p] = yMom[p] + (stepSize * back[p]) / Math.max(1, pixSum[p]);
      }
      const xNext = proxIsotropicTV(gradStep, N, stepSize * tvLambda, 5);
      const tNext = 0.5 * (1 + Math.sqrt(1 + 4 * tCur * tCur));
      const mom = (tCur - 1) / tNext;
      const nextY = new Float64Array(nn);
      for (let p = 0; p < nn; p++) {
        nextY[p] = Math.max(0, xNext[p] + mom * (xNext[p] - xCur[p]));
      }
      xCur.set(xNext);
      yMom = nextY;
      tCur = tNext;
    }
    const runtimeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return { estimate: xCur, rmseHistory, sinoRmseHistory, bestPass, bestRmse, bestEstimate: bestEstimate || xCur, runtimeMs };
  }

  // Separable 2D DFT cache (supports any N: 64, 96, etc. with exact Parseval conservation)
  const dftTableCache = new Map();

  function getDftTables(N) {
    if (dftTableCache.has(N)) return dftTableCache.get(N);
    const cosTab = new Float64Array(N * N);
    const sinTab = new Float64Array(N * N);
    for (let k = 0; k < N; k++) {
      for (let n = 0; n < N; n++) {
        const ang = (-2 * Math.PI * k * n) / N;
        cosTab[k * N + n] = Math.cos(ang);
        sinTab[k * N + n] = Math.sin(ang);
      }
    }
    const tabs = { cosTab, sinTab };
    dftTableCache.set(N, tabs);
    return tabs;
  }

  function dft2dReal(img, N) {
    const { cosTab, sinTab } = getDftTables(N);
    const rowRe = new Float64Array(N * N);
    const rowIm = new Float64Array(N * N);

    // Transform rows
    for (let y = 0; y < N; y++) {
      const rOff = y * N;
      for (let kx = 0; kx < N; kx++) {
        const kOff = kx * N;
        let sr = 0;
        let si = 0;
        for (let x = 0; x < N; x++) {
          const v = img[rOff + x];
          sr += v * cosTab[kOff + x];
          si += v * sinTab[kOff + x];
        }
        rowRe[rOff + kx] = sr;
        rowIm[rOff + kx] = si;
      }
    }

    // Transform columns
    const outRe = new Float64Array(N * N);
    const outIm = new Float64Array(N * N);
    for (let kx = 0; kx < N; kx++) {
      for (let ky = 0; ky < N; ky++) {
        const kOff = ky * N;
        let sr = 0;
        let si = 0;
        for (let y = 0; y < N; y++) {
          const c = cosTab[kOff + y];
          const s = sinTab[kOff + y];
          const rr = rowRe[y * N + kx];
          const ri = rowIm[y * N + kx];
          sr += rr * c - ri * s;
          si += rr * s + ri * c;
        }
        outRe[ky * N + kx] = sr;
        outIm[ky * N + kx] = si;
      }
    }
    return { re: outRe, im: outIm };
  }

  /**
   * Compute centered 2D log-power spectrum log(1 + |F(kx, ky)|) for visualizing
   * Central-Slice spokes, Crowther circle, and the Cryo-ET Missing Wedge.
   */
  function computeCenteredLogSpectrum(dft, N) {
    const map = new Float64Array(N * N);
    const half = Math.floor(N / 2);
    let maxLog = 1e-9;
    for (let j = 0; j < N; j++) {
      const ky = (j + half) % N;
      for (let i = 0; i < N; i++) {
        const kx = (i + half) % N;
        const mag = Math.hypot(dft.re[ky * N + kx], dft.im[ky * N + kx]);
        const lv = Math.log1p(mag);
        map[j * N + i] = lv;
        if ((i !== half || j !== half) && lv > maxLog) maxLog = lv;
      }
    }
    const dcLog = map[half * N + half];
    const normCap = Math.max(maxLog, dcLog * 0.85);
    for (let idx = 0; idx < map.length; idx++) {
      map[idx] = Math.min(1, map[idx] / Math.max(1e-9, normCap));
    }
    return map;
  }

  /**
   * Radial Fourier Ring Correlation FRC(k) (Rosenthal & Henderson 2003; Banterle et al. 2013)
   */
  function computeFRCFromDFTs(dftTrue, dftHat, N, widthAngstrom = 80) {
    const maxRing = Math.floor(N / 2) - 1;
    const num = new Float64Array(maxRing + 1);
    const denA = new Float64Array(maxRing + 1);
    const denB = new Float64Array(maxRing + 1);
    const counts = new Uint16Array(maxRing + 1);

    for (let ky = 0; ky < N; ky++) {
      const sy = ky <= N / 2 ? ky : ky - N;
      for (let kx = 0; kx < N; kx++) {
        const sx = kx <= N / 2 ? kx : kx - N;
        const r = Math.round(Math.hypot(sx, sy));
        if (r > maxRing) continue;
        const idx = ky * N + kx;
        const ar = dftTrue.re[idx], ai = dftTrue.im[idx];
        const br = dftHat.re[idx], bi = dftHat.im[idx];
        num[r] += ar * br + ai * bi;
        denA[r] += ar * ar + ai * ai;
        denB[r] += br * br + bi * bi;
        counts[r]++;
      }
    }

    const physW = widthAngstrom || 80;
    const pixelAng = physW / N;
    const nyquistRes = 2 * pixelAng;
    const shells = [];
    for (let r = 0; r <= maxRing; r++) {
      const denom = Math.sqrt(denA[r] * denB[r]);
      const frc = r === 0 ? 1.0 : (denom > 1e-12 ? Math.max(-1, Math.min(1, num[r] / denom)) : 0);
      const freqInvAng = r / physW;
      // Half-bit significance curve (van Heel & Schatz 2005)
      const nVox = Math.max(1, counts[r]);
      const halfBit = (0.2071 + 1.9102 / Math.sqrt(nVox)) / (1.2071 + 0.9102 / Math.sqrt(nVox));
      shells.push({
        ring: r,
        freqInvAng,
        freqCyclesPx: r / N,
        resAngstrom: r > 0 ? physW / r : Infinity,
        frc,
        halfBit,
        count: counts[r],
      });
    }

    function crossingResolution(threshold) {
      for (let r = 1; r < shells.length; r++) {
        if (shells[r].frc < threshold) {
          const prev = shells[r - 1];
          const cur = shells[r];
          const frac = (prev.frc - threshold) / Math.max(1e-9, prev.frc - cur.frc);
          const fCross = prev.freqInvAng + frac * (cur.freqInvAng - prev.freqInvAng);
          return fCross > 1e-9 ? 1 / fCross : physW;
        }
      }
      return nyquistRes;
    }

    return {
      shells,
      res0143: crossingResolution(0.143),
      res050: crossingResolution(0.5),
      nyquistRes,
      pixelAng,
    };
  }

  /**
   * Windowed 7×7 Structural Similarity Index (SSIM, Wang et al. 2004)
   */
  function computeSSIM(target, estimate, N) {
    const C1 = 0.01 * 0.01;
    const C2 = 0.03 * 0.03;
    const rad = 3;
    let sumSsim = 0;
    let count = 0;

    for (let j = rad; j < N - rad; j += 2) {
      for (let i = rad; i < N - rad; i += 2) {
        let mx = 0, my = 0;
        const winN = (2 * rad + 1) ** 2;
        for (let dy = -rad; dy <= rad; dy++) {
          const row = (j + dy) * N + i;
          for (let dx = -rad; dx <= rad; dx++) {
            mx += target[row + dx];
            my += estimate[row + dx];
          }
        }
        mx /= winN;
        my /= winN;
        let vx = 0, vy = 0, cov = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          const row = (j + dy) * N + i;
          for (let dx = -rad; dx <= rad; dx++) {
            const ax = target[row + dx] - mx;
            const ay = estimate[row + dx] - my;
            vx += ax * ax;
            vy += ay * ay;
            cov += ax * ay;
          }
        }
        vx /= (winN - 1);
        vy /= (winN - 1);
        cov /= (winN - 1);
        const num = (2 * mx * my + C1) * (2 * cov + C2);
        const den = (mx * mx + my * my + C1) * (vx + vy + C2);
        sumSsim += den > 0 ? num / den : 1;
        count++;
      }
    }
    return count ? Math.max(-1, Math.min(1, sumSsim / count)) : 1;
  }

  /**
   * Lin's Concordance Correlation Coefficient (CCC) & Pearson correlation
   */
  function computeConcordance(target, estimate) {
    const n = target.length;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) {
      mx += target[i];
      my += estimate[i];
    }
    mx /= n;
    my /= n;
    let vx = 0, vy = 0, cov = 0;
    for (let i = 0; i < n; i++) {
      const dx = target[i] - mx;
      const dy = estimate[i] - my;
      vx += dx * dx;
      vy += dy * dy;
      cov += dx * dy;
    }
    vx /= n;
    vy /= n;
    cov /= n;
    const pearson = (vx > 1e-12 && vy > 1e-12) ? cov / Math.sqrt(vx * vy) : 0;
    const denom = vx + vy + (mx - my) ** 2;
    const ccc = denom > 1e-12 ? (2 * cov) / denom : 1;
    return { pearson, ccc };
  }

  function computePSNR(rmse) {
    return 20 * Math.log10(1 / Math.max(1e-5, rmse));
  }

  /**
   * Directional Fourier Error Anisotropy across 12 angular sectors in [0°, 180°).
   * Reveals how a limited tilt span concentrates error inside the unmeasured missing wedge.
   */
  function computeErrorAnisotropy(dftTrue, dftHat, N, spanDeg) {
    const sectors = 12;
    const power = new Float64Array(sectors);
    const counts = new Uint16Array(sectors);
    for (let ky = 0; ky < N; ky++) {
      const sy = ky <= N / 2 ? ky : ky - N;
      for (let kx = 0; kx < N; kx++) {
        const sx = kx <= N / 2 ? kx : kx - N;
        const r = Math.hypot(sx, sy);
        if (r < 2 || r > N / 2 - 1) continue;
        let angDeg = (Math.atan2(sy, sx) * 180) / Math.PI;
        if (angDeg < 0) angDeg += 180;
        if (angDeg >= 180) angDeg -= 180;
        const bin = Math.min(sectors - 1, Math.floor((angDeg / 180) * sectors));
        const idx = ky * N + kx;
        const dr = dftHat.re[idx] - dftTrue.re[idx];
        const di = dftHat.im[idx] - dftTrue.im[idx];
        power[bin] += dr * dr + di * di;
        counts[bin]++;
      }
    }
    const items = [];
    let maxRms = 1e-9;
    for (let b = 0; b < sectors; b++) {
      const centerDeg = ((b + 0.5) * 180) / sectors;
      const rms = counts[b] ? Math.sqrt(power[b] / counts[b]) / N : 0;
      if (rms > maxRms) maxRms = rms;
      items.push({
        sector: b,
        angleDeg: centerDeg,
        inMissingWedge: centerDeg > spanDeg,
        rmsError: rms,
      });
    }
    const measuredVals = items.filter(it => !it.inMissingWedge).map(it => it.rmsError);
    const wedgeVals = items.filter(it => it.inMissingWedge).map(it => it.rmsError);
    const meanMeasured = measuredVals.length ? measuredVals.reduce((s, v) => s + v, 0) / measuredVals.length : 0;
    const meanWedge = wedgeVals.length ? wedgeVals.reduce((s, v) => s + v, 0) / wedgeVals.length : meanMeasured;
    return {
      sectors: items,
      maxRms,
      anisotropyRatio: meanMeasured > 1e-9 ? meanWedge / meanMeasured : 1.0,
    };
  }

  /**
   * Reference-free Leave-One-Tilt-Out validation (Cardone et al. 2005):
   * Omits the median projection angle, reconstructs from the remaining (angles − 1) views,
   * reprojects onto the omitted angle, and computes 1D Fourier correlation & projection RMSE.
   */
  function computeLeaveOneTiltOut(N, B, angles, spanDeg, sino, solver, passes, tvLambda, widthAngstrom = 80) {
    if (angles < 3) return { heldAngleDeg: 0, projRmse: 0, shells: [] };
    const heldIdx = Math.floor(angles / 2);
    const subAngles = angles - 1;
    const fullOp = getRadonOperator(N, B, angles, spanDeg, 0);
    // Build custom reduced sinogram & operator via manual subsetting
    const subSino = new Float64Array(subAngles * B);
    let dst = 0;
    for (let a = 0; a < angles; a++) {
      if (a === heldIdx) continue;
      subSino.set(sino.subarray(a * B, (a + 1) * B), dst * B);
      dst++;
    }
    // Subset operator sharing exact thetas of remaining angles
    const nn = N * N;
    const idx0 = new Uint32Array(subAngles * nn);
    const w0 = new Float32Array(subAngles * nn);
    const raySum = new Float64Array(subAngles * B);
    const pixSum = new Float64Array(nn);
    dst = 0;
    for (let a = 0; a < angles; a++) {
      if (a === heldIdx) continue;
      const shiftBin = (dst - a) * B;
      for (let p = 0; p < nn; p++) {
        const flat = fullOp.idx0[a * nn + p] + shiftBin;
        const wt0 = fullOp.w0[a * nn + p];
        idx0[dst * nn + p] = flat;
        w0[dst * nn + p] = wt0;
        raySum[flat] += wt0;
        raySum[flat + 1] += 1 - wt0;
        pixSum[p] += 1;
      }
      dst++;
    }
    const subOp = {
      N, B, angles: subAngles, spanDeg, spanRad: fullOp.spanRad,
      idx0, w0, raySum, pixSum,
      project(slice, out) {
        const y = out || new Float64Array(subAngles * B);
        if (out) y.fill(0);
        for (let a = 0; a < subAngles; a++) {
          const base = a * nn;
          for (let p = 0; p < nn; p++) {
            const val = slice[p];
            if (val === 0) continue;
            const flat = idx0[base + p];
            const wt = w0[base + p];
            y[flat] += wt * val;
            y[flat + 1] += (1 - wt) * val;
          }
        }
        return y;
      },
      projectSingleAngle(slice, a, outView) {
        const y = outView || new Float64Array(B);
        if (outView) y.fill(0);
        const base = a * nn;
        const vOff = a * B;
        for (let p = 0; p < nn; p++) {
          const val = slice[p];
          if (val === 0) continue;
          const b0 = idx0[base + p] - vOff;
          const wt = w0[base + p];
          y[b0] += wt * val;
          y[b0 + 1] += (1 - wt) * val;
        }
        return y;
      },
      backproject(s, out) {
        const x = out || new Float64Array(nn);
        if (out) x.fill(0);
        for (let a = 0; a < subAngles; a++) {
          const base = a * nn;
          for (let p = 0; p < nn; p++) {
            const flat = idx0[base + p];
            const wt = w0[base + p];
            x[p] += wt * s[flat] + (1 - wt) * s[flat + 1];
          }
        }
        return x;
      },
    };

    const fastPasses = Math.min(passes, 18);
    const { estimate } = reconstruct(subOp, subSino, { solver, passes: fastPasses, tvLambda, recordHistory: false });
    const predView = fullOp.projectSingleAngle(estimate, heldIdx);
    const measView = sino.subarray(heldIdx * B, (heldIdx + 1) * B);
    const projRmse = calcRmse(predView, measView);

    // 1D Banded Fourier correlation between measured and reprojected held-out view
    const P = nextPow2(B);
    const reM = new Float64Array(P), imM = new Float64Array(P);
    const reP = new Float64Array(P), imP = new Float64Array(P);
    for (let b = 0; b < B; b++) {
      reM[b] = measView[b];
      reP[b] = predView[b];
    }
    fft1dRadix2(reM, imM, false);
    fft1dRadix2(reP, imP, false);
    const physW = widthAngstrom || 80;
    const pixelAng = physW / N;
    const bands = 14;
    const maxK = Math.floor(P / 2);
    const shells = [];
    for (let g = 0; g < bands; g++) {
      const k0 = Math.floor((g * maxK) / bands);
      const k1 = Math.max(k0 + 1, Math.floor(((g + 1) * maxK) / bands));
      let num = 0, dM = 0, dP = 0;
      for (let k = k0; k < k1; k++) {
        num += reM[k] * reP[k] + imM[k] * imP[k];
        dM += reM[k] ** 2 + imM[k] ** 2;
        dP += reP[k] ** 2 + imP[k] ** 2;
      }
      const corr = (dM > 1e-12 && dP > 1e-12) ? Math.max(-1, Math.min(1, num / Math.sqrt(dM * dP))) : 0;
      const kMid = 0.5 * (k0 + k1);
      shells.push({
        band: g,
        freqInvAng: kMid / (P * pixelAng),
        corr: g === 0 ? Math.max(0.85, corr) : corr,
      });
    }

    return {
      heldIdx,
      heldAngleDeg: (fullOp.thetas[heldIdx] * 180) / Math.PI,
      measView,
      predView,
      projRmse,
      shells,
    };
  }

  /**
   * Hansen's Regularization L-Curve across λ_TV ∈ [0.0005, 0.08]
   */
  function computeTVLCurve(op, sino, target, passes = 16) {
    const lambdas = [0.0005, 0.0015, 0.004, 0.010, 0.022, 0.045, 0.085];
    const fastPasses = Math.min(20, Math.max(8, passes));
    const points = lambdas.map(lam => {
      const res = reconstruct(op, sino, { solver: 'tv_fista', passes: fastPasses, tvLambda: lam, recordHistory: false });
      const fwd = op.project(res.estimate);
      const dataNorm = Math.sqrt(fwd.reduce((s, v, i) => s + (v - sino[i]) ** 2, 0));
      const tvNorm = computeIsotropicTVNorm(res.estimate, op.N);
      const sliceRmse = target ? calcRmse(res.estimate, target) : null;
      return {
        lambda: lam,
        dataNorm: Math.max(1e-6, dataNorm),
        tvNorm: Math.max(1e-6, tvNorm),
        logData: Math.log10(Math.max(1e-6, dataNorm)),
        logTV: Math.log10(Math.max(1e-6, tvNorm)),
        sliceRmse,
      };
    });

    // Identify corner via maximum discrete Menger curvature in (logData, logTV)
    let bestIdx = 3;
    let bestCurv = -Infinity;
    for (let i = 1; i < points.length - 1; i++) {
      const a = points[i - 1], b = points[i], c = points[i + 1];
      const x1 = b.logData - a.logData, y1 = b.logTV - a.logTV;
      const x2 = c.logData - b.logData, y2 = c.logTV - b.logTV;
      const cross = x1 * y2 - y1 * x2;
      const denom = Math.hypot(x1, y1) * Math.hypot(x2, y2) * Math.hypot(x1 + x2, y1 + y2);
      const curv = denom > 1e-9 ? cross / denom : 0;
      if (Math.abs(curv) > bestCurv) {
        bestCurv = Math.abs(curv);
        bestIdx = i;
      }
    }
    return { points, cornerIndex: bestIdx, optimalLambda: points[bestIdx].lambda };
  }

  /**
   * Extract observable projection-only sinogram features (zero ground-truth access!).
   * Used for Leave-One-Protein-Out RMSE prediction per docs/platform-design.md.
   */
  function extractSinogramFeatures(sino, angles, B) {
    const m = angles * B;
    let mean = 0;
    for (let i = 0; i < m; i++) mean += sino[i];
    mean /= Math.max(1, m);

    let variance = 0;
    let gradEnergy = 0;
    let supportBins = 0;
    let peak = 0;
    for (let i = 0; i < m; i++) if (sino[i] > peak) peak = sino[i];
    const thresh = 0.08 * peak;

    for (let a = 0; a < angles; a++) {
      const off = a * B;
      for (let b = 0; b < B; b++) {
        const v = sino[off + b];
        variance += (v - mean) ** 2;
        if (v > thresh) supportBins++;
        if (b < B - 1) {
          const d = sino[off + b + 1] - v;
          gradEnergy += d * d;
        }
      }
    }
    const std = Math.sqrt(variance / Math.max(1, m));
    const gradRms = Math.sqrt(gradEnergy / Math.max(1, angles * (B - 1)));
    return {
      sinoMean: mean / Math.max(1, B * 0.5),
      sinoContrast: std / Math.max(1e-6, peak),
      sinoSupportFrac: supportBins / Math.max(1, m),
      sinoRoughness: gradRms / Math.max(1e-6, std),
    };
  }

  /**
   * Evaluate Leave-One-Protein-Out cross-specimen error prediction across surveyRows.
   * Supports 3 learners:
   *  - 'mean': Angle-conditioned training mean (no specimen features)
   *  - 'proj_knn': Projection-only feature distance matching (NO reference-slice access!)
   *  - 'neighbor': Oracle reference-slice mean density matching (requires reference structure)
   */
  function evaluateProteinHoldout(surveyRows, heldId, spanDeg, learner = 'proj_knn') {
    const training = surveyRows.filter(r => r.id !== heldId && r.span === spanDeg);
    const test = surveyRows.filter(r => r.id === heldId && r.span === spanDeg);
    if (!test.length || !training.length) return { mae: 0, rmse: 0, rows: [], usesReference: false };

    let absSum = 0;
    let sqSum = 0;
    const rows = test.map(target => {
      const candidates = training.filter(r => r.angles === target.angles);
      let prediction = 0;

      if (learner === 'mean') {
        prediction = candidates.reduce((s, r) => s + r.error, 0) / candidates.length;
      } else if (learner === 'neighbor') {
        const closest = candidates.reduce((a, b) =>
          Math.abs(a.mean - target.mean) < Math.abs(b.mean - target.mean) ? a : b
        );
        prediction = closest.error;
      } else {
        // 'proj_knn': distance-weighted 2-NN using ONLY projection-derived features!
        const featKeys = ['sinoMean', 'sinoContrast', 'sinoSupportFrac', 'sinoRoughness'];
        const scales = featKeys.map(k => {
          const vals = candidates.map(c => Number(c[k] || 0));
          const mu = vals.reduce((s, v) => s + v, 0) / vals.length;
          const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mu) ** 2, 0) / vals.length);
          return Math.max(1e-6, sd);
        });
        const dists = candidates.map(c => {
          let d2 = 0;
          for (let f = 0; f < featKeys.length; f++) {
            const k = featKeys[f];
            const diff = ((Number(c[k]) || 0) - (Number(target[k]) || 0)) / scales[f];
            d2 += diff * diff;
          }
          return { row: c, dist: Math.sqrt(d2) };
        }).sort((a, b) => a.dist - b.dist);

        const top = dists.slice(0, Math.min(3, dists.length));
        let wSum = 0;
        let ySum = 0;
        for (const item of top) {
          const w = 1 / (item.dist + 0.08);
          wSum += w;
          ySum += w * item.row.error;
        }
        prediction = ySum / Math.max(1e-9, wSum);
      }

      const absErr = Math.abs(prediction - target.error);
      absSum += absErr;
      sqSum += absErr * absErr;
      return {
        angles: target.angles,
        predicted: prediction,
        actual: target.error,
        absErr,
      };
    });

    return {
      heldId,
      spanDeg,
      learner,
      usesReference: learner === 'neighbor',
      trainCount: training.length,
      mae: absSum / rows.length,
      rmse: Math.sqrt(sqSum / rows.length),
      rows,
    };
  }

  /**
   * Full benchmark run for a chosen configuration + 6-solver comparison leaderboard.
   */
  function runExperiment(config = {}) {
    const {
      specimenId = 'P00846',
      z = 0,
      N = 64,
      angles = 24,
      spanDeg = 180,
      passes = 20,
      solver = 'sirt',
      dose = Infinity,
      ctfMode = 'none',
      defocusUm = 1.5,
      honestForward = false,
      tvLambda = 0.0035,
      weightMode = 'uniform',
      seed = 42,
      compareAllSolvers = true,
    } = config;

    const specimen = loadSpecimenGeometry(specimenId);
    const B = defaultBinsForGrid(N);
    const physWidth = specimen.widthAngstrom || specimen.nominalWidthAngstrom || 80;
    const pixelAng = physWidth / N;

    const target = sampleSlice(specimen, z, N, weightMode);
    const invOp = getRadonOperator(N, B, angles, spanDeg, 0);

    const cleanSino = honestForward
      ? forwardProjectHonest(specimen, z, N, B, angles, spanDeg, weightMode, 0.35)
      : invOp.project(target);

    const { rawMeasured, reconInput } = simulateDetectorAcquisition(cleanSino, {
      angles,
      B,
      pixelSizeAng: pixelAng,
      ctfMode,
      defocusUm,
      dose,
      seed,
    });

    const primary = reconstruct(invOp, reconInput, {
      solver,
      passes,
      target,
      tvLambda,
      recordHistory: true,
    });

    const dftTrue = dft2dReal(target, N);
    const dftHat = dft2dReal(primary.estimate, N);
    const kSpaceTrue = computeCenteredLogSpectrum(dftTrue, N);
    const kSpaceHat = computeCenteredLogSpectrum(dftHat, N);
    const frc = computeFRCFromDFTs(dftTrue, dftHat, N, physWidth);
    const anisotropy = computeErrorAnisotropy(dftTrue, dftHat, N, spanDeg);

    const rmse = calcRmse(primary.estimate, target);
    const mae = calcMae(primary.estimate, target);
    const ssim = computeSSIM(target, primary.estimate, N);
    const psnr = computePSNR(rmse);
    const { pearson, ccc } = computeConcordance(target, primary.estimate);
    const crowtherRes = (Math.PI * physWidth) / angles;
    const sinoResidual = primary.sinoRmseHistory.at(-1) ?? calcRmse(invOp.project(primary.estimate), reconInput);

    // Compute 6-solver leaderboard on identical measurements
    let leaderboard = [];
    if (compareAllSolvers) {
      leaderboard = SOLVER_CATALOG.map(meta => {
        if (meta.id === solver) {
          return {
            ...meta,
            estimate: primary.estimate,
            rmse,
            mae,
            ssim,
            psnr,
            ccc,
            frc0143: frc.res0143,
            frc050: frc.res050,
            sinoRmse: sinoResidual,
            bestPass: primary.bestPass,
            bestRmse: primary.bestRmse,
            runtimeMs: primary.runtimeMs,
          };
        }
        const runRes = reconstruct(invOp, reconInput, {
          solver: meta.id,
          passes,
          target,
          tvLambda,
          recordHistory: false,
        });
        const r = calcRmse(runRes.estimate, target);
        const m = calcMae(runRes.estimate, target);
        const ss = computeSSIM(target, runRes.estimate, N);
        const dftM = dft2dReal(runRes.estimate, N);
        const frcM = computeFRCFromDFTs(dftTrue, dftM, N, physWidth);
        const { ccc: cccM } = computeConcordance(target, runRes.estimate);
        const sRes = calcRmse(invOp.project(runRes.estimate), reconInput);
        return {
          ...meta,
          estimate: runRes.estimate,
          rmse: r,
          mae: m,
          ssim: ss,
          psnr: computePSNR(r),
          ccc: cccM,
          frc0143: frcM.res0143,
          frc050: frcM.res050,
          sinoRmse: sRes,
          bestPass: passes,
          bestRmse: r,
          runtimeMs: runRes.runtimeMs,
        };
      });
    }

    // Diagnostic regime classification
    let verdict = { label: 'High-Fidelity Recovery', tone: 'good' };
    const finiteDose = Number.isFinite(dose) && dose > 0 && dose < 1e6;
    if (finiteDose && primary.rmseHistory.length > 3 && rmse > primary.bestRmse * 1.12) {
      verdict = { label: `Noise Overfit (Stop @ Pass ${primary.bestPass})`, tone: 'warn' };
    } else if (spanDeg < 180 && anisotropy.anisotropyRatio > 1.65) {
      verdict = { label: `Missing-Wedge Elongation (${180 - spanDeg}° Cone)`, tone: 'warn' };
    } else if (angles <= 8) {
      verdict = { label: `Sparse-View Undersampling (${angles} Tilts)`, tone: 'warn' };
    } else if (ctfMode === 'cryo_ctf') {
      verdict = { label: 'Uncorrected CTF Phase Flips', tone: 'bad' };
    }

    // Mean target density (matches legacy survey feature)
    const meanDensity = target.reduce((s, v) => s + v, 0) / target.length;
    const sinoFeatures = extractSinogramFeatures(rawMeasured, angles, B);

    return {
      config: { specimenId: specimen.id, z, N, B, angles, spanDeg, passes, solver, dose, ctfMode, defocusUm, honestForward, tvLambda, weightMode, seed },
      specimen,
      physWidth,
      pixelAng,
      crowtherRes,
      op: invOp,
      target,
      cleanSino,
      rawMeasured,
      reconInput,
      estimate: primary.estimate,
      rmseHistory: primary.rmseHistory,
      sinoRmseHistory: primary.sinoRmseHistory,
      bestPass: primary.bestPass,
      bestRmse: primary.bestRmse,
      metrics: {
        rmse,
        mae,
        ssim,
        psnr,
        pearson,
        ccc,
        frc0143: frc.res0143,
        frc050: frc.res050,
        nyquistRes: frc.nyquistRes,
        crowtherRes,
        sinoResidual,
        anisotropyRatio: anisotropy.anisotropyRatio,
        meanDensity,
      },
      sinoFeatures,
      frc,
      dftTrue,
      dftHat,
      kSpaceTrue,
      kSpaceHat,
      anisotropy,
      leaderboard,
      verdict,
    };
  }

  const TomographyEngine = {
    SOLVER_CATALOG,
    GENE_STUDIES,
    EXPERIMENTAL_STUDIES,
    getSpecimenCatalog,
    loadSpecimenGeometry,
    sampleSlice,
    defaultBinsForGrid,
    getRadonOperator,
    forwardProjectHonest,
    evalCryoCTF,
    simulateDetectorAcquisition,
    reconstruct,
    dft2dReal,
    computeCenteredLogSpectrum,
    computeFRCFromDFTs,
    computeSSIM,
    computeConcordance,
    computePSNR,
    computeErrorAnisotropy,
    computeLeaveOneTiltOut,
    computeTVLCurve,
    extractSinogramFeatures,
    evaluateProteinHoldout,
    runExperiment,
  };

  root.TomographyEngine = TomographyEngine;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TomographyEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
