'use strict';

/**
 * Assay Evidence Studio — Quantitative Enzyme Kinetics & OOD Benchmark Engine
 *
 * Implements exact profile nonlinear least squares for 6 mechanistic hypotheses:
 *   1. shared        (k=2): Shared Vmax and Km across conditions
 *   2. split_vmax    (k=3): Condition-specific Vmax, shared Km
 *   3. split_km      (k=3): Shared Vmax, condition-specific Km
 *   4. split_both    (k=4): Condition-specific Vmax and Km
 *   5. hill_both     (k=6): Condition-specific cooperative Hill kinetics (Vmax, K0.5, n)
 *   6. haldane_both  (k=6): Haldane uncompetitive substrate inhibition (Vmax, Km, Ki)
 *
 * Plus molML-inspired Out-of-Distribution (OOD) vs In-Domain regime decomposition,
 * AICc / BIC / Akaike weights, Lin's Concordance Correlation Coefficient (CCC),
 * pure replicate noise floor (s_pure), exact F-test 95% confidence contours,
 * Jacobian predictive uncertainty bands, and Fisher-information active learning curves.
 */
const KineticsAnalytics = (() => {
  const MODEL_CATALOG = [
    {
      id: 'shared',
      k: 2,
      short: 'Shared Vmax & Km',
      name: 'Shared Vmax and Km (Null)',
      equation: 'v = Vmax · [S] / (Km + [S])',
      hypothesis: 'Treatment alters neither catalytic capacity (Vmax) nor apparent affinity (Km).',
    },
    {
      id: 'split_vmax',
      k: 3,
      short: 'Condition Vmax',
      name: 'Condition-specific Vmax, shared Km',
      equation: 'v_g = Vmax,g · [S] / (Km + [S])',
      hypothesis: 'Treatment scales active enzyme capacity / turnover (Vmax) while preserving half-saturation (Km).',
    },
    {
      id: 'split_km',
      k: 3,
      short: 'Condition Km',
      name: 'Shared Vmax, condition-specific Km',
      equation: 'v_g = Vmax · [S] / (Km,g + [S])',
      hypothesis: 'Treatment shifts apparent substrate half-saturation (Km, competitive-like) with a common ceiling (Vmax).',
    },
    {
      id: 'split_both',
      k: 4,
      short: 'Condition Vmax & Km',
      name: 'Condition-specific Vmax and Km',
      equation: 'v_g = Vmax,g · [S] / (Km,g + [S])',
      hypothesis: 'Each preparation follows an independent hyperbolic saturation curve (separate Vmax and Km).',
    },
    {
      id: 'hill_both',
      k: 6,
      short: 'Cooperative Hill (n)',
      name: 'Condition-specific Cooperative Hill (Vmax, K0.5, n)',
      equation: 'v_g = Vmax,g · [S]^n_g / (K0.5,g^n_g + [S]^n_g)',
      hypothesis: 'Tests allosteric multisite cooperativity (n > 1 sigmoidal, n < 1 negative cooperativity) per condition.',
    },
    {
      id: 'haldane_both',
      k: 6,
      short: 'Substrate Inhib (Ki)',
      name: 'Haldane Substrate Inhibition (Vmax, Km, Ki)',
      equation: 'v_g = Vmax,g · [S] / (Km,g + [S] + [S]² / Ki,g)',
      hypothesis: 'Tests high-dose uncompetitive substrate inhibition (dead-end ESS complex; velocity peaks at [S]opt = √(Km·Ki)).',
    },
  ];

  // Approximate 95th percentile of F(df1, df2) for confidence contours & bands
  function fCrit95(df1, df2) {
    const nu = Math.max(1, df2);
    if (df1 === 1) {
      // t_{0.975, nu}^2 Cornish-Fisher accurate to <0.3% for nu >= 3
      const z = 1.959964;
      const t = z + (z ** 3 + z) / (4 * nu) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * nu * nu);
      return t * t;
    }
    // df1 === 2 exact closed-form quantile! F_{p; 2, nu} = (nu / 2) * ((1 - p)^(-2 / nu) - 1)
    if (df1 === 2) {
      return (nu / 2) * (Math.pow(0.05, -2 / nu) - 1);
    }
    // General Wilson-Hilferty approximation
    const z = 1.644854;
    const a = 2 / (9 * df1), b = 2 / (9 * nu);
    const num = 1 - b + z * Math.sqrt(b);
    const den = 1 - a - z * Math.sqrt(a);
    return Math.pow(num / Math.max(0.1, den), 3);
  }

  // Exact profile least-squares for single Michaelis-Menten curve: v = Vmax * S / (Km + S)
  function fitSingleMM(rows) {
    const concs = rows.map(r => r.conc);
    let lo = Math.log(Math.min(...concs)) - 9.21;
    let hi = Math.log(Math.max(...concs)) + 9.21;
    const limits = [lo, hi];

    function evalAt(logK) {
      const km = Math.exp(logK);
      let num = 0, den = 0;
      for (let i = 0; i < rows.length; i++) {
        const f = rows[i].conc / (rows[i].conc + km);
        num += f * rows[i].rate;
        den += f * f;
      }
      const vmax = Math.max(1e-12, num / Math.max(1e-24, den));
      let sse = 0;
      for (let i = 0; i < rows.length; i++) {
        const f = rows[i].conc / (rows[i].conc + km);
        const err = rows[i].rate - vmax * f;
        sse += err * err;
      }
      return { vmax, km, n: 1, sse };
    }

    const NGRID = 72;
    let bestIdx = 0, bestSse = Infinity;
    const grid = new Float64Array(NGRID + 1);
    for (let i = 0; i <= NGRID; i++) {
      grid[i] = lo + ((hi - lo) * i) / NGRID;
      const s = evalAt(grid[i]).sse;
      if (s < bestSse) { bestSse = s; bestIdx = i; }
    }
    lo = grid[Math.max(0, bestIdx - 1)];
    hi = grid[Math.min(NGRID, bestIdx + 1)];
    const invPhi = (Math.sqrt(5) - 1) / 2;
    let c = hi - invPhi * (hi - lo);
    let d = lo + invPhi * (hi - lo);
    let fc = evalAt(c).sse, fd = evalAt(d).sse;
    for (let iter = 0; iter < 52; iter++) {
      if (fc < fd) {
        hi = d; d = c; fd = fc;
        c = hi - invPhi * (hi - lo);
        fc = evalAt(c).sse;
      } else {
        lo = c; c = d; fc = fd;
        d = lo + invPhi * (hi - lo);
        fd = evalAt(d).sse;
      }
    }
    const mid = 0.5 * (lo + hi);
    const out = evalAt(mid);
    out.boundary = Math.min(mid - limits[0], limits[1] - mid) < 0.01;
    return out;
  }

  // Exact profile least-squares for split_vmax: shared Km, separate Vmax_u and Vmax_t
  function fitSplitVmax(rows) {
    const untreated = rows.filter(r => r.state === 'untreated');
    const treated = rows.filter(r => r.state === 'treated');
    const concs = rows.map(r => r.conc);
    let lo = Math.log(Math.min(...concs)) - 9.21;
    let hi = Math.log(Math.max(...concs)) + 9.21;

    function evalAt(logK) {
      const km = Math.exp(logK);
      const solveVmax = subset => {
        let num = 0, den = 0;
        for (let i = 0; i < subset.length; i++) {
          const f = subset[i].conc / (subset[i].conc + km);
          num += f * subset[i].rate;
          den += f * f;
        }
        const vmax = Math.max(1e-12, num / Math.max(1e-24, den));
        let sse = 0;
        for (let i = 0; i < subset.length; i++) {
          const f = subset[i].conc / (subset[i].conc + km);
          sse += (subset[i].rate - vmax * f) ** 2;
        }
        return { vmax, sse };
      };
      const u = solveVmax(untreated);
      const t = solveVmax(treated);
      return { vmaxU: u.vmax, vmaxT: t.vmax, km, sse: u.sse + t.sse };
    }

    const NGRID = 72;
    let bestIdx = 0, bestSse = Infinity;
    const grid = new Float64Array(NGRID + 1);
    for (let i = 0; i <= NGRID; i++) {
      grid[i] = lo + ((hi - lo) * i) / NGRID;
      const s = evalAt(grid[i]).sse;
      if (s < bestSse) { bestSse = s; bestIdx = i; }
    }
    lo = grid[Math.max(0, bestIdx - 1)];
    hi = grid[Math.min(NGRID, bestIdx + 1)];
    const invPhi = (Math.sqrt(5) - 1) / 2;
    let c = hi - invPhi * (hi - lo), d = lo + invPhi * (hi - lo);
    let fc = evalAt(c).sse, fd = evalAt(d).sse;
    for (let iter = 0; iter < 52; iter++) {
      if (fc < fd) { hi = d; d = c; fd = fc; c = hi - invPhi * (hi - lo); fc = evalAt(c).sse; }
      else { lo = c; c = d; fc = fd; d = lo + invPhi * (hi - lo); fd = evalAt(d).sse; }
    }
    return evalAt(0.5 * (lo + hi));
  }

  // Exact profile least-squares for split_km: shared Vmax, separate Km_u and Km_t
  function fitSplitKm(rows) {
    const concs = rows.map(r => r.conc);
    const minL = Math.log(Math.min(...concs)) - 6.5;
    const maxL = Math.log(Math.max(...concs)) + 6.5;

    function evalAt(logKu, logKt) {
      const kmu = Math.exp(Math.max(minL, Math.min(maxL, logKu)));
      const kmt = Math.exp(Math.max(minL, Math.min(maxL, logKt)));
      let num = 0, den = 0;
      for (let i = 0; i < rows.length; i++) {
        const km = rows[i].state === 'treated' ? kmt : kmu;
        const f = rows[i].conc / (rows[i].conc + km);
        num += f * rows[i].rate;
        den += f * f;
      }
      const vmax = Math.max(1e-12, num / Math.max(1e-24, den));
      let sse = 0;
      for (let i = 0; i < rows.length; i++) {
        const km = rows[i].state === 'treated' ? kmt : kmu;
        const f = rows[i].conc / (rows[i].conc + km);
        sse += (rows[i].rate - vmax * f) ** 2;
      }
      return { vmax, kmu, kmt, sse };
    }

    // Coarse 2D grid bracket + Nelder-Mead simplex polish
    const G = 26;
    let bestU = 0, bestT = 0, bestSse = Infinity;
    for (let iu = 0; iu <= G; iu++) {
      const lu = minL + ((maxL - minL) * iu) / G;
      for (let it = 0; it <= G; it++) {
        const lt = minL + ((maxL - minL) * it) / G;
        const s = evalAt(lu, lt).sse;
        if (s < bestSse) { bestSse = s; bestU = lu; bestT = lt; }
      }
    }
    const step = (maxL - minL) / G;
    let simplex = [
      [bestU, bestT],
      [bestU + step * 0.7, bestT],
      [bestU, bestT + step * 0.7],
    ].map(p => ({ p, f: evalAt(p[0], p[1]).sse }));

    for (let iter = 0; iter < 95; iter++) {
      simplex.sort((a, b) => a.f - b.f);
      if (Math.hypot(simplex[2].p[0] - simplex[0].p[0], simplex[2].p[1] - simplex[0].p[1]) < 1e-9) break;
      const mx = 0.5 * (simplex[0].p[0] + simplex[1].p[0]);
      const my = 0.5 * (simplex[0].p[1] + simplex[1].p[1]);
      const rx = 2 * mx - simplex[2].p[0], ry = 2 * my - simplex[2].p[1];
      const fr = evalAt(rx, ry).sse;
      if (fr < simplex[0].f) {
        const ex = 3 * mx - 2 * simplex[2].p[0], ey = 3 * my - 2 * simplex[2].p[1];
        const fe = evalAt(ex, ey).sse;
        simplex[2] = fe < fr ? { p: [ex, ey], f: fe } : { p: [rx, ry], f: fr };
      } else if (fr < simplex[1].f) {
        simplex[2] = { p: [rx, ry], f: fr };
      } else {
        const cx = 0.5 * (mx + simplex[2].p[0]), cy = 0.5 * (my + simplex[2].p[1]);
        const fc = evalAt(cx, cy).sse;
        if (fc < simplex[2].f) {
          simplex[2] = { p: [cx, cy], f: fc };
        } else {
          for (let j = 1; j <= 2; j++) {
            const sx = 0.5 * (simplex[0].p[0] + simplex[j].p[0]);
            const sy = 0.5 * (simplex[0].p[1] + simplex[j].p[1]);
            simplex[j] = { p: [sx, sy], f: evalAt(sx, sy).sse };
          }
        }
      }
    }
    simplex.sort((a, b) => a.f - b.f);
    return evalAt(simplex[0].p[0], simplex[0].p[1]);
  }

  // Cooperative Hill curve fit for a single state: v = Vmax * S^n / (K0.5^n + S^n)
  function fitSingleHill(rows) {
    const concs = rows.map(r => r.conc);
    const minL = Math.log(Math.min(...concs)) - 4.5;
    const maxL = Math.log(Math.max(...concs)) + 4.5;
    const minN = 0.35, maxN = 4.0;

    function evalAt(logK, hillN) {
      const k = Math.exp(Math.max(minL, Math.min(maxL, logK)));
      const n = Math.max(minN, Math.min(maxN, hillN));
      const kn = Math.pow(k, n);
      let num = 0, den = 0;
      for (let i = 0; i < rows.length; i++) {
        const sn = Math.pow(rows[i].conc, n);
        const f = sn / (kn + sn);
        num += f * rows[i].rate;
        den += f * f;
      }
      const vmax = Math.max(1e-12, num / Math.max(1e-24, den));
      let sse = 0;
      for (let i = 0; i < rows.length; i++) {
        const sn = Math.pow(rows[i].conc, n);
        const f = sn / (kn + sn);
        sse += (rows[i].rate - vmax * f) ** 2;
      }
      return { vmax, km: k, n, sse };
    }

    const GK = 22, GN = 20;
    let bestK = 0, bestN = 1, bestSse = Infinity;
    for (let ik = 0; ik <= GK; ik++) {
      const lk = minL + ((maxL - minL) * ik) / GK;
      for (let inIdx = 0; inIdx <= GN; inIdx++) {
        const hn = minN + ((maxN - minN) * inIdx) / GN;
        const s = evalAt(lk, hn).sse;
        if (s < bestSse) { bestSse = s; bestK = lk; bestN = hn; }
      }
    }
    let simplex = [
      [bestK, bestN],
      [bestK + (maxL - minL) / GK * 0.7, bestN],
      [bestK, bestN + 0.14],
    ].map(p => ({ p, f: evalAt(p[0], p[1]).sse }));

    for (let iter = 0; iter < 85; iter++) {
      simplex.sort((a, b) => a.f - b.f);
      if (Math.hypot(simplex[2].p[0] - simplex[0].p[0], simplex[2].p[1] - simplex[0].p[1]) < 1e-8) break;
      const mx = 0.5 * (simplex[0].p[0] + simplex[1].p[0]);
      const my = 0.5 * (simplex[0].p[1] + simplex[1].p[1]);
      const rx = 2 * mx - simplex[2].p[0], ry = 2 * my - simplex[2].p[1];
      const fr = evalAt(rx, ry).sse;
      if (fr < simplex[0].f) {
        const ex = 3 * mx - 2 * simplex[2].p[0], ey = 3 * my - 2 * simplex[2].p[1];
        const fe = evalAt(ex, ey).sse;
        simplex[2] = fe < fr ? { p: [ex, ey], f: fe } : { p: [rx, ry], f: fr };
      } else if (fr < simplex[1].f) {
        simplex[2] = { p: [rx, ry], f: fr };
      } else {
        const cx = 0.5 * (mx + simplex[2].p[0]), cy = 0.5 * (my + simplex[2].p[1]);
        const fc = evalAt(cx, cy).sse;
        if (fc < simplex[2].f) simplex[2] = { p: [cx, cy], f: fc };
        else {
          for (let j = 1; j <= 2; j++) {
            const sx = 0.5 * (simplex[0].p[0] + simplex[j].p[0]);
            const sy = 0.5 * (simplex[0].p[1] + simplex[j].p[1]);
            simplex[j] = { p: [sx, sy], f: evalAt(sx, sy).sse };
          }
        }
      }
    }
    simplex.sort((a, b) => a.f - b.f);
    return evalAt(simplex[0].p[0], simplex[0].p[1]);
  }

  // Haldane uncompetitive substrate inhibition for a single state:
  // v = Vmax * S / (Km + S + alpha * S^2), where alpha = 1 / Ki >= 0
  function fitSingleHaldane(rows) {
    const mmBase = fitSingleMM(rows);
    const concs = rows.map(r => r.conc);
    const minS = Math.min(...concs), maxS = Math.max(...concs);
    const minL = Math.log(minS) - 4.5;
    const maxL = Math.log(maxS) + 4.5;
    // alpha = 1 / Ki; explore log(alpha) across [log(1 / (80 * maxS)), log(12 / minS)] plus exact alpha = 0
    const minLA = Math.log(1 / (80 * maxS));
    const maxLA = Math.log(12 / minS);

    function evalAlpha(logK, alphaVal) {
      const km = Math.exp(Math.max(minL, Math.min(maxL, logK)));
      const alpha = Math.max(0, alphaVal);
      let num = 0, den = 0;
      for (let i = 0; i < rows.length; i++) {
        const s = rows[i].conc;
        const f = s / (km + s + alpha * s * s);
        num += f * rows[i].rate;
        den += f * f;
      }
      const vmax = Math.max(1e-12, num / Math.max(1e-24, den));
      let sse = 0;
      for (let i = 0; i < rows.length; i++) {
        const s = rows[i].conc;
        const f = s / (km + s + alpha * s * s);
        sse += (rows[i].rate - vmax * f) ** 2;
      }
      const ki = alpha > 1e-8 ? 1 / alpha : Infinity;
      const sOpt = Number.isFinite(ki) ? Math.sqrt(km * ki) : Infinity;
      return { vmax, km, n: 1, alpha, ki, sOpt, sse };
    }

    let best = { vmax: mmBase.vmax, km: mmBase.km, n: 1, alpha: 0, ki: Infinity, sOpt: Infinity, sse: mmBase.sse };
    let bestLK = Math.log(mmBase.km), bestLA = minLA;

    const GK = 24, GA = 24;
    for (let ik = 0; ik <= GK; ik++) {
      const lk = minL + ((maxL - minL) * ik) / GK;
      for (let ia = 0; ia <= GA; ia++) {
        const la = minLA + ((maxLA - minLA) * ia) / GA;
        const cand = evalAlpha(lk, Math.exp(la));
        if (cand.sse < best.sse - 1e-9) {
          best = cand;
          bestLK = lk;
          bestLA = la;
        }
      }
    }

    if (best.alpha > 0) {
      const evalLog = (lk, la) => evalAlpha(lk, Math.exp(Math.max(minLA - 3, Math.min(maxLA + 2, la))));
      let simplex = [
        [bestLK, bestLA],
        [bestLK + (maxL - minL) / GK * 0.7, bestLA],
        [bestLK, bestLA + (maxLA - minLA) / GA * 0.7],
      ].map(p => ({ p, f: evalLog(p[0], p[1]).sse }));

      for (let iter = 0; iter < 90; iter++) {
        simplex.sort((a, b) => a.f - b.f);
        if (Math.hypot(simplex[2].p[0] - simplex[0].p[0], simplex[2].p[1] - simplex[0].p[1]) < 1e-8) break;
        const mx = 0.5 * (simplex[0].p[0] + simplex[1].p[0]);
        const my = 0.5 * (simplex[0].p[1] + simplex[1].p[1]);
        const rx = 2 * mx - simplex[2].p[0], ry = 2 * my - simplex[2].p[1];
        const fr = evalLog(rx, ry).sse;
        if (fr < simplex[0].f) {
          const ex = 3 * mx - 2 * simplex[2].p[0], ey = 3 * my - 2 * simplex[2].p[1];
          const fe = evalLog(ex, ey).sse;
          simplex[2] = fe < fr ? { p: [ex, ey], f: fe } : { p: [rx, ry], f: fr };
        } else if (fr < simplex[1].f) {
          simplex[2] = { p: [rx, ry], f: fr };
        } else {
          const cx = 0.5 * (mx + simplex[2].p[0]), cy = 0.5 * (my + simplex[2].p[1]);
          const fc = evalLog(cx, cy).sse;
          if (fc < simplex[2].f) simplex[2] = { p: [cx, cy], f: fc };
          else {
            for (let j = 1; j <= 2; j++) {
              const sx = 0.5 * (simplex[0].p[0] + simplex[j].p[0]);
              const sy = 0.5 * (simplex[0].p[1] + simplex[j].p[1]);
              simplex[j] = { p: [sx, sy], f: evalLog(sx, sy).sse };
            }
          }
        }
      }
      simplex.sort((a, b) => a.f - b.f);
      const refined = evalLog(simplex[0].p[0], simplex[0].p[1]);
      // Only retain finite Ki if it meaningfully lowers SSE beyond numerical noise
      if (refined.sse < mmBase.sse - 1e-6 && refined.ki < maxS * 60) {
        return refined;
      }
    }
    return { vmax: mmBase.vmax, km: mmBase.km, n: 1, alpha: 0, ki: Infinity, sOpt: Infinity, sse: mmBase.sse };
  }

  // Fit any of the 6 models on a training array [{ id, conc, rate, state }]
  function fitModel(trainRows, modelId) {
    if (modelId === 'shared') {
      const f = fitSingleMM(trainRows);
      return {
        untreated: { vmax: f.vmax, km: f.km, n: 1, alpha: 0, ki: Infinity },
        treated:   { vmax: f.vmax, km: f.km, n: 1, alpha: 0, ki: Infinity },
        sse: f.sse,
        vector: [f.vmax, f.km],
      };
    }
    if (modelId === 'split_vmax') {
      const f = fitSplitVmax(trainRows);
      return {
        untreated: { vmax: f.vmaxU, km: f.km, n: 1, alpha: 0, ki: Infinity },
        treated:   { vmax: f.vmaxT, km: f.km, n: 1, alpha: 0, ki: Infinity },
        sse: f.sse,
        vector: [f.vmaxU, f.km, f.vmaxT],
      };
    }
    if (modelId === 'split_km') {
      const f = fitSplitKm(trainRows);
      return {
        untreated: { vmax: f.vmax, km: f.kmu, n: 1, alpha: 0, ki: Infinity },
        treated:   { vmax: f.vmax, km: f.kmt, n: 1, alpha: 0, ki: Infinity },
        sse: f.sse,
        vector: [f.vmax, f.kmu, f.kmt],
      };
    }
    if (modelId === 'split_both') {
      const fu = fitSingleMM(trainRows.filter(r => r.state === 'untreated'));
      const ft = fitSingleMM(trainRows.filter(r => r.state === 'treated'));
      return {
        untreated: { vmax: fu.vmax, km: fu.km, n: 1, alpha: 0, ki: Infinity },
        treated:   { vmax: ft.vmax, km: ft.km, n: 1, alpha: 0, ki: Infinity },
        sse: fu.sse + ft.sse,
        vector: [fu.vmax, fu.km, ft.vmax, ft.km],
      };
    }
    if (modelId === 'hill_both') {
      const fu = fitSingleHill(trainRows.filter(r => r.state === 'untreated'));
      const ft = fitSingleHill(trainRows.filter(r => r.state === 'treated'));
      return {
        untreated: { vmax: fu.vmax, km: fu.km, n: fu.n, alpha: 0, ki: Infinity },
        treated:   { vmax: ft.vmax, km: ft.km, n: ft.n, alpha: 0, ki: Infinity },
        sse: fu.sse + ft.sse,
        vector: [fu.vmax, fu.km, fu.n, ft.vmax, ft.km, ft.n],
      };
    }
    if (modelId === 'haldane_both') {
      const fu = fitSingleHaldane(trainRows.filter(r => r.state === 'untreated'));
      const ft = fitSingleHaldane(trainRows.filter(r => r.state === 'treated'));
      return {
        untreated: fu,
        treated:   ft,
        sse: fu.sse + ft.sse,
        vector: [fu.vmax, fu.km, Number.isFinite(fu.ki) ? fu.ki : null, ft.vmax, ft.km, Number.isFinite(ft.ki) ? ft.ki : null],
      };
    }
    throw new Error('Unknown kinetic model: ' + modelId);
  }

  function predictRate(fitObj, state, conc) {
    const p = fitObj[state];
    if (conc <= 0) return 0;
    if (p.alpha && p.alpha > 0) {
      return (p.vmax * conc) / (p.km + conc + p.alpha * conc * conc);
    }
    if (p.n === 1) return (p.vmax * conc) / (p.km + conc);
    const sn = Math.pow(conc, p.n);
    const kn = Math.pow(p.km, p.n);
    return (p.vmax * sn) / (kn + sn);
  }

  function computeMetrics(obs) {
    const m = obs.length;
    if (!m) return { n: 0, rmse: 0, mae: 0, bias: 0, r2: 0, ccc: 0 };
    let sse = 0, sae = 0, sBias = 0, sumY = 0, sumP = 0;
    for (const r of obs) {
      const e = r.rate - r.prediction;
      sse += e * e;
      sae += Math.abs(e);
      sBias += e;
      sumY += r.rate;
      sumP += r.prediction;
    }
    const meanY = sumY / m, meanP = sumP / m;
    let varY = 0, varP = 0, covYP = 0;
    for (const r of obs) {
      const dy = r.rate - meanY;
      const dp = r.prediction - meanP;
      varY += dy * dy;
      varP += dp * dp;
      covYP += dy * dp;
    }
    const r2 = varY > 1e-12 ? 1 - sse / varY : 0;
    const denomCCC = varY + varP + m * (meanY - meanP) ** 2;
    const ccc = denomCCC > 1e-12 ? (2 * covYP) / denomCCC : 0;
    return {
      n: m,
      rmse: Math.sqrt(sse / m),
      mae: sae / m,
      bias: sBias / m,
      r2,
      ccc,
    };
  }

  // Irreducible pure replicate noise floor from identical (conc, state) cells
  function computePureError(rows) {
    const groups = new Map();
    for (const r of rows) {
      const key = `${r.state}@${r.conc}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r.rate);
    }
    let ssPure = 0, dfPure = 0;
    for (const vals of groups.values()) {
      if (vals.length > 1) {
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        for (const v of vals) ssPure += (v - mean) ** 2;
        dfPure += vals.length - 1;
      }
    }
    return {
      ssPure,
      dfPure,
      sPure: dfPure > 0 ? Math.sqrt(ssPure / dfPure) : 0,
      cells: groups.size,
    };
  }

  // Pointwise 95% confidence band & local Fisher information sensitivity for a single condition curve
  function curveConfidenceAndSensitivity(trainRows, fitObj, state, sGrid, residualSigma) {
    const subset = trainRows.filter(r => r.state === state);
    const { vmax, km, n, alpha = 0 } = fitObj[state];
    const usedRows = subset.length >= 3 ? subset : trainRows;
    const sigma2 = residualSigma * residualSigma;
    const tCrit = Math.sqrt(fCrit95(1, Math.max(3, trainRows.length - 3)));

    // 2x2 or 3x3 regularized Fisher Information J^T J
    if (alpha > 0) {
      const M = [[1e-9, 0, 0], [0, 1e-9, 0], [0, 0, 1e-9]];
      const grad3 = s => {
        const den = km + s + alpha * s * s;
        return [
          s / den,
          (-vmax * s) / (den * den),
          (-vmax * s * s * s) / (den * den),
        ];
      };
      for (const r of usedRows) {
        const g = grad3(r.conc);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) M[a][b] += g[a] * g[b];
      }
      // Exact 3x3 symmetric matrix inverse via cofactors
      const c00 = M[1][1] * M[2][2] - M[1][2] * M[2][1];
      const c01 = -(M[1][0] * M[2][2] - M[1][2] * M[2][0]);
      const c02 = M[1][0] * M[2][1] - M[1][1] * M[2][0];
      const c11 = M[0][0] * M[2][2] - M[0][2] * M[2][0];
      const c12 = -(M[0][0] * M[2][1] - M[0][1] * M[2][0]);
      const c22 = M[0][0] * M[1][1] - M[0][1] * M[1][0];
      const det = Math.max(1e-20, M[0][0] * c00 + M[0][1] * c01 + M[0][2] * c02);
      const inv = [
        [c00 / det, c01 / det, c02 / det],
        [c01 / det, c11 / det, c12 / det],
        [c02 / det, c12 / det, c22 / det],
      ];
      const vmaxSE = Math.sqrt(Math.max(0, inv[0][0] * sigma2));
      const kmSE = Math.sqrt(Math.max(0, inv[1][1] * sigma2));
      const band = sGrid.map(s => {
        const pred = predictRate(fitObj, state, s);
        if (s <= 0) return { s, pred: 0, lo: 0, hi: 0, se: 0, sensVmax: 0, sensKm: 0, sensKi: 0 };
        const g = grad3(s);
        let q = 0;
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) q += g[a] * inv[a][b] * g[b];
        const se = Math.sqrt(Math.max(0, q * sigma2));
        const sensVmax = g[0];
        const sensKm = Math.abs((km / Math.max(1e-9, vmax)) * g[1]);
        const sensKi = Math.abs((alpha / Math.max(1e-9, vmax)) * g[2]);
        return { s, pred, lo: Math.max(0, pred - tCrit * se), hi: pred + tCrit * se, se, sensVmax, sensKm, sensKi };
      });
      return { vmaxCI: [Math.max(0, vmax - tCrit * vmaxSE), vmax + tCrit * vmaxSE], kmCI: [Math.max(1e-6, km - tCrit * kmSE), km + tCrit * kmSE], vmaxSE, kmSE, band };
    }

    let j00 = 0, j01 = 0, j11 = 0;
    for (const r of usedRows) {
      const s = r.conc;
      const sn = n === 1 ? s : Math.pow(s, n);
      const kn = n === 1 ? km : Math.pow(km, n);
      const denom = kn + sn;
      const dv_dvmax = sn / denom;
      const dv_dkm = (-vmax * sn * n * Math.pow(km, n - 1)) / (denom * denom);
      j00 += dv_dvmax * dv_dvmax;
      j01 += dv_dvmax * dv_dkm;
      j11 += dv_dkm * dv_dkm;
    }
    const det = Math.max(1e-18, j00 * j11 - j01 * j01);
    const inv00 = j11 / det, inv01 = -j01 / det, inv11 = j00 / det;

    const vmaxSE = Math.sqrt(Math.max(0, inv00 * sigma2));
    const kmSE = Math.sqrt(Math.max(0, inv11 * sigma2));

    const band = sGrid.map(s => {
      const pred = predictRate(fitObj, state, s);
      if (s <= 0) return { s, pred: 0, lo: 0, hi: 0, se: 0, sensVmax: 0, sensKm: 0, sensKi: 0 };
      const sn = n === 1 ? s : Math.pow(s, n);
      const kn = n === 1 ? km : Math.pow(km, n);
      const denom = kn + sn;
      const g0 = sn / denom;
      const g1 = (-vmax * sn * n * Math.pow(km, n - 1)) / (denom * denom);
      const varPred = Math.max(0, (g0 * g0 * inv00 + 2 * g0 * g1 * inv01 + g1 * g1 * inv11) * sigma2);
      const se = Math.sqrt(varPred);
      const sensVmax = g0;
      const sensKm = Math.abs((km / Math.max(1e-9, vmax)) * g1);
      return {
        s,
        pred,
        lo: Math.max(0, pred - tCrit * se),
        hi: pred + tCrit * se,
        se,
        sensVmax,
        sensKm,
        sensKi: 0,
      };
    });

    return {
      vmaxCI: [Math.max(0, vmax - tCrit * vmaxSE), vmax + tCrit * vmaxSE],
      kmCI: [Math.max(1e-6, km - tCrit * kmSE), km + tCrit * kmSE],
      vmaxSE,
      kmSE,
      band,
    };
  }

  // Full benchmark analysis across all concentrations and all 5 models
  function analyzeDataset(rawRows, meta = {}) {
    const rows = rawRows.map((r, i) => ({
      id: String(r.id ?? r.rownames ?? i + 1),
      conc: Number(r.conc ?? r.concentration),
      rate: Number(r.rate),
      state: r.state,
    }));
    const levels = [...new Set(rows.map(r => r.conc))].sort((a, b) => a - b);
    const minConc = levels[0], maxConc = levels[levels.length - 1];
    const pure = computePureError(rows);
    const N = rows.length;

    const fullFits = {};
    const foldFits = levels.map(level => ({ level, isOOD: level === minConc || level === maxConc, models: {} }));
    const pooledByModel = {};
    const summaryByModel = {};

    for (const mSpec of MODEL_CATALOG) {
      const mId = mSpec.id;
      fullFits[mId] = fitModel(rows, mId);
      const pooledPreds = [];

      levels.forEach((level, fIdx) => {
        const train = rows.filter(r => r.conc !== level);
        const fit = fitModel(train, mId);
        const allObs = rows.map(r => {
          const prediction = predictRate(fit, r.state, r.conc);
          const isOOD = r.conc === minConc || r.conc === maxConc;
          // Local leverage proxy (sensitivity norm)
          const p = fit[r.state];
          const sn = Math.pow(r.conc, p.n), kn = Math.pow(p.km, p.n);
          const sensK = (kn * sn) / ((kn + sn) ** 2);
          return {
            ...r,
            prediction,
            residual: r.rate - prediction,
            held: r.conc === level,
            regime: isOOD ? (r.conc === minConc ? 'OOD Low' : 'OOD High') : 'In-Domain',
            isOOD,
            affinityLeverage: sensK * 4, // Normalized 0..1 (peaks at 1.0 when S == Km)
          };
        });
        const heldObs = allObs.filter(r => r.held);
        pooledPreds.push(...heldObs);
        foldFits[fIdx].models[mId] = {
          fit,
          allObs,
          heldObs,
          metrics: computeMetrics(heldObs),
          trainSigma: Math.sqrt(fit.sse / Math.max(1, train.length - mSpec.k)),
        };
      });

      pooledByModel[mId] = pooledPreds;
      const pooledMetrics = computeMetrics(pooledPreds);
      const interpMetrics = computeMetrics(pooledPreds.filter(r => !r.isOOD));
      const oodMetrics = computeMetrics(pooledPreds.filter(r => r.isOOD));

      // AIC, AICc, BIC on full dataset fit
      const pCount = mSpec.k + 1; // parameters + sigma^2
      const sseFull = Math.max(1e-12, fullFits[mId].sse);
      const aic = N * Math.log(sseFull / N) + 2 * pCount;
      const denomAicc = Math.max(1, N - pCount - 1);
      const aicc = aic + (2 * pCount * (pCount + 1)) / denomAicc;
      const bic = N * Math.log(sseFull / N) + pCount * Math.log(N);
      const resSigma = Math.sqrt(sseFull / Math.max(1, N - mSpec.k));

      // Full-data observations for pooled diagnostics
      const fullObs = rows.map(r => {
        const prediction = predictRate(fullFits[mId], r.state, r.conc);
        const isOOD = r.conc === minConc || r.conc === maxConc;
        const p = fullFits[mId][r.state];
        const sn = Math.pow(r.conc, p.n), kn = Math.pow(p.km, p.n);
        return {
          ...r,
          prediction,
          residual: r.rate - prediction,
          held: false,
          regime: isOOD ? (r.conc === minConc ? 'OOD Low' : 'OOD High') : 'In-Domain',
          isOOD,
          affinityLeverage: (4 * kn * sn) / ((kn + sn) ** 2),
        };
      });

      summaryByModel[mId] = {
        ...mSpec,
        fullFit: fullFits[mId],
        fullObs,
        sseFull,
        resSigma,
        aic,
        aicc,
        bic,
        pooled: pooledMetrics,
        interp: interpMetrics,
        ood: oodMetrics,
        oodRatio: interpMetrics.rmse > 1e-9 ? oodMetrics.rmse / interpMetrics.rmse : 1,
      };
    }

    // Compute ΔAICc, Akaike weights, and nuanced mechanistic verdicts
    const allSummaries = Object.values(summaryByModel);
    const mmSummaries = allSummaries.filter(s => !['hill_both', 'haldane_both'].includes(s.id));
    const minAicc = Math.min(...allSummaries.map(s => s.aicc));
    const minMmAicc = Math.min(...mmSummaries.map(s => s.aicc));
    const minMmRmse = Math.min(...mmSummaries.map(s => s.pooled.rmse));
    let weightSum = 0;
    for (const s of allSummaries) {
      s.deltaAicc = s.aicc - minAicc;
      s.deltaMmAicc = s.aicc - minMmAicc;
      s.rawWeight = Math.exp(-0.5 * s.deltaAicc);
      weightSum += s.rawWeight;
    }
    for (const s of allSummaries) {
      s.akaikeWeight = s.rawWeight / Math.max(1e-12, weightSum);
      if (s.id === 'haldane_both') {
        const hasInhib = Number.isFinite(s.fullFit.untreated.ki) || Number.isFinite(s.fullFit.treated.ki);
        if (s.deltaAicc === 0 && minMmAicc - s.aicc > 6) {
          s.verdict = 'Best Fit (Substrate Inhibition)';
          s.verdictTone = 'best';
        } else if (hasInhib && s.deltaAicc < 2.5) {
          s.verdict = 'Extended Fit (Mild High-[S] Hook)';
          s.verdictTone = 'good';
        } else {
          s.verdict = 'Overparameterized (No High-[S] Drop)';
          s.verdictTone = 'warn';
        }
      } else if (s.id === 'hill_both') {
        if (s.deltaAicc === 0 && minMmAicc - s.aicc > 6) {
          s.verdict = 'Best Fit (Allosteric Cooperativity)';
          s.verdictTone = 'best';
        } else if (s.deltaAicc < 2.5) {
          s.verdict = 'Extended Fit (Check Extrapolation)';
          s.verdictTone = 'good';
        } else {
          s.verdict = 'Overparameterized (k=6 Penalty)';
          s.verdictTone = 'warn';
        }
      } else if (s.deltaMmAicc < 1.5 && s.pooled.rmse <= minMmRmse * 1.05) {
        s.verdict = s.k <= 3 ? 'Recommended MM (Parsimonious)' : 'Best 4-Param MM Fit';
        s.verdictTone = 'best';
      } else if (s.deltaMmAicc < 3.5 || s.pooled.rmse <= minMmRmse * 1.08) {
        s.verdict = 'Plausible MM Alternative';
        s.verdictTone = 'good';
      } else if (s.pooled.rmse > minMmRmse * 1.22 || s.deltaMmAicc > 10) {
        s.verdict = 'Underfit (Misses Condition Shift)';
        s.verdictTone = 'poor';
      } else {
        s.verdict = 'Suboptimal Hypothesis';
        s.verdictTone = 'neutral';
      }
    }

    return {
      meta: {
        id: meta.id || 'custom',
        title: meta.title || 'Custom Enzyme Assay',
        kind: meta.kind || 'measured',
        concUnit: meta.concUnit || 'ppm',
        rateUnit: meta.rateUnit || 'counts/min/min',
        sourceUrl: meta.sourceUrl || 'studio/kinetics.html',
        description: meta.description || '',
      },
      rows,
      levels,
      minConc,
      maxConc,
      pure,
      foldFits,
      pooledByModel,
      summaryByModel,
      models: MODEL_CATALOG,
    };
  }

  // Curated benchmark datasets (1 measured canonical + 4 mechanistic/cliff synthetic benchmarks)
  function getBenchmarks(puromycinRows) {
    return {
      puromycin: {
        id: 'puromycin',
        title: 'Puromycin · Galactosyltransferase (Treloar 1974)',
        kind: 'measured',
        concUnit: 'ppm',
        rateUnit: 'counts/min/min',
        sourceUrl: 'https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/Puromycin.html',
        description: '23 measured reaction velocities across 6 substrate concentrations in Puromycin-treated vs untreated Golgi membranes.',
        rows: puromycinRows,
      },
      noncompetitive: {
        id: 'noncompetitive',
        title: 'Non-Competitive Catalytic Shift (Pure Vmax · n = 1.0)',
        kind: 'simulated',
        concUnit: 'mM',
        rateUnit: 'µmol/min/mg',
        sourceUrl: 'studio/kinetics.html#noncompetitive-benchmark',
        description: 'Pure catalytic capacity change (true Km = 0.10 mM shared; Vmax = 195 vs 120, n = 1.0). Lineweaver–Burk lines meet cleanly on the −1/[S] axis and Condition Vmax wins AICc decisively.',
        rows: [
          { id: '1', conc: 0.02, rate: 33.4, state: 'treated' }, { id: '2', conc: 0.02, rate: 31.2, state: 'treated' },
          { id: '3', conc: 0.05, rate: 64.0, state: 'treated' }, { id: '4', conc: 0.05, rate: 66.8, state: 'treated' },
          { id: '5', conc: 0.10, rate: 99.1, state: 'treated' }, { id: '6', conc: 0.10, rate: 95.6, state: 'treated' },
          { id: '7', conc: 0.25, rate: 137.8, state: 'treated' }, { id: '8', conc: 0.25, rate: 141.2, state: 'treated' },
          { id: '9', conc: 0.60, rate: 168.9, state: 'treated' }, { id: '10', conc: 0.60, rate: 165.4, state: 'treated' },
          { id: '11', conc: 1.50, rate: 181.5, state: 'treated' }, { id: '12', conc: 1.50, rate: 184.9, state: 'treated' },
          { id: '13', conc: 0.02, rate: 19.3, state: 'untreated' }, { id: '14', conc: 0.02, rate: 21.0, state: 'untreated' },
          { id: '15', conc: 0.05, rate: 41.2, state: 'untreated' }, { id: '16', conc: 0.05, rate: 38.9, state: 'untreated' },
          { id: '17', conc: 0.10, rate: 58.6, state: 'untreated' }, { id: '18', conc: 0.10, rate: 61.5, state: 'untreated' },
          { id: '19', conc: 0.25, rate: 86.9, state: 'untreated' }, { id: '20', conc: 0.25, rate: 84.3, state: 'untreated' },
          { id: '21', conc: 0.60, rate: 101.8, state: 'untreated' }, { id: '22', conc: 0.60, rate: 104.2, state: 'untreated' },
          { id: '23', conc: 1.50, rate: 111.6, state: 'untreated' }, { id: '24', conc: 1.50, rate: 113.9, state: 'untreated' },
        ],
      },
      competitive: {
        id: 'competitive',
        title: 'Competitive Inhibitor Benchmark (Pure Km Cliff)',
        kind: 'simulated',
        concUnit: 'mM',
        rateUnit: 'µmol/min/mg',
        sourceUrl: 'studio/kinetics.html#competitive-benchmark',
        description: 'Controlled competitive-inhibition benchmark (true Vmax = 180 in both states; Km = 0.08 mM control vs 0.28 mM inhibited, σ = 4.2). Lineweaver–Burk lines meet cleanly on the 1/v axis.',
        rows: [
          // treated = uninhibited control (Km = 0.08), untreated = +competitive inhibitor (Km = 0.28)
          { id: '1', conc: 0.02, rate: 38.2, state: 'treated' }, { id: '2', conc: 0.02, rate: 33.9, state: 'treated' },
          { id: '3', conc: 0.05, rate: 67.1, state: 'treated' }, { id: '4', conc: 0.05, rate: 72.4, state: 'treated' },
          { id: '5', conc: 0.12, rate: 105.0, state: 'treated' }, { id: '6', conc: 0.12, rate: 111.3, state: 'treated' },
          { id: '7', conc: 0.30, rate: 144.8, state: 'treated' }, { id: '8', conc: 0.30, rate: 139.5, state: 'treated' },
          { id: '9', conc: 0.80, rate: 161.2, state: 'treated' }, { id: '10', conc: 0.80, rate: 166.9, state: 'treated' },
          { id: '11', conc: 2.00, rate: 171.8, state: 'treated' }, { id: '12', conc: 2.00, rate: 176.4, state: 'treated' },
          { id: '13', conc: 0.02, rate: 13.4, state: 'untreated' }, { id: '14', conc: 0.02, rate: 10.9, state: 'untreated' },
          { id: '15', conc: 0.05, rate: 25.8, state: 'untreated' }, { id: '16', conc: 0.05, rate: 29.1, state: 'untreated' },
          { id: '17', conc: 0.12, rate: 56.4, state: 'untreated' }, { id: '18', conc: 0.12, rate: 51.9, state: 'untreated' },
          { id: '19', conc: 0.30, rate: 90.6, state: 'untreated' }, { id: '20', conc: 0.30, rate: 96.2, state: 'untreated' },
          { id: '21', conc: 0.80, rate: 131.5, state: 'untreated' }, { id: '22', conc: 0.80, rate: 136.0, state: 'untreated' },
          { id: '23', conc: 2.00, rate: 156.1, state: 'untreated' }, { id: '24', conc: 2.00, rate: 160.8, state: 'untreated' },
        ],
      },
      cooperative: {
        id: 'cooperative',
        title: 'Allosteric Hill Benchmark (Positive Cooperativity n ≈ 2.2)',
        kind: 'simulated',
        concUnit: 'mM',
        rateUnit: 'µmol/min/mg',
        sourceUrl: 'studio/kinetics.html#cooperative-benchmark',
        description: 'Sigmoidal multisite allosteric enzyme (Hill n = 2.2, K0.5 = 0.18 mM; activator raises Vmax from 140 to 210). Exposes systematic S-shaped misspecification in all n = 1 Michaelis–Menten models.',
        rows: [
          { id: '1', conc: 0.03, rate: 4.9, state: 'treated' }, { id: '2', conc: 0.03, rate: 6.4, state: 'treated' },
          { id: '3', conc: 0.08, rate: 25.2, state: 'treated' }, { id: '4', conc: 0.08, rate: 29.0, state: 'treated' },
          { id: '5', conc: 0.16, rate: 91.5, state: 'treated' }, { id: '6', conc: 0.16, rate: 97.4, state: 'treated' },
          { id: '7', conc: 0.30, rate: 156.8, state: 'treated' }, { id: '8', conc: 0.30, rate: 163.2, state: 'treated' },
          { id: '9', conc: 0.65, rate: 196.4, state: 'treated' }, { id: '10', conc: 0.65, rate: 201.8, state: 'treated' },
          { id: '11', conc: 1.40, rate: 206.5, state: 'treated' }, { id: '12', conc: 1.40, rate: 211.0, state: 'treated' },
          { id: '13', conc: 0.03, rate: 3.1, state: 'untreated' }, { id: '14', conc: 0.03, rate: 4.5, state: 'untreated' },
          { id: '15', conc: 0.08, rate: 16.8, state: 'untreated' }, { id: '16', conc: 0.08, rate: 19.5, state: 'untreated' },
          { id: '17', conc: 0.16, rate: 60.2, state: 'untreated' }, { id: '18', conc: 0.16, rate: 65.1, state: 'untreated' },
          { id: '19', conc: 0.30, rate: 103.5, state: 'untreated' }, { id: '20', conc: 0.30, rate: 108.9, state: 'untreated' },
          { id: '21', conc: 0.65, rate: 130.8, state: 'untreated' }, { id: '22', conc: 0.65, rate: 134.9, state: 'untreated' },
          { id: '23', conc: 1.40, rate: 138.1, state: 'untreated' }, { id: '24', conc: 1.40, rate: 141.4, state: 'untreated' },
        ],
      },
      haldane: {
        id: 'haldane',
        title: 'Substrate Inhibition · Haldane High-Dose Cliff (Ki = 0.35 vs 1.8 mM)',
        kind: 'simulated',
        concUnit: 'mM',
        rateUnit: 'µmol/min/mg',
        sourceUrl: 'studio/kinetics.html#substrate-inhibition-benchmark',
        description: 'Uncompetitive dead-end ESS substrate inhibition (shared Vmax = 260, Km = 0.08 mM; untreated Ki = 0.35 mM crashes above [S]opt ≈ 0.17 mM, whereas protective modulator raises Ki to 1.80 mM). Produces classic upward Lineweaver–Burk hooks and parabolic Hanes–Woolf curves.',
        rows: [
          { id: '1', conc: 0.02, rate: 50.4, state: 'treated' }, { id: '2', conc: 0.02, rate: 53.5, state: 'treated' },
          { id: '3', conc: 0.06, rate: 108.1, state: 'treated' }, { id: '4', conc: 0.06, rate: 111.8, state: 'treated' },
          { id: '5', conc: 0.18, rate: 166.2, state: 'treated' }, { id: '6', conc: 0.18, rate: 170.5, state: 'treated' },
          { id: '7', conc: 0.50, rate: 178.6, state: 'treated' }, { id: '8', conc: 0.50, rate: 183.1, state: 'treated' },
          { id: '9', conc: 1.20, rate: 147.9, state: 'treated' }, { id: '10', conc: 1.20, rate: 152.2, state: 'treated' },
          { id: '11', conc: 2.40, rate: 107.8, state: 'treated' }, { id: '12', conc: 2.40, rate: 112.1, state: 'treated' },
          { id: '13', conc: 0.02, rate: 50.1, state: 'untreated' }, { id: '14', conc: 0.02, rate: 52.8, state: 'untreated' },
          { id: '15', conc: 0.06, rate: 101.9, state: 'untreated' }, { id: '16', conc: 0.06, rate: 105.6, state: 'untreated' },
          { id: '17', conc: 0.18, rate: 130.8, state: 'untreated' }, { id: '18', conc: 0.18, rate: 134.9, state: 'untreated' },
          { id: '19', conc: 0.50, rate: 98.6, state: 'untreated' }, { id: '20', conc: 0.50, rate: 102.3, state: 'untreated' },
          { id: '21', conc: 1.20, rate: 56.2, state: 'untreated' }, { id: '22', conc: 1.20, rate: 59.5, state: 'untreated' },
          { id: '23', conc: 2.40, rate: 31.6, state: 'untreated' }, { id: '24', conc: 2.40, rate: 34.4, state: 'untreated' },
        ],
      },
    };
  }

  return {
    MODEL_CATALOG,
    fCrit95,
    fitSingleMM,
    fitSplitVmax,
    fitSplitKm,
    fitSingleHill,
    fitSingleHaldane,
    fitModel,
    predictRate,
    computeMetrics,
    computePureError,
    curveConfidenceAndSensitivity,
    analyzeDataset,
    getBenchmarks,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KineticsAnalytics;
}
