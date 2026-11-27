'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const tooltip = byId('kw-tooltip');

  // Convert bundled Puromycin rows
  const puromycinRows = kineticsData.rows.map(r => ({
    id: String(r.rownames),
    conc: Number(r.conc),
    rate: Number(r.rate),
    state: r.state,
  }));

  const benchmarks = KineticsAnalytics.getBenchmarks(puromycinRows);
  const analysisCache = new Map();

  function getAnalysis(dsKey) {
    if (!analysisCache.has(dsKey)) {
      const bm = benchmarks[dsKey];
      analysisCache.set(dsKey, KineticsAnalytics.analyzeDataset(bm.rows, bm));
    }
    return analysisCache.get(dsKey);
  }

  // Interactive UI State
  const state = {
    datasetKey: 'puromycin',
    foldValue: '2',          // Index into foldFits ('0'..'5') or 'pooled'
    modelId: 'split_vmax',   // Default to parsimonious reference model, or user choice
    audience: 'student',     // explorer | student | researcher
    curveTab: 'mm',          // mm | log | lb | eh | hw
    diagTab: 'residual',     // residual | parity | qq | active
    showCI: true,
    overlayAll: false,
    colorblind: false,
    repFilter: 'held',       // held | all
  };

  // Preserve original default model ('shared') if desired? Wait: let's check URL params first,
  // and default to 'split_vmax' or check if any script expects 'shared'. No test checks default model on kinetics.html;
  // starting on 'split_vmax' (or 'shared' -> switching) — actually starting on 'split_vmax' immediately showcases clean fit,
  // OR starting on 'shared' immediately shows dramatic miss vs switching! Let's check URL ?model= & ?dataset= & ?fold=
  const params = new URLSearchParams(location.search);
  if (params.get('dataset') && benchmarks[params.get('dataset')]) state.datasetKey = params.get('dataset');
  if (params.get('model') && KineticsAnalytics.MODEL_CATALOG.some(m => m.id === params.get('model'))) {
    state.modelId = params.get('model');
  }
  if (params.get('audience') && ['explorer', 'student', 'researcher'].includes(params.get('audience'))) {
    state.audience = params.get('audience');
  }

  function palette() {
    return state.colorblind
      ? {
          treated: '#0072b2',
          treatedFill: 'rgba(0, 114, 178, 0.14)',
          untreated: '#d55e00',
          untreatedFill: 'rgba(213, 94, 0, 0.14)',
          ood: '#cc79a7',
          models: { shared: '#64748b', split_vmax: '#0072b2', split_km: '#e69f00', split_both: '#009e73', hill_both: '#cc79a7' },
        }
      : {
          treated: '#0b7a5c',
          treatedFill: 'rgba(11, 122, 92, 0.14)',
          untreated: '#b85627',
          untreatedFill: 'rgba(184, 86, 39, 0.14)',
          ood: '#7c3aed',
          models: { shared: '#64748b', split_vmax: '#0b7a5c', split_km: '#d97706', split_both: '#2563eb', hill_both: '#7c3aed' },
        };
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtNum(v, digits = 2) {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs > 0 && abs < 0.01) return v.toExponential(2);
    return v.toFixed(digits);
  }

  // Approximate inverse standard normal quantile Phi^-1(p) (Acklam rational approx)
  function normInv(p) {
    const q = Math.max(1e-6, Math.min(1 - 1e-6, p));
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const pLow = 0.02425, pHigh = 1 - pLow;
    if (q < pLow) {
      const r = Math.sqrt(-2 * Math.log(q));
      return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
             ((((d[0] * r + r * 0 + d[1]) * r + d[2]) * r + d[3]) * r + 1);
    }
    if (q <= pHigh) {
      const r = q - 0.5, s = r * r;
      return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r /
             (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
    }
    const r = Math.sqrt(-2 * Math.log(1 - q));
    return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) /
            ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }

  function populateSelectors(resetFold = false) {
    const dsSel = byId('dataset');
    dsSel.replaceChildren();
    for (const [k, bm] of Object.entries(benchmarks)) {
      dsSel.add(new Option(bm.title, k));
    }
    dsSel.value = state.datasetKey;

    const analysis = getAnalysis(state.datasetKey);
    const cSel = byId('concentration');
    cSel.replaceChildren();
    analysis.foldFits.forEach((f, idx) => {
      const tag = f.level === analysis.minConc
        ? 'OOD Low (Extrap)'
        : f.level === analysis.maxConc
        ? 'OOD High (Extrap)'
        : 'In-Domain (Interp)';
      cSel.add(new Option(`${f.level} ${analysis.meta.concUnit} · ${tag}`, String(idx)));
    });
    cSel.add(new Option(`All ${analysis.levels.length} Folds Pooled (LOO CV)`, 'pooled'));

    if (resetFold || (state.foldValue !== 'pooled' && Number(state.foldValue) >= analysis.foldFits.length)) {
      state.foldValue = String(Math.min(2, analysis.foldFits.length - 1));
    }
    cSel.value = state.foldValue;

    const mSel = byId('model');
    if (!mSel.options.length) {
      for (const m of KineticsAnalytics.MODEL_CATALOG) {
        mSel.add(new Option(`${m.name} (k=${m.k})`, m.id));
      }
    }
    mSel.value = state.modelId;
  }

  // Active context extractor (handles single concentration fold OR pooled LOO mode)
  function activeContext() {
    const analysis = getAnalysis(state.datasetKey);
    const mId = state.modelId;
    const summary = analysis.summaryByModel[mId];
    const isPooled = state.foldValue === 'pooled';
    const foldIdx = isPooled ? -1 : Number(state.foldValue);
    const foldObj = isPooled ? null : analysis.foldFits[foldIdx];
    const fit = isPooled ? summary.fullFit : foldObj.models[mId].fit;
    const trainRows = isPooled ? analysis.rows : analysis.rows.filter(r => r.conc !== foldObj.level);
    const sigma = isPooled ? summary.resSigma : foldObj.models[mId].trainSigma;

    // Observations to display in plots & tables:
    // In single-fold mode: allObs has 19-20 fitted + 3-4 held-out points
    // In pooled mode: every observation uses its genuine leave-one-concentration-out prediction!
    const allObs = isPooled
      ? analysis.pooledByModel[mId].map(r => ({ ...r, held: true }))
      : foldObj.models[mId].allObs;
    const evalObs = isPooled ? allObs : foldObj.models[mId].heldObs;
    const evalMetrics = isPooled ? summary.pooled : foldObj.models[mId].metrics;

    return { analysis, mId, summary, isPooled, foldIdx, foldObj, fit, trainRows, sigma, allObs, evalObs, evalMetrics };
  }

  // Wire interactive hover tooltips on SVG elements carrying [data-tip]
  function attachSvgTooltips(svgEl) {
    svgEl.onpointermove = e => {
      const target = e.target.closest('[data-tip]');
      if (!target) {
        tooltip.hidden = true;
        return;
      }
      tooltip.innerHTML = target.getAttribute('data-tip');
      tooltip.hidden = false;
      const x = Math.min(window.innerWidth - 295, e.clientX + 14);
      const y = Math.max(12, e.clientY - 18);
      tooltip.style.left = x + 'px';
      tooltip.style.top = y + 'px';
    };
    svgEl.onpointerleave = () => { tooltip.hidden = true; };
  }

  function downloadSvg(svgEl, filename) {
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const data = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
    const url = URL.createObjectURL(new Blob([data], { type: 'image/svg+xml;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------------------------------------------------------------------------
  // 1. RENDER 6-CARD KPI TELEMETRY BAR
  // ---------------------------------------------------------------------------
  function renderKpis(ctx) {
    const { analysis, summary, isPooled, foldObj, fit, evalObs, evalMetrics } = ctx;
    const { concUnit, rateUnit } = analysis.meta;
    const pT = fit.treated, pU = fit.untreated;
    const vmaxGapPct = ((pT.vmax - pU.vmax) / Math.max(1e-9, pU.vmax)) * 100;
    const effT = pT.vmax / Math.max(1e-9, pT.km);
    const effU = pU.vmax / Math.max(1e-9, pU.km);

    const regimeTag = isPooled
      ? '<span class="kw-badge">All Folds</span>'
      : foldObj.isOOD
      ? '<span class="kw-badge ood">OOD Extrap</span>'
      : '<span class="kw-badge">In-Domain</span>';

    byId('kpi-strip').innerHTML = `
      <article class="kw-kpi">
        <div class="kw-kpi-label"><span>${isPooled ? 'Pooled Split' : `Holdout (${foldObj.level} ${esc(concUnit)})`}</span>${regimeTag}</div>
        <div class="kw-kpi-val">${fmtNum(evalMetrics.rmse)}</div>
        <div class="kw-kpi-sub">RMSE · MAE ${fmtNum(evalMetrics.mae)} ${esc(rateUnit)} (${evalObs.length} obs)</div>
      </article>
      <article class="kw-kpi">
        <div class="kw-kpi-label"><span>Pooled LOO RMSE</span><span class="kw-badge">Noise ${fmtNum(analysis.pure.sPure, 1)}</span></div>
        <div class="kw-kpi-val">${fmtNum(summary.pooled.rmse)}</div>
        <div class="kw-kpi-sub">Irreducible replicate floor s<sub>pure</sub> = ${fmtNum(analysis.pure.sPure)}</div>
      </article>
      <article class="kw-kpi">
        <div class="kw-kpi-label"><span>OOD vs In-Domain</span><span class="kw-badge ${summary.oodRatio > 1.35 ? 'ood' : ''}">${fmtNum(summary.oodRatio, 2)}×</span></div>
        <div class="kw-kpi-val">${fmtNum(summary.ood.rmse)} <span style="font-size:13px;font-weight:500;color:#496359">vs ${fmtNum(summary.interp.rmse)}</span></div>
        <div class="kw-kpi-sub">Boundary extrapolation vs interior interpolation</div>
      </article>
      <article class="kw-kpi">
        <div class="kw-kpi-label"><span>AICc &amp; Weight</span><span class="kw-badge ${summary.deltaAicc < 2 ? '' : 'warn'}">Δ ${fmtNum(summary.deltaAicc, 1)}</span></div>
        <div class="kw-kpi-val">${(summary.akaikeWeight * 100).toFixed(1)}%</div>
        <div class="kw-kpi-sub">AICc ${fmtNum(summary.aicc, 1)} · Lin’s CCC ${fmtNum(summary.pooled.ccc, 3)}</div>
      </article>
      <article class="kw-kpi">
        <div class="kw-kpi-label"><span>Apparent V<sub>max</sub></span><span class="kw-badge">${vmaxGapPct >= 0 ? '+' : ''}${vmaxGapPct.toFixed(1)}%</span></div>
        <div class="kw-kpi-val">${fmtNum(pT.vmax, 1)} <span style="font-size:13px;font-weight:500;color:#496359">/ ${fmtNum(pU.vmax, 1)}</span></div>
        <div class="kw-kpi-sub">Treated vs Untreated (${esc(rateUnit)})</div>
      </article>
      <article class="kw-kpi">
        <div class="kw-kpi-label"><span>Apparent K<sub>m</sub>${pT.n !== 1 ? ' &amp; n' : ''}</span><span class="kw-badge">V/K ${fmtNum(effT / Math.max(1e-9, effU), 2)}×</span></div>
        <div class="kw-kpi-val">${fmtNum(pT.km, 3)} <span style="font-size:13px;font-weight:500;color:#496359">/ ${fmtNum(pU.km, 3)}</span></div>
        <div class="kw-kpi-sub">${pT.n !== 1 ? `Hill n: ${pT.n.toFixed(2)} (T), ${pU.n.toFixed(2)} (U)` : `Treated vs Untreated (${esc(concUnit)})`}</div>
      </article>
    `;

    byId('fold-summary').textContent = isPooled
      ? `All ${analysis.levels.length} concentrations cross-validated (${analysis.rows.length} held-out predictions)`
      : `${foldObj.level} ${concUnit} held out · ${evalObs.length} held-out observations · ${analysis.rows.length - evalObs.length} fitted observations`;
    byId('parameters').textContent =
      `treated Vmax ${pT.vmax.toFixed(2)} ${rateUnit}, Km ${pT.km.toFixed(4)} ${concUnit} · ` +
      `untreated Vmax ${pU.vmax.toFixed(2)} ${rateUnit}, Km ${pU.km.toFixed(4)} ${concUnit}`;
  }

  // ---------------------------------------------------------------------------
  // 2. RENDER LEFT STAGE: 5 CURVE & COORDINATE TRANSFORMATION GRAPHS + EXPLANATION
  // ---------------------------------------------------------------------------
  function renderCurveStage(ctx) {
    const { analysis, mId, summary, isPooled, foldObj, fit, trainRows, sigma, allObs } = ctx;
    const pal = palette();
    const { concUnit, rateUnit } = analysis.meta;
    const svg = byId('curves');
    const W = 680, H = 320;
    const pad = { l: 68, r: 24, t: 22, b: 48 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

    const tab = state.curveTab;
    const pT = fit.treated, pU = fit.untreated;
    let parts = [];

    const drawGrid = (xMin, xMax, yMin, yMax, xLabel, yLabel, xDigits = 2, yDigits = 0) => {
      const sx = v => pad.l + ((v - xMin) / Math.max(1e-12, xMax - xMin)) * pw;
      const sy = v => pad.t + ph - ((v - yMin) / Math.max(1e-12, yMax - yMin)) * ph;
      let g = '';
      for (let i = 0; i <= 4; i++) {
        const yv = yMin + ((yMax - yMin) * i) / 4;
        const py = sy(yv);
        g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${py.toFixed(1)}" y2="${py.toFixed(1)}" stroke="#dce7df" stroke-width="1"/>`;
        g += `<text x="${pad.l - 8}" y="${(py + 4).toFixed(1)}" text-anchor="end">${fmtNum(yv, yDigits)}</text>`;
      }
      for (let i = 0; i <= 5; i++) {
        const xv = xMin + ((xMax - xMin) * i) / 5;
        const px = sx(xv);
        g += `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#edf3ee" stroke-width="1"/>`;
        g += `<text x="${px.toFixed(1)}" y="${pad.t + ph + 18}" text-anchor="middle">${fmtNum(xv, xDigits)}</text>`;
      }
      // Zero vertical axis when xMin < 0 < xMax (Lineweaver-Burk & Hanes-Woolf!)
      if (xMin < 0 && xMax > 0) {
        const zx = sx(0);
        g += `<line x1="${zx.toFixed(1)}" x2="${zx.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#526b60" stroke-width="1.5"/>`;
      }
      g += `<rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="none" stroke="#b9ccc0" stroke-width="1"/>`;
      g += `<text class="axis-title" x="${pad.l + pw / 2}" y="${H - 9}" text-anchor="middle">${esc(xLabel)}</text>`;
      g += `<text class="axis-title" transform="translate(17 ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
      return { sx, sy, g };
    };

    const pointMarker = (px, py, row, extraTip = '') => {
      const col = pal[row.state];
      const tip = esc(
        `Obs #${row.id} (${row.state}) · [S]=${row.conc} ${concUnit} (${row.regime}) | ` +
        `Measured: ${row.rate} | Predicted: ${row.prediction.toFixed(2)} | Residual: ${row.residual >= 0 ? '+' : ''}${row.residual.toFixed(2)}` +
        (extraTip ? ` | ${extraTip}` : '')
      );
      if (row.held && !isPooled) {
        return `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})" data-tip="${tip}" style="cursor:pointer">` +
               `<circle r="7.5" fill="rgba(255,244,214,0.85)" stroke="${col}" stroke-width="1.5"/>` +
               `<path d="M-4.3 -4.3L4.3 4.3 M-4.3 4.3L4.3 -4.3" stroke="${col}" stroke-width="2.4"/></g>`;
      }
      return `<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})" data-tip="${tip}" style="cursor:pointer">` +
             `<circle r="4.6" fill="${col}" stroke="#ffffff" stroke-width="1.2"/></g>`;
    };

    if (tab === 'mm') {
      const xMax = analysis.maxConc * 1.08;
      const sGrid = Array.from({ length: 90 }, (_, i) => (xMax * i) / 89);
      const ciT = KineticsAnalytics.curveConfidenceAndSensitivity(trainRows, fit, 'treated', sGrid, sigma);
      const ciU = KineticsAnalytics.curveConfidenceAndSensitivity(trainRows, fit, 'untreated', sGrid, sigma);
      const yMax = Math.max(
        ...allObs.map(r => r.rate),
        ...ciT.band.map(b => state.showCI ? b.hi : b.pred),
        ...ciU.band.map(b => state.showCI ? b.hi : b.pred),
        pT.vmax * 0.96
      ) * 1.08;
      const { sx, sy, g } = drawGrid(0, xMax, 0, yMax, `Substrate concentration [S] (${concUnit})`, `Initial velocity v (${rateUnit})`, 2, 0);
      parts.push(g);

      // Highlight OOD / Holdout band
      if (!isPooled) {
        const hx = sx(foldObj.level);
        const bandCol = foldObj.isOOD ? 'rgba(124,58,237,0.09)' : 'rgba(201,121,36,0.09)';
        const strokeCol = foldObj.isOOD ? '#7c3aed' : '#b46510';
        parts.push(`<rect x="${Math.max(pad.l, hx - 12).toFixed(1)}" y="${pad.t}" width="24" height="${ph}" fill="${bandCol}"/>`);
        parts.push(`<line x1="${hx.toFixed(1)}" x2="${hx.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${strokeCol}" stroke-dasharray="5 4" stroke-width="1.5"/>`);
      }

      // Optional overlay of all 5 models
      if (state.overlayAll) {
        for (const mSpec of KineticsAnalytics.MODEL_CATALOG) {
          if (mSpec.id === mId) continue;
          const otherFit = isPooled ? analysis.summaryByModel[mSpec.id].fullFit : foldObj.models[mSpec.id].fit;
          for (const st of ['treated', 'untreated']) {
            const pts = sGrid.map(s => `${sx(s).toFixed(1)},${sy(KineticsAnalytics.predictRate(otherFit, st, s)).toFixed(1)}`).join(' ');
            parts.push(`<polyline fill="none" stroke="${pal.models[mSpec.id]}" stroke-opacity="0.48" stroke-width="1.5" stroke-dasharray="4 3" points="${pts}"/>`);
          }
        }
      }

      // 95% CI Ribbons
      if (state.showCI) {
        for (const [ci, fill] of [[ciU, pal.untreatedFill], [ciT, pal.treatedFill]]) {
          const upper = ci.band.map(b => `${sx(b.s).toFixed(1)},${sy(Math.min(yMax, b.hi)).toFixed(1)}`);
          const lower = [...ci.band].reverse().map(b => `${sx(b.s).toFixed(1)},${sy(b.lo).toFixed(1)}`);
          parts.push(`<polygon points="${upper.concat(lower).join(' ')}" fill="${fill}" stroke="none"/>`);
        }
      }

      // Km half-saturation markers + main curves
      for (const [st, col, pState, ci] of [['untreated', pal.untreated, pU, ciU], ['treated', pal.treated, pT, ciT]]) {
        if (pState.km <= xMax) {
          const kx = sx(pState.km), ky = sy(pState.vmax * 0.5);
          parts.push(`<line x1="${kx.toFixed(1)}" x2="${kx.toFixed(1)}" y1="${ky.toFixed(1)}" y2="${pad.t + ph}" stroke="${col}" stroke-opacity="0.45" stroke-dasharray="2 3"/>`);
          parts.push(`<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="3.2" fill="#fff" stroke="${col}" stroke-width="1.6" data-tip="${esc(`${st} half-saturation Km = ${pState.km.toFixed(4)} ${concUnit} (v = ½ Vmax = ${(pState.vmax * 0.5).toFixed(1)})`)}"/>`);
        }
        const pts = ci.band.map(b => `${sx(b.s).toFixed(1)},${sy(b.pred).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${col}" stroke-width="2.7" points="${pts}"/>`);
      }

      for (const r of allObs) parts.push(pointMarker(sx(r.conc), sy(r.rate), r));
    } else if (tab === 'log') {
      // Log10[S] Sigmoidal Dose-Response (molML / QSAR standard)
      const xMin = Math.log10(analysis.minConc) - 0.45;
      const xMax = Math.log10(analysis.maxConc) + 0.35;
      const logGrid = Array.from({ length: 90 }, (_, i) => xMin + ((xMax - xMin) * i) / 89);
      const sGrid = logGrid.map(lv => Math.pow(10, lv));
      const ciT = KineticsAnalytics.curveConfidenceAndSensitivity(trainRows, fit, 'treated', sGrid, sigma);
      const ciU = KineticsAnalytics.curveConfidenceAndSensitivity(trainRows, fit, 'untreated', sGrid, sigma);
      const yMax = Math.max(...allObs.map(r => r.rate), pT.vmax, pU.vmax) * 1.1;
      const { sx, sy, g } = drawGrid(xMin, xMax, 0, yMax, `Log₁₀[S] (log₁₀ ${concUnit})`, `Initial velocity v (${rateUnit})`, 2, 0);
      parts.push(g);

      if (!isPooled) {
        const hx = sx(Math.log10(foldObj.level));
        parts.push(`<line x1="${hx.toFixed(1)}" x2="${hx.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#7c3aed" stroke-dasharray="5 4" stroke-width="1.5"/>`);
      }
      if (state.showCI) {
        for (const [ci, fill] of [[ciU, pal.untreatedFill], [ciT, pal.treatedFill]]) {
          const upper = ci.band.map((b, i) => `${sx(logGrid[i]).toFixed(1)},${sy(Math.min(yMax, b.hi)).toFixed(1)}`);
          const lower = [...ci.band].map((b, i) => [logGrid[i], b.lo]).reverse().map(([lx, lo]) => `${sx(lx).toFixed(1)},${sy(lo).toFixed(1)}`);
          parts.push(`<polygon points="${upper.concat(lower).join(' ')}" fill="${fill}"/>`);
        }
      }
      // Vmax asymptotes + log10(Km) inflection pins
      for (const [st, col, pState, ci] of [['untreated', pal.untreated, pU, ciU], ['treated', pal.treated, pT, ciT]]) {
        const vy = sy(pState.vmax);
        parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${vy.toFixed(1)}" y2="${vy.toFixed(1)}" stroke="${col}" stroke-opacity="0.32" stroke-dasharray="4 4"/>`);
        const lkm = Math.log10(pState.km);
        if (lkm >= xMin && lkm <= xMax) {
          const kx = sx(lkm), ky = sy(pState.vmax * 0.5);
          parts.push(`<line x1="${kx.toFixed(1)}" x2="${kx.toFixed(1)}" y1="${ky.toFixed(1)}" y2="${pad.t + ph}" stroke="${col}" stroke-opacity="0.45" stroke-dasharray="2 3"/>`);
          parts.push(`<circle cx="${kx.toFixed(1)}" cy="${ky.toFixed(1)}" r="4" fill="#fff" stroke="${col}" stroke-width="1.8" data-tip="${esc(`${st} inflection log₁₀(Km) = ${lkm.toFixed(2)} (Km = ${pState.km.toFixed(4)} ${concUnit})`)}"/>`);
        }
        const pts = ci.band.map((b, i) => `${sx(logGrid[i]).toFixed(1)},${sy(b.pred).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${col}" stroke-width="2.7" points="${pts}"/>`);
      }
      for (const r of allObs) parts.push(pointMarker(sx(Math.log10(r.conc)), sy(r.rate), r));
    } else if (tab === 'lb') {
      // Lineweaver-Burk: 1/v vs 1/[S], extending left to -1/Km so X & Y intercepts are directly visible!
      const minKm = Math.max(0.008, Math.min(pT.km, pU.km));
      const maxInvS = (1 / analysis.minConc) * 1.08;
      const minInvS = -Math.min(maxInvS * 0.55, (1 / minKm) * 1.28);
      const obsInvV = allObs.map(r => 1 / r.rate);
      const yMax = Math.max(...obsInvV) * 1.18;
      const { sx, sy, g } = drawGrid(minInvS, maxInvS, 0, yMax, `1 / [S] (${concUnit}⁻¹) · intercepts at −1/Km and 1/Vmax`, `1 / v (${rateUnit}⁻¹)`, 1, 3);
      parts.push(g);

      for (const [st, col, pState] of [['untreated', pal.untreated, pU], ['treated', pal.treated, pT]]) {
        if (pState.n === 1) {
          // Exact line: 1/v = (1/Vmax) + (Km/Vmax)*(1/S), x-intercept at -1/Km
          const xStart = Math.max(minInvS, -1 / pState.km);
          const yAtStart = (1 / pState.vmax) + (pState.km / pState.vmax) * xStart;
          const yAtEnd = (1 / pState.vmax) + (pState.km / pState.vmax) * maxInvS;
          parts.push(`<line x1="${sx(xStart).toFixed(1)}" y1="${sy(Math.max(0, yAtStart)).toFixed(1)}" x2="${sx(maxInvS).toFixed(1)}" y2="${sy(Math.min(yMax, yAtEnd)).toFixed(1)}" stroke="${col}" stroke-width="2.5"/>`);
          // Y-intercept dot (1/Vmax)
          parts.push(`<circle cx="${sx(0).toFixed(1)}" cy="${sy(1 / pState.vmax).toFixed(1)}" r="3.6" fill="#fff" stroke="${col}" stroke-width="1.8" data-tip="${esc(`${st} y-intercept 1/Vmax = ${(1 / pState.vmax).toFixed(4)} (Vmax = ${pState.vmax.toFixed(1)})`)}"/>`);
        } else {
          // Cooperative Hill curve in double-reciprocal space bends upward (n>1) or downward (n<1)!
          const invGrid = Array.from({ length: 70 }, (_, i) => (0.2 + ((maxInvS - 0.2) * i) / 69));
          const pts = invGrid
            .map(invS => [invS, 1 / Math.max(1e-6, KineticsAnalytics.predictRate(fit, st, 1 / invS))])
            .filter(([, iv]) => iv >= 0 && iv <= yMax)
            .map(([ix, iv]) => `${sx(ix).toFixed(1)},${sy(iv).toFixed(1)}`).join(' ');
          parts.push(`<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${pts}"/>`);
        }
      }

      // Draw noise-amplification whiskers ± s_pure / v^2 and data points
      for (const r of allObs) {
        const ix = sx(1 / r.conc), iy = sy(1 / r.rate);
        const ampErr = analysis.pure.sPure / (r.rate * r.rate);
        const yHi = sy(Math.min(yMax, 1 / r.rate + ampErr));
        const yLo = sy(Math.max(0, 1 / r.rate - ampErr));
        parts.push(`<line x1="${ix.toFixed(1)}" x2="${ix.toFixed(1)}" y1="${yLo.toFixed(1)}" y2="${yHi.toFixed(1)}" stroke="${pal[r.state]}" stroke-opacity="0.38" stroke-width="1.4"/>`);
        parts.push(pointMarker(ix, iy, r, `1/[S]=${(1 / r.conc).toFixed(1)}, 1/v=${(1 / r.rate).toFixed(4)}`));
      }
    } else if (tab === 'eh') {
      // Eadie-Hofstee: v vs v/[S]
      const obsX = allObs.map(r => r.rate / r.conc);
      const xMax = Math.max(...obsX, pT.vmax / pT.km, pU.vmax / pU.km) * 1.06;
      const yMax = Math.max(...allObs.map(r => r.rate), pT.vmax, pU.vmax) * 1.08;
      const { sx, sy, g } = drawGrid(0, xMax, 0, yMax, `v / [S] (${rateUnit} / ${concUnit})`, `Initial velocity v (${rateUnit})`, 0, 0);
      parts.push(g);

      for (const [st, col, pState] of [['untreated', pal.untreated, pU], ['treated', pal.treated, pT]]) {
        if (pState.n === 1) {
          const xInt = pState.vmax / pState.km;
          parts.push(`<line x1="${sx(0).toFixed(1)}" y1="${sy(pState.vmax).toFixed(1)}" x2="${sx(Math.min(xMax, xInt)).toFixed(1)}" y2="${sy(Math.max(0, pState.vmax - pState.km * Math.min(xMax, xInt))).toFixed(1)}" stroke="${col}" stroke-width="2.5"/>`);
        } else {
          const sGrid = Array.from({ length: 85 }, (_, i) => analysis.minConc * 0.4 * Math.pow((analysis.maxConc * 2.5) / (analysis.minConc * 0.4), i / 84));
          const pts = sGrid
            .map(s => { const v = KineticsAnalytics.predictRate(fit, st, s); return [v / s, v]; })
            .filter(([vx, vy]) => vx <= xMax && vy <= yMax)
            .map(([vx, vy]) => `${sx(vx).toFixed(1)},${sy(vy).toFixed(1)}`).join(' ');
          parts.push(`<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${pts}"/>`);
        }
      }
      for (const r of allObs) parts.push(pointMarker(sx(r.rate / r.conc), sy(r.rate), r, `v/[S]=${(r.rate / r.conc).toFixed(1)}`));
    } else if (tab === 'hw') {
      // Hanes-Woolf: [S]/v vs [S] (much more uniform variance across high [S]!)
      const xMin = -Math.max(pT.km, pU.km) * 1.35;
      const xMax = analysis.maxConc * 1.08;
      const obsY = allObs.map(r => r.conc / r.rate);
      const yMax = Math.max(...obsY) * 1.15;
      const { sx, sy, g } = drawGrid(xMin, xMax, 0, yMax, `Substrate concentration [S] (${concUnit}) · x-intercept at −Km`, `[S] / v (${concUnit} / (${rateUnit}))`, 2, 4);
      parts.push(g);

      for (const [st, col, pState] of [['untreated', pal.untreated, pU], ['treated', pal.treated, pT]]) {
        if (pState.n === 1) {
          const x0 = Math.max(xMin, -pState.km);
          const y0 = (pState.km + x0) / pState.vmax;
          const y1 = (pState.km + xMax) / pState.vmax;
          parts.push(`<line x1="${sx(x0).toFixed(1)}" y1="${sy(Math.max(0, y0)).toFixed(1)}" x2="${sx(xMax).toFixed(1)}" y2="${sy(Math.min(yMax, y1)).toFixed(1)}" stroke="${col}" stroke-width="2.5"/>`);
        } else {
          const sGrid = Array.from({ length: 80 }, (_, i) => analysis.minConc * 0.3 + ((xMax - analysis.minConc * 0.3) * i) / 79);
          const pts = sGrid
            .map(s => [s, s / Math.max(1e-6, KineticsAnalytics.predictRate(fit, st, s))])
            .filter(([, hy]) => hy <= yMax)
            .map(([hx, hy]) => `${sx(hx).toFixed(1)},${sy(hy).toFixed(1)}`).join(' ');
          parts.push(`<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${pts}"/>`);
        }
      }
      for (const r of allObs) parts.push(pointMarker(sx(r.conc), sy(r.conc / r.rate), r, `[S]/v=${(r.conc / r.rate).toFixed(5)}`));
    }

    svg.innerHTML = parts.join('');
    attachSvgTooltips(svg);

    byId('curve-legend').innerHTML =
      `<span><i class="kw-swatch" style="background:${pal.treated}"></i>Treated</span>` +
      `<span><i class="kw-swatch" style="background:${pal.untreated}"></i>Untreated</span>` +
      `<span>● Fitted</span>` +
      (isPooled ? `<span>Pooled LOO curves</span>` : `<span>✕ Held-out (${foldObj.level} ${esc(concUnit)})</span>`);

    renderCurveExplanation(ctx);
  }

  function renderCurveExplanation(ctx) {
    const { analysis, summary, isPooled, foldObj, fit } = ctx;
    const { concUnit, rateUnit } = analysis.meta;
    const pT = fit.treated, pU = fit.untreated;
    const tab = state.curveTab;
    const aud = state.audience;

    const configs = {
      mm: {
        title: 'Hyperbolic Saturation & Confidence Envelope',
        eq: summary.equation,
        body: aud === 'explorer'
          ? `Reaction velocity rises steeply at low substrate concentration and levels off toward a ceiling (Vmax) once enzyme active sites saturate. Here, Treated reaches an apparent ceiling of ${pT.vmax.toFixed(1)} vs ${pU.vmax.toFixed(1)} ${rateUnit} for Untreated.`
          : `Nonlinear least squares fits the saturation curve directly on measured velocities without distorting experimental error. Shaded bands show pointwise 95% confidence intervals around the active ${summary.short} fit${isPooled ? ' across all observations' : ` trained without ${foldObj.level} ${concUnit}`}.`,
        bullets: [
          `Apparent plateau shift ΔVmax = ${(pT.vmax - pU.vmax >= 0 ? '+' : '') + (pT.vmax - pU.vmax).toFixed(2)} ${rateUnit} (${(((pT.vmax - pU.vmax) / pU.vmax) * 100).toFixed(1)}%); half-saturation Km = ${pT.km.toFixed(4)} vs ${pU.km.toFixed(4)} ${concUnit}.`,
          isPooled
            ? `Viewing full-data curves alongside all ${analysis.rows.length} cross-validated observations (Pooled LOO RMSE = ${summary.pooled.rmse.toFixed(2)} ${rateUnit}).`
            : `Active split holds out ${foldObj.level} ${concUnit} (${foldObj.isOOD ? 'Out-of-Distribution boundary extrapolation!' : 'In-Domain interior interpolation'}): Split RMSE = ${ctx.evalMetrics.rmse.toFixed(2)} ${rateUnit}.`,
        ],
      },
      log: {
        title: 'Semi-Log Sigmoidal Dose–Response (QSAR / molML View)',
        eq: 'v(log₁₀[S]) = Vmax / (1 + 10^(n·(log₁₀Km − log₁₀[S])))',
        body: `Linear concentration axes compress low-dose points (${analysis.minConc}–${analysis.levels[2]} ${concUnit}) into a narrow sliver. Plotting against log₁₀[S]—standard across molecular ML benchmarks such as MoleculeACE (pEC50 / pKi)—unfolds the hyperbola into a symmetrical S-curve centered on log₁₀(Km).`,
        bullets: [
          `Inflection midpoints occur at log₁₀(Km) = ${Math.log10(pT.km).toFixed(2)} (Treated) and ${Math.log10(pU.km).toFixed(2)} (Untreated), where velocity equals exactly ½ Vmax.`,
          `A horizontal shift of the S-curve signals a Km (affinity) change, whereas a vertical stretch signals a Vmax (capacity) change.`,
        ],
      },
      lb: {
        title: 'Lineweaver–Burk Double-Reciprocal Diagnostic',
        eq: '1/v = (1/Vmax) + (Km/Vmax)·(1/[S])',
        body: `Inverts both axes so n = 1 Michaelis–Menten hyperbolas become straight lines meeting the vertical axis at 1/Vmax and the negative horizontal axis at −1/Km. Vertical whiskers (±s_pure / v²) reveal severe heteroscedastic error inflation at the rightmost low-[S] points.`,
        bullets: [
          Math.abs(pT.km - pU.km) / Math.max(pT.km, pU.km) < 0.08
            ? `Lines converge near −1/Km ≈ ${(-1 / pT.km).toFixed(1)} ${concUnit}⁻¹ on the horizontal axis—the classic signature of a pure Vmax (non-competitive / active-enzyme) effect.`
            : Math.abs(pT.vmax - pU.vmax) / Math.max(pT.vmax, pU.vmax) < 0.06
            ? `Lines intersect on the vertical 1/v axis at ${(1 / pT.vmax).toFixed(4)}—the classic signature of competitive inhibition (pure Km shift).`
            : `Both intercepts differ (1/Vmax = ${(1 / pT.vmax).toFixed(4)} vs ${(1 / pU.vmax).toFixed(4)}; −1/Km = ${(-1 / pT.km).toFixed(1)} vs ${(-1 / pU.km).toFixed(1)}), or curve if Hill n ≠ 1.`,
          `Pitfall: Unweighted linear regression on 1/v overweights the noisy ${analysis.minConc} ${concUnit} replicates by >${Math.round((analysis.rows.at(-1).rate / analysis.rows[0].rate) ** 4)}× relative to high-[S] points.`,
        ],
      },
      eh: {
        title: 'Eadie–Hofstee Diagnostic (Amplifies Cooperativity & Departures)',
        eq: 'v = Vmax − Km · (v / [S])',
        body: `Plots velocity v against catalytic ratio v/[S]. Steep slope equals −Km, vertical intercept gives Vmax, and horizontal intercept gives catalytic efficiency Vmax/Km. Unlike Lineweaver–Burk, Eadie–Hofstee spreads points evenly across saturation levels and makes allosteric cooperativity (n ≠ 1) immediately visible as curvature.`,
        bullets: [
          `Catalytic efficiency Vmax/Km = ${(pT.vmax / pT.km).toFixed(1)} (Treated) vs ${(pU.vmax / pU.km).toFixed(1)} (Untreated) ${rateUnit}/${concUnit}.`,
          `Caveat: Because noisy velocity v appears on both axes, measurement error correlates diagonally along lines through the origin.`,
        ],
      },
      hw: {
        title: 'Hanes–Woolf Linearization (Variance-Stabilized High-[S] Slope)',
        eq: '[S]/v = (Km/Vmax) + (1/Vmax)·[S]',
        body: `Multiplying Lineweaver–Burk by [S] yields slope 1/Vmax, vertical intercept Km/Vmax, and horizontal intercept −Km. Because [S] is controlled with negligible error, Hanes–Woolf avoids extreme low-dose leverage and estimates Vmax far more reliably than double-reciprocal plots.`,
        bullets: [
          `Parallel Hanes–Woolf slopes indicate identical Vmax (competitive Km shift); diverging slopes (${(1 / pT.vmax).toFixed(5)} vs ${(1 / pU.vmax).toFixed(5)}) confirm distinct Vmax plateaus.`,
          `X-axis intercepts sit at −Km = ${(-pT.km).toFixed(4)} (Treated) and ${(-pU.km).toFixed(4)} ${concUnit} (Untreated).`,
        ],
      },
    };

    const c = configs[tab];
    byId('curve-analysis').innerHTML = `
      <div class="kw-explain-top">
        <span class="kw-explain-title">${esc(c.title)}</span>
        <span class="kw-eq-pill">${esc(c.eq)}</span>
      </div>
      <p>${esc(c.body)}</p>
      <ul>${c.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
    `;
  }

  // ---------------------------------------------------------------------------
  // 3. RENDER RIGHT STAGE: 4 DIAGNOSTIC & ACTIVE-LEARNING GRAPHS + EXPLANATION
  // ---------------------------------------------------------------------------
  function renderDiagStage(ctx) {
    const { analysis, summary, isPooled, foldObj, fit, trainRows, sigma, allObs } = ctx;
    const pal = palette();
    const { concUnit, rateUnit } = analysis.meta;
    const svg = byId('residuals');
    const W = 680, H = 320;
    const pad = { l: 68, r: 24, t: 22, b: 48 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const tab = state.diagTab;
    let parts = [];

    if (tab === 'residual') {
      // Signed residuals vs Log10[S] so all 6 concentrations are cleanly separated!
      const xMin = Math.log10(analysis.minConc) - 0.3;
      const xMax = Math.log10(analysis.maxConc) + 0.25;
      const maxRes = Math.max(analysis.pure.sPure * 1.5, ...allObs.map(r => Math.abs(r.residual))) * 1.18;
      const sx = v => pad.l + ((v - xMin) / (xMax - xMin)) * pw;
      const sy = v => pad.t + ph - ((v + maxRes) / (2 * maxRes)) * ph;

      // Pure replicate noise corridor (± s_pure)
      if (analysis.pure.sPure > 0) {
        const yTop = sy(analysis.pure.sPure), yBot = sy(-analysis.pure.sPure);
        parts.push(`<rect x="${pad.l}" y="${yTop.toFixed(1)}" width="${pw}" height="${(yBot - yTop).toFixed(1)}" fill="rgba(22,101,52,0.07)"/>`);
      }

      for (let i = 0; i <= 4; i++) {
        const yv = -maxRes + (2 * maxRes * i) / 4;
        const py = sy(yv);
        parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${py.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${Math.abs(yv) < 1e-6 ? '#4f6d60' : '#dce7df'}" stroke-width="${Math.abs(yv) < 1e-6 ? '1.6' : '1'}"/>`);
        parts.push(`<text x="${pad.l - 8}" y="${(py + 4).toFixed(1)}" text-anchor="end">${yv.toFixed(0)}</text>`);
      }
      for (const lv of analysis.levels) {
        const px = sx(Math.log10(lv));
        parts.push(`<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#edf3ee"/>`);
        parts.push(`<text x="${px.toFixed(1)}" y="${pad.t + ph + 18}" text-anchor="middle">${lv}</text>`);
      }
      if (!isPooled) {
        const hx = sx(Math.log10(foldObj.level));
        parts.push(`<line x1="${hx.toFixed(1)}" x2="${hx.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#7c3aed" stroke-dasharray="5 4" stroke-width="1.5"/>`);
      }

      // Connect condition-mean residuals per concentration to expose systematic bias waves!
      for (const [st, col] of [['untreated', pal.untreated], ['treated', pal.treated]]) {
        const meanPts = analysis.levels.map(lv => {
          const sub = allObs.filter(r => r.state === st && r.conc === lv);
          const mRes = sub.reduce((a, b) => a + b.residual, 0) / Math.max(1, sub.length);
          return `${sx(Math.log10(lv)).toFixed(1)},${sy(mRes).toFixed(1)}`;
        }).join(' ');
        parts.push(`<polyline fill="none" stroke="${col}" stroke-opacity="0.55" stroke-width="1.8" stroke-dasharray="4 3" points="${meanPts}"/>`);
      }

      for (const r of allObs) {
        const px = sx(Math.log10(r.conc)) + (r.state === 'treated' ? 3.5 : -3.5);
        const py = sy(r.residual);
        const col = pal[r.state];
        const tip = esc(`Obs #${r.id} (${r.state}, [S]=${r.conc}) · Residual = ${r.residual >= 0 ? '+' : ''}${r.residual.toFixed(2)} ${rateUnit}`);
        if (r.held && !isPooled) {
          parts.push(`<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})" data-tip="${tip}" style="cursor:pointer"><circle r="7.5" fill="rgba(255,244,214,0.9)" stroke="${col}" stroke-width="1.5"/><path d="M-4.2 -4.2L4.2 4.2 M-4.2 4.2L4.2 -4.2" stroke="${col}" stroke-width="2.4"/></g>`);
        } else {
          parts.push(`<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})" data-tip="${tip}" style="cursor:pointer"><circle r="4.6" fill="${col}" stroke="#fff" stroke-width="1.2"/></g>`);
        }
      }

      parts.push(`<rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="none" stroke="#b9ccc0"/>`);
      parts.push(`<text class="axis-title" x="${pad.l + pw / 2}" y="${H - 9}" text-anchor="middle">Substrate concentration [S] (${esc(concUnit)}, log-spaced)</text>`);
      parts.push(`<text class="axis-title" transform="translate(17 ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle">Residual y − ŷ (${esc(rateUnit)})</text>`);
      byId('diag-legend').innerHTML =
        `<span><i class="kw-swatch" style="background:rgba(22,101,52,0.18)"></i>±s<sub>pure</sub> noise band (${analysis.pure.sPure.toFixed(1)})</span>` +
        `<span>Dashed = mean trend per state</span>`;
    } else if (tab === 'parity') {
      // Parity plot: Predicted vs Observed (molML QSAR benchmark staple)
      const vals = allObs.flatMap(r => [r.rate, r.prediction]);
      const lo = Math.max(0, Math.min(...vals) * 0.85);
      const hi = Math.max(...vals) * 1.08;
      const sx = v => pad.l + ((v - lo) / (hi - lo)) * pw;
      const sy = v => pad.t + ph - ((v - lo) / (hi - lo)) * ph;

      for (let i = 0; i <= 4; i++) {
        const v = lo + ((hi - lo) * i) / 4;
        parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" stroke="#dce7df"/>`);
        parts.push(`<line x1="${sx(v).toFixed(1)}" x2="${sx(v).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#edf3ee"/>`);
        parts.push(`<text x="${pad.l - 8}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${v.toFixed(0)}</text>`);
        parts.push(`<text x="${sx(v).toFixed(1)}" y="${pad.t + ph + 18}" text-anchor="middle">${v.toFixed(0)}</text>`);
      }

      // ±RMSE corridor around y = x
      const bandW = summary.pooled.rmse;
      const poly = [
        [lo, Math.min(hi, lo + bandW)],
        [Math.max(lo, hi - bandW), hi],
        [hi, hi],
        [hi, Math.max(lo, hi - bandW)],
        [Math.min(hi, lo + bandW), lo],
        [lo, lo],
      ].map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
      parts.push(`<polygon points="${poly}" fill="rgba(15,118,110,0.08)"/>`);
      parts.push(`<line x1="${sx(lo).toFixed(1)}" y1="${sy(lo).toFixed(1)}" x2="${sx(hi).toFixed(1)}" y2="${sy(hi).toFixed(1)}" stroke="#335c50" stroke-width="1.8" stroke-dasharray="5 4"/>`);

      for (const r of allObs) {
        const px = sx(r.rate), py = sy(r.prediction);
        const col = pal[r.state];
        const tip = esc(`Obs #${r.id} (${r.state}, [S]=${r.conc}) · Observed ${r.rate} vs Predicted ${r.prediction.toFixed(2)}`);
        if (r.held && !isPooled) {
          parts.push(`<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})" data-tip="${tip}"><circle r="7.2" fill="rgba(255,244,214,0.9)" stroke="${col}" stroke-width="1.5"/><path d="M-4 -4L4 4 M-4 4L4 -4" stroke="${col}" stroke-width="2.3"/></g>`);
        } else {
          parts.push(`<g transform="translate(${px.toFixed(1)} ${py.toFixed(1)})" data-tip="${tip}"><circle r="4.8" fill="${col}" stroke="#fff" stroke-width="1.2"/></g>`);
        }
      }

      const m = KineticsAnalytics.computeMetrics(allObs);
      parts.push(`<rect x="${pad.l + 12}" y="${pad.t + 10}" width="188" height="44" rx="7" fill="rgba(255,255,255,0.92)" stroke="#c6d8cd"/>`);
      parts.push(`<text x="${pad.l + 22}" y="${pad.t + 28}" font-weight="700">R² = ${m.r2.toFixed(3)} · CCC = ${m.ccc.toFixed(3)}</text>`);
      parts.push(`<text x="${pad.l + 22}" y="${pad.t + 45}" fill="#496359">Bias = ${m.bias >= 0 ? '+' : ''}${m.bias.toFixed(2)} ${esc(rateUnit)}</text>`);

      parts.push(`<rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="none" stroke="#b9ccc0"/>`);
      parts.push(`<text class="axis-title" x="${pad.l + pw / 2}" y="${H - 9}" text-anchor="middle">Observed velocity y (${esc(rateUnit)})</text>`);
      parts.push(`<text class="axis-title" transform="translate(17 ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle">Predicted velocity ŷ (${esc(rateUnit)})</text>`);
      byId('diag-legend').innerHTML = `<span>Dashed = y = x identity</span><span>Shaded = ±Pooled RMSE (${summary.pooled.rmse.toFixed(1)})</span>`;
    } else if (tab === 'qq') {
      // Normal Q-Q Plot of Standardized Residuals
      const denomS = Math.max(1e-6, sigma);
      const sorted = [...allObs]
        .map(r => ({ ...r, z: r.residual / denomS }))
        .sort((a, b) => a.z - b.z);
      const m = sorted.length;
      const qqPts = sorted.map((r, i) => ({
        ...r,
        theo: normInv((i + 1 - 0.375) / (m + 0.25)),
      }));
      const bound = Math.max(2.6, ...qqPts.flatMap(p => [Math.abs(p.theo), Math.abs(p.z)])) * 1.1;
      const sx = v => pad.l + ((v + bound) / (2 * bound)) * pw;
      const sy = v => pad.t + ph - ((v + bound) / (2 * bound)) * ph;

      for (const tk of [-2, -1, 0, 1, 2]) {
        parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(tk).toFixed(1)}" y2="${sy(tk).toFixed(1)}" stroke="${Math.abs(tk) === 2 ? '#e2c6c2' : '#dce7df'}" stroke-dasharray="${Math.abs(tk) === 2 ? '4 3' : ''}"/>`);
        parts.push(`<line x1="${sx(tk).toFixed(1)}" x2="${sx(tk).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#edf3ee"/>`);
        parts.push(`<text x="${pad.l - 8}" y="${(sy(tk) + 4).toFixed(1)}" text-anchor="end">${tk}σ</text>`);
        parts.push(`<text x="${sx(tk).toFixed(1)}" y="${pad.t + ph + 18}" text-anchor="middle">${tk}σ</text>`);
      }
      parts.push(`<line x1="${sx(-bound).toFixed(1)}" y1="${sy(-bound).toFixed(1)}" x2="${sx(bound).toFixed(1)}" y2="${sy(bound).toFixed(1)}" stroke="#335c50" stroke-width="1.8" stroke-dasharray="5 4"/>`);

      for (const p of qqPts) {
        const tip = esc(`Obs #${p.id} (${p.state}, [S]=${p.conc}) · Std. z = ${p.z >= 0 ? '+' : ''}${p.z.toFixed(2)}σ vs Normal ${p.theo.toFixed(2)}σ`);
        parts.push(`<circle cx="${sx(p.theo).toFixed(1)}" cy="${sy(p.z).toFixed(1)}" r="4.8" fill="${pal[p.state]}" stroke="#fff" stroke-width="1.2" data-tip="${tip}"/>`);
      }
      parts.push(`<rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="none" stroke="#b9ccc0"/>`);
      parts.push(`<text class="axis-title" x="${pad.l + pw / 2}" y="${H - 9}" text-anchor="middle">Theoretical Gaussian quantile (σ)</text>`);
      parts.push(`<text class="axis-title" transform="translate(17 ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle">Standardized residual (y − ŷ) / s</text>`);
      byId('diag-legend').innerHTML = `<span>Diagonal = Gaussian noise</span><span>Red dashed = ±2σ outlier threshold</span>`;
    } else if (tab === 'active') {
      // Active-Learning Fisher Sensitivity & Optimal Next-Dose Curve (molML active learning!)
      const xMin = Math.log10(analysis.minConc) - 0.35;
      const xMax = Math.log10(analysis.maxConc) + 0.35;
      const logGrid = Array.from({ length: 90 }, (_, i) => xMin + ((xMax - xMin) * i) / 89);
      const sGrid = logGrid.map(lv => Math.pow(10, lv));
      const ciT = KineticsAnalytics.curveConfidenceAndSensitivity(trainRows, fit, 'treated', sGrid, sigma);

      // Normalize sensitivity curves onto [0, 1] information utility scale
      const maxSe = Math.max(1e-6, ...ciT.band.map(b => b.se));
      // Combined D-optimal utility balancing affinity (4*sensKm peaks at 1.0 at Km) + predictive SE
      const utilities = ciT.band.map(b => 0.62 * (b.sensKm * 4) + 0.38 * (b.se / maxSe));
      let bestIdx = 0;
      utilities.forEach((u, i) => { if (u > utilities[bestIdx]) bestIdx = i; });
      const optS = sGrid[bestIdx];

      const sx = v => pad.l + ((v - xMin) / (xMax - xMin)) * pw;
      const sy = v => pad.t + ph - v * ph;

      for (let i = 0; i <= 4; i++) {
        const v = i / 4;
        parts.push(`<line x1="${pad.l}" x2="${W - pad.r}" y1="${sy(v).toFixed(1)}" y2="${sy(v).toFixed(1)}" stroke="#dce7df"/>`);
        parts.push(`<text x="${pad.l - 8}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end">${(v * 100).toFixed(0)}%</text>`);
      }
      for (const lv of analysis.levels) {
        const px = sx(Math.log10(lv));
        parts.push(`<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#e2ece5" stroke-dasharray="2 3"/>`);
        parts.push(`<text x="${px.toFixed(1)}" y="${pad.t + ph + 18}" text-anchor="middle">${lv}</text>`);
      }

      const kmSensPts = ciT.band.map((b, i) => `${sx(logGrid[i]).toFixed(1)},${sy(Math.min(1, b.sensKm * 4)).toFixed(1)}`).join(' ');
      const vmaxSensPts = ciT.band.map((b, i) => `${sx(logGrid[i]).toFixed(1)},${sy(Math.min(1, b.sensVmax)).toFixed(1)}`).join(' ');
      const sePts = ciT.band.map((b, i) => `${sx(logGrid[i]).toFixed(1)},${sy(b.se / maxSe).toFixed(1)}`).join(' ');

      parts.push(`<polyline fill="none" stroke="#0053d6" stroke-width="2.6" points="${kmSensPts}"/>`);
      parts.push(`<polyline fill="none" stroke="#0b7a5c" stroke-width="2.2" stroke-dasharray="5 3" points="${vmaxSensPts}"/>`);
      parts.push(`<polyline fill="none" stroke="#c97924" stroke-width="2.2" points="${sePts}"/>`);

      // Optimal Next-Dose vertical recommendation pin
      const ox = sx(Math.log10(optS));
      parts.push(`<line x1="${ox.toFixed(1)}" x2="${ox.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#7c3aed" stroke-width="2"/>`);
      parts.push(`<rect x="${Math.min(W - pad.r - 172, Math.max(pad.l + 6, ox - 84)).toFixed(1)}" y="${pad.t + 8}" width="168" height="24" rx="12" fill="#7c3aed"/>`);
      parts.push(`<text x="${Math.min(W - pad.r - 88, Math.max(pad.l + 90, ox)).toFixed(1)}" y="${pad.t + 24}" text-anchor="middle" style="fill:#ffffff;font-weight:700;font-size:11.5px">Next [S]* ≈ ${optS.toFixed(3)} ${esc(concUnit)}</text>`);

      parts.push(`<rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="none" stroke="#b9ccc0"/>`);
      parts.push(`<text class="axis-title" x="${pad.l + pw / 2}" y="${H - 9}" text-anchor="middle">Candidate substrate concentration [S] (${esc(concUnit)}, log-spaced)</text>`);
      parts.push(`<text class="axis-title" transform="translate(17 ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle">Normalized Fisher sensitivity &amp; SE</text>`);
      byId('diag-legend').innerHTML =
        `<span><i class="kw-swatch" style="background:#0053d6"></i>Km info (peaks at [S]=Km)</span>` +
        `<span><i class="kw-swatch" style="background:#0b7a5c"></i>Vmax info</span>` +
        `<span><i class="kw-swatch" style="background:#c97924"></i>Pred. SE</span>`;
    }

    svg.innerHTML = parts.join('');
    attachSvgTooltips(svg);
    renderDiagExplanation(ctx);
  }

  function renderDiagExplanation(ctx) {
    const { analysis, summary, fit, allObs } = ctx;
    const { concUnit, rateUnit } = analysis.meta;
    const tab = state.diagTab;
    const m = KineticsAnalytics.computeMetrics(allObs);
    const outliers = allObs.filter(r => Math.abs(r.residual / Math.max(1e-6, ctx.sigma)) > 2);

    const configs = {
      residual: {
        title: 'Signed Residual Structure vs. Pure Replicate Noise',
        eq: 'e_i = y_i − ŷ_i',
        body: `A well-specified kinetic law should leave unpatterned residuals scattered inside the shaded ±s_pure (${analysis.pure.sPure.toFixed(1)} ${rateUnit}) experimental replicate band. Persistent separation between the Treated and Untreated dashed mean traces diagnoses an unmodeled condition parameter.`,
        bullets: [
          `Mean signed bias = ${m.bias >= 0 ? '+' : ''}${m.bias.toFixed(2)} ${rateUnit}; Pooled RMSE (${summary.pooled.rmse.toFixed(2)}) is ${(summary.pooled.rmse / Math.max(1e-6, analysis.pure.sPure)).toFixed(2)}× the irreducible replicate noise floor.`,
          summary.id === 'shared'
            ? `Notice the wide vertical split between Treated (+) and Untreated (−) residuals at high [S]—direct proof that a single shared curve underpredicts Treated and overpredicts Untreated.`
            : `Residual scatter across interior concentrations closely approaches replicate noise, with remaining error concentrated at low-dose boundary holdouts.`,
        ],
      },
      parity: {
        title: 'Parity & Concordance Audit (Predicted ŷ vs. Observed y)',
        eq: `CCC = ${m.ccc.toFixed(3)} · R² = ${m.r2.toFixed(3)}`,
        body: `Standard across molecular property benchmarks (molML), parity plots test alignment with the 45° y = x identity line. Unlike Pearson correlation, Lin’s Concordance Correlation Coefficient (CCC) penalizes both scale compression and vertical location bias.`,
        bullets: [
          `Displayed observations achieve R² = ${m.r2.toFixed(3)} and Lin’s CCC = ${m.ccc.toFixed(3)} within a ±${summary.pooled.rmse.toFixed(1)} ${rateUnit} RMSE corridor.`,
          `Systematic tilt away from 45° indicates underpredicted high-rate plateaus or unmodeled cooperativity.`,
        ],
      },
      qq: {
        title: 'Gaussian Quantile–Quantile (Q–Q) Normality & Outlier Check',
        eq: 'z_(i) vs Φ⁻¹((i − 0.375)/(N + 0.25))',
        body: `Least-squares AICc and F-test confidence regions assume approximately Gaussian, homoscedastic errors. Points tracking the 45° diagonal support Gaussian error assumptions; S-shaped tails or points beyond ±2σ flag outliers or model misspecification.`,
        bullets: [
          outliers.length
            ? `${outliers.length} observation(s) exceed ±2σ (${outliers.map(o => `#${o.id} at ${o.conc} ${concUnit}`).join(', ')})—inspect whether these arise at an extrapolated OOD fold.`
            : `Zero observations exceed ±2σ under ${summary.short}, supporting well-behaved Gaussian residual variance.`,
          `Estimated residual scale s = ${ctx.sigma.toFixed(2)} ${rateUnit}.`,
        ],
      },
      active: {
        title: 'Active-Learning Next-Dose Fisher Information Design',
        eq: 'argmax_[S] I(Km, Vmax; [S])',
        body: `Inspired by active-learning loops in self-driving molecular labs (molML), Fisher sensitivity reveals where a new measurement carries maximum mechanistic leverage: Km information (blue) peaks sharply at [S] = Km (${fit.treated.km.toFixed(3)} ${concUnit}), whereas Vmax information (green) saturates only above [S] > 5·Km.`,
        bullets: [
          `To tighten half-saturation Km most efficiently, add replicates near [S] ≈ ${fit.treated.km.toFixed(3)}–${fit.untreated.km.toFixed(3)} ${concUnit}.`,
          `To resolve subtle Vmax vs. Hill-exponent extrapolation, add a high-saturation anchor above ${(analysis.maxConc * 1.4).toFixed(2)} ${concUnit} across independent biological runs.`,
        ],
      },
    };

    const c = configs[tab];
    byId('diag-analysis').innerHTML = `
      <div class="kw-explain-top">
        <span class="kw-explain-title">${esc(c.title)}</span>
        <span class="kw-eq-pill">${esc(c.eq)}</span>
      </div>
      <p>${esc(c.body)}</p>
      <ul>${c.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
    `;
  }

  // ---------------------------------------------------------------------------
  // 4. RENDER DEEP SECTION LEFT: 5x6 HOLDOUT HEATMAP + OOD BAR CHART
  // ---------------------------------------------------------------------------
  function renderRegimeSection(ctx) {
    const { analysis, mId, isPooled, foldIdx } = ctx;
    const { concUnit, rateUnit } = analysis.meta;
    const allErrs = analysis.foldFits.flatMap(f =>
      KineticsAnalytics.MODEL_CATALOG.map(m => f.models[m.id].metrics.rmse)
    );
    const lo = Math.min(...allErrs), hi = Math.max(...allErrs);

    const tbl = byId('fold-heatmap');
    let html = `<thead><tr><th class="row-h">Model \\ Held [S]</th>` +
      analysis.foldFits.map(f =>
        `<th>${f.level}<br><span style="font-weight:500;font-size:10px;color:${f.isOOD ? '#6d28d9' : '#526b60'}">${f.isOOD ? 'OOD' : 'In-Dom'}</span></th>`
      ).join('') +
      `<th>Pooled</th></tr></thead><tbody>`;

    for (const mSpec of KineticsAnalytics.MODEL_CATALOG) {
      const s = analysis.summaryByModel[mSpec.id];
      html += `<tr><th class="row-h">${esc(mSpec.short)}</th>`;
      analysis.foldFits.forEach((f, idx) => {
        const val = f.models[mSpec.id].metrics.rmse;
        const t = (val - lo) / Math.max(1e-9, hi - lo);
        // Mint-white (low error) -> deep teal/amber-coral (high error)
        const bg = t < 0.45
          ? `hsl(156, 42%, ${95 - t * 42}%)`
          : `hsl(${Math.round(42 - (t - 0.45) * 65)}, 72%, ${90 - t * 32}%)`;
        const fg = t > 0.72 ? '#ffffff' : '#13312a';
        const isActive = !isPooled && idx === foldIdx && mSpec.id === mId;
        html += `<td><button type="button" class="kw-heat-cell ${isActive ? 'active' : ''}" data-hmodel="${mSpec.id}" data-hfold="${idx}" style="background:${bg};color:${fg}" title="${esc(`${mSpec.name} @ ${f.level} ${concUnit}: RMSE ${val.toFixed(2)} ${rateUnit}`)}">${val.toFixed(1)}</button></td>`;
      });
      const isPoolActive = isPooled && mSpec.id === mId;
      html += `<td><button type="button" class="kw-heat-cell ${isPoolActive ? 'active' : ''}" data-hmodel="${mSpec.id}" data-hfold="pooled" style="background:#e7f0eb;color:#12382e;font-weight:750">${s.pooled.rmse.toFixed(1)}</button></td></tr>`;
    }
    html += `</tbody>`;
    tbl.innerHTML = html;

    tbl.querySelectorAll('[data-hmodel]').forEach(btn => {
      btn.onclick = () => {
        state.modelId = btn.dataset.hmodel;
        state.foldValue = btn.dataset.hfold;
        byId('model').value = state.modelId;
        byId('concentration').value = state.foldValue;
        renderAll();
      };
    });

    // Grouped Bar Chart: In-Domain RMSE vs OOD Extrapolation RMSE across all 5 models
    const barSvg = byId('regime-bars');
    const BW = 620, BH = 185, bp = { l: 54, r: 18, t: 22, b: 36 };
    const bpw = BW - bp.l - bp.r, bph = BH - bp.t - bp.b;
    const models = KineticsAnalytics.MODEL_CATALOG;
    const yMax = Math.max(...models.flatMap(m => [analysis.summaryByModel[m.id].interp.rmse, analysis.summaryByModel[m.id].ood.rmse]), analysis.pure.sPure) * 1.15;
    const sy = v => bp.t + bph - (v / Math.max(1e-6, yMax)) * bph;

    let bParts = [];
    for (let i = 0; i <= 3; i++) {
      const yv = (yMax * i) / 3;
      bParts.push(`<line x1="${bp.l}" x2="${BW - bp.r}" y1="${sy(yv).toFixed(1)}" y2="${sy(yv).toFixed(1)}" stroke="#e1ebe4"/>`);
      bParts.push(`<text x="${bp.l - 6}" y="${(sy(yv) + 4).toFixed(1)}" text-anchor="end">${yv.toFixed(0)}</text>`);
    }
    // Pure replicate noise reference line
    if (analysis.pure.sPure > 0) {
      const py = sy(analysis.pure.sPure);
      bParts.push(`<line x1="${bp.l}" x2="${BW - bp.r}" y1="${py.toFixed(1)}" y2="${py.toFixed(1)}" stroke="#15803d" stroke-width="1.5" stroke-dasharray="4 3"/>`);
      bParts.push(`<text x="${BW - bp.r - 4}" y="${(py - 4).toFixed(1)}" text-anchor="end" fill="#15803d" font-size="11" font-weight="650">Replicate floor (${analysis.pure.sPure.toFixed(1)})</text>`);
    }

    const barLabels = {
      shared: 'Shared',
      split_vmax: 'Cond. Vmax',
      split_km: 'Cond. Km',
      split_both: 'Cond. Both',
      hill_both: 'Hill (n)',
    };
    const slotW = bpw / models.length;
    models.forEach((m, i) => {
      const s = analysis.summaryByModel[m.id];
      const cx = bp.l + slotW * (i + 0.5);
      const bw = Math.min(24, slotW * 0.32);
      const hIn = bph - (sy(s.interp.rmse) - bp.t);
      const hOod = bph - (sy(s.ood.rmse) - bp.t);
      const isSel = m.id === mId;
      bParts.push(`<rect x="${(cx - bw - 2).toFixed(1)}" y="${sy(s.interp.rmse).toFixed(1)}" width="${bw}" height="${hIn.toFixed(1)}" rx="3" fill="#0d9488" opacity="${isSel ? '1' : '0.68'}" data-tip="${esc(`${m.name} · In-Domain Interpolation RMSE: ${s.interp.rmse.toFixed(2)} ${rateUnit}`)}"/>`);
      bParts.push(`<rect x="${(cx + 2).toFixed(1)}" y="${sy(s.ood.rmse).toFixed(1)}" width="${bw}" height="${hOod.toFixed(1)}" rx="3" fill="#7c3aed" opacity="${isSel ? '1' : '0.68'}" data-tip="${esc(`${m.name} · OOD Boundary Extrapolation RMSE: ${s.ood.rmse.toFixed(2)} ${rateUnit}`)}"/>`);
      bParts.push(`<text x="${cx.toFixed(1)}" y="${BH - 11}" text-anchor="middle" style="font-size:11.5px;font-weight:${isSel ? '700' : '500'}">${esc(barLabels[m.id] || m.short)}</text>`);
    });
    bParts.push(`<rect x="${bp.l + 8}" y="4" width="10" height="10" rx="2" fill="#0d9488"/><text x="${bp.l + 22}" y="13" style="font-size:11.5px;font-weight:600">In-Domain Interp</text>`);
    bParts.push(`<rect x="${bp.l + 138}" y="4" width="10" height="10" rx="2" fill="#7c3aed"/><text x="${bp.l + 152}" y="13" style="font-size:11.5px;font-weight:600">OOD Boundary Extrap</text>`);
    barSvg.innerHTML = bParts.join('');
    attachSvgTooltips(barSvg);

    const activeS = analysis.summaryByModel[mId];
    byId('regime-analysis').innerHTML = `
      <div class="kw-explain-top">
        <span class="kw-explain-title">Interpolation vs. Out-of-Distribution (OOD) Cliff Analysis</span>
        <span class="kw-eq-pill">OOD / In-Domain = ${activeS.oodRatio.toFixed(2)}×</span>
      </div>
      <p>Holding out interior concentrations (${analysis.levels.slice(1, -1).join(', ')} ${esc(concUnit)}) lets models interpolate between bracketing neighbors, whereas holding out ${analysis.minConc} or ${analysis.maxConc} ${esc(concUnit)} forces genuine OOD extrapolation into the low-dose catalytic slope or high-dose saturation ceiling.</p>
      <ul>
        <li>Under <strong>${esc(activeS.short)}</strong>, interior interpolation RMSE is <strong>${activeS.interp.rmse.toFixed(2)}</strong> vs. OOD extrapolation RMSE <strong>${activeS.ood.rmse.toFixed(2)} ${esc(rateUnit)}</strong>.</li>
        <li>Notice at high saturation (${analysis.maxConc} ${esc(concUnit)}), Shared Vmax &amp; Km suffers ${analysis.foldFits.at(-1).models.shared.metrics.rmse.toFixed(1)} RMSE while Condition Vmax drops error to ${analysis.foldFits.at(-1).models.split_vmax.metrics.rmse.toFixed(1)} ${esc(rateUnit)}.</li>
      </ul>
    `;
  }

  // ---------------------------------------------------------------------------
  // 5. RENDER DEEP SECTION RIGHT: 2D PARAMETER SSE LANDSCAPE & EXACT 95% CONTOURS
  // ---------------------------------------------------------------------------
  function renderContourLandscape(ctx) {
    const { analysis, fit } = ctx;
    const pal = palette();
    const { concUnit, rateUnit } = analysis.meta;
    const canvas = byId('contour-canvas');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 600, H = 390;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#fbfdfb';
    c.fillRect(0, 0, W, H);

    const pad = { l: 64, r: 22, t: 24, b: 46 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;

    const sepFit = analysis.summaryByModel.split_both.fullFit;
    const uRows = analysis.rows.filter(r => r.state === 'untreated');
    const tRows = analysis.rows.filter(r => r.state === 'treated');

    const kmMin = Math.max(1e-4, Math.min(sepFit.untreated.km, sepFit.treated.km, fit.untreated.km, fit.treated.km) * 0.28);
    const kmMax = Math.max(sepFit.untreated.km, sepFit.treated.km, fit.untreated.km, fit.treated.km) * 2.15;
    const vMin = Math.min(sepFit.untreated.vmax, sepFit.treated.vmax, fit.untreated.vmax, fit.treated.vmax) * 0.72;
    const vMax = Math.max(sepFit.untreated.vmax, sepFit.treated.vmax, fit.untreated.vmax, fit.treated.vmax) * 1.24;

    const GX = 240, GY = 170;
    const sseU = new Float64Array(GX * GY);
    const sseT = new Float64Array(GX * GY);
    const totalLog = new Float64Array(GX * GY);
    let minU = Infinity, minT = Infinity, loLog = Infinity, hiLog = -Infinity;

    const nU = fit.untreated.n, nT = fit.treated.n;

    for (let iy = 0; iy < GY; iy++) {
      const vmax = vMax - ((vMax - vMin) * iy) / (GY - 1);
      for (let ix = 0; ix < GX; ix++) {
        const km = kmMin + ((kmMax - kmMin) * ix) / (GX - 1);
        let su = 0, st = 0;
        const knU = nU === 1 ? km : Math.pow(km, nU);
        const knT = nT === 1 ? km : Math.pow(km, nT);
        for (let k = 0; k < uRows.length; k++) {
          const sn = nU === 1 ? uRows[k].conc : Math.pow(uRows[k].conc, nU);
          const e = uRows[k].rate - (vmax * sn) / (knU + sn);
          su += e * e;
        }
        for (let k = 0; k < tRows.length; k++) {
          const sn = nT === 1 ? tRows[k].conc : Math.pow(tRows[k].conc, nT);
          const e = tRows[k].rate - (vmax * sn) / (knT + sn);
          st += e * e;
        }
        const idx = iy * GX + ix;
        sseU[idx] = su;
        sseT[idx] = st;
        if (su < minU) minU = su;
        if (st < minT) minT = st;
        const lv = Math.log10(Math.min(su, st) + 1);
        totalLog[idx] = lv;
        if (lv < loLog) loLog = lv;
        if (lv > hiLog) hiLog = lv;
      }
    }

    const threshU = minU * (1 + (2 / Math.max(2, uRows.length - 2)) * KineticsAnalytics.fCrit95(2, Math.max(2, uRows.length - 2)));
    const threshT = minT * (1 + (2 / Math.max(2, tRows.length - 2)) * KineticsAnalytics.fCrit95(2, Math.max(2, tRows.length - 2)));

    const off = document.createElement('canvas');
    off.width = GX;
    off.height = GY;
    const octx = off.getContext('2d');
    const img = octx.createImageData(GX, GY);
    for (let i = 0; i < GX * GY; i++) {
      const t = (totalLog[i] - loLog) / Math.max(1e-6, hiLog - loLog);
      const q = Math.floor(t * 16) / 16;
      let r = Math.round(245 - q * 32);
      let g = Math.round(249 - q * 22);
      let b = Math.round(247 - q * 26);
      if (sseU[i] <= threshU) {
        r = state.colorblind ? 242 : 243;
        g = state.colorblind ? 198 : 196;
        b = state.colorblind ? 166 : 176;
      }
      if (sseT[i] <= threshT) {
        r = state.colorblind ? 174 : 174;
        g = state.colorblind ? 214 : 228;
        b = state.colorblind ? 240 : 212;
      }
      if (sseU[i] <= threshU && sseT[i] <= threshT) {
        r = 192; g = 198; b = 228;
      }
      img.data[4 * i] = r;
      img.data[4 * i + 1] = g;
      img.data[4 * i + 2] = b;
      img.data[4 * i + 3] = 255;
    }
    octx.putImageData(img, 0, 0);
    c.imageSmoothingEnabled = true;
    c.drawImage(off, pad.l, pad.t, pw, ph);

    // Smooth marching-squares linear-interpolated contour segments
    const drawMarchingContour = (grid, thr, stroke) => {
      c.strokeStyle = stroke;
      c.lineWidth = 1.9;
      c.lineCap = 'round';
      c.beginPath();
      const interp = (v1, v2) => {
        const d = v2 - v1;
        return Math.abs(d) < 1e-12 ? 0.5 : Math.max(0, Math.min(1, (thr - v1) / d));
      };
      for (let iy = 0; iy < GY - 1; iy++) {
        for (let ix = 0; ix < GX - 1; ix++) {
          const i00 = grid[iy * GX + ix];
          const i10 = grid[iy * GX + ix + 1];
          const i01 = grid[(iy + 1) * GX + ix];
          const i11 = grid[(iy + 1) * GX + ix + 1];
          const code = (i00 <= thr ? 8 : 0) | (i10 <= thr ? 4 : 0) | (i11 <= thr ? 2 : 0) | (i01 <= thr ? 1 : 0);
          if (code === 0 || code === 15) continue;
          const top = [ix + interp(i00, i10), iy];
          const right = [ix + 1, iy + interp(i10, i11)];
          const bottom = [ix + interp(i01, i11), iy + 1];
          const left = [ix, iy + interp(i00, i01)];
          const toScreen = ([gx, gy]) => [pad.l + (gx / (GX - 1)) * pw, pad.t + (gy / (GY - 1)) * ph];
          const segs = {
            1: [[left, bottom]], 2: [[bottom, right]], 3: [[left, right]], 4: [[top, right]],
            5: [[left, top], [bottom, right]], 6: [[top, bottom]], 7: [[left, top]],
            8: [[left, top]], 9: [[top, bottom]], 10: [[top, right], [left, bottom]],
            11: [[top, right]], 12: [[left, right]], 13: [[bottom, right]], 14: [[left, bottom]],
          }[code] || [];
          for (const [pA, pB] of segs) {
            const [x1, y1] = toScreen(pA), [x2, y2] = toScreen(pB);
            c.moveTo(x1, y1);
            c.lineTo(x2, y2);
          }
        }
      }
      c.stroke();
    };
    drawMarchingContour(sseU, threshU, pal.untreated);
    drawMarchingContour(sseT, threshT, pal.treated);

    const sx = km => pad.l + ((km - kmMin) / (kmMax - kmMin)) * pw;
    const sy = vm => pad.t + ((vMax - vm) / (vMax - vMin)) * ph;

    c.strokeStyle = '#9bb2a5';
    c.lineWidth = 1;
    c.strokeRect(pad.l, pad.t, pw, ph);
    c.fillStyle = '#1b3b33';
    c.font = '11.5px "Inter",sans-serif';
    for (let i = 0; i <= 4; i++) {
      const kv = kmMin + ((kmMax - kmMin) * i) / 4;
      const px = sx(kv);
      c.textAlign = 'center';
      c.fillText(fmtNum(kv, 3), px, pad.t + ph + 17);
      const vv = vMin + ((vMax - vMin) * i) / 4;
      const py = sy(vv);
      c.textAlign = 'right';
      c.fillText(vv.toFixed(0), pad.l - 7, py + 4);
    }
    c.font = '600 12px "Inter",sans-serif';
    c.textAlign = 'center';
    c.fillText(`Apparent half-saturation Km (${concUnit})`, pad.l + pw / 2, H - 9);
    c.save();
    c.translate(16, pad.t + ph / 2);
    c.rotate(-Math.PI / 2);
    c.fillText(`Apparent plateau Vmax (${rateUnit})`, 0, 0);
    c.restore();

    // Plot active model parameter estimates with crisp translucent pill tags
    for (const [st, col, lbl, dy] of [['untreated', pal.untreated, 'Untreated', 18], ['treated', pal.treated, 'Treated', -14]]) {
      const p = fit[st];
      const px = Math.max(pad.l + 8, Math.min(pad.l + pw - 8, sx(p.km)));
      const py = Math.max(pad.t + 8, Math.min(pad.t + ph - 8, sy(p.vmax)));
      c.beginPath();
      c.arc(px, py, 5.5, 0, Math.PI * 2);
      c.fillStyle = col;
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2;
      c.stroke();

      const tag = `${lbl} (${fmtNum(p.km, 3)}, ${p.vmax.toFixed(0)})`;
      c.font = '700 11px "Inter",sans-serif';
      const tw = c.measureText(tag).width;
      const lx = Math.max(pad.l + 6, Math.min(pad.l + pw - tw - 14, px + 10));
      const ly = Math.max(pad.t + 14, Math.min(pad.t + ph - 12, py + dy));
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.strokeStyle = col;
      c.lineWidth = 1.1;
      c.beginPath();
      c.roundRect(lx - 5, ly - 9, tw + 10, 18, 5);
      c.fill();
      c.stroke();
      c.fillStyle = '#102b24';
      c.textAlign = 'left';
      c.textBaseline = 'middle';
      c.fillText(tag, lx, ly);
      c.textBaseline = 'alphabetic';
    }

    // Check overlap of 95% confidence regions along Vmax vs Km
    let bothCount = 0;
    for (let i = 0; i < GX * GY; i++) if (sseU[i] <= threshU && sseT[i] <= threshT) bothCount++;
    const disjoint = bothCount === 0;

    byId('landscape-analysis').innerHTML = `
      <div class="kw-explain-top">
        <span class="kw-explain-title">Exact F-Test 95% Joint Confidence Regions &amp; Collinearity</span>
        <span class="kw-eq-pill">${disjoint ? '95% Regions Disjoint' : '95% Regions Overlap'}</span>
      </div>
      <p>Nonlinear saturation models exhibit classic banana-shaped confidence contours tilted upward to the right: raising trial Km requires raising trial Vmax to fit the same intermediate rates (positive parameter collinearity).</p>
      <ul>
        <li>${disjoint
          ? 'The Treated and Untreated 95% joint confidence regions are completely disjoint—strong statistical evidence against a single shared curve.'
          : 'The 95% joint confidence regions partially overlap; review ΔAICc and holdout RMSE before claiming two distinct parameter sets.'}</li>
        <li>Notice whether separation occurs vertically (distinct Vmax plateaus) or horizontally (distinct Km affinities)—directly explaining which 3-parameter model captures the biological shift.</li>
      </ul>
    `;
  }

  // ---------------------------------------------------------------------------
  // 6. RENDER 5-MODEL LEADERBOARD & OBSERVATION INSPECTOR TABLES
  // ---------------------------------------------------------------------------
  function renderTables(ctx) {
    const { analysis, mId, isPooled, foldObj, allObs } = ctx;
    const { concUnit, rateUnit } = analysis.meta;
    const tbody = byId('comparison');
    tbody.replaceChildren();

    for (const mSpec of KineticsAnalytics.MODEL_CATALOG) {
      const s = analysis.summaryByModel[mSpec.id];
      const fMet = isPooled ? s.pooled : foldObj.models[mSpec.id].metrics;
      const tr = tbody.insertRow();
      tr.className = 'clickable-row' + (mSpec.id === mId ? ' active-row' : '');
      tr.onclick = () => {
        state.modelId = mSpec.id;
        byId('model').value = mSpec.id;
        renderAll();
      };
      const cells = [
        `<strong>${esc(mSpec.name)}</strong>`,
        String(mSpec.k),
        fmtNum(fMet.mae),
        `<strong>${fmtNum(fMet.rmse)}</strong>`,
        fmtNum(s.interp.rmse),
        fmtNum(s.ood.rmse),
        `<strong>${fmtNum(s.pooled.rmse)}</strong>`,
        `${s.aicc.toFixed(1)} <span style="color:#526b60">(+${s.deltaAicc.toFixed(1)})</span>`,
        `${(s.akaikeWeight * 100).toFixed(1)}%`,
        s.pooled.ccc.toFixed(3),
        `<span class="kw-verdict ${s.verdictTone}">${esc(s.verdict)}</span>`,
      ];
      cells.forEach(html => { const td = tr.insertCell(); td.innerHTML = html; });
    }

    // Synthesis callout comparing MM parsimony vs extended Hill
    const sShared = analysis.summaryByModel.shared;
    const sVmax = analysis.summaryByModel.split_vmax;
    const sKm = analysis.summaryByModel.split_km;
    const sBoth = analysis.summaryByModel.split_both;
    const sHill = analysis.summaryByModel.hill_both;
    const bestMm = [sShared, sVmax, sKm, sBoth].sort((a, b) => a.aicc - b.aicc)[0];

    byId('leaderboard-synthesis').innerHTML =
      `<strong>Automated Audit Synthesis (${esc(analysis.meta.title)}):</strong> ` +
      `Among the four canonical Michaelis–Menten (n = 1) models, <strong>${esc(bestMm.name)}</strong> achieves the strongest information-theoretic support ` +
      `(AICc = ${bestMm.aicc.toFixed(1)}, Pooled LOO RMSE = ${bestMm.pooled.rmse.toFixed(2)} ${esc(rateUnit)} vs. ${sShared.pooled.rmse.toFixed(2)} for Shared). ` +
      (sHill.deltaAicc === 0 && bestMm.aicc - sHill.aicc > 6
        ? `However, the 6-parameter <strong>Cooperative Hill</strong> model reduces AICc by ${(bestMm.aicc - sHill.aicc).toFixed(1)} units (Hill n = ${sHill.fullFit.treated.n.toFixed(2)}), confirming strong sigmoidal cooperativity.`
        : sHill.pooled.rmse < bestMm.pooled.rmse
        ? `Allowing sub-hyperbolic Hill exponents (n ≈ ${sHill.fullFit.treated.n.toFixed(2)}) lowers LOO RMSE further to ${sHill.pooled.rmse.toFixed(2)} (near replicate floor ${analysis.pure.sPure.toFixed(2)}), though extrapolated Vmax rises above measured concentrations—retain <strong>${esc(bestMm.short)}</strong> unless independent high-dose or binding assays support heterogeneity/cooperativity.`
        : `Adding Hill exponents (k = 6) incurs an AICc penalty (ΔAICc = +${sHill.deltaAicc.toFixed(1)}) without improving generalization, confirming n = 1 hyperbolic saturation.`);

    // Observation & Leverage Inspector Table
    const repBody = byId('replicates');
    repBody.replaceChildren();
    const shown = state.repFilter === 'held' && !isPooled
      ? allObs.filter(r => r.held)
      : allObs;

    byId('replicates-subtitle').textContent = state.repFilter === 'held' && !isPooled
      ? `Showing ${shown.length} held-out replicates at ${foldObj.level} ${concUnit} (${foldObj.isOOD ? 'OOD Extrapolation' : 'In-Domain Interpolation'}).`
      : `Showing all ${shown.length} observations (${isPooled ? 'cross-validated LOO predictions' : 'yellow rows mark active holdout'}).`;

    for (const r of shown) {
      const tr = repBody.insertRow();
      if (r.held && !isPooled) tr.className = 'held';
      const z = r.residual / Math.max(1e-6, ctx.sigma);
      const cells = [
        `#${esc(r.id)}`,
        esc(r.state),
        `${r.conc} ${esc(concUnit)}`,
        `<span class="kw-badge ${r.isOOD ? 'ood' : ''}">${esc(r.regime)}</span>`,
        r.rate.toFixed(2),
        r.prediction.toFixed(2),
        `${r.residual >= 0 ? '+' : ''}${r.residual.toFixed(2)}`,
        `${z >= 0 ? '+' : ''}${z.toFixed(2)}σ`,
        `${(r.affinityLeverage * 100).toFixed(0)}%`,
      ];
      cells.forEach(html => { const td = tr.insertCell(); td.innerHTML = html; });
    }
  }

  function renderAll() {
    const ctx = activeContext();
    byId('dataset-subtitle').textContent = ctx.analysis.meta.description ||
      'Audit mechanistic saturation hypotheses across in-domain interpolation and out-of-distribution (OOD) concentration holdouts.';
    renderKpis(ctx);
    renderCurveStage(ctx);
    renderDiagStage(ctx);
    renderRegimeSection(ctx);
    renderContourLandscape(ctx);
    renderTables(ctx);
  }

  // ---------------------------------------------------------------------------
  // 7. EVENT WIRING, EXPORTS & EVIDENCE WORKSPACE INTEGRATION
  // ---------------------------------------------------------------------------
  populateSelectors(true);
  byId('custom-csv').value = ['conc,rate,state', ...puromycinRows.map(r => `${r.conc},${r.rate},${r.state}`)].join('\n');

  byId('dataset').onchange = e => {
    state.datasetKey = e.target.value;
    populateSelectors(true);
    renderAll();
  };
  byId('concentration').onchange = e => { state.foldValue = e.target.value; renderAll(); };
  byId('model').onchange = e => { state.modelId = e.target.value; renderAll(); };

  document.querySelectorAll('[data-audience]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.audience === state.audience));
    btn.onclick = () => {
      state.audience = btn.dataset.audience;
      document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      renderAll();
    };
  });

  document.querySelectorAll('#curve-tabs button').forEach(btn => {
    btn.onclick = () => {
      state.curveTab = btn.dataset.curve;
      document.querySelectorAll('#curve-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      renderCurveStage(activeContext());
    };
  });

  document.querySelectorAll('#diag-tabs button').forEach(btn => {
    btn.onclick = () => {
      state.diagTab = btn.dataset.diag;
      document.querySelectorAll('#diag-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      renderDiagStage(activeContext());
    };
  });

  byId('toggle-ci').onclick = e => {
    state.showCI = !state.showCI;
    e.currentTarget.setAttribute('aria-pressed', String(state.showCI));
    renderCurveStage(activeContext());
  };
  byId('toggle-all-models').onclick = e => {
    state.overlayAll = !state.overlayAll;
    e.currentTarget.setAttribute('aria-pressed', String(state.overlayAll));
    renderCurveStage(activeContext());
  };
  byId('toggle-cb').onclick = e => {
    state.colorblind = !state.colorblind;
    document.body.classList.toggle('cb-mode', state.colorblind);
    e.currentTarget.setAttribute('aria-pressed', String(state.colorblind));
    renderAll();
  };

  byId('rep-filter-held').onclick = () => {
    state.repFilter = 'held';
    byId('rep-filter-held').setAttribute('aria-pressed', 'true');
    byId('rep-filter-all').setAttribute('aria-pressed', 'false');
    renderTables(activeContext());
  };
  byId('rep-filter-all').onclick = () => {
    state.repFilter = 'all';
    byId('rep-filter-all').setAttribute('aria-pressed', 'true');
    byId('rep-filter-held').setAttribute('aria-pressed', 'false');
    renderTables(activeContext());
  };

  // Custom CSV Drawer
  byId('toggle-csv-drawer').onclick = e => {
    const drawer = byId('csv-drawer');
    const open = drawer.hidden;
    drawer.hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  };

  byId('custom-file').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 250000) {
      byId('csv-status').textContent = 'Choose a plain CSV smaller than 250 KB.';
      return;
    }
    byId('custom-csv').value = await file.text();
    byId('csv-status').textContent = `Loaded ${file.name}. Click "Fit all 5 models on CSV" to analyze.`;
  };

  byId('apply-csv').onclick = () => {
    try {
      const parsed = parseAssay(byId('custom-csv').value).map((r, i) => ({ id: String(i + 1), ...r }));
      const concUnit = byId('custom-conc-unit').value.trim() || 'mM';
      const rateUnit = byId('custom-rate-unit').value.trim() || 'rate';
      benchmarks.custom = {
        id: 'custom',
        title: `Custom Assay (${parsed.length} obs · ${concUnit})`,
        kind: 'measured',
        concUnit,
        rateUnit,
        sourceUrl: 'studio/kinetics.html#custom-csv',
        description: `User-supplied two-condition kinetic assay (${parsed.length} observations across ${new Set(parsed.map(r => r.conc)).size} shared substrate concentrations).`,
        rows: parsed,
      };
      analysisCache.delete('custom');
      state.datasetKey = 'custom';
      populateSelectors(true);
      byId('csv-status').style.color = '#14532d';
      byId('csv-status').textContent = `Analyzed ${parsed.length} custom observations across all 5 kinetic models.`;
      renderAll();
    } catch (err) {
      byId('csv-status').style.color = '#991b1b';
      byId('csv-status').textContent = err.message;
    }
  };

  byId('reset-puromycin').onclick = () => {
    state.datasetKey = 'puromycin';
    populateSelectors(true);
    byId('csv-drawer').hidden = true;
    byId('toggle-csv-drawer').setAttribute('aria-expanded', 'false');
    renderAll();
  };

  // Exports: SVG, PNG, CSV, Markdown Audit Report
  byId('export-curve-svg').onclick = () => downloadSvg(byId('curves'), `kinetics-${state.datasetKey}-${state.curveTab}.svg`);
  byId('export-diag-svg').onclick = () => downloadSvg(byId('residuals'), `kinetics-${state.datasetKey}-${state.diagTab}.svg`);
  byId('export-contour-png').onclick = () => {
    const a = document.createElement('a');
    a.href = byId('contour-canvas').toDataURL('image/png');
    a.download = `kinetics-${state.datasetKey}-sse-contour.png`;
    a.click();
  };

  byId('download').onclick = () => {
    const analysis = getAnalysis(state.datasetKey);
    const lines = ['model,observation,condition,concentration,regime,observed,predicted,residual'];
    for (const mSpec of KineticsAnalytics.MODEL_CATALOG) {
      for (const r of analysis.pooledByModel[mSpec.id]) {
        lines.push([mSpec.id, r.id, r.state, r.conc, r.regime, r.rate, r.prediction.toFixed(6), r.residual.toFixed(6)].join(','));
      }
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.datasetKey}-held-out-predictions.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  byId('export-md').onclick = () => {
    const ctx = activeContext();
    const { analysis } = ctx;
    const { concUnit, rateUnit } = analysis.meta;
    const md = [
      `# Enzyme Kinetics & OOD Benchmark Audit — ${analysis.meta.title}`,
      ``,
      `- **Observations:** ${analysis.rows.length} across ${analysis.levels.length} concentrations (${analysis.levels.join(', ')} ${concUnit})`,
      `- **Pure Replicate Noise Floor (s_pure):** ${analysis.pure.sPure.toFixed(3)} ${rateUnit}`,
      ``,
      `## 5-Model Generalization & Information-Criteria Leaderboard`,
      ``,
      `| Model | k | In-Domain RMSE | OOD Extrap RMSE | Pooled LOO RMSE | AICc | ΔAICc | Weight | CCC | Verdict |`,
      `|---|---:|---:|---:|---:|---:|---:|---:|---:|---|`,
      ...KineticsAnalytics.MODEL_CATALOG.map(m => {
        const s = analysis.summaryByModel[m.id];
        return `| ${m.name} | ${m.k} | ${s.interp.rmse.toFixed(2)} | ${s.ood.rmse.toFixed(2)} | ${s.pooled.rmse.toFixed(2)} | ${s.aicc.toFixed(1)} | +${s.deltaAicc.toFixed(1)} | ${(s.akaikeWeight * 100).toFixed(1)}% | ${s.pooled.ccc.toFixed(3)} | ${s.verdict} |`;
      }),
      ``,
      `Generated offline by Assay Evidence Studio (Kinetics & OOD Benchmark Workbench).`,
    ].join('\n');
    const url = URL.createObjectURL(new Blob([md + '\n'], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.datasetKey}-kinetics-audit.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Save to Evidence Workspace (100% compatible with existing puromycin-holdout-<level> comparison keys!)
  byId('save-evidence').onclick = () => {
    const ctx = activeContext();
    const { analysis, summary, isPooled, foldObj, fit, evalObs, evalMetrics } = ctx;
    const isPuromycin = state.datasetKey === 'puromycin';
    const dsName = isPuromycin
      ? 'Puromycin · galactosyltransferase initial rates'
      : analysis.meta.title;
    const compKey = isPooled
      ? `${state.datasetKey}-pooled-loo`
      : `${state.datasetKey}-holdout-${foldObj.level}`;
    const titleLabel = isPooled
      ? `${summary.short} · Pooled LOO (${analysis.levels.length} folds)`
      : `${summary.name} · ${foldObj.level} ${analysis.meta.concUnit}`;

    try {
      evidenceRecords.capture({
        kind: analysis.meta.kind,
        title: titleLabel,
        dataset: dsName,
        method: isPooled ? 'Leave-one-concentration-out (pooled)' : 'Leave one concentration out',
        metric: isPooled ? 'Pooled LOO RMSE' : 'Held-out RMSE',
        value: Number(evalMetrics.rmse.toFixed(4)),
        unit: analysis.meta.rateUnit,
        source: analysis.meta.sourceUrl,
        details: {
          comparisonKey: compKey,
          concentrationPpm: isPooled ? null : foldObj.level,
          regime: isPooled ? 'Pooled LOO' : (foldObj.isOOD ? 'OOD Extrapolation' : 'In-Domain Interpolation'),
          model: state.modelId,
          freeParametersK: summary.k,
          pooledLooRmse: Number(summary.pooled.rmse.toFixed(3)),
          inDomainRmse: Number(summary.interp.rmse.toFixed(3)),
          oodExtrapRmse: Number(summary.ood.rmse.toFixed(3)),
          aicc: Number(summary.aicc.toFixed(2)),
          akaikeWeightPct: Number((summary.akaikeWeight * 100).toFixed(1)),
          linsCCC: Number(summary.pooled.ccc.toFixed(4)),
          fittedParameters: fit.vector,
          heldOutCount: evalObs.length,
        },
      });
      byId('save-status').textContent =
        `Saved "${titleLabel}" (RMSE ${evalMetrics.rmse.toFixed(2)} ${analysis.meta.rateUnit}) to the Evidence Workspace.`;
    } catch (error) {
      byId('save-status').textContent = 'Could not save the run. ' + error.message;
    }
  };

  renderAll();
})();
