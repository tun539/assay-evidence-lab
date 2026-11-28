'use strict';

/**
 * Assay Evidence Studio — 3D Single-Particle Tracking (SPT), Anomalous Diffusion & Cellular Biophysics Engine
 *
 * Implements:
 *  - 8 generative 3D stochastic transport regimes:
 *      1) free      — Isotropic Brownian diffusion (⟨r²⟩ = 6Dt, α = 1)
 *      2) drift     — Motor / advective directed transport (⟨r²⟩ = 6Dt + (vt)²)
 *      3) trap      — Harmonic optical-trap / tethering Ornstein–Uhlenbeck (⟨r²⟩ = 3D(1 − e⁻²ᵏᵗ)/k)
 *      4) axis      — Anisotropic channel / filament diffusion (Dx = D(1 + k), Dy = Dz = D)
 *      5) wave      — Oscillatory pulsatile flow (v(t) = v₀ cos(πt) x̂)
 *      6) fbm       — Viscoelastic Fractional Brownian Motion (AnDi fBm, exact Toeplitz–Cholesky fGn)
 *      7) ctrw      — Continuous-Time Random Walk transient traps (AnDi CTRW, Pareto waiting times)
 *      8) two_state — Spot-On Chromatin Bound ⇌ Free Markov switching (Hansen et al., eLife 2018)
 *  - Stokes–Einstein macromolecular hydrodynamics coupled to 14 bundled AlphaFold DB v6 & RCSB PDB 3D folds
 *    across 5 calibrated biological viscosities (37 °C / 310.15 K).
 *  - Live-cell sCMOS camera physics: static localization error σ_loc (nm) + exact Brownian-bridge exposure
 *    motion blur R ∈ [0, 1/6], plus Michalet & Berglund (2012) / Vestergaard et al. (2014) unbiased
 *    Covariance-Based Estimator (CVE) and Cramér–Rao Lower Bound (CRLB).
 *  - Ensemble vs. Time-Averaged MSD (EA-MSD vs. TA-MSD), Ergodicity-Breaking parameter EB(Δ), local log–log
 *    anomalous slope α(τ), Van Hove displacement distribution P(Δx, τ), 3D Non-Gaussianity α₂(t),
 *    Velocity Autocorrelation C_v(τ), 3D Turning-Angle distribution P(θ), Spot-On 3D Maxwell jump-length
 *    2-state mixture fit, Virtual 3D Gaussian-PSF FRAP recovery F(t), and 3D spherical First-Passage S(t).
 *  - 7-candidate held-out trajectory inference (`fitMotion`, backward-compatible + viscoelastic fGn AR
 *    and 2-state bound/free EM scale mixture) ranked by out-of-sample NLL (nats/coord) and Akaike weights.
 */
(function initTransportEngine(root) {
  const KB_T_310K = 1.380649e-23 * 310.15; // J at 37.0 °C (310.15 K)

  const TRANSPORT_MODES = [
    {
      id: 'free',
      label: 'Isotropic Brownian Diffusion',
      short: 'Brownian (α = 1)',
      family: 'Fickian Equilibrium',
      hasParam: false,
      paramLabel: '',
      paramUnit: '',
      paramMin: 0,
      paramMax: 2,
      paramStep: 0.1,
      paramDefault: 0,
      formula: 'E[r²(t)] = 6 D t · Ergodic (EB → 0), Gaussian (α₂ = 0), memoryless increments C_v(Δt) = 0.',
      question: 'Double D or add 50 nm localization noise σ_loc: notice how naive short-lag OLS inflates D̂ while Vestergaard–Berglund CVE stays unbiased near the Cramér–Rao bound.',
    },
    {
      id: 'drift',
      label: 'Directed Motor / Advective Drift',
      short: 'Directed Drift',
      family: 'Active Ballistic + Thermal',
      hasParam: true,
      paramLabel: 'Motor / drift speed v',
      paramUnit: 'μm/s',
      paramMin: 0.1,
      paramMax: 2.0,
      paramStep: 0.1,
      paramDefault: 0.8,
      formula: 'E[r²(t)] = 6 D t + (v t)² · Diffusive-to-ballistic crossover at τ_c = 6D / v² (α → 2 at long lags).',
      question: 'Inspect Log–Log Scaling α(τ): below τ_c = 6D/v² thermal kicks dominate (α ≈ 1); above τ_c directed transport bends the slope toward ballistic α → 2.',
    },
    {
      id: 'trap',
      label: 'Harmonic Confinement (Ornstein–Uhlenbeck)',
      short: 'Harmonic Trap (OU)',
      family: 'Confined / Tethered',
      hasParam: true,
      paramLabel: 'Restoring spring rate k',
      paramUnit: '1/s',
      paramMin: 0.1,
      paramMax: 3.0,
      paramStep: 0.1,
      paramDefault: 0.8,
      formula: 'E[r²(t)] = (3D / k)(1 − e⁻²ᵏᵗ) · Asymptotic confinement plateau r_∞ = √(3D / k) with relaxation τ_trap = 1/k.',
      question: 'Compare Virtual FRAP and First-Passage S(t): strong harmonic tethering creates an apparent immobile fraction (1 − M_f > 0) and recoil in C_v(Δt) < 0.',
    },
    {
      id: 'axis',
      label: 'Anisotropic Channel / Filament Diffusion',
      short: 'Anisotropic (Dx > Dy,Dz)',
      family: 'Directional Tensor D',
      hasParam: true,
      paramLabel: 'Extra x-axis diffusivity k',
      paramUnit: '× D',
      paramMin: 0.2,
      paramMax: 3.0,
      paramStep: 0.1,
      paramDefault: 1.2,
      formula: 'Dx = D(1 + k), Dy = Dz = D · E[r²(t)] = 2 D t (3 + k) · Prolate 3D ±1σ covariance ellipsoid.',
      question: 'Orbit the 3D cloud and inspect the 7-model inference table: isotropic MSD stays linear (α = 1), so only coordinate-resolved tensor likelihood separates Dx from Dy, Dz.',
    },
    {
      id: 'wave',
      label: 'Oscillatory Pulsatile Flow',
      short: 'Periodic Flow',
      family: 'Time-Periodic Forcing',
      hasParam: true,
      paramLabel: 'Peak oscillatory speed v₀',
      paramUnit: 'μm/s',
      paramMin: 0.2,
      paramMax: 2.5,
      paramStep: 0.1,
      paramDefault: 1.1,
      formula: 'v_x(t) = v₀ cos(πt) · E[r²(t)] = 6 D t + [v₀ sin(πt) / π]² · Zero net displacement every 1.0 s half-cycle.',
      question: 'Scrub between t = 0.5 s and t = 1.0 s: constant drift cannot explain a centroid that reverses sign, whereas conditional periodic-flow inference captures the phase.',
    },
    {
      id: 'fbm',
      label: 'Viscoelastic Fractional Brownian (AnDi fBm)',
      short: 'Viscoelastic fBm',
      family: 'Ergodic Anomalous (Memory)',
      hasParam: true,
      paramLabel: 'Anomalous exponent α',
      paramUnit: '',
      paramMin: 0.35,
      paramMax: 1.65,
      paramStep: 0.05,
      paramDefault: 0.55,
      formula: 'E[r²(t)] = 6 D_α t^α · Exact Cholesky fGn covariance: ρ₁ = 2^(α−1) − 1 · Ergodic (EB → 0) & Gaussian (α₂ ≈ 0).',
      question: 'At α = 0.55 (crowded chromatin/cytoplasm), check VACF & Turning Angles: anti-persistent viscoelastic recoil drives C_v(Δt) < 0 and 180° back-scattering while Van Hove stays Gaussian!',
    },
    {
      id: 'ctrw',
      label: 'Transient Traps · Continuous-Time RW (AnDi CTRW)',
      short: 'Transient Traps (CTRW)',
      family: 'Weak Ergodicity Breaking',
      hasParam: true,
      paramLabel: 'Waiting-time tail α_trap',
      paramUnit: '',
      paramMin: 0.40,
      paramMax: 0.95,
      paramStep: 0.05,
      paramDefault: 0.60,
      formula: 'ψ(τ) ∝ τ^(−1−α) · Ensemble ⟨r²(t)⟩ ≈ 6 D_α t^α, yet individual TA-MSDs scale linearly (∝ Δ¹) with large EB > 0!',
      question: 'Contrast CTRW (α = 0.60) against fBm (α = 0.55): both bend EA-MSD subdiffusively, but CTRW shatters ergodicity (wide TA-MSD fan) and creates a sharp non-Gaussian Van Hove spike (α₂ > 0.3).',
    },
    {
      id: 'two_state',
      label: 'Spot-On Chromatin Bound ⇌ Free Switching',
      short: 'Spot-On 2-State',
      family: 'Kinetic State Switching',
      hasParam: true,
      paramLabel: 'Chromatin bound fraction f_bound',
      paramUnit: '',
      paramMin: 0.10,
      paramMax: 0.85,
      paramStep: 0.05,
      paramDefault: 0.45,
      formula: 'Bound (D_b) ⇌ Free (D_f) · f_bound = k_on / (k_on + k_off) · E[r²(t)] = 6 [f_bound D_b + (1 − f_bound) D_f] t.',
      question: 'Watch tracers switch between coral (chromatin-bound) and cyan (free) in 3D, then open Spot-On Jump CDF and 7-Model Inference to see how 2-state Maxwell/EM mixtures recover f_bound.',
    },
  ];

  const COMPARTMENT_PRESETS = [
    {
      id: 'custom',
      label: 'Manual Diffusivity D (Custom Tracer)',
      short: 'Manual D',
      viscosityMpas: null,
      note: 'User-controlled diffusivity slider D (0.04–1.20 μm²/s) independent of macromolecular radius.',
    },
    {
      id: 'ecoli_cyto',
      label: 'Bacterial Cytoplasm (η_eff ≈ 95 cP · Crowded Sieve)',
      short: 'Bacterial Cytoplasm',
      viscosityMpas: 95,
      note: 'Macromolecular crowding (~300 mg/mL RNA/protein) slows cytosolic proteins ~95× relative to water at 37 °C.',
    },
    {
      id: 'nucleoplasm',
      label: 'Eukaryotic Chromatin / Nucleoplasm (η_eff ≈ 160 cP)',
      short: 'Nucleoplasm (160 cP)',
      viscosityMpas: 160,
      note: 'Dense nucleosomal fiber meshwork typical of live-cell transcription-factor SPT (Hansen et al. 2018).',
    },
    {
      id: 'glycerol85',
      label: '85% Glycerol–Water Calibration Standard (η = 110 cP)',
      short: 'Glycerol Standard',
      viscosityMpas: 110,
      note: 'Newtonian single-viscosity microfluidic reference solution (α = 1.00, zero viscoelastic recoil).',
    },
    {
      id: 'condensate',
      label: 'Biomolecular Phase Condensate (η_eff ≈ 520 cP)',
      short: 'Condensate (520 cP)',
      viscosityMpas: 520,
      note: 'Liquid–liquid phase-separated ribonucleoprotein droplet / stress granule interior.',
    },
    {
      id: 'membrane',
      label: 'Organelle / ER Membrane Sheet (η_eff ≈ 950 cP)',
      short: 'Membrane (950 cP)',
      viscosityMpas: 950,
      note: 'High-drag lipid bilayer / peripheral membrane-tethered complex regime.',
    },
  ];

  // Fallback exact radii of gyration (nm) computed from bundled AlphaFold DB v6 & RCSB PDB Cα coordinates
  // so standalone Node scripts get identical numbers even when folds/*.js are not loaded into global scope.
  const FALLBACK_MACROMOLECULES = [
    { id: 'P01308', gene: 'INS', title: 'Preproinsulin (AF-P01308)', kind: 'AlphaFold DB v6', residues: 110, rgNm: 1.564, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P01308' },
    { id: 'O23290', gene: 'AT4G14320', title: 'Zinc-ribbon ribosomal protein (AF-O23290)', kind: 'AlphaFold DB v6', residues: 105, rgNm: 1.488, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/O23290' },
    { id: 'P68871', gene: 'HBB', title: 'Hemoglobin subunit β (AF-P68871)', kind: 'AlphaFold DB v6', residues: 147, rgNm: 1.458, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P68871' },
    { id: 'P00441', gene: 'SOD1', title: 'Cu/Zn Superoxide dismutase (AF-P00441)', kind: 'AlphaFold DB v6', residues: 154, rgNm: 1.474, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P00441' },
    { id: '1MBO', gene: 'PDB 1MBO', title: 'Oxymyoglobin + Fe-Heme (1MBO)', kind: 'RCSB PDB', residues: 153, rgNm: 1.519, sourceUrl: 'https://www.rcsb.org/structure/1MBO' },
    { id: 'P0A7J3', gene: 'rplJ', title: 'Ribosomal stalk uL10 (AF-P0A7J3)', kind: 'AlphaFold DB v6', residues: 165, rgNm: 1.884, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P0A7J3' },
    { id: '1GFL', gene: 'PDB 1GFL', title: 'Green Fluorescent Protein β-barrel (1GFL)', kind: 'RCSB PDB', residues: 230, rgNm: 1.682, sourceUrl: 'https://www.rcsb.org/structure/1GFL' },
    { id: 'P00846', gene: 'MT-ATP6', title: 'ATP synthase subunit a (AF-P00846)', kind: 'AlphaFold DB v6', residues: 226, rgNm: 1.942, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P00846' },
    { id: 'P00359', gene: 'TDH3', title: 'GAPDH glycolytic Rossmann fold (AF-P00359)', kind: 'AlphaFold DB v6', residues: 332, rgNm: 1.965, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P00359' },
    { id: 'P0A7G6', gene: 'recA', title: 'Recombinase RecA ATPase (AF-P0A7G6)', kind: 'AlphaFold DB v6', residues: 353, rgNm: 2.285, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P0A7G6' },
    { id: '8AW3', gene: 'PDB 8AW3', title: 'Protein–tRNA–2×Zn²⁺ RNP Complex (8AW3)', kind: 'RCSB PDB', residues: 438, rgNm: 2.412, sourceUrl: 'https://www.rcsb.org/structure/8AW3' },
    { id: 'Q31BY4', gene: 'rbcL', title: 'RuBisCO large subunit TIM-barrel (AF-Q31BY4)', kind: 'AlphaFold DB v6', residues: 471, rgNm: 2.246, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/Q31BY4' },
    { id: 'P04637', gene: 'TP53', title: 'Tumor suppressor p53 + IDR tails (AF-P04637)', kind: 'AlphaFold DB v6', residues: 393, rgNm: 3.418, sourceUrl: 'https://alphafold.ebi.ac.uk/entry/P04637' },
    { id: '1BNA', gene: 'PDB 1BNA', title: 'Dickerson–Drew B-DNA Dodecamer (1BNA)', kind: 'RCSB PDB', residues: 24, rgNm: 1.312, sourceUrl: 'https://www.rcsb.org/structure/1BNA' },
  ];

  function resolveCatalogs() {
    return {
      foldIds: typeof foldIds !== 'undefined' ? foldIds : (root.foldIds || []),
      dnaRecords: typeof dnaRecords !== 'undefined' ? dnaRecords : (root.dnaRecords || []),
      bundledFolds: typeof bundledFolds !== 'undefined' ? bundledFolds : (root.bundledFolds || {}),
      experimental: typeof experimental !== 'undefined' ? experimental : (root.experimental || {}),
    };
  }

  function computeRgNmFromCoords(coordsAngstrom) {
    const n = coordsAngstrom.length;
    if (!n) return 1.8;
    let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) {
      mx += coordsAngstrom[i][0];
      my += coordsAngstrom[i][1];
      mz += coordsAngstrom[i][2];
    }
    mx /= n; my /= n; mz /= n;
    let r2 = 0;
    for (let i = 0; i < n; i++) {
      const dx = coordsAngstrom[i][0] - mx;
      const dy = coordsAngstrom[i][1] - my;
      const dz = coordsAngstrom[i][2] - mz;
      r2 += dx * dx + dy * dy + dz * dz;
    }
    return Math.sqrt(r2 / n) * 0.1; // 1 Å = 0.1 nm
  }

  function stokesEinsteinD(rhNm, viscosityMpas) {
    if (!viscosityMpas || viscosityMpas <= 0 || !rhNm || rhNm <= 0) return 0.20;
    const etaPaS = viscosityMpas * 1e-3;
    const rhMeters = rhNm * 1e-9;
    const dM2PerS = KB_T_310K / (6 * Math.PI * etaPaS * rhMeters);
    return dM2PerS * 1e12; // m²/s -> μm²/s
  }

  function getMacromoleculeCatalog() {
    const { foldIds: fIds, dnaRecords: dRecs, bundledFolds: bFolds, experimental: expMap } = resolveCatalogs();
    const list = [];

    if (fIds.length && Object.keys(bFolds).length) {
      for (let i = 0; i < fIds.length; i++) {
        const id = fIds[i];
        const fold = bFolds[id];
        if (!fold || !Array.isArray(fold.rows)) continue;
        const info = dRecs[i] || { gene: id, note: id };
        const coords = fold.rows.map(r => [r[2], r[3], r[4]]);
        const rgNm = computeRgNmFromCoords(coords);
        const rhNm = 1.29 * rgNm;
        list.push({
          id,
          gene: info.gene || id,
          title: `${info.gene || id} · ${info.note || 'AlphaFold monomer'} (${id})`,
          kind: 'AlphaFold DB v6',
          residues: fold.rows.length,
          rgNm: Number(rgNm.toFixed(3)),
          rhNm: Number(rhNm.toFixed(3)),
          sourceUrl: `https://alphafold.ebi.ac.uk/entry/${id}`,
        });
      }
      const pdbMeta = [
        ['1GFL', 'PDB 1GFL', 'Green Fluorescent Protein β-barrel (1GFL)'],
        ['1MBO', 'PDB 1MBO', 'Oxymyoglobin + Fe-Heme (1MBO)'],
        ['8AW3', 'PDB 8AW3', 'Protein–tRNA–2×Zn²⁺ RNP Complex (8AW3)'],
        ['1BNA', 'PDB 1BNA', 'Dickerson–Drew B-DNA Dodecamer (1BNA)'],
      ];
      for (const [id, gene, title] of pdbMeta) {
        const model = expMap[id];
        if (!model || !Array.isArray(model.chains)) continue;
        const coords = [];
        for (const ch of model.chains) {
          for (const r of (ch.rows || [])) {
            if (Number.isFinite(r[2]) && Number.isFinite(r[3]) && Number.isFinite(r[4])) {
              coords.push([r[2], r[3], r[4]]);
            }
          }
        }
        for (const lig of (model.ligands || [])) {
          if (Number.isFinite(lig[1]) && Number.isFinite(lig[2]) && Number.isFinite(lig[3])) {
            coords.push([lig[1], lig[2], lig[3]]);
          }
        }
        if (!coords.length) continue;
        const rgNm = computeRgNmFromCoords(coords);
        const rhNm = 1.29 * rgNm;
        list.push({
          id,
          gene,
          title,
          kind: 'RCSB PDB',
          residues: coords.length,
          rgNm: Number(rgNm.toFixed(3)),
          rhNm: Number(rhNm.toFixed(3)),
          sourceUrl: `https://www.rcsb.org/structure/${id}`,
        });
      }
    }

    if (!list.length) {
      for (const item of FALLBACK_MACROMOLECULES) {
        list.push({
          ...item,
          rhNm: Number((1.29 * item.rgNm).toFixed(3)),
        });
      }
    }

    return list.sort((a, b) => a.rgNm - b.rgNm);
  }

  // Deterministic LCG / Mulberry32 PRNG matching seed reproducibility
  function createRng(seed) {
    let s = (Number(seed) || 41) >>> 0;
    return function nextUniform() {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return (s + 0.5) / 4294967296;
    };
  }

  function makeNormal(rng) {
    return function nextGaussian() {
      const u1 = Math.max(1e-12, rng());
      const u2 = rng();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };
  }

  // Lanczos approximation for Gamma(z) on z > 0
  function gammaFn(z) {
    const g = 7;
    const p = [
      0.99999999999980993,
      676.5203681218851,
      -1259.1392167224028,
      771.32342877765313,
      -176.61502916214059,
      12.507343278686905,
      -0.13857109526572012,
      9.9843695780195716e-6,
      1.5056327351493116e-7,
    ];
    if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
    let x = p[0];
    const zm = z - 1;
    for (let i = 1; i < g + 2; i++) x += p[i] / (zm + i);
    const t = zm + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, zm + 0.5) * Math.exp(-t) * x;
  }

  function erfApprox(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return sign * y;
  }

  // Exact lower-triangular Cholesky factor L of fractional Gaussian noise (fGn) covariance
  // Cov(ΔX_i, ΔX_j) = D_α dt^α (|k+1|^α + |k-1|^α - 2|k|^α), k = |i - j|
  function buildFgnCholesky(steps, D, dt, alpha) {
    const a = Math.max(0.25, Math.min(1.85, alpha));
    const scale = D * Math.pow(dt, a);
    const gamma = new Float64Array(steps);
    gamma[0] = 2 * scale;
    for (let k = 1; k < steps; k++) {
      gamma[k] = scale * (Math.pow(k + 1, a) + Math.pow(k - 1, a) - 2 * Math.pow(k, a));
    }
    const L = new Float64Array(steps * steps);
    for (let i = 0; i < steps; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = gamma[i - j];
        const rowI = i * steps;
        const rowJ = j * steps;
        for (let p = 0; p < j; p++) sum -= L[rowI + p] * L[rowJ + p];
        if (i === j) {
          L[rowI + j] = Math.sqrt(Math.max(1e-14, sum));
        } else {
          L[rowI + j] = sum / L[rowJ + j];
        }
      }
    }
    return L;
  }

  function theoreticalTrueMsd(mode, D, k, t) {
    if (t <= 0) return 0;
    if (mode === 'free') return 6 * D * t;
    if (mode === 'drift') return 6 * D * t + (k * t) * (k * t);
    if (mode === 'trap') {
      return k > 1e-8 ? (-3 * D * Math.expm1(-2 * k * t)) / k : 6 * D * t;
    }
    if (mode === 'axis') return 2 * D * t * (3 + k);
    if (mode === 'wave') {
      const s = (k * Math.sin(Math.PI * t)) / Math.PI;
      return 6 * D * t + s * s;
    }
    if (mode === 'fbm') {
      const a = Math.max(0.25, Math.min(1.85, k || 0.55));
      return 6 * D * Math.pow(t, a);
    }
    if (mode === 'ctrw') {
      const a = Math.max(0.30, Math.min(0.98, k || 0.60));
      return 6 * D * Math.pow(t, a);
    }
    if (mode === 'two_state') {
      const fBound = Math.max(0.02, Math.min(0.95, k || 0.45));
      const dBound = Math.min(0.015, 0.08 * D);
      const dEff = fBound * dBound + (1 - fBound) * D;
      return 6 * dEff * t;
    }
    return 6 * D * t;
  }

  /**
   * Simulate 3D tracer trajectories + sCMOS camera localization noise & motion blur
   * and compute comprehensive SPT & anomalous diffusion diagnostics.
   */
  function runExperiment(rawOptions = {}) {
    const mode = rawOptions.mode || 'free';
    const D = Math.max(0.01, Number(rawOptions.D ?? 0.20));
    const modeSpec = TRANSPORT_MODES.find(m => m.id === mode) || TRANSPORT_MODES[0];
    const k = modeSpec.hasParam
      ? Number(rawOptions.strength ?? modeSpec.paramDefault)
      : 0;
    const seed = Math.max(1, Math.floor(Number(rawOptions.seed ?? 41)));
    const count = Math.max(24, Math.floor(Number(rawOptions.count ?? 96)));
    const steps = Math.max(40, Math.floor(Number(rawOptions.steps ?? 160)));
    const dt = Number(rawOptions.dt ?? 0.025);
    const sigmaLoc = Math.max(0, Number(rawOptions.sigmaLoc ?? 0)); // μm (e.g. 0.030 = 30 nm)
    const blurR = Math.max(0, Math.min(1 / 6, Number(rawOptions.blurR ?? 0))); // ∈ [0, 1/6]
    const bleachRadius = Math.max(0.25, Number(rawOptions.bleachRadius ?? 0.85)); // μm
    const targetRadius = Math.max(0.40, Number(rawOptions.targetRadius ?? 1.25)); // μm

    const rng = createRng(seed);
    const normal = makeNormal(rng);

    // Allocate true positions and kinetic state flags (0 = bound/trapped, 1 = mobile/free)
    const trueFrames = Array.from({ length: steps + 1 }, () => new Float64Array(count * 3));
    const stateFrames = Array.from({ length: steps + 1 }, () => new Uint8Array(count));
    for (let j = 0; j < count; j++) stateFrames[0][j] = 1;

    if (mode === 'fbm') {
      const alpha = Math.max(0.35, Math.min(1.65, k || 0.55));
      const L = buildFgnCholesky(steps, D, dt, alpha);
      const z = new Float64Array(steps);
      for (let j = 0; j < count; j++) {
        for (let axis = 0; axis < 3; axis++) {
          for (let f = 0; f < steps; f++) z[f] = normal();
          let pos = 0;
          for (let f = 0; f < steps; f++) {
            let inc = 0;
            const row = f * steps;
            for (let p = 0; p <= f; p++) inc += L[row + p] * z[p];
            pos += inc;
            trueFrames[f + 1][j * 3 + axis] = pos;
          }
        }
        for (let f = 0; f <= steps; f++) stateFrames[f][j] = 1;
      }
    } else if (mode === 'ctrw') {
      // Scher–Montroll / Metzler–Klafter subdiffusive CTRW with Pareto waiting times ψ(τ) = α τ₀^α / τ^(1+α)
      // Renewal theory ⟨N(t)⟩ = (t/τ₀)^α / [Γ(1+α) Γ(1−α)], so σ_hop² = 2 D Γ(1+α) Γ(1−α) τ₀^α yields ⟨r²(t)⟩ = 6 D t^α.
      const alpha = Math.max(0.40, Math.min(0.95, k || 0.60));
      const tau0 = 0.0025; // 2.5 ms microscopic binding-trap scale (Δt / 10)
      const hopSigma = Math.sqrt(2 * D * gammaFn(1 + alpha) * gammaFn(1 - alpha) * Math.pow(tau0, alpha));
      const thermalJitter = Math.sqrt(2 * Math.min(0.0015, 0.008 * D) * dt);

      for (let j = 0; j < count; j++) {
        let px = 0, py = 0, pz = 0;
        let nextJumpTime = tau0 * Math.pow(Math.max(1e-12, 1 - rng()), -1 / alpha);
        stateFrames[0][j] = nextJumpTime > dt ? 0 : 1;
        for (let f = 1; f <= steps; f++) {
          const tNow = f * dt;
          let jumped = false;
          let guard = 0;
          while (nextJumpTime <= tNow && guard < 4000) {
            px += hopSigma * normal();
            py += hopSigma * normal();
            pz += hopSigma * normal();
            jumped = true;
            const wait = tau0 * Math.pow(Math.max(1e-12, 1 - rng()), -1 / alpha);
            nextJumpTime += wait;
            guard++;
          }
          const jx = jumped ? 0 : thermalJitter * normal();
          const jy = jumped ? 0 : thermalJitter * normal();
          const jz = jumped ? 0 : thermalJitter * normal();
          trueFrames[f][j * 3] = px + jx;
          trueFrames[f][j * 3 + 1] = py + jy;
          trueFrames[f][j * 3 + 2] = pz + jz;
          stateFrames[f][j] = jumped ? 1 : 0;
        }
      }
    } else if (mode === 'two_state') {
      // Hansen et al. (eLife 2018) Spot-On 2-state Bound ⇌ Free continuous-time Markov switching
      const fBound = Math.max(0.05, Math.min(0.90, k || 0.45));
      const dBound = Math.min(0.015, 0.08 * D);
      const dFree = D;
      const kOff = 1.25; // s⁻¹ chromatin residence dissociation rate (~0.8 s residence)
      const kOn = (kOff * fBound) / (1 - fBound);
      const kSum = kOn + kOff;
      const nSub = 5;
      const subDt = dt / nSub;
      const p0to1 = (kOff / kSum) * (1 - Math.exp(-kSum * subDt)); // bound -> free
      const p1to0 = (kOn / kSum) * (1 - Math.exp(-kSum * subDt));  // free -> bound
      const sigBound = Math.sqrt(2 * dBound * subDt);
      const sigFree = Math.sqrt(2 * dFree * subDt);

      for (let j = 0; j < count; j++) {
        let state = rng() < fBound ? 0 : 1; // 0 = bound, 1 = free
        stateFrames[0][j] = state;
        let px = 0, py = 0, pz = 0;
        for (let f = 1; f <= steps; f++) {
          let freeSubCount = 0;
          for (let s = 0; s < nSub; s++) {
            if (state === 0) {
              if (rng() < p0to1) state = 1;
            } else if (rng() < p1to0) {
              state = 0;
            }
            const sig = state === 0 ? sigBound : sigFree;
            px += sig * normal();
            py += sig * normal();
            pz += sig * normal();
            if (state === 1) freeSubCount++;
          }
          trueFrames[f][j * 3] = px;
          trueFrames[f][j * 3 + 1] = py;
          trueFrames[f][j * 3 + 2] = pz;
          stateFrames[f][j] = freeSubCount >= 3 ? 1 : 0;
        }
      }
    } else {
      // Canonical 5 SDE propagators (exact discrete-time Gaussian transitions)
      const trap = mode === 'trap' && k > 0;
      const decay = trap ? Math.exp(-k * dt) : 1;
      const sigma = Math.sqrt(trap ? (-D * Math.expm1(-2 * k * dt)) / k : 2 * D * dt);
      const xAniso = mode === 'axis' ? Math.sqrt(1 + k) : 1;

      for (let f = 1; f <= steps; f++) {
        const t = f * dt;
        const shift = mode === 'wave'
          ? (k * (Math.sin(Math.PI * t) - Math.sin(Math.PI * (t - dt)))) / Math.PI
          : mode === 'drift'
            ? k * dt
            : 0;
        const prev = trueFrames[f - 1];
        const next = trueFrames[f];
        const st = stateFrames[f];
        for (let i = 0; i < count * 3; i++) {
          const axis = i % 3;
          next[i] = decay * prev[i] + sigma * normal() * (axis === 0 ? xAniso : 1) + (axis === 0 ? shift : 0);
        }
        for (let j = 0; j < count; j++) st[j] = 1;
      }
    }

    // Apply camera exposure motion blur R ∈ [0, 1/6] (exact Brownian-bridge integral) + static localization noise σ_loc
    const obsFrames = Array.from({ length: steps + 1 }, () => new Float64Array(count * 3));
    const epsExposure = Math.max(0, Math.min(1, 6 * blurR));
    const dStepRef = mode === 'two_state'
      ? (k * Math.min(0.015, 0.08 * D) + (1 - k) * D)
      : D;
    const bridgeStd = epsExposure > 0
      ? Math.sqrt(2 * dStepRef * dt * epsExposure * (1 / 3 - epsExposure / 4))
      : 0;

    if (epsExposure === 0 && sigmaLoc === 0) {
      for (let f = 0; f <= steps; f++) obsFrames[f].set(trueFrames[f]);
    } else {
      // Independent pre-frame-0 virtual step so frame 0 has identical stationary camera blur statistics
      const preZero = new Float64Array(count * 3);
      const preStd = Math.sqrt(2 * dStepRef * dt);
      for (let i = 0; i < count * 3; i++) preZero[i] = -preStd * normal();

      for (let f = 0; f <= steps; f++) {
        const cur = trueFrames[f];
        const prv = f === 0 ? preZero : trueFrames[f - 1];
        const out = obsFrames[f];
        for (let i = 0; i < count * 3; i++) {
          const blurred = epsExposure > 0
            ? (1 - 0.5 * epsExposure) * cur[i] + 0.5 * epsExposure * prv[i] + bridgeStd * normal()
            : cur[i];
          out[i] = blurred + (sigmaLoc > 0 ? sigmaLoc * normal() : 0);
        }
      }
    }

    // 1. Per-frame summary: [t, obsMsd, expectedObsMsd, meanX, meanY, meanZ, trueMsd, alpha2, boundFrac]
    // Expected observed MSD relative to observed frame 0 includes 2 * 3 * σ_loc² offset for f >= 1 and -12 D dt R blur shift.
    const summary = [];
    const alpha2Series = new Float64Array(steps + 1);
    const obs0 = obsFrames[0];

    for (let f = 0; f <= steps; f++) {
      const t = f * dt;
      const obs = obsFrames[f];
      const tru = trueFrames[f];
      let obsMsd = 0;
      let trueMsd = 0;
      let r4Sum = 0;
      let mx = 0, my = 0, mz = 0;
      let boundCount = 0;

      for (let j = 0; j < count; j++) {
        const idx = j * 3;
        const dx = obs[idx] - obs0[idx];
        const dy = obs[idx + 1] - obs0[idx + 1];
        const dz = obs[idx + 2] - obs0[idx + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        obsMsd += r2;
        r4Sum += r2 * r2;
        mx += obs[idx];
        my += obs[idx + 1];
        mz += obs[idx + 2];

        const tx = tru[idx], ty = tru[idx + 1], tz = tru[idx + 2];
        trueMsd += tx * tx + ty * ty + tz * tz;
        if (stateFrames[f][j] === 0) boundCount++;
      }

      obsMsd /= count;
      trueMsd /= count;
      r4Sum /= count;
      mx /= count; my /= count; mz /= count;

      const theoryTrue = theoreticalTrueMsd(mode, D, k, t);
      const blurShift = f > 0 ? 12 * dStepRef * dt * blurR : 0;
      const locShift = f > 0 ? 6 * sigmaLoc * sigmaLoc : 0;
      const theoryObs = f === 0 ? 0 : Math.max(0, theoryTrue - blurShift + locShift);
      const a2 = f > 0 && obsMsd > 1e-12 ? (3 * r4Sum) / (5 * obsMsd * obsMsd) - 1 : 0;
      alpha2Series[f] = a2;

      summary.push([t, obsMsd, theoryObs, mx, my, mz, trueMsd, theoryTrue, a2, boundCount / count]);
    }

    // 2. Time-Averaged MSD (TA-MSD) per tracer & Ergodicity-Breaking parameter EB(Δ)
    const maxLag = Math.min(48, Math.floor(steps / 2));
    const taLags = [];
    for (let lag = 1; lag <= maxLag; lag++) taLags.push(lag);

    const nSampleTracks = Math.min(20, count);
    const sampleTaMsd = Array.from({ length: nSampleTracks }, () => new Float64Array(taLags.length));
    const meanTaMsd = new Float64Array(taLags.length);
    const ebSeries = new Float64Array(taLags.length);
    const perTracerTa = new Float64Array(count);

    for (let li = 0; li < taLags.length; li++) {
      const lag = taLags[li];
      const nPairs = steps + 1 - lag;
      let m1 = 0;
      let m2 = 0;
      for (let j = 0; j < count; j++) {
        const idx = j * 3;
        let sumR2 = 0;
        for (let f = 0; f < nPairs; f++) {
          const a = obsFrames[f];
          const b = obsFrames[f + lag];
          const dx = b[idx] - a[idx];
          const dy = b[idx + 1] - a[idx + 1];
          const dz = b[idx + 2] - a[idx + 2];
          sumR2 += dx * dx + dy * dy + dz * dz;
        }
        const delta2 = sumR2 / nPairs;
        perTracerTa[j] = delta2;
        if (j < nSampleTracks) sampleTaMsd[j][li] = delta2;
        m1 += delta2;
        m2 += delta2 * delta2;
      }
      m1 /= count;
      m2 /= count;
      meanTaMsd[li] = m1;
      ebSeries[li] = m1 > 1e-12 ? Math.max(0, m2 / (m1 * m1) - 1) : 0;
    }

    // 3. Log–Log Anomalous Slope α(τ) & Global Power-Law Fit (both raw and noise-floor-subtracted)
    const logTau = [];
    const logEaMsd = [];
    const logTaMsd = [];
    const localAlpha = [];

    for (let li = 0; li < taLags.length; li++) {
      const lag = taLags[li];
      const tau = lag * dt;
      logTau.push(Math.log(tau));
      logEaMsd.push(Math.log(Math.max(1e-10, summary[lag][1])));
      logTaMsd.push(Math.log(Math.max(1e-10, meanTaMsd[li])));
    }
    for (let li = 0; li < taLags.length; li++) {
      const i0 = Math.max(0, li - 2);
      const i1 = Math.min(taLags.length - 1, li + 2);
      const slope = (logEaMsd[i1] - logEaMsd[i0]) / Math.max(1e-9, logTau[i1] - logTau[i0]);
      localAlpha.push(slope);
    }

    // Fit global anomalous exponent α̂ over lags 3..32 (0.075 s .. 0.80 s)
    const cveMetrics = computeMichaletBerglundCve(obsFrames, dt, blurR, D, sigmaLoc);
    const estLocOffset = Math.min(0.45 * summary[1][1], 6 * sigmaLoc * sigmaLoc);
    let sx = 0, sy = 0, sxx = 0, sxy = 0, nAlpha = 0;
    let sxTa = 0, syTa = 0, sxyTa = 0;
    for (let li = 2; li < Math.min(32, taLags.length); li++) {
      const x = logTau[li];
      const yCorr = Math.log(Math.max(1e-8, summary[taLags[li]][1] - estLocOffset));
      const yTaCorr = Math.log(Math.max(1e-8, meanTaMsd[li] - estLocOffset));
      sx += x; sy += yCorr; sxx += x * x; sxy += x * yCorr;
      sxTa += x; syTa += yTaCorr; sxyTa += x * yTaCorr;
      nAlpha++;
    }
    const denomAlpha = Math.max(1e-12, nAlpha * sxx - sx * sx);
    const alphaHat = (nAlpha * sxy - sx * sy) / denomAlpha;
    const alphaTaHat = (nAlpha * sxyTa - sxTa * syTa) / denomAlpha;
    const dAlphaHat = Math.exp((sy - alphaHat * sx) / Math.max(1, nAlpha)) / 6;

    // 4. Van Hove Displacement Distribution P(Δx, τ = 4 Δt = 0.10 s)
    const vhLag = Math.min(4, steps);
    const vhValues = [];
    for (let f = 0; f <= steps - vhLag; f += 2) {
      const a = obsFrames[f];
      const b = obsFrames[f + vhLag];
      for (let i = 0; i < count * 3; i++) {
        // Subtract ensemble mean shift along axis so drift doesn't shift symmetric distribution off-screen
        const meanShift = summary[f + vhLag][3 + (i % 3)] - summary[f][3 + (i % 3)];
        vhValues.push(b[i] - a[i] - meanShift);
      }
    }
    let vhVar = 0, vhKurt = 0;
    for (let i = 0; i < vhValues.length; i++) vhVar += vhValues[i] * vhValues[i];
    vhVar /= Math.max(1, vhValues.length);
    for (let i = 0; i < vhValues.length; i++) vhKurt += Math.pow(vhValues[i], 4);
    vhKurt /= Math.max(1, vhValues.length);
    const vhAlpha2 = vhVar > 1e-12 ? vhKurt / (3 * vhVar * vhVar) - 1 : 0;
    const vhStd = Math.sqrt(Math.max(1e-9, vhVar));
    const vhMax = Math.max(0.15, 3.6 * vhStd);
    const vhBins = 29;
    const vhHist = new Float64Array(vhBins);
    const vhCenters = new Float64Array(vhBins);
    const vhWidth = (2 * vhMax) / vhBins;
    for (let b = 0; b < vhBins; b++) vhCenters[b] = -vhMax + (b + 0.5) * vhWidth;
    let vhCountInRange = 0;
    for (let i = 0; i < vhValues.length; i++) {
      const v = vhValues[i];
      const bin = Math.floor((v + vhMax) / vhWidth);
      if (bin >= 0 && bin < vhBins) {
        vhHist[bin]++;
        vhCountInRange++;
      }
    }
    for (let b = 0; b < vhBins; b++) {
      vhHist[b] = vhCountInRange > 0 ? vhHist[b] / (vhCountInRange * vhWidth) : 0;
    }

    // 5. Normalized Velocity Autocorrelation C_v(τ) & 3D Turning-Angle Distribution P(θ)
    const vacfMaxLag = 14;
    const vacf = new Float64Array(vacfMaxLag + 1);
    let c0 = 0;
    for (let lag = 0; lag <= vacfMaxLag; lag++) {
      let sumDot = 0;
      let nDot = 0;
      for (let f = 1; f <= steps - lag; f++) {
        const p0 = obsFrames[f - 1];
        const p1 = obsFrames[f];
        const q0 = obsFrames[f - 1 + lag];
        const q1 = obsFrames[f + lag];
        for (let j = 0; j < count; j++) {
          const idx = j * 3;
          const vx1 = p1[idx] - p0[idx];
          const vy1 = p1[idx + 1] - p0[idx + 1];
          const vz1 = p1[idx + 2] - p0[idx + 2];
          const vx2 = q1[idx] - q0[idx];
          const vy2 = q1[idx + 1] - q0[idx + 1];
          const vz2 = q1[idx + 2] - q0[idx + 2];
          sumDot += vx1 * vx2 + vy1 * vy2 + vz1 * vz2;
          nDot++;
        }
      }
      const val = sumDot / Math.max(1, nDot);
      if (lag === 0) c0 = Math.max(1e-12, val);
      vacf[lag] = val / c0;
    }

    const angleBins = 18; // 10° bins from 0° to 180°
    const angleHist = new Float64Array(angleBins);
    let nAngles = 0;
    let meanAngleDeg = 0;
    for (let f = 1; f < steps; f++) {
      const p0 = obsFrames[f - 1];
      const p1 = obsFrames[f];
      const p2 = obsFrames[f + 1];
      for (let j = 0; j < count; j++) {
        const idx = j * 3;
        const ax = p1[idx] - p0[idx], ay = p1[idx + 1] - p0[idx + 1], az = p1[idx + 2] - p0[idx + 2];
        const bx = p2[idx] - p1[idx], by = p2[idx + 1] - p1[idx + 1], bz = p2[idx + 2] - p1[idx + 2];
        const na = Math.hypot(ax, ay, az);
        const nb = Math.hypot(bx, by, bz);
        if (na > 1e-8 && nb > 1e-8) {
          const cosTheta = Math.max(-1, Math.min(1, (ax * bx + ay * by + az * bz) / (na * nb)));
          const deg = (Math.acos(cosTheta) * 180) / Math.PI;
          const bin = Math.min(angleBins - 1, Math.floor(deg / (180 / angleBins)));
          angleHist[bin]++;
          meanAngleDeg += deg;
          nAngles++;
        }
      }
    }
    meanAngleDeg = nAngles > 0 ? meanAngleDeg / nAngles : 90;
    for (let b = 0; b < angleBins; b++) {
      angleHist[b] = nAngles > 0 ? angleHist[b] / (nAngles * (180 / angleBins)) : 0;
    }

    // 6. Spot-On 3D Jump-Length Histogram & 1-State vs. 2-State Maxwell Mixture Fit
    const spotOn = computeSpotOnJumpAnalysis(obsFrames, dt, cveMetrics.sigmaLocHat, blurR);

    // 7. Virtual 3D Gaussian-Beam FRAP Photobleaching Recovery F(t) & First-Passage Survival S(t)
    const frap = computeVirtualFrap(trueFrames, dt, D, bleachRadius);
    const fpt = computeFirstPassage(trueFrames, dt, D, targetRadius);

    // 8. 7-Model Held-Out Trajectory Inference (2/3 train, 1/3 held-out test)
    const trainCount = Math.floor((count * 2) / 3);
    const fits = fitMotion(obsFrames, dt, trainCount);

    return {
      config: {
        mode,
        modeLabel: modeSpec.label,
        modeShort: modeSpec.short,
        D,
        k,
        seed,
        count,
        trainCount,
        testCount: count - trainCount,
        steps,
        dt,
        sigmaLoc,
        blurR,
        bleachRadius,
        targetRadius,
      },
      frames: obsFrames,
      trueFrames,
      stateFrames,
      stats: summary,
      ta: {
        lags: taLags.map(l => l * dt),
        lagSteps: taLags,
        sampleTracks: sampleTaMsd,
        meanTaMsd,
        ebSeries,
        ebAt10: ebSeries[Math.min(9, ebSeries.length - 1)],
        alphaHat,
        alphaTaHat,
        dAlphaHat,
        localAlpha,
      },
      vanHove: {
        lagS: vhLag * dt,
        centers: vhCenters,
        density: vhHist,
        std: vhStd,
        alpha2: vhAlpha2,
        alpha2Series,
      },
      correlations: {
        vacf,
        vacfLag1: vacf[1],
        angleHist,
        meanAngleDeg,
      },
      cve: cveMetrics,
      spotOn,
      frap,
      fpt,
      fits,
    };
  }

  /**
   * Michalet & Berglund (Phys. Rev. E 2012) / Vestergaard et al. (Phys. Rev. E 2014)
   * Covariance-Based Estimator (CVE), Naive Single-Lag Apparent D, Multi-Lag OLS D, and CRLB.
   */
  function computeMichaletBerglundCve(frames, dt, blurR, trueD, trueSigmaLoc) {
    const steps = frames.length - 1;
    const nCoords = frames[0].length;
    let sumSq = 0;
    let nSq = 0;
    let sumCov = 0;
    let nCov = 0;

    for (let f = 1; f <= steps; f++) {
      const p0 = frames[f - 1];
      const p1 = frames[f];
      for (let i = 0; i < nCoords; i++) {
        const d1 = p1[i] - p0[i];
        sumSq += d1 * d1;
        nSq++;
      }
      if (f < steps) {
        const p2 = frames[f + 1];
        for (let i = 0; i < nCoords; i++) {
          const d1 = p1[i] - p0[i];
          const d2 = p2[i] - p1[i];
          sumCov += d1 * d2;
          nCov++;
        }
      }
    }

    const meanSq = sumSq / Math.max(1, nSq);
    const meanCov = sumCov / Math.max(1, nCov);

    // Vestergaard et al. (2014) Eq. 7 & Eq. 8:
    const dCve = Math.max(0.001, meanSq / (2 * dt) + meanCov / dt);
    const sigma2Hat = blurR * meanSq + (2 * blurR - 1) * meanCov;
    const sigmaLocHat = Math.sqrt(Math.max(0, sigma2Hat));

    // Naive 1-step apparent diffusivity D_app(Δt) = ⟨Δx²⟩ / (2 Δt) (severely biased by σ_loc² / Δt & blur)
    const dNaive1 = meanSq / (2 * dt);

    // Uncompensated forced-origin OLS fit MSD(τ) = 6 D_ols τ across lags 1..5
    let stt = 0, stm = 0;
    const maxOlsLag = Math.min(5, steps);
    const apparentByLag = [];
    for (let lag = 1; lag <= Math.min(12, steps); lag++) {
      let msdLag = 0;
      let cnt = 0;
      for (let f = 0; f <= steps - lag; f += 2) {
        const a = frames[f], b = frames[f + lag];
        for (let i = 0; i < nCoords; i += 3) {
          const dx = b[i] - a[i], dy = b[i + 1] - a[i + 1], dz = b[i + 2] - a[i + 2];
          msdLag += dx * dx + dy * dy + dz * dz;
          cnt++;
        }
      }
      msdLag /= Math.max(1, cnt);
      const tau = lag * dt;
      apparentByLag.push({ lag, tau, msd: msdLag, dApp: msdLag / (6 * tau) });
      if (lag <= maxOlsLag) {
        stt += 36 * tau * tau;
        stm += 6 * tau * msdLag;
      }
    }
    const dOlsOrigin = stm / Math.max(1e-12, stt);

    // Cramér–Rao Lower Bound (CRLB) standard error on D across 3 * N_tracers 1D tracks of length K = steps
    const eps = (trueSigmaLoc * trueSigmaLoc) / Math.max(1e-9, trueD * dt) - 2 * blurR;
    const crlbVar = ((trueD * trueD) / Math.max(1, nCoords)) *
      ((6 + 4 * eps + 2 * eps * eps) / steps + (4 * Math.pow(1 + eps, 2)) / (steps * steps));
    const crlbStd = Math.sqrt(Math.max(1e-12, crlbVar));

    // Noise sweep curve: compare theoretical bias of Naive 1-lag vs CVE CRLB SD across σ_loc ∈ [0, 80 nm]
    const noiseSweep = [];
    for (let nm = 0; nm <= 80; nm += 10) {
      const s = nm * 0.001; // μm
      const dAppExpected = trueD * (1 - 2 * blurR) + (s * s) / dt;
      const epsSweep = (s * s) / Math.max(1e-9, trueD * dt) - 2 * blurR;
      const sdSweep = Math.sqrt(Math.max(1e-12,
        ((trueD * trueD) / Math.max(1, nCoords)) *
        ((6 + 4 * epsSweep + 2 * epsSweep * epsSweep) / steps)
      ));
      noiseSweep.push({ sigmaNm: nm, dNaiveExpected: dAppExpected, dTrue: trueD, crlbSd: sdSweep });
    }

    return {
      dCve,
      dNaive1,
      dOlsOrigin,
      sigmaLocHat,
      crlbStd,
      snrRatio: Math.sqrt(2 * trueD * dt) / Math.max(0.001, trueSigmaLoc || 0.001),
      apparentByLag,
      noiseSweep,
    };
  }

  /**
   * Hansen et al. (eLife 2018) Spot-On 3D Maxwell Jump-Length Distribution & 2-State EM Fit
   */
  function maxwell3dPdf(r, s2) {
    const s = Math.sqrt(Math.max(1e-10, s2));
    return Math.sqrt(2 / Math.PI) * ((r * r) / (s * s * s)) * Math.exp(-(r * r) / (2 * s2));
  }

  function maxwell3dCdf(r, s2) {
    if (r <= 0) return 0;
    const s = Math.sqrt(Math.max(1e-10, s2));
    const u = r / (Math.SQRT2 * s);
    return erfApprox(u) - Math.sqrt(2 / Math.PI) * (r / s) * Math.exp(-(r * r) / (2 * s2));
  }

  function fitTwoStateStepMixture3D(r2Array) {
    const n = r2Array.length;
    if (!n) return { wBound: 0, sBound2: 1e-4, sFree2: 1e-3, sSingle2: 1e-3 };
    let meanR2 = 0;
    for (let i = 0; i < n; i++) meanR2 += r2Array[i];
    meanR2 /= n;
    const sSingle2 = Math.max(1e-8, meanR2 / 3);

    // Initialize 2-component scale mixture (sBound2 < sFree2)
    let w = 0.35;
    let s1 = Math.max(1e-7, 0.15 * sSingle2);
    let s2 = Math.max(2e-7, 1.45 * sSingle2);
    const inv2Pi32 = 1 / Math.pow(2 * Math.PI, 1.5);

    for (let iter = 0; iter < 28; iter++) {
      let sumGam = 0;
      let sumGamR2 = 0;
      let sumOneMinusR2 = 0;
      const c1 = w * inv2Pi32 / Math.pow(s1, 1.5);
      const c2 = (1 - w) * inv2Pi32 / Math.pow(s2, 1.5);

      for (let i = 0; i < n; i++) {
        const r2 = r2Array[i];
        const p1 = c1 * Math.exp(-r2 / (2 * s1));
        const p2 = c2 * Math.exp(-r2 / (2 * s2));
        const denom = p1 + p2 + 1e-30;
        const gam = p1 / denom;
        sumGam += gam;
        sumGamR2 += gam * r2;
        sumOneMinusR2 += (1 - gam) * r2;
      }
      w = Math.min(0.96, Math.max(0.04, sumGam / n));
      s1 = Math.max(1e-7, sumGamR2 / Math.max(1e-9, 3 * sumGam));
      s2 = Math.max(1e-7, sumOneMinusR2 / Math.max(1e-9, 3 * (n - sumGam)));
      if (s1 > s2) {
        const tmp = s1; s1 = s2; s2 = tmp;
        w = 1 - w;
      }
    }

    // If the two variances nearly coincide, collapse bound fraction toward 0
    const separation = s2 / Math.max(1e-9, s1);
    const effectiveBoundFrac = separation < 1.55 ? 0 : w;
    return {
      wBound: w,
      effectiveBoundFrac,
      sBound2: s1,
      sFree2: s2,
      sSingle2,
      separation,
    };
  }

  function computeSpotOnJumpAnalysis(frames, dt, sigmaLocHat, blurR) {
    const steps = frames.length - 1;
    const count = frames[0].length / 3;
    const r2List = new Float64Array(steps * count);
    const jumps = new Float64Array(steps * count);
    let ptr = 0;
    let maxJump = 0.25;

    for (let f = 1; f <= steps; f++) {
      const a = frames[f - 1], b = frames[f];
      for (let j = 0; j < count; j++) {
        const idx = j * 3;
        const dx = b[idx] - a[idx], dy = b[idx + 1] - a[idx + 1], dz = b[idx + 2] - a[idx + 2];
        const r2 = dx * dx + dy * dy + dz * dz;
        const r = Math.sqrt(r2);
        r2List[ptr] = r2;
        jumps[ptr] = r;
        if (r > maxJump) maxJump = r;
        ptr++;
      }
    }

    const mix = fitTwoStateStepMixture3D(r2List);
    const locVar = 2 * sigmaLocHat * sigmaLocHat;
    const denom = 2 * dt * Math.max(0.4, 1 - 2 * blurR);
    const dBoundHat = Math.max(0, (mix.sBound2 - locVar) / denom);
    const dFreeHat = Math.max(0.002, (mix.sFree2 - locVar) / denom);

    const nBins = 26;
    const rUpper = Math.min(maxJump * 1.04, Math.sqrt(mix.sFree2) * 4.2 + 0.08);
    const binW = rUpper / nBins;
    const centers = new Float64Array(nBins);
    const pdfHist = new Float64Array(nBins);
    const cdfEmp = new Float64Array(nBins);
    const pdf1State = new Float64Array(nBins);
    const pdf2State = new Float64Array(nBins);
    const cdf1State = new Float64Array(nBins);
    const cdf2State = new Float64Array(nBins);

    for (let i = 0; i < jumps.length; i++) {
      const bin = Math.floor(jumps[i] / binW);
      if (bin >= 0 && bin < nBins) pdfHist[bin]++;
    }
    let cum = 0;
    for (let b = 0; b < nBins; b++) {
      const r = (b + 0.5) * binW;
      const rEdge = (b + 1) * binW;
      centers[b] = r;
      cum += pdfHist[b];
      cdfEmp[b] = cum / Math.max(1, jumps.length);
      pdfHist[b] /= Math.max(1, jumps.length) * binW;
      pdf1State[b] = maxwell3dPdf(r, mix.sSingle2);
      pdf2State[b] = mix.wBound * maxwell3dPdf(r, mix.sBound2) + (1 - mix.wBound) * maxwell3dPdf(r, mix.sFree2);
      cdf1State[b] = maxwell3dCdf(rEdge, mix.sSingle2);
      cdf2State[b] = mix.wBound * maxwell3dCdf(rEdge, mix.sBound2) + (1 - mix.wBound) * maxwell3dCdf(rEdge, mix.sFree2);
    }

    // Max Kolmogorov–Smirnov CDF discrepancy for 1-state vs 2-state fit
    let ks1 = 0, ks2 = 0;
    for (let b = 0; b < nBins; b++) {
      ks1 = Math.max(ks1, Math.abs(cdfEmp[b] - cdf1State[b]));
      ks2 = Math.max(ks2, Math.abs(cdfEmp[b] - cdf2State[b]));
    }

    return {
      centers,
      pdfHist,
      cdfEmp,
      pdf1State,
      pdf2State,
      cdf1State,
      cdf2State,
      fBoundHat: mix.effectiveBoundFrac,
      rawWeightBound: mix.wBound,
      dBoundHat,
      dFreeHat,
      separation: mix.separation,
      ks1State: ks1,
      ks2State: ks2,
    };
  }

  /**
   * Virtual 3D Gaussian-PSF FRAP Recovery F(t) = 1 − ⟨exp(−‖r(t)‖² / w₀²)⟩
   * Exact 3D Brownian analytical baseline: F_Brownian(t) = 1 − (1 + 4 D t / w₀²)^(−3/2)
   */
  function computeVirtualFrap(trueFrames, dt, D, w0) {
    const steps = trueFrames.length - 1;
    const count = trueFrames[0].length / 3;
    const w2 = w0 * w0;
    const empirical = new Float64Array(steps + 1);
    const brownianRef = new Float64Array(steps + 1);

    for (let f = 0; f <= steps; f++) {
      const t = f * dt;
      const p = trueFrames[f];
      let sumBleach = 0;
      for (let j = 0; j < count; j++) {
        const idx = j * 3;
        const r2 = p[idx] * p[idx] + p[idx + 1] * p[idx + 1] + p[idx + 2] * p[idx + 2];
        sumBleach += Math.exp(-r2 / w2);
      }
      empirical[f] = 1 - sumBleach / count;
      brownianRef[f] = 1 - Math.pow(1 + (4 * D * t) / w2, -1.5);
    }

    // Mobile fraction M_f estimated from late-time plateau average (last 10 frames)
    let tailSum = 0;
    const tailCount = Math.min(10, steps);
    for (let f = steps - tailCount + 1; f <= steps; f++) tailSum += empirical[f];
    const mobileFraction = Math.min(1, Math.max(0, tailSum / tailCount));
    const halfTarget = 0.5 * mobileFraction;
    let tauHalf = steps * dt;
    for (let f = 1; f <= steps; f++) {
      if (empirical[f] >= halfTarget) {
        const prev = empirical[f - 1];
        const frac = (halfTarget - prev) / Math.max(1e-9, empirical[f] - prev);
        tauHalf = (f - 1 + Math.max(0, Math.min(1, frac))) * dt;
        break;
      }
    }
    const tauHalfTheory = ((Math.pow(2, 2 / 3) - 1) * w2) / (4 * D);

    return {
      w0,
      empirical,
      brownianRef,
      mobileFraction,
      immobileFraction: 1 - mobileFraction,
      tauHalf,
      tauHalfTheory,
    };
  }

  /**
   * 3D Spherical Absorbing-Boundary First-Passage Survival S(t) = P(max_{u ≤ t} ‖r(u)‖ < R)
   * Exact 3D Brownian eigenmode series: S_ref(t) = 2 ∑_{m=1}^{14} (−1)^(m+1) exp(−m² π² D t / R²), E[τ] = R² / (6D)
   */
  function computeFirstPassage(trueFrames, dt, D, radius) {
    const steps = trueFrames.length - 1;
    const count = trueFrames[0].length / 3;
    const r2Thresh = radius * radius;
    const absorbedAt = new Float64Array(count).fill(Infinity);

    for (let j = 0; j < count; j++) {
      const idx = j * 3;
      for (let f = 1; f <= steps; f++) {
        const p = trueFrames[f];
        const r2 = p[idx] * p[idx] + p[idx + 1] * p[idx + 1] + p[idx + 2] * p[idx + 2];
        if (r2 >= r2Thresh) {
          absorbedAt[j] = f * dt;
          break;
        }
      }
    }

    const survival = new Float64Array(steps + 1);
    const brownianSurvival = new Float64Array(steps + 1);
    for (let f = 0; f <= steps; f++) {
      const t = f * dt;
      let alive = 0;
      for (let j = 0; j < count; j++) {
        if (absorbedAt[j] > t) alive++;
      }
      survival[f] = alive / count;

      if (t === 0) {
        brownianSurvival[f] = 1;
      } else {
        let sSum = 0;
        for (let m = 1; m <= 16; m++) {
          const sign = m % 2 === 1 ? 1 : -1;
          sSum += sign * Math.exp(-(m * m * Math.PI * Math.PI * D * t) / r2Thresh);
        }
        brownianSurvival[f] = Math.max(0, Math.min(1, 2 * sSum));
      }
    }

    const mfptTheory = r2Thresh / (6 * D);
    let absorbedCount = 0;
    let sumAbsTime = 0;
    for (let j = 0; j < count; j++) {
      if (Number.isFinite(absorbedAt[j])) {
        absorbedCount++;
        sumAbsTime += absorbedAt[j];
      }
    }
    // Restricted mean survival time (area under S(t) over [0, T])
    let rmst = 0;
    for (let f = 1; f <= steps; f++) rmst += 0.5 * (survival[f - 1] + survival[f]) * dt;

    return {
      radius,
      survival,
      brownianSurvival,
      absorbedFraction: absorbedCount / count,
      meanHitTimeObserved: absorbedCount > 0 ? sumAbsTime / absorbedCount : null,
      rmst,
      mfptTheory,
    };
  }

  /**
   * 7-Candidate Conditional Trajectory Likelihood Inference (`fitMotion`)
   * Backward-compatible signature: `fitMotion(paths, dt, trainCount)`
   * Ranks 5 canonical Gaussian SDE models + Viscoelastic Memory (fGn AR-1) + Two-State Bound/Free Mixture
   * on the exact same trainCount / (count - trainCount) trajectory split!
   */
  function fitMotion(paths, dt, trainCount = 64) {
    const count = paths[0].length / 3;
    const tCount = Math.min(count - 1, Math.max(1, trainCount));
    const testTracers = Math.max(1, count - tCount);
    const nSteps = paths.length - 1;
    const nTestCoords = 3 * testTracers * nSteps;
    const nTrainCoords = 3 * tCount * nSteps;
    const omega = Math.PI; // 2.0 s forcing period

    const gaussianModels = [
      { name: 'Isotropic diffusion', family: 'Fickian SDE', kParams: 1 },
      { name: 'Constant drift', family: 'Advective SDE', kParams: 2 },
      { name: 'Periodic flow', family: 'Oscillatory SDE', kParams: 2 },
      { name: 'Restoring force', family: 'Confined OU SDE', kParams: 2 },
      { name: 'Axis-dependent diffusion', family: 'Anisotropic Tensor', kParams: 3 },
    ];

    function predictor(modelName, axis, t, x) {
      if (modelName === 'Constant drift') return axis === 0 ? dt : 0;
      if (modelName === 'Periodic flow') return axis === 0 ? (Math.sin(omega * t) - Math.sin(omega * (t - dt))) / omega : 0;
      if (modelName === 'Restoring force') return -x;
      return 0;
    }

    const results = gaussianModels.map(spec => {
      const model = spec.name;
      let xy = 0, xx = 0;
      for (let f = 1; f <= nSteps; f++) {
        const p0 = paths[f - 1], p1 = paths[f];
        const t = f * dt;
        for (let i = 0; i < 3 * tCount; i++) {
          const old = p0[i];
          const delta = p1[i] - old;
          const h = predictor(model, i % 3, t, old);
          xy += h * delta;
          xx += h * h;
        }
      }
      let beta = xx > 0 ? xy / xx : 0;
      if (model === 'Restoring force') beta = Math.min(0.999999, Math.max(0, beta));

      const variances = [0, 0, 0];
      const nAxisTrain = tCount * nSteps;
      for (let f = 1; f <= nSteps; f++) {
        const p0 = paths[f - 1], p1 = paths[f];
        const t = f * dt;
        for (let i = 0; i < 3 * tCount; i++) {
          const a = i % 3;
          const old = p0[i];
          const y = p1[i] - old;
          const h = predictor(model, a, t, old);
          variances[a] += ((y - beta * h) * (y - beta * h)) / nAxisTrain;
        }
      }
      const pooled = (variances[0] + variances[1] + variances[2]) / 3;
      const v = variances.map(val => Math.max(1e-12, model === 'Axis-dependent diffusion' ? val : pooled));

      let trainNllSum = 0;
      let testNllSum = 0;
      for (let f = 1; f <= nSteps; f++) {
        const p0 = paths[f - 1], p1 = paths[f];
        const t = f * dt;
        for (let i = 0; i < 3 * count; i++) {
          const a = i % 3;
          const old = p0[i];
          const y = p1[i] - old;
          const h = predictor(model, a, t, old);
          const nll = 0.5 * (Math.log(2 * Math.PI * v[a]) + ((y - beta * h) * (y - beta * h)) / v[a]);
          if (i < 3 * tCount) trainNllSum += nll;
          else testNllSum += nll;
        }
      }

      const rate = model === 'Restoring force' ? -Math.log1p(-beta) / dt : 0;
      const diffusivity = v.map(val => (rate > 0 ? (val * rate) / (-Math.expm1(-2 * rate * dt)) : val / (2 * dt)));
      const paramNote = model === 'Restoring force'
        ? `k = ${rate.toFixed(3)} /s`
        : (model === 'Constant drift' || model === 'Periodic flow')
          ? `v = ${beta.toFixed(3)} μm/s`
          : model === 'Axis-dependent diffusion'
            ? `Dx/Dy = ${(diffusivity[0] / Math.max(1e-9, diffusivity[1])).toFixed(2)}×`
            : '—';

      return {
        model,
        family: spec.family,
        kParams: spec.kParams,
        beta,
        rate,
        diffusivity,
        paramNote,
        trainLoss: trainNllSum / nTrainCoords,
        loss: testNllSum / nTestCoords,
        totalTestNll: testNllSum,
      };
    });

    // Candidate 6: Viscoelastic Memory (fGn AR-2 increment memory model)
    // Captures fractional Gaussian noise negative recoil (α < 1) or persistence (α > 1)
    {
      let s11 = 0, s22 = 0, s12 = 0, sy1 = 0, sy2 = 0;
      let varStep1 = 0;
      for (let i = 0; i < 3 * tCount; i++) {
        const d1 = paths[1][i] - paths[0][i];
        varStep1 += d1 * d1;
      }
      varStep1 = Math.max(1e-12, varStep1 / (3 * tCount));

      for (let f = 2; f <= nSteps; f++) {
        for (let i = 0; i < 3 * tCount; i++) {
          const y = paths[f][i] - paths[f - 1][i];
          const x1 = paths[f - 1][i] - paths[f - 2][i];
          const x2 = f >= 3 ? paths[f - 2][i] - paths[f - 3][i] : 0;
          s11 += x1 * x1;
          s22 += x2 * x2;
          s12 += x1 * x2;
          sy1 += y * x1;
          sy2 += y * x2;
        }
      }
      const det = s11 * s22 - s12 * s12;
      let phi1 = 0, phi2 = 0;
      if (Math.abs(det) > 1e-12) {
        phi1 = Math.max(-0.85, Math.min(0.85, (sy1 * s22 - sy2 * s12) / det));
        phi2 = Math.max(-0.65, Math.min(0.65, (sy2 * s11 - sy1 * s12) / det));
      } else if (s11 > 1e-12) {
        phi1 = Math.max(-0.85, Math.min(0.85, sy1 / s11));
      }

      let residSum = 0;
      const nRestTrain = 3 * tCount * (nSteps - 1);
      for (let f = 2; f <= nSteps; f++) {
        for (let i = 0; i < 3 * tCount; i++) {
          const y = paths[f][i] - paths[f - 1][i];
          const x1 = paths[f - 1][i] - paths[f - 2][i];
          const x2 = f >= 3 ? paths[f - 2][i] - paths[f - 3][i] : 0;
          const r = y - phi1 * x1 - phi2 * x2;
          residSum += r * r;
        }
      }
      const varInnov = Math.max(1e-12, residSum / Math.max(1, nRestTrain));

      let trainNllSum = 0, testNllSum = 0;
      for (let i = 0; i < 3 * count; i++) {
        const d1 = paths[1][i] - paths[0][i];
        const nll1 = 0.5 * (Math.log(2 * Math.PI * varStep1) + (d1 * d1) / varStep1);
        if (i < 3 * tCount) trainNllSum += nll1;
        else testNllSum += nll1;
      }
      for (let f = 2; f <= nSteps; f++) {
        for (let i = 0; i < 3 * count; i++) {
          const y = paths[f][i] - paths[f - 1][i];
          const x1 = paths[f - 1][i] - paths[f - 2][i];
          const x2 = f >= 3 ? paths[f - 2][i] - paths[f - 3][i] : 0;
          const r = y - phi1 * x1 - phi2 * x2;
          const nll = 0.5 * (Math.log(2 * Math.PI * varInnov) + (r * r) / varInnov);
          if (i < 3 * tCount) trainNllSum += nll;
          else testNllSum += nll;
        }
      }

      // Lag-1 autocorrelation implied by Yule-Walker: ρ₁ = φ₁ / (1 - φ₂), fGn α = 1 + log₂(1 + ρ₁)
      const rho1 = Math.max(-0.48, Math.min(0.85, phi1 / Math.max(0.25, 1 - phi2)));
      const alphaEst = Math.max(0.25, Math.min(1.85, 1 + Math.log2(Math.max(0.15, 1 + rho1))));
      const dApp = varStep1 / (2 * dt);

      results.push({
        model: 'Viscoelastic memory (fBm)',
        family: 'Fractional Memory AR',
        kParams: 3,
        beta: phi1,
        rate: 0,
        alphaEst,
        diffusivity: [dApp, dApp, dApp],
        paramNote: `α̂ = ${alphaEst.toFixed(2)} (ρ₁ = ${rho1 >= 0 ? '+' : ''}${rho1.toFixed(2)})`,
        trainLoss: trainNllSum / nTrainCoords,
        loss: testNllSum / nTestCoords,
        totalTestNll: testNllSum,
      });
    }

    // Candidate 7: Two-State Bound ⇌ Free 3D Gaussian Scale Mixture (Spot-On / CTRW Trap Mixture)
    {
      const trainR2 = new Float64Array(tCount * nSteps);
      let ptr = 0;
      for (let f = 1; f <= nSteps; f++) {
        const p0 = paths[f - 1], p1 = paths[f];
        for (let j = 0; j < tCount; j++) {
          const idx = j * 3;
          const dx = p1[idx] - p0[idx], dy = p1[idx + 1] - p0[idx + 1], dz = p1[idx + 2] - p0[idx + 2];
          trainR2[ptr++] = dx * dx + dy * dy + dz * dz;
        }
      }
      const mix = fitTwoStateStepMixture3D(trainR2);
      const w = mix.wBound;
      const s1 = Math.max(1e-12, mix.sBound2);
      const s2 = Math.max(1e-12, mix.sFree2);
      const c1 = w / Math.pow(2 * Math.PI * s1, 1.5);
      const c2 = (1 - w) / Math.pow(2 * Math.PI * s2, 1.5);

      let trainNllSum = 0, testNllSum = 0;
      for (let f = 1; f <= nSteps; f++) {
        const p0 = paths[f - 1], p1 = paths[f];
        for (let j = 0; j < count; j++) {
          const idx = j * 3;
          const dx = p1[idx] - p0[idx], dy = p1[idx + 1] - p0[idx + 1], dz = p1[idx + 2] - p0[idx + 2];
          const r2 = dx * dx + dy * dy + dz * dz;
          const density = Math.max(1e-300, c1 * Math.exp(-r2 / (2 * s1)) + c2 * Math.exp(-r2 / (2 * s2)));
          const nll3d = -Math.log(density);
          if (j < tCount) trainNllSum += nll3d;
          else testNllSum += nll3d;
        }
      }
      const dBound = s1 / (2 * dt);
      const dFree = s2 / (2 * dt);
      const dEff = w * dBound + (1 - w) * dFree;

      results.push({
        model: 'Two-state bound/free',
        family: 'Spot-On Scale Mixture',
        kParams: 3,
        beta: w,
        rate: 0,
        fBoundEst: mix.effectiveBoundFrac,
        dBoundEst: dBound,
        dFreeEst: dFree,
        diffusivity: [dEff, dEff, dEff],
        paramNote: `f_b = ${(100 * mix.effectiveBoundFrac).toFixed(0)}% (${dBound.toFixed(3)} / ${dFree.toFixed(2)})`,
        trainLoss: trainNllSum / nTrainCoords,
        loss: testNllSum / nTestCoords,
        totalTestNll: testNllSum,
      });
    }

    results.sort((a, b) => a.loss - b.loss);
    const bestLoss = results[0].loss;
    for (const r of results) {
      r.deltaLoss = r.loss - bestLoss;
      r.aic = 2 * r.kParams + 2 * nTestCoords * r.loss;
    }
    const minAic = Math.min(...results.map(r => r.aic));
    let weightDenom = 0;
    for (const r of results) {
      r.deltaAic = r.aic - minAic;
      weightDenom += Math.exp(Math.max(-80, -0.5 * r.deltaAic));
    }
    for (const r of results) {
      r.weight = Math.exp(Math.max(-80, -0.5 * r.deltaAic)) / Math.max(1e-30, weightDenom);
    }

    return results;
  }

  const api = {
    TRANSPORT_MODES,
    COMPARTMENT_PRESETS,
    getMacromoleculeCatalog,
    stokesEinsteinD,
    theoreticalTrueMsd,
    runExperiment,
    computeMichaletBerglundCve,
    computeSpotOnJumpAnalysis,
    computeVirtualFrap,
    computeFirstPassage,
    fitMotion,
  };

  root.TransportEngine = api;
  root.fitMotion = fitMotion;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
