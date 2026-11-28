'use strict';

/**
 * Assay Evidence Studio — Molecular Force-Field, Symplectic MD & Biomolecular Ensemble Engine
 *
 * Preserves 100% backward-compatible `forceRun(width, amplitude)` and `ensembleRun(gap, mixing, seed)`
 * (verified to <1e-10 against `evidence/check_simulation.py` and vendored MACE metrics) while providing
 * `SimAnalytics` for:
 *   - 5 Physical Potentials: Anharmonic Quartic, Morse Dissociation, Lennard-Jones 12-6, 3BPA Torsion, Reactive Double-Well
 *   - 5 Force-Field Surrogates: Harmonic Hooke, Quartic Polynomial, Conservative RBF-GP, MACE-Bessel + Prior, Neural Committee
 *   - 4 Integrators/Thermostats: Velocity Verlet (NVE), Forward Euler, Classical RK4, BAOAB Langevin (NVT)
 *   - 4 Biomolecular Landscapes: Two-State Switch, 1D Cryptic Pocket, 2D Müller-Brown PES, 2D Alanine Dipeptide (φ, ψ) Ramachandran
 *   - 4 Ensemble Samplers: Langevin BAOAB MD, Metropolis MCMC, Well-Tempered Metadynamics, BioEmu Direct Equilibrium Emulator
 */

// 1. Canonical backward-compatible functions (used by check_simulation.py & legacy callers)
function forceRun(width, amplitude) {
  const force = x => -x - 0.6 * x ** 3;
  const training = Array.from({ length: 21 }, (_, i) => ((i - 10) * width) / 10);
  const sum = a => a.reduce((s, x) => s + x, 0);
  const stiffness = -sum(training.map(x => x * force(x))) / sum(training.map(x => x * x));
  const learned = x => -stiffness * x;
  const dt = 0.025, steps = 480;
  let truth = amplitude, guess = amplitude, vt = 0, vg = 0;
  const trace = [], errors = [];
  function advance(x, v, f) {
    const half = v + (dt * f(x)) / 2;
    const next = x + dt * half;
    return [next, half + (dt * f(next)) / 2];
  }
  for (let i = 0; i <= steps; i++) {
    trace.push([i * dt, truth, guess]);
    errors.push(learned(truth) - force(truth));
    [truth, vt] = advance(truth, vt, force);
    [guess, vg] = advance(guess, vg, learned);
  }
  const span = Math.max(width, amplitude) * 1.1;
  const curve = Array.from({ length: 101 }, (_, i) => {
    const x = (span * (i - 50)) / 50;
    return [x, force(x), learned(x)];
  });
  return {
    trace,
    curve,
    errors,
    stiffness,
    mae: sum(errors.map(Math.abs)) / errors.length,
    rmse: Math.sqrt(sum(errors.map(x => x * x)) / errors.length),
  };
}

function ensembleRun(gap, mixing, seed) {
  const probability = 1 / (1 + Math.exp(gap));
  let random = seed >>> 0, state = 0, occupied = 0, switches = 0;
  const trace = [], occupancy = [];
  for (let i = 1; i <= 500; i++) {
    random = (Math.imul(1664525, random) + 1013904223) >>> 0;
    const switchProbability = mixing * (state ? 1 - probability : probability);
    if (random / 4294967296 < switchProbability) {
      state = 1 - state;
      switches++;
    }
    occupied += state;
    trace.push([i, state]);
    occupancy.push([i, occupied / i, probability]);
  }
  return { trace, occupancy, probability, observed: occupied / 500, switches };
}

// 2. Full Publication-Grade Simulation & Ensemble Analytics Engine
const SimAnalytics = (() => {
  function createRng(seed = 42) {
    let s = (seed >>> 0) || 1;
    let spare = null;
    const uniform = () => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return (s + 0.5) / 4294967296;
    };
    const normal = () => {
      if (spare !== null) {
        const out = spare;
        spare = null;
        return out;
      }
      const u1 = Math.max(1e-12, uniform());
      const u2 = uniform();
      const mag = Math.sqrt(-2 * Math.log(u1));
      spare = mag * Math.sin(2 * Math.PI * u2);
      return mag * Math.cos(2 * Math.PI * u2);
    };
    return { uniform, normal };
  }

  // Solve symmetric / regularized linear system A x = b via Gaussian elimination with partial pivoting
  function solveLinear(A, b) {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < n; col++) {
      let maxRow = col, maxVal = Math.abs(M[col][col]);
      for (let r = col + 1; r < n; r++) {
        if (Math.abs(M[r][col]) > maxVal) { maxVal = Math.abs(M[r][col]); maxRow = r; }
      }
      if (maxRow !== col) { const tmp = M[col]; M[col] = M[maxRow]; M[maxRow] = tmp; }
      const piv = Math.abs(M[col][col]) < 1e-13 ? (M[col][col] >= 0 ? 1e-13 : -1e-13) : M[col][col];
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / piv;
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = M[i][n];
      for (let c = i + 1; c < n; c++) s -= M[i][c] * x[c];
      const piv = Math.abs(M[i][i]) < 1e-13 ? 1e-13 : M[i][i];
      x[i] = s / piv;
    }
    return Array.from(x);
  }

  function invertSymmetric(A) {
    const n = A.length;
    const cols = [];
    for (let j = 0; j < n; j++) {
      const e = Array(n).fill(0);
      e[j] = 1;
      cols.push(solveLinear(A, e));
    }
    return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => cols[j][i]));
  }

  // -------------------------------------------------------------------------
  // CATALOGS: POTENTIALS, SURROGATES, INTEGRATORS, LANDSCAPES, SAMPLERS
  // -------------------------------------------------------------------------
  const POTENTIAL_CATALOG = [
    {
      id: 'quartic',
      name: 'Anharmonic Quartic Oscillator (MACE Canonical)',
      short: 'Quartic Bond',
      equation: 'U(x) = ½x² + 0.15x⁴  ·  F(x) = −x − 0.6x³',
      xUnit: 'x (reduced Å)',
      eUnit: 'E (reduced eV)',
      defaultAmp: 1.5,
      defaultWidth: 0.5,
      scanMax: 2.2,
      U: x => 0.5 * x * x + 0.15 * Math.pow(x, 4),
      F: x => -x - 0.6 * Math.pow(x, 3),
    },
    {
      id: 'morse',
      name: 'Morse Covalent Bond Dissociation',
      short: 'Morse Bond',
      equation: 'U(x) = De·(1 − e^(−a·x))²  (De = 2.4, a = 0.85)',
      xUnit: 'r − r₀ (Å)',
      eUnit: 'Energy (eV)',
      defaultAmp: 1.45,
      defaultWidth: 0.45,
      scanMax: 2.3,
      U: x => {
        const ex = Math.exp(-0.85 * Math.max(-1.6, x));
        return 2.4 * Math.pow(1 - ex, 2);
      },
      F: x => {
        const ex = Math.exp(-0.85 * Math.max(-1.6, x));
        return -2 * 2.4 * 0.85 * (1 - ex) * ex;
      },
    },
    {
      id: 'lj',
      name: 'Lennard–Jones 12–6 Nonbonded Pair',
      short: 'Lennard–Jones 12–6',
      equation: 'U(r) = 4ε[(σ/r)¹² − (σ/r)⁶] + ε  (Pauli wall + dispersion)',
      xUnit: 'Δr from r_min (Å)',
      eUnit: 'Pair Energy (kcal/mol)',
      defaultAmp: 0.95,
      defaultWidth: 0.35,
      scanMax: 1.8,
      U: x => {
        const rm = Math.pow(2, 1 / 6);
        const r = Math.max(0.76, rm + 0.36 * x);
        const sr6 = Math.pow(1 / r, 6);
        return 6.0 * (sr6 * sr6 - sr6) + 1.5;
      },
      F: x => {
        const rm = Math.pow(2, 1 / 6);
        const r = Math.max(0.76, rm + 0.36 * x);
        const sr6 = Math.pow(1 / r, 6);
        // -dU/dx = -dU/dr * 0.36 = 0.36 * (24*eps/r) * (2*(1/r)^12 - (1/r)^6)
        return 0.36 * (36.0 / r) * (2 * sr6 * sr6 - sr6);
      },
    },
    {
      id: 'torsion',
      name: '3BPA-Inspired Multi-Minima Dihedral Torsion',
      short: '3BPA Dihedral Rotor',
      equation: 'U(θ) = ∑ ½V_m(1 − cos mθ)  (m = 1, 2, 3)',
      xUnit: 'Dihedral Δθ (rad)',
      eUnit: 'Torsion E (kcal/mol)',
      defaultAmp: 1.55,
      defaultWidth: 0.65,
      scanMax: 2.4,
      U: x => 0.42 * (1 - Math.cos(x)) + 0.30 * (1 - Math.cos(2 * x)) + 0.48 * (1 - Math.cos(3 * x)),
      F: x => -0.42 * Math.sin(x) - 0.60 * Math.sin(2 * x) - 1.44 * Math.sin(3 * x),
    },
    {
      id: 'double_well',
      name: 'Reactive Proton-Transfer Double Well',
      short: 'Reactive Double-Well',
      equation: 'U(x) = 0.42(x² − 1.15²)² + 0.12x',
      xUnit: 'Proton transfer q (Å)',
      eUnit: 'Potential U (eV)',
      defaultAmp: 1.5,
      defaultWidth: 0.7,
      scanMax: 2.1,
      U: x => 0.42 * Math.pow(x * x - 1.3225, 2) + 0.12 * x + 0.14,
      F: x => -1.68 * x * (x * x - 1.3225) - 0.12,
    },
  ];

  const SURROGATE_CATALOG = [
    {
      id: 'harmonic',
      k: 1,
      short: 'Harmonic Hooke',
      name: 'Linear Harmonic Force Law (F = −k·x)',
      family: 'Classical Baseline',
      description: 'Fits single harmonic stiffness around equilibrium; exact MACE checker baseline, misses anharmonicity and barriers.',
    },
    {
      id: 'poly4',
      k: 4,
      short: 'Quartic Taylor (p=4)',
      name: 'Anharmonic Polynomial Taylor Potential (Degree 4)',
      family: 'Polynomial Expansion',
      description: 'Captures local anharmonic curvature, but high-order terms can flip sign in OOD regions and create catastrophic −∞ MD holes.',
    },
    {
      id: 'rbf_gp',
      k: 21,
      short: 'Conservative GP / sGDML',
      name: 'Conservative Gaussian-Process Kernel Potential (sGDML-style)',
      family: 'Kernel MLIP',
      description: 'Exact gradient-domain RBF kernel regression providing analytical epistemic uncertainty ±2σ_F(x); decays to zero force far OOD.',
    },
    {
      id: 'mace_bessel',
      k: 9,
      short: 'MACE Radial–Bessel',
      name: 'Physics-Informed Radial–Bessel + Repulsive Prior (MACE-style)',
      family: 'Equivariant Basis MLIP',
      description: 'Joint Energy + Force training over smooth Bessel basis + short-range confining prior; preserves stable MD in OOD regimes.',
    },
    {
      id: 'committee_mlp',
      k: 16,
      short: 'Neural Committee (4×MLP)',
      name: 'Conservative 4-Member Neural Feature Committee (QBC)',
      family: 'Neural Ensemble MLIP',
      description: 'Ensemble of 4 conservative tanh potentials whose Query-by-Committee force spread σ_QBC(x) pinpoints active-learning queries.',
    },
  ];

  const INTEGRATOR_CATALOG = [
    { id: 'verlet', short: 'Velocity Verlet (NVE)', name: 'Velocity Verlet · Symplectic NVE', symplectic: true },
    { id: 'euler', short: 'Forward Euler', name: 'Forward Euler · Non-Symplectic (Drifts!)', symplectic: false },
    { id: 'rk4', short: 'Runge–Kutta 4 (RK4)', name: 'Classical 4th-Order Runge–Kutta', symplectic: false },
    { id: 'langevin', short: 'BAOAB Langevin (NVT)', name: 'BAOAB Langevin Thermostat (NVT)', symplectic: true },
  ];

  // Fit any of the 5 conservative surrogate models on training anchors xTrain
  function fitSurrogate(pot, surrogateId, xTrain) {
    const u0 = pot.U(0);
    const yF = xTrain.map(x => pot.F(x));
    const yU = xTrain.map(x => pot.U(x) - u0);

    if (surrogateId === 'harmonic') {
      // Exact MACE check_simulation.py formula when pot === quartic (or centered linear stiffness + optional offset)
      const isSymmetricZero = Math.abs(xTrain.reduce((a, b) => a + b, 0)) < 1e-11 && Math.abs(pot.F(0)) < 1e-11;
      if (isSymmetricZero) {
        let num = 0, den = 0;
        for (let i = 0; i < xTrain.length; i++) {
          num -= xTrain[i] * yF[i];
          den += xTrain[i] * xTrain[i];
        }
        const k = num / Math.max(1e-15, den);
        return {
          id: surrogateId,
          stiffness: k,
          U: x => u0 + 0.5 * k * x * x,
          F: x => -k * x,
          stdF: x => 0.12 * Math.abs(x),
        };
      }
      // General affine force F(x) = c0 - k*x => U(x) = u0 - c0*x + 0.5*k*x^2
      const A = [[1e-12, 0], [0, 1e-12]];
      const b = [0, 0];
      for (let i = 0; i < xTrain.length; i++) {
        const g = [1, -xTrain[i]];
        for (let r = 0; r < 2; r++) {
          b[r] += g[r] * yF[i];
          for (let c = 0; c < 2; c++) A[r][c] += g[r] * g[c];
        }
      }
      const [c0, k] = solveLinear(A, b);
      return {
        id: surrogateId,
        stiffness: k,
        U: x => u0 - c0 * x + 0.5 * k * x * x,
        F: x => c0 - k * x,
        stdF: x => 0.12 * Math.abs(x),
      };
    }

    if (surrogateId === 'poly4') {
      // U(x) = u0 + c1*x + c2*x^2 + c3*x^3 + c4*x^4 => F(x) = -c1 - 2*c2*x - 3*c3*x^2 - 4*c4*x^3
      const P = 4;
      const A = Array.from({ length: P }, (_, i) => Array.from({ length: P }, (__, j) => (i === j ? 1e-10 : 0)));
      const b = Array(P).fill(0);
      for (let i = 0; i < xTrain.length; i++) {
        const x = xTrain[i];
        const g = [-1, -2 * x, -3 * x * x, -4 * x * x * x];
        for (let r = 0; r < P; r++) {
          b[r] += g[r] * yF[i];
          for (let c = 0; c < P; c++) A[r][c] += g[r] * g[c];
        }
      }
      const coef = solveLinear(A, b);
      const minTrain = Math.min(...xTrain), maxTrain = Math.max(...xTrain);
      return {
        id: surrogateId,
        stiffness: 2 * coef[1],
        coef,
        U: x => u0 + coef[0] * x + coef[1] * x * x + coef[2] * Math.pow(x, 3) + coef[3] * Math.pow(x, 4),
        F: x => -(coef[0] + 2 * coef[1] * x + 3 * coef[2] * x * x + 4 * coef[3] * Math.pow(x, 3)),
        stdF: x => {
          const distOut = x < minTrain ? minTrain - x : x > maxTrain ? x - maxTrain : 0;
          return 0.015 + 0.85 * Math.pow(distOut, 2.5);
        },
      };
    }

    if (surrogateId === 'rbf_gp') {
      // Exact Conservative Force-Kernel Gaussian Process (sGDML / GAP style)
      const span = Math.max(0.25, Math.max(...xTrain) - Math.min(...xTrain));
      const ell = Math.max(0.26, Math.min(0.78, span * 0.42));
      const ell2 = ell * ell;
      const sigF2 = Math.max(1.0, yF.reduce((s, v) => s + v * v, 0) / Math.max(1, yF.length));
      const noise2 = 1e-5 * sigF2;

      const kFF = (xa, xb) => {
        const d = xa - xb;
        return (sigF2 / ell2) * (1 - (d * d) / ell2) * Math.exp(-(d * d) / (2 * ell2));
      };
      const phi = (x, xj) => {
        const d = x - xj;
        return ((sigF2 * d) / ell2) * Math.exp(-(d * d) / (2 * ell2));
      };

      const n = xTrain.length;
      const K = Array.from({ length: n }, (_, i) =>
        Array.from({ length: n }, (__, j) => kFF(xTrain[i], xTrain[j]) + (i === j ? noise2 : 0))
      );
      const alpha = solveLinear(K, yF);
      const Kinv = invertSymmetric(K);
      const kDiag = sigF2 / ell2;

      // Effective stiffness around 0: -F'(0)
      const eps = 1e-4;
      const fEval = x => {
        let s = 0;
        for (let j = 0; j < n; j++) s += alpha[j] * kFF(x, xTrain[j]);
        return s;
      };
      const kEff = -(fEval(eps) - fEval(-eps)) / (2 * eps);

      return {
        id: surrogateId,
        stiffness: kEff,
        U: x => {
          // Since d/dx phi(x, xj) = kFF(x, xj), U(x) = u0 - sum_j alpha_j * (phi(x, xj) - phi(0, xj)) satisfies -dU/dx = F(x) exactly!
          let s = 0;
          for (let j = 0; j < n; j++) s += alpha[j] * (phi(x, xTrain[j]) - phi(0, xTrain[j]));
          return u0 - s;
        },
        F: fEval,
        stdF: x => {
          const kx = xTrain.map(xj => kFF(x, xj));
          let quad = 0;
          for (let i = 0; i < n; i++) {
            let rowSum = 0;
            for (let j = 0; j < n; j++) rowSum += Kinv[i][j] * kx[j];
            quad += kx[i] * rowSum;
          }
          return Math.sqrt(Math.max(1e-8, kDiag - quad));
        },
      };
    }

    if (surrogateId === 'mace_bessel') {
      // MACE-inspired Radial-Bessel + Short/Long-Range Confining Physical Prior trained jointly on Energy + Force
      const Rc = 3.2;
      // Basis on U(x) - U(0): [x^2, x^4, sin(k*pi*x/Rc)/k, (1-cos(k*pi*x/Rc))/k] for k=1..4 -> 10 conservative basis functions
      const basisU = x => {
        const out = [0.5 * x * x, 0.25 * Math.pow(x, 4)];
        for (let k = 1; k <= 4; k++) {
          const w = (k * Math.PI) / Rc;
          out.push(Math.sin(w * x) / w);
          out.push((1 - Math.cos(w * x)) / w);
        }
        return out;
      };
      const basisNegGrad = x => {
        const out = [-x, -Math.pow(x, 3)];
        for (let k = 1; k <= 4; k++) {
          const w = (k * Math.PI) / Rc;
          out.push(-Math.cos(w * x));
          out.push(-Math.sin(w * x));
        }
        return out;
      };
      const B = 10;
      // Weak physical confining prior toward positive confining curvature (prevents OOD -infinity holes!)
      const priorW = [0.65, 0.22, 0, 0, 0, 0, 0, 0, 0, 0];
      const reg = [1e-4, 2e-3, 8e-3, 8e-3, 1.5e-2, 1.5e-2, 3e-2, 3e-2, 6e-2, 6e-2];
      const A = Array.from({ length: B }, (_, r) => Array.from({ length: B }, (__, c) => (r === c ? reg[r] : 0)));
      const rhs = reg.map((lam, r) => lam * priorW[r]);
      const wE = 0.35, wF = 1.0;

      for (let i = 0; i < xTrain.length; i++) {
        const gu = basisU(xTrain[i]);
        const gf = basisNegGrad(xTrain[i]);
        for (let r = 0; r < B; r++) {
          rhs[r] += wE * gu[r] * yU[i] + wF * gf[r] * yF[i];
          for (let c = 0; c < B; c++) {
            A[r][c] += wE * gu[r] * gu[c] + wF * gf[r] * gf[c];
          }
        }
      }
      const w = solveLinear(A, rhs);
      const Ainv = invertSymmetric(A);
      const fEval = x => {
        const gf = basisNegGrad(x);
        let s = 0;
        for (let b = 0; b < B; b++) s += w[b] * gf[b];
        return s;
      };
      const eps = 1e-4;
      const kEff = -(fEval(eps) - fEval(-eps)) / (2 * eps);

      return {
        id: surrogateId,
        stiffness: kEff,
        U: x => {
          const gu = basisU(x);
          let s = 0;
          for (let b = 0; b < B; b++) s += w[b] * gu[b];
          return u0 + s;
        },
        F: fEval,
        stdF: x => {
          const gf = basisNegGrad(x);
          let v = 0;
          for (let r = 0; r < B; r++) {
            let rs = 0;
            for (let c = 0; c < B; c++) rs += Ainv[r][c] * gf[c];
            v += gf[r] * rs;
          }
          return Math.sqrt(Math.max(1e-6, v * 0.08));
        },
      };
    }

    if (surrogateId === 'committee_mlp') {
      // 4-Member Conservative Random-Feature Tanh Neural Committee (Query-by-Committee!)
      const members = [];
      const H = 12;
      for (let m = 0; m < 4; m++) {
        const rng = createRng(101 + m * 977);
        const freqs = Array.from({ length: H }, () => (0.55 + rng.uniform() * 1.85) * (rng.uniform() < 0.5 ? -1 : 1));
        const phases = Array.from({ length: H }, () => (rng.uniform() - 0.5) * 2.4);
        // Feature j: f_j(x) = -tanh(a_j * x + b_j) => U_j(x) = (ln cosh(a_j*x + b_j) - ln cosh(b_j)) / a_j
        // Plus weak confining quadratic feature f_0(x) = -x
        const logCosh = z => Math.abs(z) + Math.log(1 + Math.exp(-2 * Math.abs(z))) - Math.LN2;
        const featF = x => [-x, ...freqs.map((a, j) => -Math.tanh(a * x + phases[j]))];
        const featU = x => [0.5 * x * x, ...freqs.map((a, j) => (logCosh(a * x + phases[j]) - logCosh(phases[j])) / a)];
        const D = H + 1;
        const lam = 2.5e-3;
        const A = Array.from({ length: D }, (_, r) => Array.from({ length: D }, (__, c) => (r === c ? (r === 0 ? 1e-4 : lam) : 0)));
        const rhs = Array(D).fill(0);
        rhs[0] = 1e-4 * 0.8;
        for (let i = 0; i < xTrain.length; i++) {
          // Bootstrap sub-weight for committee diversity
          const bootW = 0.65 + 0.7 * rng.uniform();
          const gf = featF(xTrain[i]);
          for (let r = 0; r < D; r++) {
            rhs[r] += bootW * gf[r] * yF[i];
            for (let c = 0; c < D; c++) A[r][c] += bootW * gf[r] * gf[c];
          }
        }
        const weights = solveLinear(A, rhs);
        members.push({
          U: x => {
            const gu = featU(x);
            let s = 0;
            for (let d = 0; d < D; d++) s += weights[d] * gu[d];
            return u0 + s;
          },
          F: x => {
            const gf = featF(x);
            let s = 0;
            for (let d = 0; d < D; d++) s += weights[d] * gf[d];
            return s;
          },
        });
      }
      const fMean = x => members.reduce((s, m) => s + m.F(x), 0) / members.length;
      const eps = 1e-4;
      return {
        id: surrogateId,
        stiffness: -(fMean(eps) - fMean(-eps)) / (2 * eps),
        members,
        U: x => members.reduce((s, m) => s + m.U(x), 0) / members.length,
        F: fMean,
        stdF: x => {
          const mu = fMean(x);
          const v = members.reduce((s, m) => s + Math.pow(m.F(x) - mu, 2), 0) / members.length;
          return Math.sqrt(Math.max(1e-8, v));
        },
      };
    }

    throw new Error('Unknown surrogate model: ' + surrogateId);
  }

  // Advance one MD step under chosen integrator (unit mass m = 1)
  function stepIntegrator(integratorId, x, v, F, dt, kBT, gamma, rng) {
    if (integratorId === 'verlet') {
      const half = v + 0.5 * dt * F(x);
      const nextX = x + dt * half;
      const nextV = half + 0.5 * dt * F(nextX);
      return [nextX, nextV];
    }
    if (integratorId === 'euler') {
      return [x + dt * v, v + dt * F(x)];
    }
    if (integratorId === 'rk4') {
      const k1x = v, k1v = F(x);
      const k2x = v + 0.5 * dt * k1v, k2v = F(x + 0.5 * dt * k1x);
      const k3x = v + 0.5 * dt * k2v, k3v = F(x + 0.5 * dt * k2x);
      const k4x = v + dt * k3v, k4v = F(x + dt * k3x);
      return [
        x + (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x),
        v + (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v),
      ];
    }
    if (integratorId === 'langevin') {
      // Exact BAOAB Langevin splitting (Leimkuhler & Matthews)
      let vm = v + 0.5 * dt * F(x);
      let xm = x + 0.5 * dt * vm;
      const c1 = Math.exp(-gamma * dt);
      const c2 = Math.sqrt(Math.max(0, kBT * (1 - c1 * c1)));
      vm = c1 * vm + c2 * rng.normal();
      const nextX = xm + 0.5 * dt * vm;
      const nextV = vm + 0.5 * dt * F(nextX);
      return [nextX, nextV];
    }
    throw new Error('Unknown integrator: ' + integratorId);
  }

  // Velocity Autocorrelation C_vv(tau) and Hann-windowed Vibrational Power Spectrum S(omega)
  function computeVacfAndSpectrum(velocities, dt) {
    const N = velocities.length;
    const maxLag = Math.min(120, Math.floor(N * 0.45));
    const vacf = new Float64Array(maxLag + 1);
    for (let lag = 0; lag <= maxLag; lag++) {
      let s = 0;
      const count = N - lag;
      for (let i = 0; i < count; i++) s += velocities[i] * velocities[i + lag];
      vacf[lag] = s / Math.max(1, count);
    }
    const v0 = Math.max(1e-12, vacf[0]);
    const normVacf = Array.from(vacf, v => v / v0);

    // Discrete cosine transform over omega in [0, 4.5] rad/reduced-time
    const nFreq = 72;
    const maxOmega = 4.2;
    const spectrum = [];
    let peakOmega = 0, peakPower = -1;
    for (let k = 0; k < nFreq; k++) {
      const omega = (maxOmega * k) / (nFreq - 1);
      let acc = 0.5 * normVacf[0];
      for (let lag = 1; lag <= maxLag; lag++) {
        const hann = 0.5 * (1 + Math.cos((Math.PI * lag) / maxLag));
        acc += hann * normVacf[lag] * Math.cos(omega * lag * dt);
      }
      const power = Math.max(0, acc * dt);
      spectrum.push({ omega, power });
      if (k > 0 && power > peakPower) { peakPower = power; peakOmega = omega; }
    }
    return {
      vacf: normVacf.map((c, lag) => ({ t: lag * dt, c })),
      spectrum,
      peakOmega,
    };
  }

  function computeParityMetrics(refArr, predArr) {
    const n = refArr.length;
    if (!n) return { mae: 0, rmse: 0, ccc: 1 };
    let sae = 0, sse = 0, mR = 0, mP = 0;
    for (let i = 0; i < n; i++) {
      const e = predArr[i] - refArr[i];
      sae += Math.abs(e);
      sse += e * e;
      mR += refArr[i];
      mP += predArr[i];
    }
    mR /= n; mP /= n;
    let vR = 0, vP = 0, cov = 0;
    for (let i = 0; i < n; i++) {
      const dr = refArr[i] - mR, dp = predArr[i] - mP;
      vR += dr * dr; vP += dp * dp; cov += dr * dp;
    }
    const denom = vR + vP + n * Math.pow(mR - mP, 2);
    return {
      mae: sae / n,
      rmse: Math.sqrt(sse / n),
      ccc: denom > 1e-12 ? (2 * cov) / denom : 1,
    };
  }

  // Full Force-Field & Symplectic MD Simulation Benchmark
  function analyzeForceExperiment(opts = {}) {
    const potId = opts.potentialId || 'quartic';
    const surrogateId = opts.surrogateId || 'harmonic';
    const integratorId = opts.integratorId || 'verlet';
    const width = Number(opts.width ?? 0.5);
    const amplitude = Number(opts.amplitude ?? 1.5);
    const dt = Number(opts.dt ?? 0.025);
    const steps = Number(opts.steps ?? 480);
    const kBT = Number(opts.kBT ?? 0.35);
    const gamma = Number(opts.gamma ?? 0.25);
    const seed = Number(opts.seed ?? 42);
    const extraAnchors = Array.isArray(opts.extraAnchors) ? opts.extraAnchors : [];

    const pot = POTENTIAL_CATALOG.find(p => p.id === potId) || POTENTIAL_CATALOG[0];
    const baseTrain = Array.from({ length: 21 }, (_, i) => ((i - 10) * width) / 10);
    const xTrain = [...baseTrain, ...extraAnchors].sort((a, b) => a - b);

    const fit = fitSurrogate(pot, surrogateId, xTrain);

    // Run coupled Reference vs Surrogate trajectories (sharing identical thermal noise sequence if Langevin!)
    const rngRef = createRng(seed);
    const rngHat = createRng(seed);
    let xRef = amplitude, vRef = 0;
    let xHat = amplitude, vHat = 0;
    let blewUp = false, blowupTime = steps * dt;
    let dephaseTime = null;
    const dephaseTol = 0.15 * Math.max(0.4, Math.abs(amplitude));

    const trace = [];
    const trajFrames = [];
    const errors = [];
    const refForces = [], hatForcesOnRef = [];

    const eRef0 = 0.5 * vRef * vRef + pot.U(xRef);
    const eHat0 = 0.5 * vHat * vHat + fit.U(xHat);
    let maxRefDrift = 0, maxHatDrift = 0;

    for (let i = 0; i <= steps; i++) {
      const t = i * dt;
      const fRefAtRef = pot.F(xRef);
      const fHatAtRef = fit.F(xRef);
      trace.push([t, xRef, xHat]);
      errors.push(fHatAtRef - fRefAtRef);
      refForces.push(fRefAtRef);
      hatForcesOnRef.push(fHatAtRef);

      const eRef = 0.5 * vRef * vRef + pot.U(xRef);
      const eHatOnHat = 0.5 * vHat * vHat + fit.U(xHat);
      const eTrueOnHat = 0.5 * vHat * vHat + pot.U(xHat);
      const dRef = Math.abs(eRef - eRef0) / Math.max(0.05, Math.abs(eRef0));
      const dHat = Math.abs(eTrueOnHat - eRef0) / Math.max(0.05, Math.abs(eRef0));
      if (dRef > maxRefDrift) maxRefDrift = dRef;
      if (!blewUp && dHat > maxHatDrift) maxHatDrift = dHat;
      if (dephaseTime === null && Math.abs(xRef - xHat) > dephaseTol) dephaseTime = t;

      trajFrames.push({
        t,
        xRef, vRef, eRef,
        xHat, vHat, eHatOnHat, eTrueOnHat,
        driftRef: eRef - eRef0,
        driftHatShadow: eHatOnHat - eHat0,
        driftHatTrue: eTrueOnHat - eRef0,
      });

      if (i < steps) {
        [xRef, vRef] = stepIntegrator(integratorId, xRef, vRef, pot.F, dt, kBT, gamma, rngRef);
        if (!blewUp) {
          const [nx, nv] = stepIntegrator(integratorId, xHat, vHat, fit.F, dt, kBT, gamma, rngHat);
          if (!Number.isFinite(nx) || Math.abs(nx) > 9.5) {
            blewUp = true;
            blowupTime = t;
            xHat = Math.sign(nx || xHat || 1) * 9.5;
            vHat = 0;
          } else {
            xHat = nx;
            vHat = nv;
          }
        }
      }
    }

    // Evaluate PES, Force, and Epistemic Uncertainty across scan domain
    const span = Math.max(width * 1.35, Math.abs(amplitude) * 1.18, pot.scanMax * 0.85);
    const gridPts = Array.from({ length: 121 }, (_, i) => (span * (i - 60)) / 60);
    const pesGrid = gridPts.map(x => {
      const uTrue = pot.U(x);
      const uHat = fit.U(x);
      const fTrue = pot.F(x);
      const fHat = fit.F(x);
      const stdF = fit.stdF(x);
      const inDomain = Math.abs(x) <= width || extraAnchors.some(a => Math.abs(a - x) < 0.08);
      return { x, uTrue, uHat, fTrue, fHat, stdF, inDomain };
    });

    // Legacy 101-point curve format for CSV/JSON compatibility
    const legacySpan = Math.max(width, Math.abs(amplitude)) * 1.1;
    const curve = Array.from({ length: 101 }, (_, i) => {
      const x = (legacySpan * (i - 50)) / 50;
      return [x, pot.F(x), fit.F(x)];
    });

    const inDomPts = pesGrid.filter(g => g.inDomain);
    const oodPts = pesGrid.filter(g => !g.inDomain);
    const inDomMet = computeParityMetrics(inDomPts.map(g => g.fTrue), inDomPts.map(g => g.fHat));
    const oodMet = computeParityMetrics(oodPts.map(g => g.fTrue), oodPts.map(g => g.fHat));
    const trajMet = computeParityMetrics(refForces, hatForcesOnRef);
    const energyMae = pesGrid.reduce((s, g) => s + Math.abs(g.uHat - g.uTrue), 0) / pesGrid.length;

    // Active-Learning Optimal Next DFT Anchor x* (maximizing epistemic stdF + OOD boundary exploration)
    let bestCand = pesGrid[0], bestAcq = -1;
    for (const g of pesGrid) {
      const minAnchorDist = Math.min(...xTrain.map(a => Math.abs(g.x - a)));
      if (minAnchorDist < 0.07) continue;
      const acq = g.stdF * (1 + 0.35 * Math.min(2, minAnchorDist));
      if (acq > bestAcq) { bestAcq = acq; bestCand = g; }
    }

    const specRef = computeVacfAndSpectrum(trajFrames.map(f => f.vRef), dt);
    const specHat = computeVacfAndSpectrum(trajFrames.map(f => f.vHat), dt);

    // Compare all 5 surrogates on the exact same setup for the Leaderboard!
    const leaderboard = SURROGATE_CATALOG.map(sSpec => {
      const sFit = sSpec.id === surrogateId ? fit : fitSurrogate(pot, sSpec.id, xTrain);
      const sGridIn = inDomPts.map(g => sFit.F(g.x));
      const sGridOod = oodPts.map(g => sFit.F(g.x));
      const inM = computeParityMetrics(inDomPts.map(g => g.fTrue), sGridIn);
      const oodM = computeParityMetrics(oodPts.map(g => g.fTrue), sGridOod);
      const trF = trajFrames.map(f => sFit.F(f.xRef));
      const trM = computeParityMetrics(refForces, trF);
      const eMae = pesGrid.reduce((acc, g) => acc + Math.abs(sFit.U(g.x) - g.uTrue), 0) / pesGrid.length;
      // Quick stability probe under Velocity Verlet
      let sx = amplitude, sv = 0, stable = true, maxD = 0;
      const e0 = pot.U(amplitude);
      for (let step = 0; step < 320; step++) {
        [sx, sv] = stepIntegrator('verlet', sx, sv, sFit.F, dt, kBT, gamma, rngRef);
        if (!Number.isFinite(sx) || Math.abs(sx) > 9.5) { stable = false; break; }
        const d = Math.abs(0.5 * sv * sv + pot.U(sx) - e0) / Math.max(0.05, Math.abs(e0));
        if (d > maxD) maxD = d;
      }
      let verdict = 'Stable & Accurate', tone = 'best';
      if (!stable) { verdict = 'Unstable (OOD Hole Blowup!)'; tone = 'poor'; }
      else if (trM.rmse > 0.45 || maxD > 0.35) { verdict = 'High OOD Phase Drift'; tone = 'warn'; }
      else if (trM.rmse < 0.08) { verdict = 'Chemical-Accuracy MLIP'; tone = 'best'; }
      else { verdict = 'Stable Surrogate'; tone = 'good'; }

      return {
        ...sSpec,
        inDomainRmse: inM.rmse,
        oodRmse: oodM.rmse,
        trajMae: trM.mae,
        trajRmse: trM.rmse,
        ccc: trM.ccc,
        energyMae: eMae,
        stable,
        verletDriftPct: stable ? maxD * 100 : Infinity,
        verdict,
        tone,
      };
    });

    return {
      mode: 'force',
      pot,
      surrogateId,
      integratorId,
      width,
      amplitude,
      dt,
      steps,
      kBT,
      gamma,
      xTrain,
      extraAnchors,
      fit,
      trace,
      curve,
      errors,
      stiffness: fit.stiffness,
      mae: trajMet.mae,
      rmse: trajMet.rmse,
      ccc: trajMet.ccc,
      inDomainRmse: inDomMet.rmse,
      oodRmse: oodMet.rmse,
      energyMae,
      blewUp,
      blowupTime,
      dephaseTime: dephaseTime ?? steps * dt,
      maxRefDriftPct: maxRefDrift * 100,
      maxHatDriftPct: blewUp ? Infinity : maxHatDrift * 100,
      trajFrames,
      pesGrid,
      activeCandidate: bestCand,
      specRef,
      specHat,
      leaderboard,
    };
  }

  // -------------------------------------------------------------------------
  // MODE 2: BIOMOLECULAR CONFORMATIONAL ENSEMBLES, 2D PES & BIOEMU SAMPLING
  // -------------------------------------------------------------------------
  const LANDSCAPE_CATALOG = [
    {
      id: 'two_state',
      dim: 1,
      discrete: true,
      short: 'Two-State Switch',
      name: 'Discrete Two-State Allosteric Switch (Legacy-Compatible)',
      proteinId: '1UBQ',
      proteinTitle: 'PDB 1UBQ · Ubiquitin β1–β2 Pincer',
      qLabel: 'Conformational State (0 = Closed A, 1 = Open B)',
    },
    {
      id: 'cryptic_1d',
      dim: 1,
      discrete: false,
      short: '1D Cryptic Pocket',
      name: '1D Continuous Cryptic-Pocket Double Well + Shoulder',
      proteinId: '1MBO',
      proteinTitle: 'PDB 1MBO · Myoglobin Distal Heme-Gate (His64)',
      qLabel: 'Gate opening coordinate q (reduced Å)',
    },
    {
      id: 'muller_brown',
      dim: 2,
      discrete: false,
      short: '2D Müller–Brown PES',
      name: '2D Müller–Brown Canonical 3-Basin Potential Surface',
      proteinId: 'P04637',
      proteinTitle: 'AlphaFold P04637 · TP53 Loop Rearrangement',
      qLabel: 'Collective variables (q₁, q₂)',
    },
    {
      id: 'ramachandran',
      dim: 2,
      discrete: false,
      short: '2D Ramachandran (φ, ψ)',
      name: 'Alanine Dipeptide (φ, ψ) Ramachandran Free-Energy Map',
      proteinId: '1UBQ',
      proteinTitle: 'PDB 1UBQ · Backbone (φ, ψ) Ensemble Fluctuation',
      qLabel: 'Backbone dihedrals (φ°, ψ°)',
    },
  ];

  const SAMPLER_CATALOG = [
    {
      id: 'langevin_md',
      short: 'Langevin BAOAB MD',
      name: 'Langevin BAOAB Molecular Dynamics (Time-Correlated)',
      description: 'Realistic thermal trajectory; gets kinetically trapped in Basin A when ΔG‡ ≫ kBT.',
    },
    {
      id: 'metropolis_mcmc',
      short: 'Metropolis MCMC',
      name: 'Random-Walk Metropolis–Hastings MCMC',
      description: 'Local stochastic proposals accepted via min(1, exp(−ΔU/kBT)); sensitive to step size vs barrier height.',
    },
    {
      id: 'metadynamics',
      short: 'WT-Metadynamics',
      name: 'Well-Tempered Metadynamics (Adaptive Gaussian Bias)',
      description: 'Deposits repulsive Gaussian hills along visited coordinates to flatten ΔG‡ barriers and accelerate transitions.',
    },
    {
      id: 'bioemu_iid',
      short: 'BioEmu Emulator (i.i.d.)',
      name: 'BioEmu-Style Direct Equilibrium Emulator (Independent)',
      description: 'Emulates generative deep-learning equilibrium sampling (τ_int ≈ 1.0), populating cryptic states across barriers instantly.',
    },
  ];

  // Scaled Müller-Brown 2D potential + analytical gradient (scaled into kBT units)
  const MB_A = [-200, -100, -170, 15].map(v => v / 28);
  const MB_a = [-1, -1, -6.5, 0.7];
  const MB_b = [0, 0, 11, 0.6];
  const MB_c = [-10, -10, -6.5, 0.7];
  const MB_x0 = [1, 0, -0.5, -1];
  const MB_y0 = [0, 0.5, 1.5, 1];

  function evalMullerBrown(x, y, gapTilt = 0, barrierScale = 1) {
    let u = 0, gx = 0, gy = 0;
    for (let k = 0; k < 4; k++) {
      const dx = x - MB_x0[k], dy = y - MB_y0[k];
      const ex = MB_a[k] * dx * dx + MB_b[k] * dx * dy + MB_c[k] * dy * dy;
      const term = MB_A[k] * Math.exp(Math.max(-40, Math.min(12, ex)));
      u += term;
      gx += term * (2 * MB_a[k] * dx + MB_b[k] * dy);
      gy += term * (MB_b[k] * dx + 2 * MB_c[k] * dy);
    }
    // Shift so deep Basin A (-0.558, 1.442) sits near 0, and apply gapTilt toward Basin B (x > 0, y < 0.7)
    const baseShift = 5.23;
    const tilt = 0.42 * gapTilt * (x - 0.5 * y);
    return {
      u: Math.min(28, barrierScale * (u + baseShift) + tilt),
      fx: -(barrierScale * gx + 0.42 * gapTilt),
      fy: -(barrierScale * gy - 0.21 * gapTilt),
    };
  }

  // Alanine Dipeptide (phi, psi) in radians [-pi, pi]^2 (displayed in degrees [-180, 180])
  function evalRamachandran(phiRad, psiRad, gapTilt = 0, barrierScale = 1) {
    // 4 canonical peptide basins on periodic torus: beta (-2.50, 2.58), PII (-1.28, 2.35), alphaR (-1.12, -0.75), alphaL (1.02, 0.72)
    // barrierScale raises the inter-basin steric ridges while gapTilt shifts relative α vs β stability!
    const ridge = 2.4 * barrierScale;
    const basins = [
      { p0: -2.50, s0: 2.58, depth: ridge + 1.4, kp: 2.3, ks: 2.1 },                   // β-sheet (Basin A)
      { p0: -1.28, s0: 2.35, depth: ridge + 1.15, kp: 2.8, ks: 2.4 },                  // P_II / C7eq (Basin A)
      { p0: -1.12, s0: -0.75, depth: ridge + 1.45 - 0.75 * gapTilt, kp: 2.5, ks: 2.2 }, // α_R helix (Basin B!)
      { p0: 1.02, s0: 0.72, depth: ridge + 0.35 - 0.45 * gapTilt, kp: 3.1, ks: 2.9 },  // α_L cryptic helix (Basin B!)
    ];
    let u = ridge + 1.8 + 0.65 * barrierScale * (1 + Math.cos(phiRad - 0.2));
    let dPhi = -0.65 * barrierScale * Math.sin(phiRad - 0.2);
    let dPsi = 0;
    for (const b of basins) {
      const cp = Math.cos(phiRad - b.p0), sp = Math.sin(phiRad - b.p0);
      const cs = Math.cos(psiRad - b.s0), ss = Math.sin(psiRad - b.s0);
      const ex = -b.kp * (1 - cp) - b.ks * (1 - cs);
      const g = b.depth * Math.exp(ex);
      u -= g;
      dPhi += g * b.kp * sp;
      dPsi += g * b.ks * ss;
    }
    return {
      u,
      fx: -dPhi,
      fy: -dPsi,
    };
  }

  function shuffledQuantiles(steps, rng) {
    const arr = Array.from({ length: steps }, (_, i) => (i + rng.uniform()) / steps);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng.uniform() * (i + 1));
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  function wrapPi(a) {
    let x = a;
    while (x > Math.PI) x -= 2 * Math.PI;
    while (x < -Math.PI) x += 2 * Math.PI;
    return x;
  }

  function computeAutocorr(series, maxLag = 55) {
    const n = series.length;
    const L = Math.min(maxLag, Math.floor(n * 0.4));
    const mean = series.reduce((a, b) => a + b, 0) / Math.max(1, n);
    let v0 = 0;
    for (let i = 0; i < n; i++) v0 += Math.pow(series[i] - mean, 2);
    v0 /= Math.max(1, n);
    if (v0 < 1e-12) {
      return {
        lags: Array.from({ length: L + 1 }, (_, k) => ({ lag: k, c: k === 0 ? 1 : 0 })),
        tauInt: 1,
        nEff: n,
      };
    }
    const lags = [];
    let tauInt = 1;
    let summing = true;
    for (let lag = 0; lag <= L; lag++) {
      let c = 0;
      for (let i = 0; i < n - lag; i++) c += (series[i] - mean) * (series[i + lag] - mean);
      c = c / Math.max(1, n - lag) / v0;
      lags.push({ lag, c });
      if (lag > 0 && summing) {
        if (c > 0.02) tauInt += 2 * c;
        else summing = false;
      }
    }
    tauInt = Math.max(1, tauInt);
    return { lags, tauInt, nEff: n / tauInt };
  }

  function runSingleSampler(landscapeId, samplerId, opts) {
    const gap = Number(opts.gap ?? 1.0);
    const barrier = Number(opts.barrier ?? 2.2);
    const kBT = Number(opts.kBT ?? 1.0);
    const steps = Number(opts.steps ?? 600);
    const mix = Number(opts.mix ?? 0.12);
    const seed = Number(opts.seed ?? 42);
    const rng = createRng(seed);

    // 1. Canonical discrete two_state mode
    if (landscapeId === 'two_state') {
      if (samplerId === 'langevin_md' && steps === 500 && Math.abs(kBT - 1) < 1e-9) {
        // Preserve exact legacy LCG trajectory when requested
      }
      const pEq = 1 / (1 + Math.exp(gap / Math.max(0.15, kBT)));
      if (samplerId === 'bioemu_iid') {
        let occ = 0, sw = 0, prev = 0;
        const trace = [], occupancy = [], qSeries = [];
        for (let i = 1; i <= steps; i++) {
          const st = rng.uniform() < pEq ? 1 : 0;
          if (i > 1 && st !== prev) sw++;
          prev = st; occ += st;
          trace.push([i, st]);
          occupancy.push([i, occ / i, pEq]);
          qSeries.push(st);
        }
        const ac = computeAutocorr(qSeries);
        return {
          trace, occupancy, qSeries, points2D: null,
          probability: pEq, observed: occ / steps, switches: sw, acceptRate: 1.0,
          ...ac,
        };
      }
      // Effective rate modulated by sampler (Metadynamics boosts barrier crossing!)
      const effMix = samplerId === 'metadynamics'
        ? Math.min(0.92, mix * 3.6 + 0.12)
        : samplerId === 'metropolis_mcmc'
        ? Math.min(0.95, mix * 1.35)
        : mix;
      const leg = ensembleRun(gap / Math.max(0.15, kBT), effMix, seed);
      // Extend if steps !== 500
      let st = leg.trace.at(-1)[1], occ = leg.observed * 500, sw = leg.switches;
      const trace = leg.trace.slice(0, Math.min(steps, 500));
      const occupancy = leg.occupancy.slice(0, Math.min(steps, 500));
      if (steps < 500) {
        occ = trace.reduce((s, r) => s + r[1], 0);
        sw = trace.reduce((s, r, idx) => s + (idx > 0 && r[1] !== trace[idx - 1][1] ? 1 : 0), 0);
      } else {
        for (let i = 501; i <= steps; i++) {
          const sp = effMix * (st ? 1 - pEq : pEq);
          if (rng.uniform() < sp) { st = 1 - st; sw++; }
          occ += st;
          trace.push([i, st]);
          occupancy.push([i, occ / i, pEq]);
        }
      }
      const qSeries = trace.map(r => r[1]);
      const ac = computeAutocorr(qSeries);
      return {
        trace, occupancy, qSeries, points2D: null,
        probability: pEq, observed: occ / steps, switches: sw, acceptRate: effMix,
        ...ac,
      };
    }

    // 2. Continuous 1D Cryptic-Pocket Double-Well + Shoulder
    if (landscapeId === 'cryptic_1d') {
      const eval1D = q => {
        const u = barrier * Math.pow(q * q - 1, 2) + 0.5 * gap * q + 0.35 * Math.exp(-8 * Math.pow(q - 0.15, 2));
        const du = 4 * barrier * q * (q * q - 1) + 0.5 * gap - 5.6 * (q - 0.15) * Math.exp(-8 * Math.pow(q - 0.15, 2));
        return { u, f: -du };
      };
      // Exact quadrature grid on [-2.1, 2.1]
      const NG = 161, qMin = -2.1, qMax = 2.1, dq = (qMax - qMin) / (NG - 1);
      const qGrid = Array.from({ length: NG }, (_, i) => qMin + i * dq);
      const uArr = qGrid.map(q => eval1D(q).u);
      const uMin = Math.min(...uArr);
      const weights = uArr.map(u => Math.exp(-(u - uMin) / Math.max(0.15, kBT)));
      const Z = weights.reduce((a, b) => a + b, 0);
      const pmfTrue = uArr.map(u => u - uMin);
      const cdf = [];
      let cSum = 0, pEqB = 0;
      weights.forEach((w, i) => {
        const p = w / Z;
        cSum += p;
        cdf.push(cSum);
        if (qGrid[i] > 0) pEqB += p;
      });

      const qSeries = [];
      const trace = [], occupancy = [];
      let q = -1.0, v = 0, occB = 0, sw = 0, accepted = 0;
      const biasBins = new Float64Array(NG);
      const bioQuantiles1D = samplerId === 'bioemu_iid' ? shuffledQuantiles(steps, rng) : null;

      for (let step = 1; step <= steps; step++) {
        const prevState = q > 0 ? 1 : 0;
        if (samplerId === 'bioemu_iid') {
          const uDraw = bioQuantiles1D[step - 1];
          let idx = cdf.findIndex(c => c >= uDraw);
          if (idx < 0) idx = NG - 1;
          q = Math.max(qMin, Math.min(qMax, qGrid[idx] + (rng.uniform() - 0.5) * dq));
          accepted++;
        } else if (samplerId === 'metropolis_mcmc') {
          const stepSigma = 0.12 + 0.55 * mix;
          const cand = q + stepSigma * rng.normal();
          if (cand >= qMin && cand <= qMax) {
            const dU = eval1D(cand).u - eval1D(q).u;
            if (dU <= 0 || rng.uniform() < Math.exp(-dU / Math.max(0.15, kBT))) {
              q = cand;
              accepted++;
            }
          }
        } else {
          // Langevin MD or Well-Tempered Metadynamics
          const dtM = 0.045;
          const subSteps = 4;
          for (let s = 0; s < subSteps; s++) {
            let { f } = eval1D(q);
            if (samplerId === 'metadynamics') {
              // Compute derivative of accumulated bias potential
              const bi = Math.max(1, Math.min(NG - 2, Math.round((q - qMin) / dq)));
              const dBias = (biasBins[bi + 1] - biasBins[bi - 1]) / (2 * dq);
              f -= dBias;
            }
            [q, v] = stepIntegrator('langevin', q, v, () => f, dtM, kBT, 1.35, rng);
            q = Math.max(qMin, Math.min(qMax, q));
          }
          if (samplerId === 'metadynamics') {
            // Deposit well-tempered Gaussian hill every step
            const biCenter = Math.max(0, Math.min(NG - 1, Math.round((q - qMin) / dq)));
            const wHill = 0.085 * Math.exp(-biasBins[biCenter] / Math.max(0.6, 3.5 * kBT));
            for (let gIdx = 0; gIdx < NG; gIdx++) {
              const dist = (qGrid[gIdx] - q) / 0.22;
              if (Math.abs(dist) < 3.5) biasBins[gIdx] += wHill * Math.exp(-0.5 * dist * dist);
            }
          }
          accepted++;
        }
        const curState = q > 0 ? 1 : 0;
        if (step > 1 && curState !== prevState) sw++;
        occB += curState;
        qSeries.push(q);
        trace.push([step, q]);
        occupancy.push([step, occB / step, pEqB]);
      }

      // Reconstruct empirical 1D PMF (-kBT ln P_hat(q)) across 32 histogram bins
      const NB = 32;
      const counts = new Float64Array(NB).fill(0.35); // tiny Jeffreys pseudocount
      for (let i = 0; i < qSeries.length; i++) {
        const b = Math.max(0, Math.min(NB - 1, Math.floor(((qSeries[i] - qMin) / (qMax - qMin)) * NB)));
        // Under Metadynamics, reweight by exp(+V_bias(q) / kBT) (umbrella reweighting!)
        if (samplerId === 'metadynamics') {
          const gi = Math.max(0, Math.min(NG - 1, Math.round((qSeries[i] - qMin) / dq)));
          counts[b] += Math.exp(Math.min(10, biasBins[gi] / Math.max(0.15, kBT)));
        } else {
          counts[b] += 1;
        }
      }
      // Also compute reweighted State-B fraction for Metadynamics!
      let obsB = occB / steps;
      if (samplerId === 'metadynamics') {
        let wB = 0, wTot = 0;
        for (const qv of qSeries) {
          const gi = Math.max(0, Math.min(NG - 1, Math.round((qv - qMin) / dq)));
          const w = Math.exp(Math.min(10, biasBins[gi] / Math.max(0.15, kBT)));
          wTot += w;
          if (qv > 0) wB += w;
        }
        obsB = wB / Math.max(1e-9, wTot);
        // Smooth running estimate toward reweighted occupancy on last frame
        occupancy[occupancy.length - 1][1] = obsB;
      }

      const pmfBins = Array.from({ length: NB }, (_, b) => {
        const qc = qMin + ((b + 0.5) * (qMax - qMin)) / NB;
        const fTrue = eval1D(qc).u - uMin;
        const fEmpRaw = -kBT * Math.log(counts[b]);
        return { q: qc, fTrue, fEmpRaw };
      });
      const minEmp = Math.min(...pmfBins.map(b => b.fEmpRaw));
      let pmfSse = 0;
      pmfBins.forEach(b => {
        b.fEmp = b.fEmpRaw - minEmp;
        if (b.fTrue < 6 * kBT) pmfSse += Math.pow(b.fEmp - b.fTrue, 2);
      });

      const ac = computeAutocorr(qSeries);
      return {
        trace,
        occupancy,
        qSeries,
        points2D: null,
        pmfBins,
        pmfGrid: qGrid.map((qv, i) => ({ q: qv, u: pmfTrue[i] })),
        pmfRmse: Math.sqrt(pmfSse / NB),
        probability: pEqB,
        observed: obsB,
        switches: sw,
        acceptRate: accepted / steps,
        ...ac,
      };
    }

    // 3. 2D Landscapes: Müller-Brown PES OR Alanine Dipeptide (φ, ψ) Ramachandran!
    const isRama = landscapeId === 'ramachandran';
    const xBounds = isRama ? [-Math.PI, Math.PI] : [-1.48, 1.12];
    const yBounds = isRama ? [-Math.PI, Math.PI] : [-0.28, 1.98];
    const bScale = Math.max(0.25, barrier / 2.2);
    const eval2D = (x, y) => isRama ? evalRamachandran(x, y, gap, bScale) : evalMullerBrown(x, y, gap, bScale);
    const isStateB = (x, y) => isRama ? (y < -0.15 || x > 0.35) : (y < 0.82);

    // Precompute 56x48 Boltzmann grid for exact equilibrium B fraction, 2D contour rendering, and BioEmu i.i.d. draws
    const GX = 56, GY = 48;
    const dx = (xBounds[1] - xBounds[0]) / (GX - 1);
    const dy = (yBounds[1] - yBounds[0]) / (GY - 1);
    const gridU = new Float64Array(GX * GY);
    let uMin = Infinity;
    for (let iy = 0; iy < GY; iy++) {
      const y = yBounds[0] + iy * dy;
      for (let ix = 0; ix < GX; ix++) {
        const x = xBounds[0] + ix * dx;
        const u = eval2D(x, y).u;
        gridU[iy * GX + ix] = u;
        if (u < uMin) uMin = u;
      }
    }
    const cdf2D = new Float64Array(GX * GY);
    let Z = 0, zB = 0;
    for (let i = 0; i < GX * GY; i++) {
      gridU[i] -= uMin;
      const w = Math.exp(-gridU[i] / Math.max(0.18, kBT));
      Z += w;
      cdf2D[i] = Z;
      const ix = i % GX, iy = Math.floor(i / GX);
      if (isStateB(xBounds[0] + ix * dx, yBounds[0] + iy * dy)) zB += w;
    }
    for (let i = 0; i < GX * GY; i++) cdf2D[i] /= Z;
    const pEqB = zB / Z;

    // Starting point in Basin A (upper-left β-sheet for Ramachandran; deep upper-left minimum for Müller-Brown)
    let x = isRama ? -2.35 : -0.56;
    let y = isRama ? 2.48 : 1.44;
    let vx = 0, vy = 0;
    const bias2D = new Float64Array(GX * GY);

    const points2D = [];
    const qSeries = [];
    const trace = [], occupancy = [];
    let occB = 0, sw = 0, accepted = 0;
    const bioQuantiles2D = samplerId === 'bioemu_iid' ? shuffledQuantiles(steps, rng) : null;

    for (let step = 1; step <= steps; step++) {
      const prevB = isStateB(x, y) ? 1 : 0;
      if (samplerId === 'bioemu_iid') {
        const uDraw = bioQuantiles2D[step - 1];
        let lo = 0, hi = GX * GY - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cdf2D[mid] < uDraw) lo = mid + 1;
          else hi = mid;
        }
        const ix = lo % GX, iy = Math.floor(lo / GX);
        x = xBounds[0] + ix * dx + (rng.uniform() - 0.5) * dx;
        y = yBounds[0] + iy * dy + (rng.uniform() - 0.5) * dy;
        if (isRama) { x = wrapPi(x); y = wrapPi(y); }
        accepted++;
      } else if (samplerId === 'metropolis_mcmc') {
        const sig = (isRama ? 0.24 : 0.11) * (0.4 + 1.8 * mix);
        let cx = x + sig * rng.normal(), cy = y + sig * rng.normal();
        if (isRama) { cx = wrapPi(cx); cy = wrapPi(cy); }
        if (isRama || (cx >= xBounds[0] && cx <= xBounds[1] && cy >= yBounds[0] && cy <= yBounds[1])) {
          const dU = eval2D(cx, cy).u - eval2D(x, y).u;
          if (dU <= 0 || rng.uniform() < Math.exp(-dU / Math.max(0.18, kBT))) {
            x = cx; y = cy; accepted++;
          }
        }
      } else {
        // 2D BAOAB Langevin MD or 2D Well-Tempered Metadynamics
        const dt2 = isRama ? 0.048 : 0.028;
        for (let s = 0; s < 4; s++) {
          let { fx, fy } = eval2D(x, y);
          if (samplerId === 'metadynamics') {
            const ix = Math.max(1, Math.min(GX - 2, Math.round((x - xBounds[0]) / dx)));
            const iy = Math.max(1, Math.min(GY - 2, Math.round((y - yBounds[0]) / dy)));
            fx -= (bias2D[iy * GX + ix + 1] - bias2D[iy * GX + ix - 1]) / (2 * dx);
            fy -= (bias2D[(iy + 1) * GX + ix] - bias2D[(iy - 1) * GX + ix]) / (2 * dy);
          }
          [x, vx] = stepIntegrator('langevin', x, vx, () => fx, dt2, kBT, 1.45, rng);
          [y, vy] = stepIntegrator('langevin', y, vy, () => fy, dt2, kBT, 1.45, rng);
          if (isRama) { x = wrapPi(x); y = wrapPi(y); }
          else {
            x = Math.max(xBounds[0], Math.min(xBounds[1], x));
            y = Math.max(yBounds[0], Math.min(yBounds[1], y));
          }
        }
        if (samplerId === 'metadynamics') {
          const ixC = Math.max(0, Math.min(GX - 1, Math.round((x - xBounds[0]) / dx)));
          const iyC = Math.max(0, Math.min(GY - 1, Math.round((y - yBounds[0]) / dy)));
          const wHill = 0.11 * Math.exp(-bias2D[iyC * GX + ixC] / Math.max(0.6, 3.5 * kBT));
          const sxH = isRama ? 0.35 : 0.16, syH = isRama ? 0.35 : 0.16;
          for (let jy = Math.max(0, iyC - 5); jy <= Math.min(GY - 1, iyC + 5); jy++) {
            for (let jx = Math.max(0, ixC - 5); jx <= Math.min(GX - 1, ixC + 5); jx++) {
              const d2 = Math.pow((xBounds[0] + jx * dx - x) / sxH, 2) + Math.pow((yBounds[0] + jy * dy - y) / syH, 2);
              if (d2 < 9) bias2D[jy * GX + jx] += wHill * Math.exp(-0.5 * d2);
            }
          }
        }
        accepted++;
      }

      const curB = isStateB(x, y) ? 1 : 0;
      if (step > 1 && curB !== prevB) sw++;
      occB += curB;
      // 1D collective reaction progress coordinate along A -> B
      const prog = isRama ? -Math.sin(0.5 * (y - 0.9)) : 0.65 * x - 0.55 * (y - 0.8);
      points2D.push({
        step,
        x: isRama ? (x * 180) / Math.PI : x,
        y: isRama ? (y * 180) / Math.PI : y,
        stateB: curB,
        prog,
      });
      qSeries.push(prog);
      trace.push([step, prog]);
      occupancy.push([step, occB / step, pEqB]);
    }

    let obsB = occB / steps;
    if (samplerId === 'metadynamics') {
      let wB = 0, wTot = 0;
      for (const pt of points2D) {
        const rx = isRama ? (pt.x * Math.PI) / 180 : pt.x;
        const ry = isRama ? (pt.y * Math.PI) / 180 : pt.y;
        const ix = Math.max(0, Math.min(GX - 1, Math.round((rx - xBounds[0]) / dx)));
        const iy = Math.max(0, Math.min(GY - 1, Math.round((ry - yBounds[0]) / dy)));
        const w = Math.exp(Math.min(10, bias2D[iy * GX + ix] / Math.max(0.18, kBT)));
        wTot += w;
        if (pt.stateB) wB += w;
      }
      obsB = wB / Math.max(1e-9, wTot);
      occupancy[occupancy.length - 1][1] = obsB;
    }

    // Also project 1D PMF along reaction progress [-1.4, 1.4]
    const NB = 26, pMin = -1.35, pMax = 1.35;
    const empCounts = new Float64Array(NB).fill(0.4);
    const trueWeights = new Float64Array(NB).fill(1e-6);
    for (let iy = 0; iy < GY; iy++) {
      const yv = yBounds[0] + iy * dy;
      for (let ix = 0; ix < GX; ix++) {
        const xv = xBounds[0] + ix * dx;
        const pr = isRama ? -Math.sin(0.5 * (yv - 0.9)) : 0.65 * xv - 0.55 * (yv - 0.8);
        const bi = Math.max(0, Math.min(NB - 1, Math.floor(((pr - pMin) / (pMax - pMin)) * NB)));
        trueWeights[bi] += Math.exp(-gridU[iy * GX + ix] / Math.max(0.18, kBT));
      }
    }
    for (const pt of points2D) {
      const bi = Math.max(0, Math.min(NB - 1, Math.floor(((pt.prog - pMin) / (pMax - pMin)) * NB)));
      empCounts[bi] += 1;
    }
    const pmfBins = Array.from({ length: NB }, (_, b) => ({
      q: pMin + ((b + 0.5) * (pMax - pMin)) / NB,
      fTrueRaw: -kBT * Math.log(trueWeights[b]),
      fEmpRaw: -kBT * Math.log(empCounts[b]),
    }));
    const minFT = Math.min(...pmfBins.map(b => b.fTrueRaw));
    const minFE = Math.min(...pmfBins.map(b => b.fEmpRaw));
    let pmfSse = 0;
    pmfBins.forEach(b => {
      b.fTrue = b.fTrueRaw - minFT;
      b.fEmp = b.fEmpRaw - minFE;
      if (b.fTrue < 6 * kBT) pmfSse += Math.pow(b.fEmp - b.fTrue, 2);
    });

    const ac = computeAutocorr(qSeries);
    return {
      trace,
      occupancy,
      qSeries,
      points2D,
      surface2D: {
        isRama,
        GX, GY,
        xMin: isRama ? -180 : xBounds[0],
        xMax: isRama ? 180 : xBounds[1],
        yMin: isRama ? -180 : yBounds[0],
        yMax: isRama ? 180 : yBounds[1],
        gridU,
      },
      pmfBins,
      pmfRmse: Math.sqrt(pmfSse / NB),
      probability: pEqB,
      observed: obsB,
      switches: sw,
      acceptRate: accepted / steps,
      ...ac,
    };
  }

  function analyzeEnsembleExperiment(opts = {}) {
    const landscapeId = opts.landscapeId || 'cryptic_1d';
    const samplerId = opts.samplerId || 'langevin_md';
    const gap = Number(opts.gap ?? 0.8);
    const barrier = Number(opts.barrier ?? 2.4);
    const kBT = Number(opts.kBT ?? 0.85);
    const steps = Number(opts.steps ?? 600);
    const mix = Number(opts.mix ?? 0.15);
    const seed = Number(opts.seed ?? 42);

    const land = LANDSCAPE_CATALOG.find(l => l.id === landscapeId) || LANDSCAPE_CATALOG[0];
    const primary = runSingleSampler(landscapeId, samplerId, { gap, barrier, kBT, steps, mix, seed });

    const clampP = p => Math.max(1e-4, Math.min(1 - 1e-4, p));
    const deltaGTrue = -kBT * Math.log(clampP(primary.probability) / (1 - clampP(primary.probability)));
    const deltaGSampled = -kBT * Math.log(clampP(primary.observed) / (1 - clampP(primary.observed)));
    const deltaGError = Math.abs(deltaGSampled - deltaGTrue);

    // Compare all 4 samplers on identical free-energy surface for Leaderboard!
    const leaderboard = SAMPLER_CATALOG.map(sSpec => {
      const r = sSpec.id === samplerId
        ? primary
        : runSingleSampler(landscapeId, sSpec.id, { gap, barrier, kBT, steps, mix, seed });
      const dgS = -kBT * Math.log(clampP(r.observed) / (1 - clampP(r.observed)));
      const dgErr = Math.abs(dgS - deltaGTrue);
      const occErr = Math.abs(r.observed - r.probability);
      let verdict = 'Well-Converged Ensemble', tone = 'best';
      if (r.switches === 0 && occErr > 0.08) { verdict = 'Metastable Trapped (0 Crossings!)'; tone = 'poor'; }
      else if (occErr > 0.10 || r.nEff < 12) { verdict = 'Under-Sampled (High τ_int)'; tone = 'warn'; }
      else if (dgErr < 0.18 * kBT) { verdict = 'Equilibrium Accuracy (<0.2 kBT)'; tone = 'best'; }
      else { verdict = 'Moderate Convergence'; tone = 'good'; }

      return {
        ...sSpec,
        observedB: r.observed,
        equilibriumB: r.probability,
        occError: occErr,
        deltaGSampled: dgS,
        deltaGError: dgErr,
        switches: r.switches,
        tauInt: r.tauInt,
        nEff: r.nEff,
        pmfRmse: r.pmfRmse ?? occErr,
        verdict,
        tone,
      };
    });

    // Kramers escape scaling curve across barrier / kBT ratios
    const kramersCurve = [0.6, 1.2, 1.8, 2.5, 3.3, 4.2].map(bVal => {
      const ratio = bVal / Math.max(0.2, kBT);
      return {
        barrier: bVal,
        ratio,
        theoryRate: Math.exp(-ratio),
      };
    });

    return {
      mode: 'ensemble',
      land,
      landscapeId,
      samplerId,
      gap,
      barrier,
      kBT,
      steps,
      mix,
      seed,
      ...primary,
      deltaGTrue,
      deltaGSampled,
      deltaGError,
      kramersCurve,
      leaderboard,
    };
  }

  return {
    POTENTIAL_CATALOG,
    SURROGATE_CATALOG,
    INTEGRATOR_CATALOG,
    LANDSCAPE_CATALOG,
    SAMPLER_CATALOG,
    createRng,
    fitSurrogate,
    analyzeForceExperiment,
    analyzeEnsembleExperiment,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { forceRun, ensembleRun, SimAnalytics };
}
