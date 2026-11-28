'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const tooltip = byId('sw-tooltip');

  // Interactive Workbench State
  const state = {
    mode: 'force',                 // 'force' | 'ensemble'
    audience: 'student',           // 'explorer' | 'student' | 'researcher'
    showUnc: true,
    colorblind: false,
    playing: false,
    playRaf: 0,
    frameIdx: 120,
    rep3d: 'cartoon',
    protein3d: '1MBO',             // '1MBO' | '1UBQ' | 'P04637'

    // Track A: Force-Field & Symplectic MD
    potentialId: 'quartic',
    surrogateId: 'harmonic',
    integratorId: 'verlet',
    width: 0.5,
    amplitude: 1.5,
    dt: 0.025,
    kBTForce: 0.35,
    extraAnchors: [],
    leftTabForce: 'force',         // 'pes' | 'force' | 'parity' | 'active'
    rightTabForce: 'traj',         // 'traj' | 'phase' | 'energy' | 'spectrum'

    // Track B: Biomolecular Ensembles & BioEmu Landscapes
    landscapeId: 'ramachandran',
    samplerId: 'langevin_md',
    gap: 0.4,
    barrier: 2.6,
    kBTEns: 0.75,
    mix: 0.12,
    seed: 42,
    stepsEns: 600,
    leftTabEns: 'landscape',       // 'landscape' | 'pmf' | 'occ' | 'kramers'
    rightTabEns: 'qtraj',          // 'qtraj' | 'autocorr' | 'hist' | 'seeds'
  };

  // Parse optional URL deep-link params
  const params = new URLSearchParams(location.search);
  if (params.get('mode') === 'ensemble' || params.get('mode') === 'force') state.mode = params.get('mode');
  if (params.get('potential') && SimAnalytics.POTENTIAL_CATALOG.some(p => p.id === params.get('potential'))) {
    state.potentialId = params.get('potential');
  }
  if (params.get('surrogate') && SimAnalytics.SURROGATE_CATALOG.some(s => s.id === params.get('surrogate'))) {
    state.surrogateId = params.get('surrogate');
  }
  if (params.get('integrator') && SimAnalytics.INTEGRATOR_CATALOG.some(i => i.id === params.get('integrator'))) {
    state.integratorId = params.get('integrator');
  }
  if (params.get('landscape') && SimAnalytics.LANDSCAPE_CATALOG.some(l => l.id === params.get('landscape'))) {
    state.landscapeId = params.get('landscape');
  }
  if (params.get('sampler') && SimAnalytics.SAMPLER_CATALOG.some(s => s.id === params.get('sampler'))) {
    state.samplerId = params.get('sampler');
  }
  if (params.get('audience') && ['explorer', 'student', 'researcher'].includes(params.get('audience'))) {
    state.audience = params.get('audience');
  }

  let currentResult = null;
  let viewer3d = null;

  function palette() {
    return state.colorblind
      ? {
          ref: '#0072b2',
          refFill: 'rgba(0, 114, 178, 0.14)',
          hat: '#d55e00',
          hatFill: 'rgba(213, 94, 0, 0.15)',
          ood: '#cc79a7',
          active: '#882255',
          trainBg: 'rgba(0, 158, 115, 0.08)',
        }
      : {
          ref: '#0b7a5c',
          refFill: 'rgba(11, 122, 92, 0.14)',
          hat: '#b85627',
          hatFill: 'rgba(184, 86, 39, 0.15)',
          ood: '#7c3aed',
          active: '#e11d48',
          trainBg: 'rgba(16, 185, 129, 0.08)',
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
    if (!Number.isFinite(v)) return '∞';
    const abs = Math.abs(v);
    if (abs > 0 && abs < Math.pow(10, -digits)) return v.toExponential(1);
    return v.toFixed(digits);
  }

  function attachSvgTooltips(svgEl) {
    svgEl.onpointermove = e => {
      const target = e.target.closest('[data-tip]');
      if (!target) {
        tooltip.hidden = true;
        return;
      }
      tooltip.innerHTML = target.getAttribute('data-tip');
      tooltip.hidden = false;
      tooltip.style.left = Math.min(window.innerWidth - 300, e.clientX + 14) + 'px';
      tooltip.style.top = Math.max(12, e.clientY - 18) + 'px';
    };
    svgEl.onpointerleave = () => { tooltip.hidden = true; };
  }

  function downloadBlob(filename, content, mime) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadSvg(svgEl, filename) {
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    downloadBlob(filename, '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML, 'image/svg+xml;charset=utf-8');
  }

  // ---------------------------------------------------------------------------
  // 1. DYNAMIC CONTROLS & TABS BUILDER
  // ---------------------------------------------------------------------------
  function buildControls() {
    const selHost = byId('selector-bar');
    const sldHost = byId('controls');
    selHost.replaceChildren();
    sldHost.replaceChildren();

    byId('mode').value = state.mode;
    byId('track-force').setAttribute('aria-pressed', String(state.mode === 'force'));
    byId('track-ensemble').setAttribute('aria-pressed', String(state.mode === 'ensemble'));
    byId('add-active-anchor').hidden = state.mode !== 'force';
    byId('reset-anchors').hidden = state.mode !== 'force' || state.extraAnchors.length === 0;
    byId('toggle-unc').hidden = state.mode !== 'force';

    const makeSelect = (id, labelTxt, options, val, onChange) => {
      const wrap = document.createElement('div');
      wrap.className = 'sw-field';
      const lbl = document.createElement('label');
      lbl.htmlFor = id;
      lbl.textContent = labelTxt;
      const sel = document.createElement('select');
      sel.id = id;
      for (const [optVal, optLabel] of options) sel.add(new Option(optLabel, optVal));
      sel.value = val;
      sel.onchange = e => onChange(e.target.value);
      wrap.append(lbl, sel);
      selHost.append(wrap);
    };

    const makeSlider = (id, labelTxt, min, max, step, val, unit, onChange) => {
      const wrap = document.createElement('div');
      wrap.className = 'sw-field';
      const lbl = document.createElement('label');
      lbl.htmlFor = id;
      const strong = document.createElement('strong');
      strong.textContent = `${val}${unit ? ' ' + unit : ''}`;
      lbl.innerHTML = `<span>${esc(labelTxt)}</span>`;
      lbl.append(strong);
      const inp = document.createElement('input');
      inp.type = 'range';
      Object.assign(inp, { id, min, max, step, value: val });
      inp.oninput = () => {
        const num = Number(inp.value);
        strong.textContent = `${num}${unit ? ' ' + unit : ''}`;
        onChange(num);
      };
      wrap.append(lbl, inp);
      sldHost.append(wrap);
    };

    if (state.mode === 'force') {
      makeSelect(
        'sel-potential',
        'Physical Reference Potential (5 systems)',
        SimAnalytics.POTENTIAL_CATALOG.map(p => [p.id, p.name]),
        state.potentialId,
        v => { state.potentialId = v; state.extraAnchors = []; computeAndRender(); }
      );
      makeSelect(
        'sel-surrogate',
        'Learned Force-Field Architecture (5 models)',
        SimAnalytics.SURROGATE_CATALOG.map(s => [s.id, s.name]),
        state.surrogateId,
        v => { state.surrogateId = v; computeAndRender(); }
      );
      makeSelect(
        'sel-integrator',
        'MD Time Integrator / Thermostat (4 schemes)',
        SimAnalytics.INTEGRATOR_CATALOG.map(i => [i.id, i.name]),
        state.integratorId,
        v => { state.integratorId = v; buildControls(); computeAndRender(); }
      );

      makeSlider('width', 'Training half-width w', 0.2, 2.0, 0.05, state.width, '', v => { state.width = v; computeAndRender(); });
      makeSlider('amplitude', 'Initial displacement x₀', 0.2, 2.0, 0.05, state.amplitude, '', v => { state.amplitude = v; computeAndRender(); });
      makeSlider('dt-slider', 'Timestep Δt', 0.01, 0.06, 0.005, state.dt, '', v => { state.dt = v; computeAndRender(); });
      if (state.integratorId === 'langevin') {
        makeSlider('kbt-force', 'Thermal bath kBT', 0.05, 1.5, 0.05, state.kBTForce, '', v => { state.kBTForce = v; computeAndRender(); });
      } else {
        makeSelect(
          'sel-protein3d-force',
          '3D Mode-Coupled Structure',
          [
            ['1MBO', 'PDB 1MBO · Myoglobin Heme Pocket'],
            ['1UBQ', 'PDB 1UBQ · Ubiquitin Pincer'],
            ['P04637', 'AlphaFold TP53 · DNA Loop'],
          ],
          state.protein3d,
          v => { state.protein3d = v; render3DStage(); }
        );
      }

      byId('question').textContent =
        'Test why low training-set force error is not enough: inspect OOD potential holes, symplectic Hamiltonian conservation, and vibrational power spectra across 5 potentials × 5 surrogates.';
      byId('challenge').textContent =
        'Team challenge: Train Quartic Taylor (p=4) vs. MACE Radial–Bessel on Morse Bond (w = 0.45, x₀ = 1.45), then click "+ Add DFT Query x*" to test active-learning healing.';
      byId('method').textContent =
        'Canonical check: Selecting Anharmonic Quartic + Linear Harmonic + Velocity Verlet (Δt = 0.025, 480 steps) matches python evidence/check_simulation.py to <10⁻¹³.';
    } else {
      makeSelect(
        'sel-landscape',
        'Conformational Free-Energy Landscape (4 benchmarks)',
        SimAnalytics.LANDSCAPE_CATALOG.map(l => [l.id, l.name]),
        state.landscapeId,
        v => {
          state.landscapeId = v;
          const lObj = SimAnalytics.LANDSCAPE_CATALOG.find(x => x.id === v);
          if (lObj) state.protein3d = lObj.proteinId;
          buildControls();
          computeAndRender();
        }
      );
      makeSelect(
        'sel-sampler',
        'Sampling / Emulation Engine (4 paradigms)',
        SimAnalytics.SAMPLER_CATALOG.map(s => [s.id, s.name]),
        state.samplerId,
        v => { state.samplerId = v; computeAndRender(); }
      );
      makeSelect(
        'sel-protein3d',
        'Coupled 3D Protein Ensemble Specimen',
        [
          ['1MBO', 'PDB 1MBO · Myoglobin Distal Heme Gate'],
          ['1UBQ', 'PDB 1UBQ · Ubiquitin β1–β2 Pincer'],
          ['P04637', 'AlphaFold TP53 · Core Loop Ensemble'],
        ],
        state.protein3d,
        v => { state.protein3d = v; render3DStage(); }
      );

      makeSlider('gap', 'Free-energy tilt ΔG', -2.5, 2.5, 0.1, state.gap, 'kBT', v => { state.gap = v; computeAndRender(); });
      if (state.landscapeId === 'two_state') {
        makeSlider('mix', 'Kinetic transition scale', 0.01, 0.8, 0.01, state.mix, '', v => { state.mix = v; computeAndRender(); });
      } else {
        makeSlider('barrier', 'Kinetic barrier ΔG‡', 0.6, 4.2, 0.1, state.barrier, '', v => { state.barrier = v; computeAndRender(); });
      }
      makeSlider('kbt-ens', 'Thermal energy kBT', 0.35, 1.8, 0.05, state.kBTEns, '', v => { state.kBTEns = v; computeAndRender(); });
      makeSlider('seed', 'Trajectory random seed', 1, 500, 1, state.seed, '', v => { state.seed = v; computeAndRender(); });

      byId('question').textContent =
        'Contrast barrier-trapped Langevin MD and MCMC trajectories against Well-Tempered Metadynamics and BioEmu-style independent equilibrium generation across 1D & 2D free-energy landscapes.';
      byId('challenge').textContent =
        'Team challenge: Raise Kinetic Barrier ΔG‡ above 3.2 at kBT = 0.65. Compare State-B transitions, autocorrelation τ_int, and ΔG error between Langevin MD, WT-Metadynamics, and BioEmu.';
      byId('method').textContent =
        'Boltzmann reference populations and 1D/2D potentials of mean force are integrated numerically over exact quadrature grids; BioEmu mode emulates uncorrelated equilibrium generation (τ_int ≈ 1).';
    }

    buildStageTabs();
  }

  function buildStageTabs() {
    const lHost = byId('left-tabs');
    const rHost = byId('right-tabs');
    lHost.replaceChildren();
    rHost.replaceChildren();

    const leftDefs = state.mode === 'force'
      ? [
          ['pes', 'PES U(x)'],
          ['force', 'Force Law F(x)'],
          ['parity', 'Parity (F̂ vs F)'],
          ['active', 'Active DFT Query'],
        ]
      : [
          ['landscape', state.landscapeId === 'muller_brown' || state.landscapeId === 'ramachandran' ? '2D Free-Energy Map' : 'Free-Energy Landscape'],
          ['pmf', '1D PMF −kBT ln P'],
          ['occ', 'State-B Convergence'],
          ['kramers', 'Kramers Scaling'],
        ];

    const rightDefs = state.mode === 'force'
      ? [
          ['traj', 'Trajectory x(t)'],
          ['phase', 'Phase Space (x, p)'],
          ['energy', 'Energy Drift ΔH(t)'],
          ['spectrum', 'VACF & Spectrum S(ω)'],
        ]
      : [
          ['qtraj', 'Trajectory q(t)'],
          ['autocorr', 'Autocorr & N_eff'],
          ['hist', 'Boltzmann Histogram'],
          ['seeds', '20-Seed Variance'],
        ];

    const activeL = state.mode === 'force' ? state.leftTabForce : state.leftTabEns;
    const activeR = state.mode === 'force' ? state.rightTabForce : state.rightTabEns;

    byId('left-stage-title').textContent = state.mode === 'force'
      ? 'Potential Surface, Force Law & Active Learning'
      : 'Free-Energy Landscape, PMF & Kramers Kinetics';
    byId('right-stage-title').textContent = state.mode === 'force'
      ? 'Trajectories, Symplectic Phase Space & Spectra'
      : 'Conformational Dynamics, Autocorrelation & Seeds';

    for (const [id, label] of leftDefs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.ltab = id;
      b.setAttribute('aria-pressed', String(id === activeL));
      b.onclick = () => {
        if (state.mode === 'force') state.leftTabForce = id;
        else state.leftTabEns = id;
        buildStageTabs();
        renderLeftStage();
      };
      lHost.append(b);
    }

    for (const [id, label] of rightDefs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.dataset.rtab = id;
      b.setAttribute('aria-pressed', String(id === activeR));
      b.onclick = () => {
        if (state.mode === 'force') state.rightTabForce = id;
        else state.rightTabEns = id;
        buildStageTabs();
        renderRightStage();
      };
      rHost.append(b);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. SVG GRID HELPER
  // ---------------------------------------------------------------------------
  function makeSvgGrid(W, H, pad, xMin, xMax, yMin, yMax, xLabel, yLabel, xDig = 2, yDig = 2) {
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const sx = v => pad.l + ((v - xMin) / Math.max(1e-12, xMax - xMin)) * pw;
    const sy = v => pad.t + ph - ((v - yMin) / Math.max(1e-12, yMax - yMin)) * ph;
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const yv = yMin + ((yMax - yMin) * i) / 4;
      const py = sy(yv);
      const isZero = Math.abs(yv) < (yMax - yMin) * 1e-4 && yMin < 0 && yMax > 0;
      g += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${py.toFixed(1)}" y2="${py.toFixed(1)}" stroke="${isZero ? '#5b786c' : '#dce7df'}" stroke-width="${isZero ? '1.4' : '1'}"/>`;
      g += `<text x="${pad.l - 8}" y="${(py + 4).toFixed(1)}" text-anchor="end">${fmtNum(yv, yDig)}</text>`;
    }
    for (let i = 0; i <= 5; i++) {
      const xv = xMin + ((xMax - xMin) * i) / 5;
      const px = sx(xv);
      g += `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#edf3ee" stroke-width="1"/>`;
      g += `<text x="${px.toFixed(1)}" y="${pad.t + ph + 18}" text-anchor="middle">${fmtNum(xv, xDig)}</text>`;
    }
    if (xMin < 0 && xMax > 0) {
      const zx = sx(0);
      g += `<line x1="${zx.toFixed(1)}" x2="${zx.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#89a397" stroke-dasharray="3 3" stroke-width="1"/>`;
    }
    g += `<rect x="${pad.l}" y="${pad.t}" width="${pw}" height="${ph}" fill="none" stroke="#b9ccc0" stroke-width="1"/>`;
    g += `<text class="axis-title" x="${pad.l + pw / 2}" y="${H - 9}" text-anchor="middle">${esc(xLabel)}</text>`;
    g += `<text class="axis-title" transform="translate(17 ${pad.t + ph / 2}) rotate(-90)" text-anchor="middle">${esc(yLabel)}</text>`;
    return { pw, ph, sx, sy, g };
  }

  // ---------------------------------------------------------------------------
  // 3. RENDER 6-CARD KPI TELEMETRY BAR
  // ---------------------------------------------------------------------------
  function renderKpis() {
    const r = currentResult;
    if (r.mode === 'force') {
      const oodRatio = r.oodRmse / Math.max(1e-6, r.inDomainRmse);
      const driftBadge = r.blewUp
        ? '<span class="sw-badge poor">Blew Up!</span>'
        : r.maxHatDriftPct < 3
        ? '<span class="sw-badge">Conserved</span>'
        : '<span class="sw-badge warn">Drifting</span>';
      const dOmega = Math.abs(r.specHat.peakOmega - r.specRef.peakOmega);

      byId('sim-kpi-strip').innerHTML = `
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>Traj Force RMSE</span><span class="sw-badge">MACE</span></div>
          <div class="sw-kpi-val">${fmtNum(r.rmse, 3)}</div>
          <div class="sw-kpi-sub">MAE ${fmtNum(r.mae, 3)} · CCC ${fmtNum(r.ccc, 3)}</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>OOD vs In-Domain</span><span class="sw-badge ${oodRatio > 2.5 ? 'ood' : ''}">${fmtNum(oodRatio, 1)}×</span></div>
          <div class="sw-kpi-val">${fmtNum(r.oodRmse, 3)} <span style="font-size:12.5px;font-weight:500;color:#486358">vs ${fmtNum(r.inDomainRmse, 3)}</span></div>
          <div class="sw-kpi-sub">Outside [−${r.width}, +${r.width}] + ${r.extraAnchors.length} DFT pts</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>PES Energy MAE</span><span class="sw-badge">${esc(r.pot.short)}</span></div>
          <div class="sw-kpi-val">${fmtNum(r.energyMae, 3)}</div>
          <div class="sw-kpi-sub">Apparent stiffness k₀ = ${fmtNum(r.stiffness, 3)}</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>Hamiltonian Drift</span>${driftBadge}</div>
          <div class="sw-kpi-val">${r.blewUp ? 'Unstable' : fmtNum(r.maxHatDriftPct, 2) + '%'}</div>
          <div class="sw-kpi-sub">Ref integrator drift: ${fmtNum(r.maxRefDriftPct, 3)}%</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>Spectral Peak ω*</span><span class="sw-badge">Δω ${fmtNum(dOmega, 2)}</span></div>
          <div class="sw-kpi-val">${fmtNum(r.specHat.peakOmega, 2)} <span style="font-size:12.5px;font-weight:500;color:#486358">/ ${fmtNum(r.specRef.peakOmega, 2)}</span></div>
          <div class="sw-kpi-sub">Surrogate vs Reference VACF peak</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>Next DFT Query x*</span><span class="sw-badge ood">molML AL</span></div>
          <div class="sw-kpi-val">${r.activeCandidate.x >= 0 ? '+' : ''}${r.activeCandidate.x.toFixed(2)}</div>
          <div class="sw-kpi-sub">Uncertainty σ_F = ${fmtNum(r.activeCandidate.stdF, 3)}</div>
        </article>
      `;
    } else {
      const occErrPct = Math.abs(r.observed - r.probability) * 100;
      const trapTag = r.switches === 0 && occErrPct > 8
        ? '<span class="sw-badge poor">Trapped</span>'
        : occErrPct < 4
        ? '<span class="sw-badge">Converged</span>'
        : '<span class="sw-badge warn">Biased</span>';

      byId('sim-kpi-strip').innerHTML = `
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>State-B Occupancy</span>${trapTag}</div>
          <div class="sw-kpi-val">${(r.observed * 100).toFixed(1)}%</div>
          <div class="sw-kpi-sub">Exact Boltzmann: ${(r.probability * 100).toFixed(1)}% (|Δ| ${occErrPct.toFixed(1)}%)</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>Free Energy ΔG</span><span class="sw-badge ${r.deltaGError < 0.2 ? '' : 'warn'}">|ε| ${fmtNum(r.deltaGError, 2)}</span></div>
          <div class="sw-kpi-val">${fmtNum(r.deltaGSampled, 2)} <span style="font-size:12.5px;font-weight:500;color:#486358">/ ${fmtNum(r.deltaGTrue, 2)}</span></div>
          <div class="sw-kpi-sub">Sampled vs Exact ΔG_A→B (kBT)</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>Autocorrelation τ_int</span><span class="sw-badge">${r.tauInt < 2 ? 'i.i.d.' : 'Correlated'}</span></div>
          <div class="sw-kpi-val">${fmtNum(r.tauInt, 1)} <span style="font-size:12.5px;font-weight:500;color:#486358">steps</span></div>
          <div class="sw-kpi-sub">Decorrelation timescale</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>Effective Samples</span><span class="sw-badge ood">BioEmu Metric</span></div>
          <div class="sw-kpi-val">${Math.round(r.nEff)} <span style="font-size:12.5px;font-weight:500;color:#486358">/ ${r.steps}</span></div>
          <div class="sw-kpi-sub">Efficiency ${((r.nEff / r.steps) * 100).toFixed(0)}% (N / τ_int)</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>Basin Crossings</span><span class="sw-badge">Kramers</span></div>
          <div class="sw-kpi-val">${r.switches}</div>
          <div class="sw-kpi-sub">A ↔ B rare-event transitions</div>
        </article>
        <article class="sw-kpi">
          <div class="sw-kpi-label"><span>1D PMF Error</span><span class="sw-badge">${esc(r.land.short)}</span></div>
          <div class="sw-kpi-val">${fmtNum(r.pmfRmse ?? occErrPct / 100, 2)}</div>
          <div class="sw-kpi-sub">RMSE vs −kBT ln P(q) surface</div>
        </article>
      `;
    }
  }

  // ---------------------------------------------------------------------------
  // 4. RENDER LEFT STAGE (FORCE / PES / PARITY / ACTIVE OR 2D/1D LANDSCAPE / PMF)
  // ---------------------------------------------------------------------------
  function renderLeftStage() {
    const r = currentResult;
    const pal = palette();
    const svg = byId('left-svg');
    const cvs = byId('left-canvas');
    const W = 680, H = 320;
    const pad = { l: 64, r: 24, t: 22, b: 48 };

    if (r.mode === 'force') {
      svg.style.display = 'block';
      cvs.hidden = true;
      const tab = state.leftTabForce;
      const fIdx = Math.min(r.trajFrames.length - 1, state.frameIdx);
      const curFrame = r.trajFrames[fIdx];
      let parts = [];

      if (tab === 'pes' || tab === 'force') {
        const isPes = tab === 'pes';
        const xs = r.pesGrid.map(g => g.x);
        const xMin = xs[0], xMax = xs.at(-1);
        const refVals = r.pesGrid.map(g => isPes ? g.uTrue : g.fTrue);
        const hatVals = r.pesGrid.map(g => isPes ? g.uHat : g.fHat);
        // Bound y-range sensibly around reference so extreme polynomial blowups clip cleanly at plot border
        const refLo = Math.min(...refVals), refHi = Math.max(...refVals);
        const refSpan = Math.max(0.5, refHi - refLo);
        const yMin = Math.max(refLo - refSpan * 0.55, Math.min(...refVals, ...hatVals) - refSpan * 0.12);
        const yMax = Math.min(refHi + refSpan * 0.65, Math.max(...refVals, ...hatVals) + refSpan * 0.15);

        const { ph, sx, sy, g } = makeSvgGrid(
          W, H, pad, xMin, xMax, yMin, yMax,
          r.pot.xUnit,
          isPes ? `Potential U(x) · ${r.pot.eUnit}` : `Restoring Force F(x)`,
          2, 2
        );
        parts.push(g);

        // Shaded In-Domain Training Window [-w, +w]
        const tx1 = sx(Math.max(xMin, -r.width)), tx2 = sx(Math.min(xMax, r.width));
        parts.push(`<rect x="${tx1.toFixed(1)}" y="${pad.t}" width="${Math.max(0, tx2 - tx1).toFixed(1)}" height="${ph}" fill="${pal.trainBg}"/>`);
        parts.push(`<line x1="${tx1.toFixed(1)}" x2="${tx1.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#0d9488" stroke-dasharray="4 3"/>`);
        parts.push(`<line x1="${tx2.toFixed(1)}" x2="${tx2.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="#0d9488" stroke-dasharray="4 3"/>`);

        // Epistemic ±2σ ribbon
        if (state.showUnc) {
          const clampY = v => Math.max(yMin, Math.min(yMax, v));
          const upper = r.pesGrid.map(p => `${sx(p.x).toFixed(1)},${sy(clampY((isPes ? p.uHat : p.fHat) + (isPes ? 0.65 : 2.0) * p.stdF)).toFixed(1)}`);
          const lower = [...r.pesGrid].reverse().map(p => `${sx(p.x).toFixed(1)},${sy(clampY((isPes ? p.uHat : p.fHat) - (isPes ? 0.65 : 2.0) * p.stdF)).toFixed(1)}`);
          parts.push(`<polygon points="${upper.concat(lower).join(' ')}" fill="${pal.hatFill}"/>`);
        }

        const clampY = v => Math.max(yMin, Math.min(yMax, v));
        const refPts = r.pesGrid.map(p => `${sx(p.x).toFixed(1)},${sy(clampY(isPes ? p.uTrue : p.fTrue)).toFixed(1)}`).join(' ');
        const hatPts = r.pesGrid.map(p => `${sx(p.x).toFixed(1)},${sy(clampY(isPes ? p.uHat : p.fHat)).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.ref}" stroke-width="2.7" points="${refPts}"/>`);
        parts.push(`<polyline fill="none" stroke="${pal.hat}" stroke-width="2.5" stroke-dasharray="6 3" points="${hatPts}"/>`);

        // Training DFT anchor markers
        for (const ax of r.xTrain) {
          if (ax < xMin || ax > xMax) continue;
          const isExtra = r.extraAnchors.includes(ax);
          const yv = clampY(isPes ? r.pot.U(ax) : r.pot.F(ax));
          parts.push(`<circle cx="${sx(ax).toFixed(1)}" cy="${sy(yv).toFixed(1)}" r="${isExtra ? '4.8' : '2.8'}" fill="${isExtra ? pal.active : '#0f766e'}" stroke="#fff" stroke-width="1" data-tip="${esc(`${isExtra ? 'Active-Learned DFT Anchor' : 'Training Anchor'} x = ${ax.toFixed(3)}`)}"/>`);
        }

        // Live particle beads at scrubbed frame!
        if (curFrame.xRef >= xMin && curFrame.xRef <= xMax) {
          const yr = clampY(isPes ? r.pot.U(curFrame.xRef) : r.pot.F(curFrame.xRef));
          parts.push(`<circle cx="${sx(curFrame.xRef).toFixed(1)}" cy="${sy(yr).toFixed(1)}" r="6.2" fill="${pal.ref}" stroke="#fff" stroke-width="2" data-tip="${esc(`Reference bead @ t=${curFrame.t.toFixed(2)}: x=${curFrame.xRef.toFixed(3)}`)}"/>`);
        }
        if (!r.blewUp && curFrame.xHat >= xMin && curFrame.xHat <= xMax) {
          const yh = clampY(isPes ? r.fit.U(curFrame.xHat) : r.fit.F(curFrame.xHat));
          parts.push(`<circle cx="${sx(curFrame.xHat).toFixed(1)}" cy="${sy(yh).toFixed(1)}" r="6.0" fill="${pal.hat}" stroke="#fff" stroke-width="2" data-tip="${esc(`Surrogate bead @ t=${curFrame.t.toFixed(2)}: x̂=${curFrame.xHat.toFixed(3)}`)}"/>`);
        }

        byId('left-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Exact Reference</span>` +
          `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Surrogate (${esc(r.surrogateId)})</span>` +
          `<span><i class="sw-swatch" style="background:rgba(16,185,129,0.28)"></i>Training [−${r.width}, +${r.width}]</span>` +
          (r.extraAnchors.length ? `<span><i class="sw-swatch" style="background:${pal.active}"></i>+${r.extraAnchors.length} AL DFT pts</span>` : '');

        const hasHole = r.pesGrid.some(g => g.uHat < r.pot.U(0) - 0.8);
        byId('left-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">${isPes ? 'Potential Energy Surface U(x) & OOD Confinement Audit' : 'Conservative Force Field F(x) = −∇U(x) & Epistemic Ribbon'}</span>
            <span class="sw-eq-pill">${esc(r.pot.equation)}</span>
          </div>
          <p>${isPes
            ? `Compares the true physical potential surface (solid) against the analytically integrated surrogate Û(x) (dashed). Inside the shaded [−${r.width}, +${r.width}] training window both surfaces agree closely, whereas outside the dashed lines OOD extrapolation determines whether trajectories remain confined.`
            : `Evaluates force predictions directly against exact restoring forces. Shaded ribbons show ±2σ_F(x) epistemic uncertainty, which collapses at DFT training points and expands into unsampled OOD displacements.`}</p>
          <ul>
            <li>In-Domain Force RMSE = <strong>${fmtNum(r.inDomainRmse, 4)}</strong> vs. OOD Extrapolation Force RMSE = <strong>${fmtNum(r.oodRmse, 4)}</strong> (${fmtNum(r.oodRmse / Math.max(1e-6, r.inDomainRmse), 1)}× OOD cliff).</li>
            <li>${hasHole
              ? 'Warning: Surrogate Û(x) turns downward into an unphysical −∞ potential hole outside the training domain—a classic MLFF failure mode highlighted in Fu et al. (ICLR 2023)!'
              : 'Surrogate potential remains positively confining across the scanned coordinate interval, preventing catastrophic trajectory escape.'}</li>
          </ul>
        `;
      } else if (tab === 'parity') {
        // Force Parity along trajectory frames
        const pts = r.trajFrames.filter((_, i) => i % 3 === 0).map(f => ({
          t: f.t,
          x: f.xRef,
          fTrue: r.pot.F(f.xRef),
          fHat: r.fit.F(f.xRef),
          ood: Math.abs(f.xRef) > r.width && !r.extraAnchors.some(a => Math.abs(a - f.xRef) < 0.08),
        }));
        const allF = pts.flatMap(p => [p.fTrue, p.fHat]);
        const lo = Math.min(...allF) * 1.1 - 0.2, hi = Math.max(...allF) * 1.1 + 0.2;
        const { sx, sy, g } = makeSvgGrid(W, H, pad, lo, hi, lo, hi, 'Exact Reference Force F(x)', 'Surrogate Force F̂(x)', 2, 2);
        parts.push(g);
        parts.push(`<line x1="${sx(lo).toFixed(1)}" y1="${sy(lo).toFixed(1)}" x2="${sx(hi).toFixed(1)}" y2="${sy(hi).toFixed(1)}" stroke="#335c50" stroke-width="1.8" stroke-dasharray="5 4"/>`);
        for (const p of pts) {
          const col = p.ood ? pal.ood : pal.ref;
          parts.push(`<circle cx="${sx(p.fTrue).toFixed(1)}" cy="${sy(Math.max(lo, Math.min(hi, p.fHat))).toFixed(1)}" r="4.0" fill="${col}" fill-opacity="0.82" stroke="#fff" stroke-width="0.9" data-tip="${esc(`t=${p.t.toFixed(2)}, x=${p.x.toFixed(2)} (${p.ood ? 'OOD' : 'In-Domain'}) | True F=${p.fTrue.toFixed(3)}, F̂=${p.fHat.toFixed(3)}`)}"/>`);
        }
        parts.push(`<rect x="${pad.l + 12}" y="${pad.t + 10}" width="194" height="44" rx="7" fill="rgba(255,255,255,0.93)" stroke="#c6d8cd"/>`);
        parts.push(`<text x="${pad.l + 22}" y="${pad.t + 28}" style="font-weight:700">Lin’s CCC = ${fmtNum(r.ccc, 3)}</text>`);
        parts.push(`<text x="${pad.l + 22}" y="${pad.t + 45}" style="fill:#486358">Traj Force RMSE = ${fmtNum(r.rmse, 3)}</text>`);

        byId('left-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ref}"></i>In-Domain frame</span>` +
          `<span><i class="sw-swatch" style="background:${pal.ood}"></i>OOD extrapolated frame</span>` +
          `<span>Dashed = y = x identity</span>`;
        byId('left-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">MACE Trajectory Force Parity &amp; OOD Curvature Breakdown</span>
            <span class="sw-eq-pill">CCC = ${fmtNum(r.ccc, 3)} · MAE = ${fmtNum(r.mae, 3)}</span>
          </div>
          <p>Evaluates surrogate forces along the exact positions visited by the reference trajectory (matching the vendored MACE evaluation protocol in <code>evidence/check_simulation.py</code>). S-shaped or hooked departures on purple OOD points diagnose unmodeled bond anharmonicity.</p>
          <ul>
            <li>Green In-Domain points hug the 45° diagonal (RMSE ${fmtNum(r.inDomainRmse, 4)}), while purple OOD excursions drive total error.</li>
            <li>Switch to <strong>MACE Radial–Bessel</strong> or click <strong>+ Add DFT Query x*</strong> to collapse the OOD parity tails onto the identity line.</li>
          </ul>
        `;
      } else if (tab === 'active') {
        // Active-Learning Epistemic Uncertainty & Acquisition Curve
        const xs = r.pesGrid.map(g => g.x);
        const xMin = xs[0], xMax = xs.at(-1);
        const maxS = Math.max(0.05, ...r.pesGrid.map(g => g.stdF), ...r.pesGrid.map(g => Math.abs(g.fHat - g.fTrue))) * 1.15;
        const { ph, sx, sy, g } = makeSvgGrid(W, H, pad, xMin, xMax, 0, maxS, `Candidate configuration ${r.pot.xUnit}`, 'Uncertainty σ_F(x) & True |ΔF(x)|', 2, 2);
        parts.push(g);

        const tx1 = sx(Math.max(xMin, -r.width)), tx2 = sx(Math.min(xMax, r.width));
        parts.push(`<rect x="${tx1.toFixed(1)}" y="${pad.t}" width="${Math.max(0, tx2 - tx1).toFixed(1)}" height="${ph}" fill="${pal.trainBg}"/>`);

        const stdPts = r.pesGrid.map(p => `${sx(p.x).toFixed(1)},${sy(Math.min(maxS, p.stdF)).toFixed(1)}`).join(' ');
        const errPts = r.pesGrid.map(p => `${sx(p.x).toFixed(1)},${sy(Math.min(maxS, Math.abs(p.fHat - p.fTrue))).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.ood}" stroke-width="2.6" points="${stdPts}"/>`);
        parts.push(`<polyline fill="none" stroke="${pal.hat}" stroke-width="2.1" stroke-dasharray="5 3" points="${errPts}"/>`);

        const cx = sx(r.activeCandidate.x);
        parts.push(`<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${pal.active}" stroke-width="2"/>`);
        const pillX = Math.min(W - pad.r - 178, Math.max(pad.l + 6, cx - 88));
        parts.push(`<rect x="${pillX.toFixed(1)}" y="${pad.t + 8}" width="174" height="24" rx="12" fill="${pal.active}"/>`);
        parts.push(`<text x="${(pillX + 87).toFixed(1)}" y="${pad.t + 24}" text-anchor="middle" style="fill:#ffffff;font-weight:700;font-size:11.5px">Next DFT x* = ${r.activeCandidate.x >= 0 ? '+' : ''}${r.activeCandidate.x.toFixed(2)}</text>`);

        byId('left-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ood}"></i>Epistemic σ_F(x)</span>` +
          `<span><i class="sw-swatch" style="background:${pal.hat}"></i>True OOD Error |F̂ − F|</span>` +
          `<span><i class="sw-swatch" style="background:${pal.active}"></i>Optimal Query x*</span>`;
        byId('left-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">On-the-Fly Active Learning · Query-by-Committee &amp; Kernel σ_F(x)</span>
            <span class="sw-eq-pill">x* = argmax σ_F(x) = ${r.activeCandidate.x.toFixed(3)}</span>
          </div>
          <p>Modern ML force-field workflows (MACE, Flare, molML) avoid expensive exhaustive DFT grids by running MD until epistemic uncertainty σ_F(x) spikes, then querying quantum chemistry only at high-uncertainty configurations x*.</p>
          <ul>
            <li>Click <strong>+ Add DFT Query x*</strong> in the toolbar above to evaluate the exact reference force at <code>x* = ${r.activeCandidate.x.toFixed(2)}</code> and watch OOD Force RMSE drop immediately!</li>
            <li>Currently <strong>${r.extraAnchors.length}</strong> active-learned DFT anchor(s) added beyond the initial 21-point window.</li>
          </ul>
        `;
      }

      svg.innerHTML = parts.join('');
      attachSvgTooltips(svg);
      return;
    }

    // -------------------------------------------------------------------------
    // TRACK B (ENSEMBLE): LEFT STAGE
    // -------------------------------------------------------------------------
    const tab = state.leftTabEns;
    if (tab === 'landscape' && r.surface2D) {
      // High-DPI 2D Marching-Squares Contour Map for Müller-Brown OR Alanine Dipeptide (φ, ψ) Ramachandran!
      svg.style.display = 'none';
      cvs.hidden = false;
      render2DLandscapeCanvas(cvs, r);
      byId('left-legend').innerHTML =
        `<span><i class="sw-swatch" style="background:#0d9488"></i>Low Free Energy Basin</span>` +
        `<span><i class="sw-swatch" style="background:#b85627"></i>Sampled Trajectory</span>` +
        `<span>● Active Conformer (Step ${Math.min(r.steps, state.frameIdx + 1)})</span>`;
      byId('left-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">${r.surface2D.isRama ? 'Alanine Dipeptide (φ, ψ) Ramachandran Free-Energy Landscape' : '2D Müller–Brown Canonical Three-Basin Potential Surface'}</span>
          <span class="sw-eq-pill">ΔG‡ = ${r.barrier.toFixed(1)} · kBT = ${r.kBT.toFixed(2)}</span>
        </div>
        <p>${r.surface2D.isRama
          ? `Maps backbone torsion free energy across (φ, ψ) ∈ [−180°, +180°]² showing canonical β-sheet/P_II (upper-left Basin A), right-handed α_R-helix (center-left Basin B), and rare left-handed α_L (upper-right cryptic state).`
          : `Renders the benchmark 2D Müller–Brown potential with three non-collinear minima separated by curved saddle ridges—testing whether a sampler discovers the reaction channel from upper-left Basin A to lower-right Basin B.`}</p>
        <ul>
          <li>Under <strong>${esc(r.samplerId)}</strong>, the trajectory executed <strong>${r.switches}</strong> inter-basin crossings, estimating State-B population at <strong>${(r.observed * 100).toFixed(1)}%</strong> vs. exact Boltzmann <strong>${(r.probability * 100).toFixed(1)}%</strong>.</li>
          <li>Switch between <strong>Langevin BAOAB MD</strong>, <strong>WT-Metadynamics</strong>, and <strong>BioEmu Emulator</strong> to compare kinetic trapping against barrier-free equilibrium coverage!</li>
        </ul>
      `;
      return;
    }

    svg.style.display = 'block';
    cvs.hidden = true;
    let parts = [];

    if (tab === 'landscape' || tab === 'pmf') {
      if (r.pmfBins) {
        const qs = r.pmfBins.map(b => b.q);
        const xMin = qs[0] - 0.08, xMax = qs.at(-1) + 0.08;
        const yMax = Math.min(8.5 * r.kBT, Math.max(...r.pmfBins.map(b => Math.min(8 * r.kBT, Math.max(b.fTrue, b.fEmp)))) * 1.15 + 0.5);
        const { sx, sy, g } = makeSvgGrid(W, H, pad, xMin, xMax, 0, yMax, r.land.qLabel, 'Free Energy PMF −kBT ln P(q)', 2, 2);
        parts.push(g);

        const truePts = (r.pmfGrid || r.pmfBins.map(b => ({ q: b.q, u: b.fTrue })))
          .map(p => `${sx(p.q).toFixed(1)},${sy(Math.min(yMax, p.u)).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.ref}" stroke-width="2.7" points="${truePts}"/>`);

        const empPts = r.pmfBins.map(b => `${sx(b.q).toFixed(1)},${sy(Math.min(yMax, b.fEmp)).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.hat}" stroke-width="2.4" stroke-dasharray="5 3" points="${empPts}"/>`);
        for (const b of r.pmfBins) {
          parts.push(`<circle cx="${sx(b.q).toFixed(1)}" cy="${sy(Math.min(yMax, b.fEmp)).toFixed(1)}" r="3.4" fill="${pal.hat}" stroke="#fff" stroke-width="1" data-tip="${esc(`q=${b.q.toFixed(2)} | Empirical PMF=${b.fEmp.toFixed(2)} vs Exact=${b.fTrue.toFixed(2)}`)}"/>`);
        }

        // Scrubbed conformer bead
        const curQ = r.qSeries[Math.min(r.qSeries.length - 1, state.frameIdx)];
        if (curQ >= xMin && curQ <= xMax) {
          parts.push(`<line x1="${sx(curQ).toFixed(1)}" x2="${sx(curQ).toFixed(1)}" y1="${pad.t}" y2="${H - pad.b}" stroke="${pal.ood}" stroke-dasharray="3 3" stroke-width="1.6"/>`);
        }

        byId('left-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Exact Boltzmann PMF</span>` +
          `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Sampled Histogram PMF</span>`;
        byId('left-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">Potential of Mean Force Recovery · F̂(q) = −kBT ln P̂(q)</span>
            <span class="sw-eq-pill">PMF RMSE = ${fmtNum(r.pmfRmse, 2)} · ΔG Error = ${fmtNum(r.deltaGError, 2)} kBT</span>
          </div>
          <p>Inverts the empirical coordinate histogram (with exact umbrella bias reweighting for WT-Metadynamics) into a free-energy profile. Unvisited basins appear as artificially high free-energy ceilings when MD is trapped behind ΔG‡.</p>
          <ul>
            <li>Exact free-energy difference ΔG_A→B = <strong>${fmtNum(r.deltaGTrue, 2)} kBT</strong> vs. Sampled = <strong>${fmtNum(r.deltaGSampled, 2)} kBT</strong>.</li>
            <li>BioEmu-style generative emulators target &lt;1 kcal/mol (~1.6 kBT) PMF accuracy across cryptic pockets without waiting for millisecond barrier crossings.</li>
          </ul>
        `;
      } else {
        // Two-state discrete bar comparison (State A vs State B Boltzmann vs Observed)
        const { sx, sy, g } = makeSvgGrid(W, H, pad, 0, 1, 0, 1, 'Conformational Macrostate (A = Closed, B = Open)', 'Equilibrium vs Sampled Probability', 1, 2);
        parts.push(g);
        const pA_eq = 1 - r.probability, pB_eq = r.probability;
        const pA_ob = 1 - r.observed, pB_ob = r.observed;
        for (const [xc, eqV, obV, lbl] of [[0.28, pA_eq, pA_ob, 'State A (Closed)'], [0.72, pB_eq, pB_ob, 'State B (Open)']]) {
          const cx = sx(xc);
          parts.push(`<rect x="${(cx - 42).toFixed(1)}" y="${sy(eqV).toFixed(1)}" width="38" height="${(H - pad.b - sy(eqV)).toFixed(1)}" rx="4" fill="${pal.ref}"/>`);
          parts.push(`<rect x="${(cx + 4).toFixed(1)}" y="${sy(obV).toFixed(1)}" width="38" height="${(H - pad.b - sy(obV)).toFixed(1)}" rx="4" fill="${pal.hat}"/>`);
          parts.push(`<text x="${cx.toFixed(1)}" y="${H - pad.b + 34}" text-anchor="middle" style="font-weight:700">${lbl}</text>`);
        }
        byId('left-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Exact Boltzmann</span>` +
          `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Sampled Trajectory</span>`;
        byId('left-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">Two-State Boltzmann Detailed Balance</span>
            <span class="sw-eq-pill">p(B) = 1 / (1 + exp(ΔG / kBT)) = ${(r.probability * 100).toFixed(1)}%</span>
          </div>
          <p>Compares exact two-state Boltzmann populations against empirical dwell fractions from ${r.steps} correlated steps.</p>
          <ul><li>Observed State B = <strong>${(r.observed * 100).toFixed(1)}%</strong> (${r.switches} switches; N_eff = ${Math.round(r.nEff)}).</li></ul>
        `;
      }
    } else if (tab === 'occ') {
      const { sx, sy, g } = makeSvgGrid(W, H, pad, 1, r.steps, 0, 1, 'Simulation step', 'Cumulative State-B fraction p̂_B(t)', 0, 2);
      parts.push(g);
      // ±1σ Monte Carlo convergence funnel around p_eq
      const pEq = r.probability;
      const sig0 = Math.sqrt(Math.max(0.002, pEq * (1 - pEq) * r.tauInt));
      const stride = Math.max(1, Math.floor(r.steps / 80));
      const up = [], dn = [];
      for (let i = 1; i <= r.steps; i += stride) {
        const se = Math.min(0.45, sig0 / Math.sqrt(i));
        up.push(`${sx(i).toFixed(1)},${sy(Math.min(1, pEq + se)).toFixed(1)}`);
        dn.unshift(`${sx(i).toFixed(1)},${sy(Math.max(0, pEq - se)).toFixed(1)}`);
      }
      parts.push(`<polygon points="${up.concat(dn).join(' ')}" fill="${pal.refFill}"/>`);
      parts.push(`<line x1="${sx(1).toFixed(1)}" x2="${sx(r.steps).toFixed(1)}" y1="${sy(pEq).toFixed(1)}" y2="${sy(pEq).toFixed(1)}" stroke="${pal.ref}" stroke-width="2.2" stroke-dasharray="5 4"/>`);
      const runPts = r.occupancy.filter((_, i) => i % stride === 0 || i === r.occupancy.length - 1)
        .map(([st, ob]) => `${sx(st).toFixed(1)},${sy(Math.max(0, Math.min(1, ob))).toFixed(1)}`).join(' ');
      parts.push(`<polyline fill="none" stroke="${pal.hat}" stroke-width="2.6" points="${runPts}"/>`);

      byId('left-legend').innerHTML =
        `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Running p̂_B(t)</span>` +
        `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Exact Equilibrium (${(pEq * 100).toFixed(1)}%)</span>` +
        `<span>Shaded = ±1σ_eff funnel</span>`;
      byId('left-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">Ergodic Convergence vs. Metastable Trapping</span>
          <span class="sw-eq-pill">SE(p̂_B) ≈ √[p(1−p)·τ_int / N]</span>
        </div>
        <p>Standard error shrinks only with the number of <em>statistically independent</em> transitions N_eff = N / τ_int—not raw MD step count N. When τ_int is large, running averages plateau far from the true Boltzmann dashed line.</p>
        <ul>
          <li>Final estimate p̂_B = <strong>${(r.observed * 100).toFixed(1)}%</strong> vs. exact <strong>${(pEq * 100).toFixed(1)}%</strong> (N_eff = ${Math.round(r.nEff)} independent draws).</li>
        </ul>
      `;
    } else if (tab === 'kramers') {
      const xs = r.kramersCurve.map(c => c.ratio);
      const xMin = 0, xMax = Math.max(...xs) * 1.08;
      const { sx, sy, g } = makeSvgGrid(W, H, pad, xMin, xMax, -6, 0, 'Reduced Barrier Ratio ΔG‡ / kBT', 'Log Transition Rate ln(k / k₀)', 1, 1);
      parts.push(g);
      parts.push(`<line x1="${sx(0).toFixed(1)}" y1="${sy(0).toFixed(1)}" x2="${sx(Math.min(xMax, 6)).toFixed(1)}" y2="${sy(-Math.min(xMax, 6)).toFixed(1)}" stroke="${pal.ref}" stroke-width="2.6"/>`);
      // BioEmu barrier-invariant horizontal rate reference!
      parts.push(`<line x1="${sx(0).toFixed(1)}" y1="${sy(-0.25).toFixed(1)}" x2="${sx(xMax).toFixed(1)}" y2="${sy(-0.25).toFixed(1)}" stroke="${pal.ood}" stroke-width="2.2" stroke-dasharray="5 3"/>`);
      const curRatio = Math.min(xMax, r.barrier / Math.max(0.2, r.kBT));
      parts.push(`<circle cx="${sx(curRatio).toFixed(1)}" cy="${sy(Math.max(-6, -curRatio)).toFixed(1)}" r="6" fill="${pal.hat}" stroke="#fff" stroke-width="2" data-tip="${esc(`Active ΔG‡/kBT = ${curRatio.toFixed(2)} → Kramers slowdown exp(−${curRatio.toFixed(2)}) = ${Math.exp(-curRatio).toExponential(2)}`)}"/>`);

      byId('left-legend').innerHTML =
        `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Kramers MD Rate (−ΔG‡/kBT)</span>` +
        `<span><i class="sw-swatch" style="background:${pal.ood}"></i>BioEmu Generative Cost (Barrier-Free)</span>` +
        `<span>● Active Regime</span>`;
      byId('left-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">Kramers Rare-Event Exponential Bottleneck vs. Generative Amortization</span>
          <span class="sw-eq-pill">k_A→B ∝ exp(−ΔG‡ / kBT)</span>
        </div>
        <p>Every +2.3 kBT increase in transition-state barrier ΔG‡ slows molecular dynamics basin crossings by 10× (linearly plunging on a log-rate plot), explaining why millisecond cryptic-pocket opening requires enhanced sampling (Metadynamics) or amortized generative emulators (BioEmu).</p>
        <ul><li>At current ΔG‡/kBT = <strong>${curRatio.toFixed(2)}</strong>, thermal crossing probability is suppressed by <strong>${Math.exp(-curRatio).toExponential(2)}×</strong>.</li></ul>
      `;
    }

    svg.innerHTML = parts.join('');
    attachSvgTooltips(svg);
  }

  function render2DLandscapeCanvas(canvas, r) {
    const s2 = r.surface2D;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = 680, H = 320;
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
      canvas.width = W * dpr;
      canvas.height = H * dpr;
    }
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#fbfdfb';
    c.fillRect(0, 0, W, H);

    const pad = { l: 64, r: 24, t: 20, b: 44 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const { GX, GY, gridU, xMin, xMax, yMin, yMax, isRama } = s2;

    // Render crisp interpolated perceptual emerald-teal-sand heatmap
    const RW = 220, RH = 140;
    const off = document.createElement('canvas');
    off.width = RW; off.height = RH;
    const octx = off.getContext('2d');
    const img = octx.createImageData(RW, RH);
    const capU = 7.5 * r.kBT;

    const sampleBilinear = (uNorm, vNorm) => {
      const gx = uNorm * (GX - 1), gy = (1 - vNorm) * (GY - 1);
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const x1 = Math.min(GX - 1, x0 + 1), y1 = Math.min(GY - 1, y0 + 1);
      const fx = gx - x0, fy = gy - y0;
      const v00 = gridU[y0 * GX + x0], v10 = gridU[y0 * GX + x1];
      const v01 = gridU[y1 * GX + x0], v11 = gridU[y1 * GX + x1];
      return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11;
    };

    for (let py = 0; py < RH; py++) {
      for (let px = 0; px < RW; px++) {
        const val = sampleBilinear(px / (RW - 1), py / (RH - 1));
        const t = Math.min(1, Math.max(0, val / Math.max(0.5, capU)));
        // Deep basin teal (#115e59) -> soft mint (#a7f3d0) -> warm alabaster/ochre ridge (#f6f4ec)
        let red, grn, blu;
        if (t < 0.38) {
          const u = t / 0.38;
          red = Math.round(18 + u * 115);
          grn = Math.round(108 + u * 114);
          blu = Math.round(104 + u * 92);
        } else {
          const u = (t - 0.38) / 0.62;
          red = Math.round(133 + u * 116);
          grn = Math.round(222 + u * 25);
          blu = Math.round(196 + u * 45);
        }
        const idx = 4 * (py * RW + px);
        img.data[idx] = red;
        img.data[idx + 1] = grn;
        img.data[idx + 2] = blu;
        img.data[idx + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    c.drawImage(off, pad.l, pad.t, pw, ph);

    // Marching-squares iso-energy contours at 1, 2, 3.5, 5 kBT
    c.strokeStyle = 'rgba(17, 52, 43, 0.28)';
    c.lineWidth = 1.0;
    for (const lvl of [1.0, 2.2, 3.6, 5.2].map(m => m * r.kBT)) {
      c.beginPath();
      for (let iy = 0; iy < GY - 1; iy++) {
        for (let ix = 0; ix < GX - 1; ix++) {
          const v00 = gridU[iy * GX + ix], v10 = gridU[iy * GX + ix + 1];
          const v01 = gridU[(iy + 1) * GX + ix], v11 = gridU[(iy + 1) * GX + ix + 1];
          const code = (v00 <= lvl ? 8 : 0) | (v10 <= lvl ? 4 : 0) | (v11 <= lvl ? 2 : 0) | (v01 <= lvl ? 1 : 0);
          if (code === 0 || code === 15) continue;
          const itp = (a, b) => Math.abs(b - a) < 1e-9 ? 0.5 : Math.max(0, Math.min(1, (lvl - a) / (b - a)));
          const scr = (gx, gy) => [pad.l + (gx / (GX - 1)) * pw, pad.t + (1 - gy / (GY - 1)) * ph];
          const top = scr(ix + itp(v00, v10), iy);
          const right = scr(ix + 1, iy + itp(v10, v11));
          const bot = scr(ix + itp(v01, v11), iy + 1);
          const left = scr(ix, iy + itp(v00, v01));
          const segs = {
            1: [[left, bot]], 2: [[bot, right]], 3: [[left, right]], 4: [[top, right]],
            5: [[left, top], [bot, right]], 6: [[top, bot]], 7: [[left, top]],
            8: [[left, top]], 9: [[top, bot]], 10: [[top, right], [left, bot]],
            11: [[top, right]], 12: [[left, right]], 13: [[bot, right]], 14: [[left, bot]],
          }[code] || [];
          for (const [pA, pB] of segs) { c.moveTo(pA[0], pA[1]); c.lineTo(pB[0], pB[1]); }
        }
      }
      c.stroke();
    }

    const sx = xv => pad.l + ((xv - xMin) / (xMax - xMin)) * pw;
    const sy = yv => pad.t + ph - ((yv - yMin) / (yMax - yMin)) * ph;

    // Plot sampled conformations & trajectory segments
    const pal = palette();
    const pts = r.points2D;
    if (r.samplerId !== 'bioemu_iid') {
      c.strokeStyle = 'rgba(184, 86, 39, 0.42)';
      c.lineWidth = 1.25;
      c.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const px = sx(pts[i].x), py = sy(pts[i].y);
        if (i === 0 || (isRama && (Math.abs(pts[i].x - pts[i - 1].x) > 160 || Math.abs(pts[i].y - pts[i - 1].y) > 160))) {
          c.moveTo(px, py);
        } else {
          c.lineTo(px, py);
        }
      }
      c.stroke();
    }
    const stride = Math.max(1, Math.floor(pts.length / 180));
    for (let i = 0; i < pts.length; i += stride) {
      c.beginPath();
      c.arc(sx(pts[i].x), sy(pts[i].y), 2.7, 0, Math.PI * 2);
      c.fillStyle = pts[i].stateB ? '#c2410c' : '#ffffff';
      c.fill();
      c.strokeStyle = '#13312a';
      c.lineWidth = 0.8;
      c.stroke();
    }

    // Active scrubbed conformer halo
    const activePt = pts[Math.min(pts.length - 1, state.frameIdx)];
    if (activePt) {
      const ax = sx(activePt.x), ay = sy(activePt.y);
      c.beginPath();
      c.arc(ax, ay, 7.2, 0, Math.PI * 2);
      c.fillStyle = pal.active;
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2.2;
      c.stroke();
    }

    // Basin labels
    const labels = isRama
      ? [['β / PII (Basin A)', -125, 148], ['α_R Helix (Basin B)', -65, -43], ['α_L (Cryptic)', 58, 42]]
      : [['Basin A (Start)', -0.56, 1.45], ['Intermediate', -0.05, 0.47], ['Basin B (Product)', 0.62, 0.04]];
    c.font = '700 11px "Inter",sans-serif';
    for (const [txt, lxVal, lyVal] of labels) {
      const px = sx(lxVal), py = sy(lyVal) - 11;
      const tw = c.measureText(txt).width;
      const bx = Math.max(pad.l + 4, Math.min(pad.l + pw - tw - 12, px - tw / 2 - 5));
      const by = Math.max(pad.t + 4, Math.min(pad.t + ph - 20, py - 9));
      c.fillStyle = 'rgba(255,255,255,0.88)';
      c.strokeStyle = '#256650';
      c.lineWidth = 1;
      c.beginPath();
      c.roundRect(bx, by, tw + 10, 17, 5);
      c.fill();
      c.stroke();
      c.fillStyle = '#102e26';
      c.textAlign = 'left';
      c.fillText(txt, bx + 5, by + 12);
    }

    // Frame & Axes
    c.strokeStyle = '#9bb2a5';
    c.lineWidth = 1;
    c.strokeRect(pad.l, pad.t, pw, ph);
    c.fillStyle = '#1b3b33';
    c.font = '11.5px "Inter",sans-serif';
    for (let i = 0; i <= 4; i++) {
      const xv = xMin + ((xMax - xMin) * i) / 4;
      c.textAlign = 'center';
      c.fillText(isRama ? `${xv.toFixed(0)}°` : xv.toFixed(2), sx(xv), pad.t + ph + 16);
      const yv = yMin + ((yMax - yMin) * i) / 4;
      c.textAlign = 'right';
      c.fillText(isRama ? `${yv.toFixed(0)}°` : yv.toFixed(2), pad.l - 7, sy(yv) + 4);
    }
    c.font = '600 12px "Inter",sans-serif';
    c.textAlign = 'center';
    c.fillText(isRama ? 'Backbone Dihedral φ (degrees)' : 'Reaction Coordinate q₁', pad.l + pw / 2, H - 8);
    c.save();
    c.translate(16, pad.t + ph / 2);
    c.rotate(-Math.PI / 2);
    c.fillText(isRama ? 'Backbone Dihedral ψ (degrees)' : 'Reaction Coordinate q₂', 0, 0);
    c.restore();
  }

  // ---------------------------------------------------------------------------
  // 5. RENDER RIGHT STAGE (TRAJECTORY / PHASE SPACE / DRIFT / SPECTRUM / AUTOCORR)
  // ---------------------------------------------------------------------------
  function renderRightStage() {
    const r = currentResult;
    const pal = palette();
    const svg = byId('right-svg');
    const W = 680, H = 320;
    const pad = { l: 64, r: 24, t: 22, b: 48 };
    let parts = [];

    if (r.mode === 'force') {
      const tab = state.rightTabForce;
      const fIdx = Math.min(r.trajFrames.length - 1, state.frameIdx);
      const curF = r.trajFrames[fIdx];

      if (tab === 'traj') {
        const tMax = r.steps * r.dt;
        const yBound = Math.max(Math.abs(r.amplitude) * 1.35, ...r.trajFrames.map(f => Math.abs(f.xRef))) * 1.1;
        const { ph, sx, sy, g } = makeSvgGrid(W, H, pad, 0, tMax, -yBound, yBound, 'Reduced Time t', r.pot.xUnit, 1, 2);
        parts.push(g);

        const clampY = v => Math.max(-yBound, Math.min(yBound, v));
        const refPts = r.trajFrames.filter((_, i) => i % 2 === 0).map(f => `${sx(f.t).toFixed(1)},${sy(clampY(f.xRef)).toFixed(1)}`).join(' ');
        const hatPts = r.trajFrames.filter((_, i) => i % 2 === 0).map(f => `${sx(f.t).toFixed(1)},${sy(clampY(f.xHat)).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.ref}" stroke-width="2.4" points="${refPts}"/>`);
        parts.push(`<polyline fill="none" stroke="${pal.hat}" stroke-width="2.2" stroke-dasharray="6 3" points="${hatPts}"/>`);

        // Scrubber cursor
        const cx = sx(curF.t);
        parts.push(`<line x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${pal.ood}" stroke-width="1.6" stroke-dasharray="3 3"/>`);
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${sy(clampY(curF.xRef)).toFixed(1)}" r="5" fill="${pal.ref}" stroke="#fff" stroke-width="1.6"/>`);
        parts.push(`<circle cx="${cx.toFixed(1)}" cy="${sy(clampY(curF.xHat)).toFixed(1)}" r="5" fill="${pal.hat}" stroke="#fff" stroke-width="1.6"/>`);

        byId('right-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Exact Reference x(t)</span>` +
          `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Surrogate x̂(t)</span>` +
          `<span>Dephase horizon: ${r.dephaseTime.toFixed(2)}</span>`;
        byId('right-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">Coupled MD Time Evolution &amp; Anharmonic Phase Drift</span>
            <span class="sw-eq-pill">${r.blewUp ? `MD Blowup @ t = ${r.blowupTime.toFixed(2)}!` : `Dephase @ t = ${r.dephaseTime.toFixed(2)}`}</span>
          </div>
          <p>Integrates both the true and learned force fields from identical initial displacement x₀ = ${r.amplitude.toFixed(2)} using <strong>${esc(r.integratorId)}</strong>. Even modest force errors accumulate into pronounced frequency/phase lag over hundreds of steps.</p>
          <ul>
            <li>${r.blewUp
              ? `Catastrophic trajectory instability occurred at t = ${r.blowupTime.toFixed(2)} when the surrogate crossed into an unphysical OOD region!`
              : `Trajectory stays bounded; surrogate separates beyond 15% phase tolerance at t = ${r.dephaseTime.toFixed(2)} (full window ${tMax.toFixed(1)}).`}</li>
          </ul>
        `;
      } else if (tab === 'phase') {
        const xs = r.trajFrames.map(f => f.xRef);
        const vs = r.trajFrames.map(f => f.vRef);
        const xBound = Math.max(Math.abs(r.amplitude) * 1.25, ...xs.map(Math.abs)) * 1.15;
        const vBound = Math.max(0.6, ...vs.map(Math.abs)) * 1.22;
        const { sx, sy, g } = makeSvgGrid(W, H, pad, -xBound, xBound, -vBound, vBound, `Position ${r.pot.xUnit}`, 'Momentum / Velocity p = m·v', 2, 2);
        parts.push(g);

        const clampX = v => Math.max(-xBound, Math.min(xBound, v));
        const clampV = v => Math.max(-vBound, Math.min(vBound, v));
        const refPts = r.trajFrames.map(f => `${sx(clampX(f.xRef)).toFixed(1)},${sy(clampV(f.vRef)).toFixed(1)}`).join(' ');
        const hatPts = r.trajFrames.map(f => `${sx(clampX(f.xHat)).toFixed(1)},${sy(clampV(f.vHat)).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.ref}" stroke-width="2.2" points="${refPts}"/>`);
        parts.push(`<polyline fill="none" stroke="${pal.hat}" stroke-width="2.0" stroke-dasharray="5 3" points="${hatPts}"/>`);
        parts.push(`<circle cx="${sx(clampX(curF.xRef)).toFixed(1)}" cy="${sy(clampV(curF.vRef)).toFixed(1)}" r="5.8" fill="${pal.ref}" stroke="#fff" stroke-width="1.8"/>`);
        parts.push(`<circle cx="${sx(clampX(curF.xHat)).toFixed(1)}" cy="${sy(clampV(curF.vHat)).toFixed(1)}" r="5.6" fill="${pal.hat}" stroke="#fff" stroke-width="1.8"/>`);

        byId('right-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Reference Orbit</span>` +
          `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Surrogate Orbit</span>` +
          `<span>Integrator: ${esc(r.integratorId)}</span>`;
        byId('right-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">Symplectic Phase-Space Portrait (x, p) &amp; Liouville Volume</span>
            <span class="sw-eq-pill">dx/dt = ∂H/∂p · dp/dt = −∂H/∂x</span>
          </div>
          <p>Under symplectic <strong>Velocity Verlet</strong>, conservative Hamiltonians trace closed, non-spiraling invariant tori in (x, p) space. Switching the integrator dropdown to <strong>Forward Euler</strong> immediately reveals unphysical outward spiraling (numerical heating) even on the exact force field!</p>
          <ul><li>Compare the rounded elliptical Harmonic orbit against squarish/asymmetric anharmonic phase portraits at high amplitude.</li></ul>
        `;
      } else if (tab === 'energy') {
        const tMax = r.steps * r.dt;
        const dRefArr = r.trajFrames.map(f => f.driftRef);
        const dHatArr = r.trajFrames.map(f => r.blewUp ? 0 : f.driftHatTrue);
        const maxD = Math.max(0.02, ...dRefArr.map(Math.abs), ...dHatArr.map(Math.abs)) * 1.18;
        const { sx, sy, g } = makeSvgGrid(W, H, pad, 0, tMax, -maxD, maxD, 'Reduced Time t', 'Total Energy Deviation H(t) − H(0)', 1, 3);
        parts.push(g);

        const refPts = r.trajFrames.filter((_, i) => i % 2 === 0).map(f => `${sx(f.t).toFixed(1)},${sy(Math.max(-maxD, Math.min(maxD, f.driftRef))).toFixed(1)}`).join(' ');
        const hatPts = r.trajFrames.filter((_, i) => i % 2 === 0).map(f => `${sx(f.t).toFixed(1)},${sy(Math.max(-maxD, Math.min(maxD, f.driftHatTrue))).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.ref}" stroke-width="2.3" points="${refPts}"/>`);
        if (!r.blewUp) parts.push(`<polyline fill="none" stroke="${pal.hat}" stroke-width="2.1" stroke-dasharray="5 3" points="${hatPts}"/>`);

        byId('right-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Ref Integrator ΔH(t) (Max ${fmtNum(r.maxRefDriftPct, 3)}%)</span>` +
          `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Surrogate True-Energy Error</span>`;
        byId('right-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">MDsim Stability Benchmark · Hamiltonian Energy Conservation</span>
            <span class="sw-eq-pill">H(x, v) = ½mv² + U(x)</span>
          </div>
          <p>Tracks bounded symplectic shadow-energy oscillations (green) vs. true-potential energy mismatch along the surrogate trajectory (dashed). In NVE molecular dynamics, secular drift signals either a non-symplectic integrator (Euler) or non-conservative/inaccurate forces.</p>
          <ul><li>Reference integrator max relative drift = <strong>${fmtNum(r.maxRefDriftPct, 3)}%</strong>; surrogate trajectory true-energy discrepancy = <strong>${r.blewUp ? 'Diverged (Blew up)' : fmtNum(r.maxHatDriftPct, 2) + '%'}</strong>.</li></ul>
        `;
      } else if (tab === 'spectrum') {
        const xMax = r.specRef.spectrum.at(-1).omega;
        const yMax = Math.max(0.1, ...r.specRef.spectrum.map(s => s.power), ...r.specHat.spectrum.map(s => s.power)) * 1.15;
        const { sx, sy, g } = makeSvgGrid(W, H, pad, 0, xMax, 0, yMax, 'Angular Frequency ω (rad / time)', 'Vibrational Power Density S(ω)', 2, 2);
        parts.push(g);

        const refPts = r.specRef.spectrum.map(s => `${sx(s.omega).toFixed(1)},${sy(s.power).toFixed(1)}`).join(' ');
        const hatPts = r.specHat.spectrum.map(s => `${sx(s.omega).toFixed(1)},${sy(s.power).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.ref}" stroke-width="2.6" points="${refPts}"/>`);
        parts.push(`<polyline fill="none" stroke="${pal.hat}" stroke-width="2.4" stroke-dasharray="5 3" points="${hatPts}"/>`);

        byId('right-legend').innerHTML =
          `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Ref S(ω) (ω* = ${r.specRef.peakOmega.toFixed(2)})</span>` +
          `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Surrogate S(ω) (ω* = ${r.specHat.peakOmega.toFixed(2)})</span>`;
        byId('right-analysis').innerHTML = `
          <div class="sw-explain-top">
            <span class="sw-explain-title">Velocity Autocorrelation Power Spectrum S(ω) (IR / Vibrational Observable)</span>
            <span class="sw-eq-pill">S(ω) = ∫ C_vv(τ) cos(ωτ) dτ</span>
          </div>
          <p>Computes the vibrational density of states via cosine transform of the velocity autocorrelation function C_vv(τ)—a primary physical observable in MDsim (Fu et al., 2023). Anharmonic bond stiffening blueshifts ω* at higher amplitudes, whereas bond softening (Morse) redshifts ω*.</p>
          <ul><li>Reference fundamental frequency ω* = <strong>${r.specRef.peakOmega.toFixed(2)}</strong> vs. Surrogate ω* = <strong>${r.specHat.peakOmega.toFixed(2)}</strong> rad/t.</li></ul>
        `;
      }

      svg.innerHTML = parts.join('');
      attachSvgTooltips(svg);
      return;
    }

    // -------------------------------------------------------------------------
    // TRACK B (ENSEMBLE): RIGHT STAGE
    // -------------------------------------------------------------------------
    const tab = state.rightTabEns;
    if (tab === 'qtraj') {
      const qArr = r.qSeries;
      const yMin = r.land.discrete ? -0.15 : Math.min(...qArr, -1.2) * 1.12;
      const yMax = r.land.discrete ? 1.15 : Math.max(...qArr, 1.2) * 1.12;
      const { ph, sx, sy, g } = makeSvgGrid(W, H, pad, 1, r.steps, yMin, yMax, 'Sampling Step', r.land.discrete ? 'State (0=A, 1=B)' : 'Reaction Progress q(t)', 0, 2);
      parts.push(g);

      const stride = r.land.discrete ? 1 : Math.max(1, Math.floor(r.steps / 280));
      const pts = r.trace.filter((_, i) => i % stride === 0).map(([st, qv]) => `${sx(st).toFixed(1)},${sy(qv).toFixed(1)}`).join(' ');
      parts.push(`<polyline fill="none" stroke="${pal.ref}" stroke-width="${r.samplerId === 'bioemu_iid' ? '1.3' : '2.0'}" points="${pts}"/>`);

      const curStep = Math.min(r.steps, state.frameIdx + 1);
      parts.push(`<line x1="${sx(curStep).toFixed(1)}" x2="${sx(curStep).toFixed(1)}" y1="${pad.t}" y2="${pad.t + ph}" stroke="${pal.active}" stroke-width="1.8" stroke-dasharray="3 3"/>`);

      byId('right-legend').innerHTML =
        `<span><i class="sw-swatch" style="background:${pal.ref}"></i>${esc(r.samplerId)} trajectory</span>` +
        `<span>Crossings: ${r.switches} · Scrub step: ${curStep}</span>`;
      byId('right-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">Conformational Reaction-Coordinate Time Series q(t)</span>
          <span class="sw-eq-pill">${r.switches} A ↔ B Transitions</span>
        </div>
        <p>Shows step-by-step basin exploration synchronized with the 3D protein conformer below. Notice how Langevin MD dwells long intervals inside single wells, whereas WT-Metadynamics pushes across barriers and BioEmu jumps freely between equilibrium states.</p>
        <ul><li>Acceptance / update efficiency = <strong>${(r.acceptRate * 100).toFixed(0)}%</strong> across ${r.steps} steps.</li></ul>
      `;
    } else if (tab === 'autocorr') {
      const maxLag = r.lags.at(-1).lag;
      const { sx, sy, g } = makeSvgGrid(W, H, pad, 0, maxLag, -0.2, 1.05, 'Lag τ (steps)', 'Autocorrelation C(τ)', 0, 2);
      parts.push(g);
      const pts = r.lags.map(l => `${sx(l.lag).toFixed(1)},${sy(Math.max(-0.2, Math.min(1.05, l.c))).toFixed(1)}`).join(' ');
      parts.push(`<polyline fill="none" stroke="${pal.ood}" stroke-width="2.6" points="${pts}"/>`);

      byId('right-legend').innerHTML =
        `<span><i class="sw-swatch" style="background:${pal.ood}"></i>C(τ) decay</span>` +
        `<span>τ_int = ${r.tauInt.toFixed(1)} steps · N_eff = ${Math.round(r.nEff)}</span>`;
      byId('right-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">Sample Autocorrelation C(τ) &amp; Integrated Effective Sample Size</span>
          <span class="sw-eq-pill">τ_int = 1 + 2∑ C(τ) = ${r.tauInt.toFixed(1)} · N_eff = ${Math.round(r.nEff)}</span>
        </div>
        <p>Quantifies statistical redundancy between consecutive structures. Correlated MD trajectories exhibit slow C(τ) decay (large τ_int, tiny N_eff), whereas generative equilibrium emulators (BioEmu) drop immediately to C(1) ≈ 0 so nearly every generated structure is an independent draw!</p>
        <ul><li>Effective sample yield = <strong>${((r.nEff / r.steps) * 100).toFixed(1)}%</strong> (${Math.round(r.nEff)} independent conformations out of ${r.steps}).</li></ul>
      `;
    } else if (tab === 'hist') {
      if (r.pmfBins) {
        const qs = r.pmfBins.map(b => b.q);
        const pTrueRaw = r.pmfBins.map(b => Math.exp(-b.fTrue / Math.max(0.15, r.kBT)));
        const pEmpRaw = r.pmfBins.map(b => Math.exp(-b.fEmp / Math.max(0.15, r.kBT)));
        const zT = pTrueRaw.reduce((a, b) => a + b, 0), zE = pEmpRaw.reduce((a, b) => a + b, 0);
        const pT = pTrueRaw.map(v => v / zT), pE = pEmpRaw.map(v => v / zE);
        const yMax = Math.max(...pT, ...pE) * 1.18;
        const { sx, sy, g } = makeSvgGrid(W, H, pad, qs[0] - 0.1, qs.at(-1) + 0.1, 0, yMax, r.land.qLabel, 'Normalized Bin Probability P(q)', 2, 2);
        parts.push(g);
        const bw = Math.max(4, ((W - pad.l - pad.r) / qs.length) * 0.72);
        qs.forEach((qv, i) => {
          const cx = sx(qv);
          parts.push(`<rect x="${(cx - bw / 2).toFixed(1)}" y="${sy(pE[i]).toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - pad.b - sy(pE[i])).toFixed(1)}" fill="${pal.hat}" opacity="0.55"/>`);
        });
        const truePts = qs.map((qv, i) => `${sx(qv).toFixed(1)},${sy(pT[i]).toFixed(1)}`).join(' ');
        parts.push(`<polyline fill="none" stroke="${pal.ref}" stroke-width="2.8" points="${truePts}"/>`);
      } else {
        const { sx, sy, g } = makeSvgGrid(W, H, pad, -0.5, 1.5, 0, 1, 'Discrete State', 'Probability Mass', 0, 2);
        parts.push(g);
        parts.push(`<rect x="${(sx(0) - 28).toFixed(1)}" y="${sy(1 - r.observed).toFixed(1)}" width="56" height="${(H - pad.b - sy(1 - r.observed)).toFixed(1)}" fill="${pal.hat}" opacity="0.7"/>`);
        parts.push(`<rect x="${(sx(1) - 28).toFixed(1)}" y="${sy(r.observed).toFixed(1)}" width="56" height="${(H - pad.b - sy(r.observed)).toFixed(1)}" fill="${pal.ref}" opacity="0.7"/>`);
      }
      byId('right-legend').innerHTML =
        `<span><i class="sw-swatch" style="background:${pal.ref}"></i>Exact Boltzmann Density</span>` +
        `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Empirical Histogram</span>`;
      byId('right-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">Boltzmann Equilibrium Density vs. Sampled Conformer Histogram</span>
          <span class="sw-eq-pill">P_eq(q) = Z⁻¹ exp(−U(q) / kBT)</span>
        </div>
        <p>Compares the empirical conformational density directly against the exact canonical Boltzmann distribution on linear probability scale, highlighting missing secondary peaks when a trajectory fails to cross kinetic saddles.</p>
        <ul><li>Total variation / occupancy discrepancy |Δp_B| = <strong>${(Math.abs(r.observed - r.probability) * 100).toFixed(1)}%</strong>.</li></ul>
      `;
    } else if (tab === 'seeds') {
      // 20-Seed Ensemble Reproducibility Audit (Langevin MD vs BioEmu across seeds 1..20!)
      const { sx, sy, g } = makeSvgGrid(W, H, pad, 1, 20, 0, 1, 'Independent Replicate Seed (1–20)', 'Estimated State-B Fraction p̂_B', 0, 2);
      parts.push(g);
      parts.push(`<line x1="${sx(1).toFixed(1)}" x2="${sx(20).toFixed(1)}" y1="${sy(r.probability).toFixed(1)}" y2="${sy(r.probability).toFixed(1)}" stroke="#335c50" stroke-width="2" stroke-dasharray="5 4"/>`);

      let mdErrSum = 0, bioErrSum = 0;
      for (let sd = 1; sd <= 20; sd++) {
        const rMd = SimAnalytics.analyzeEnsembleExperiment({
          landscapeId: state.landscapeId === 'ramachandran' || state.landscapeId === 'muller_brown' ? 'cryptic_1d' : state.landscapeId,
          samplerId: 'langevin_md',
          gap: state.gap, barrier: state.barrier, kBT: state.kBTEns, steps: 260, mix: state.mix, seed: sd * 13,
        });
        const rBio = SimAnalytics.analyzeEnsembleExperiment({
          landscapeId: state.landscapeId === 'ramachandran' || state.landscapeId === 'muller_brown' ? 'cryptic_1d' : state.landscapeId,
          samplerId: 'bioemu_iid',
          gap: state.gap, barrier: state.barrier, kBT: state.kBTEns, steps: 260, mix: state.mix, seed: sd * 13,
        });
        mdErrSum += Math.abs(rMd.observed - rMd.probability);
        bioErrSum += Math.abs(rBio.observed - rBio.probability);
        parts.push(`<circle cx="${(sx(sd) - 3).toFixed(1)}" cy="${sy(rMd.observed).toFixed(1)}" r="4.5" fill="${pal.hat}" stroke="#fff" stroke-width="1" data-tip="${esc(`Seed #${sd} Langevin MD: p̂_B = ${(rMd.observed * 100).toFixed(1)}%`)}"/>`);
        parts.push(`<circle cx="${(sx(sd) + 3).toFixed(1)}" cy="${sy(rBio.observed).toFixed(1)}" r="4.5" fill="${pal.ref}" stroke="#fff" stroke-width="1" data-tip="${esc(`Seed #${sd} BioEmu i.i.d.: p̂_B = ${(rBio.observed * 100).toFixed(1)}%`)}"/>`);
      }

      byId('right-legend').innerHTML =
        `<span><i class="sw-swatch" style="background:${pal.hat}"></i>Langevin MD (20 seeds)</span>` +
        `<span><i class="sw-swatch" style="background:${pal.ref}"></i>BioEmu i.i.d. (20 seeds)</span>` +
        `<span>Dashed = Boltzmann Truth</span>`;
      byId('right-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">20-Seed Replicate Dispersion · Run-to-Run Variance Audit</span>
          <span class="sw-eq-pill">Mean |Δp_B|: MD ${((mdErrSum / 20) * 100).toFixed(1)}% vs BioEmu ${((bioErrSum / 20) * 100).toFixed(1)}%</span>
        </div>
        <p>Repeats the experiment across 20 independent random seeds. Short correlated MD trajectories show wide seed-to-seed dispersion (or systematic collapse near 0% when trapped in Basin A), whereas uncorrelated equilibrium draws cluster tightly on the Boltzmann truth.</p>
        <ul><li>Never claim ensemble convergence from a single MD seed without checking multi-seed variance and τ_int!</li></ul>
      `;
    }

    svg.innerHTML = parts.join('');
    attachSvgTooltips(svg);
  }

  // ---------------------------------------------------------------------------
  // 6. RENDER DEEP SECTION LEFT: CLICKABLE SWEEP MATRIX + GROUPED REGIME BARS
  // ---------------------------------------------------------------------------
  function renderSweepSection() {
    const r = currentResult;
    const tbl = byId('sweep-heatmap');
    const barSvg = byId('sweep-bars');
    const BW = 620, BH = 185, bp = { l: 54, r: 18, t: 22, b: 36 };
    const bpw = BW - bp.l - bp.r, bph = BH - bp.t - bp.b;

    if (r.mode === 'force') {
      byId('sweep-title').textContent = 'OOD Training-Coverage vs. Displacement Matrix';
      const widths = [0.3, 0.5, 0.9, 1.4];
      const amps = [0.4, 0.8, 1.2, 1.6];
      const gridVals = widths.map(w =>
        amps.map(a =>
          SimAnalytics.analyzeForceExperiment({
            potentialId: state.potentialId,
            surrogateId: state.surrogateId,
            integratorId: 'verlet',
            width: w,
            amplitude: a,
            dt: state.dt,
            steps: 240,
          }).rmse
        )
      );
      const flat = gridVals.flat().filter(Number.isFinite);
      const lo = Math.min(...flat), hi = Math.max(lo + 0.05, ...flat);

      let html = `<thead><tr><th class="row-h">Train ±w \\ Start x₀</th>` +
        amps.map(a => `<th>x₀ = ${a.toFixed(1)}</th>`).join('') + `</tr></thead><tbody>`;
      widths.forEach((w, wi) => {
        html += `<tr><th class="row-h">±${w.toFixed(1)}</th>`;
        amps.forEach((a, ai) => {
          const val = gridVals[wi][ai];
          const t = Math.min(1, (val - lo) / Math.max(1e-6, hi - lo));
          const bg = t < 0.45
            ? `hsl(156, 42%, ${95 - t * 42}%)`
            : `hsl(${Math.round(42 - (t - 0.45) * 65)}, 74%, ${90 - t * 34}%)`;
          const fg = t > 0.72 ? '#ffffff' : '#12312a';
          const isAct = Math.abs(state.width - w) < 0.06 && Math.abs(state.amplitude - a) < 0.06;
          html += `<td><button type="button" class="sw-heat-cell ${isAct ? 'active' : ''}" data-sw="${w}" data-sa="${a}" style="background:${bg};color:${fg}" title="Train ±${w}, Start x₀=${a}: Force RMSE ${val.toFixed(3)}">${val.toFixed(2)}</button></td>`;
        });
        html += `</tr>`;
      });
      html += `</tbody>`;
      tbl.innerHTML = html;
      tbl.querySelectorAll('[data-sw]').forEach(btn => {
        btn.onclick = () => {
          state.width = Number(btn.dataset.sw);
          state.amplitude = Number(btn.dataset.sa);
          buildControls();
          computeAndRender();
        };
      });

      // Grouped Bar Chart across all 5 Surrogates: In-Domain RMSE vs OOD RMSE
      const rows = r.leaderboard;
      const yMax = Math.max(0.05, ...rows.flatMap(m => [m.inDomainRmse, Math.min(3.5, m.oodRmse)])) * 1.15;
      const sy = v => bp.t + bph - (Math.min(yMax, v) / yMax) * bph;
      let bParts = [];
      for (let i = 0; i <= 3; i++) {
        const yv = (yMax * i) / 3;
        bParts.push(`<line x1="${bp.l}" x2="${BW - bp.r}" y1="${sy(yv).toFixed(1)}" y2="${sy(yv).toFixed(1)}" stroke="#e1ebe4"/>`);
        bParts.push(`<text x="${bp.l - 6}" y="${(sy(yv) + 4).toFixed(1)}" text-anchor="end">${fmtNum(yv, 2)}</text>`);
      }
      const slotW = bpw / rows.length;
      const shortLbls = { harmonic: 'Harmonic', poly4: 'Taylor p=4', rbf_gp: 'RBF-GP', mace_bessel: 'MACE-Bessel', committee_mlp: 'Committee' };
      rows.forEach((m, i) => {
        const cx = bp.l + slotW * (i + 0.5), bw = 20;
        const hIn = bph - (sy(m.inDomainRmse) - bp.t);
        const hOod = bph - (sy(m.oodRmse) - bp.t);
        const isSel = m.id === state.surrogateId;
        bParts.push(`<rect x="${(cx - bw - 2).toFixed(1)}" y="${sy(m.inDomainRmse).toFixed(1)}" width="${bw}" height="${hIn.toFixed(1)}" rx="3" fill="#0d9488" opacity="${isSel ? '1' : '0.68'}" data-tip="${esc(`${m.short} · In-Domain Force RMSE: ${m.inDomainRmse.toFixed(4)}`)}"/>`);
        bParts.push(`<rect x="${(cx + 2).toFixed(1)}" y="${sy(m.oodRmse).toFixed(1)}" width="${bw}" height="${hOod.toFixed(1)}" rx="3" fill="#7c3aed" opacity="${isSel ? '1' : '0.68'}" data-tip="${esc(`${m.short} · OOD Extrapolation Force RMSE: ${m.oodRmse.toFixed(4)}`)}"/>`);
        bParts.push(`<text x="${cx.toFixed(1)}" y="${BH - 11}" text-anchor="middle" style="font-size:11px;font-weight:${isSel ? '700' : '500'}">${shortLbls[m.id]}</text>`);
      });
      bParts.push(`<rect x="${bp.l + 8}" y="4" width="10" height="10" rx="2" fill="#0d9488"/><text x="${bp.l + 22}" y="13" style="font-size:11.5px;font-weight:600">In-Domain Force RMSE</text>`);
      bParts.push(`<rect x="${bp.l + 188}" y="4" width="10" height="10" rx="2" fill="#7c3aed"/><text x="${bp.l + 202}" y="13" style="font-size:11.5px;font-weight:600">OOD Extrapolation RMSE</text>`);
      barSvg.innerHTML = bParts.join('');
      attachSvgTooltips(barSvg);

      byId('sweep-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">Training Coverage vs. Out-of-Distribution Displacement Cliff</span>
          <span class="sw-eq-pill">Upper-right cells = Severe OOD</span>
        </div>
        <p>Reading across any row holds training coverage ±w fixed while launching trajectories from larger displacements x₀. Notice how <strong>MACE-Bessel</strong> suppresses purple OOD error bars compared to unregularized <strong>Taylor p=4</strong> or linear <strong>Harmonic</strong> baselines.</p>
      `;
    } else {
      byId('sweep-title').textContent = 'Barrier Height × Sampler Free-Energy Error Matrix';
      const barriers = [1.0, 2.0, 3.0, 4.0];
      const samplers = SimAnalytics.SAMPLER_CATALOG;
      const gridVals = samplers.map(s =>
        barriers.map(b =>
          SimAnalytics.analyzeEnsembleExperiment({
            landscapeId: state.landscapeId === 'two_state' ? 'cryptic_1d' : state.landscapeId,
            samplerId: s.id,
            gap: state.gap,
            barrier: b,
            kBT: state.kBTEns,
            steps: 320,
            seed: state.seed,
          }).deltaGError
        )
      );
      const flat = gridVals.flat();
      const lo = Math.min(...flat), hi = Math.max(lo + 0.1, ...flat);

      let html = `<thead><tr><th class="row-h">Sampler \\ Barrier ΔG‡</th>` +
        barriers.map(b => `<th>ΔG‡ = ${b.toFixed(1)}</th>`).join('') + `</tr></thead><tbody>`;
      samplers.forEach((s, si) => {
        html += `<tr><th class="row-h">${esc(s.short)}</th>`;
        barriers.forEach((b, bi) => {
          const val = gridVals[si][bi];
          const t = Math.min(1, (val - lo) / Math.max(1e-6, hi - lo));
          const bg = t < 0.45
            ? `hsl(156, 42%, ${95 - t * 42}%)`
            : `hsl(${Math.round(42 - (t - 0.45) * 65)}, 74%, ${90 - t * 34}%)`;
          const fg = t > 0.72 ? '#ffffff' : '#12312a';
          const isAct = s.id === state.samplerId && Math.abs(state.barrier - b) < 0.15;
          html += `<td><button type="button" class="sw-heat-cell ${isAct ? 'active' : ''}" data-ssamp="${s.id}" data-sbar="${b}" style="background:${bg};color:${fg}" title="${esc(s.short)} @ ΔG‡=${b}: |ΔΔG| = ${val.toFixed(2)} kBT">${val.toFixed(2)}</button></td>`;
        });
        html += `</tr>`;
      });
      html += `</tbody>`;
      tbl.innerHTML = html;
      tbl.querySelectorAll('[data-ssamp]').forEach(btn => {
        btn.onclick = () => {
          state.samplerId = btn.dataset.ssamp;
          state.barrier = Number(btn.dataset.sbar);
          buildControls();
          computeAndRender();
        };
      });

      // Bar Chart: ΔG Error vs Effective Sample Fraction across all 4 samplers
      const rows = r.leaderboard;
      const yMax = Math.max(0.4, ...rows.map(m => m.deltaGError)) * 1.18;
      const sy = v => bp.t + bph - (Math.min(yMax, v) / yMax) * bph;
      let bParts = [];
      for (let i = 0; i <= 3; i++) {
        const yv = (yMax * i) / 3;
        bParts.push(`<line x1="${bp.l}" x2="${BW - bp.r}" y1="${sy(yv).toFixed(1)}" y2="${sy(yv).toFixed(1)}" stroke="#e1ebe4"/>`);
        bParts.push(`<text x="${bp.l - 6}" y="${(sy(yv) + 4).toFixed(1)}" text-anchor="end">${yv.toFixed(2)}</text>`);
      }
      const slotW = bpw / rows.length;
      rows.forEach((m, i) => {
        const cx = bp.l + slotW * (i + 0.5), bw = 32;
        const hErr = bph - (sy(m.deltaGError) - bp.t);
        const isSel = m.id === state.samplerId;
        bParts.push(`<rect x="${(cx - bw / 2).toFixed(1)}" y="${sy(m.deltaGError).toFixed(1)}" width="${bw}" height="${hErr.toFixed(1)}" rx="4" fill="${m.id === 'bioemu_iid' ? '#0d9488' : m.id === 'metadynamics' ? '#2563eb' : '#7c3aed'}" opacity="${isSel ? '1' : '0.72'}" data-tip="${esc(`${m.name} · |ΔG Error| = ${m.deltaGError.toFixed(2)} kBT (N_eff = ${Math.round(m.nEff)})`)}"/>`);
        bParts.push(`<text x="${cx.toFixed(1)}" y="${BH - 11}" text-anchor="middle" style="font-size:11px;font-weight:${isSel ? '700' : '500'}">${esc(m.short)}</text>`);
      });
      bParts.push(`<text x="${bp.l + 8}" y="13" style="font-size:11.5px;font-weight:650">Free-Energy Error |ΔG_sampled − ΔG_true| (kBT · lower is better)</text>`);
      barSvg.innerHTML = bParts.join('');
      attachSvgTooltips(barSvg);

      byId('sweep-analysis').innerHTML = `
        <div class="sw-explain-top">
          <span class="sw-explain-title">Barrier Escalation vs. Enhanced &amp; Generative Sampling</span>
          <span class="sw-eq-pill">Cells = |ΔG Error| in kBT</span>
        </div>
        <p>As kinetic barrier ΔG‡ climbs from 1.0 to 4.0, un-biased Langevin MD &amp; MCMC error spikes into amber/red due to Basin-A trapping, while <strong>WT-Metadynamics</strong> and <strong>BioEmu (i.i.d.)</strong> maintain low green ΔG error across all columns.</p>
      `;
    }
  }

  // ---------------------------------------------------------------------------
  // 7. RENDER DEEP SECTION RIGHT: LIVE 3D PROTEIN CONFORMATIONAL BREATHING STAGE
  // ---------------------------------------------------------------------------
  function buildMorphedProteinSpec(proteinId, coordQ) {
    // Smoothly clamp collective breathing coordinate into [-1.35, +1.35]
    const q = Math.max(-1.35, Math.min(1.35, coordQ));

    if (proteinId === '1MBO' && typeof experimental !== 'undefined' && experimental['1MBO']) {
      // Sperm whale Oxymyoglobin + Heme: morph distal E-helix pocket gate (residues 56..70, His64 gate!)
      const src = experimental['1MBO'];
      const baseRows = src.chains[0].rows;
      const morphed = baseRows.map((r, idx) => {
        const resSeq = r[1];
        // Bell envelope centered at distal His64 (pocket gate opening outward along [-0.62, +0.72, +0.31])
        const env = Math.exp(-Math.pow((resSeq - 64) / 5.5, 2));
        const shift = (q + 0.5) * 2.35 * env;
        return [r[0], resSeq, r[2] - 0.62 * shift, r[3] + 0.72 * shift, r[4] + 0.31 * shift];
      });
      return {
        label: 'PDB 1MBO · Myoglobin Distal Heme Gate',
        gateLabel: 'His64–Phe43 Gate',
        spec: {
          chains: [{ id: 'A', type: 'protein', label: 'Myoglobin Chain A', rows: morphed }],
          ligands: src.ligands,
        },
        selA: 42, // Phe43
        selB: 63, // His64
        colorMode: 'spectrum',
      };
    }

    if (proteinId === 'P04637' && typeof bundledFolds !== 'undefined' && bundledFolds['P04637']) {
      // AlphaFold DB v6 TP53 DNA-binding domain + flexible loop (residues 94..294)
      const fold = bundledFolds['P04637'];
      const slice = fold.rows.slice(93, 294).map(r => {
        const seq = r[1];
        // L1 loop (112..124) & L3 loop (238..250) concerted pincer breathing
        const envL1 = Math.exp(-Math.pow((seq - 118) / 4.8, 2));
        const envL3 = Math.exp(-Math.pow((seq - 243) / 5.0, 2));
        const s1 = q * 2.6 * envL1;
        const s3 = -q * 2.2 * envL3;
        return [r[0], seq, r[2] + 0.65 * (s1 + s3), r[3] + 0.70 * (s1 - s3), r[4] + 0.28 * s1, r[5]];
      });
      return {
        label: 'AlphaFold P04637 · TP53 L1/L3 Loop Ensemble',
        gateLabel: 'Lys120–Arg248 Cleft',
        spec: { rows: slice, hasPlddt: true, chain: 'A' },
        selA: 26,  // Lys120
        selB: 154, // Arg248
        colorMode: 'plddt',
      };
    }

    // Default fallback / 1UBQ Ubiquitin β1–β2 Hairpin Pincer (residues 6..14 vs Asp39)
    const morphedUbq = residues.map((r, i) => {
      const seq = i + 1;
      const envHairpin = Math.exp(-Math.pow((seq - 10) / 3.8, 2));
      const envTail = seq >= 70 ? ((seq - 69) / 7) * 0.85 : 0;
      const shift = q * 2.4 * envHairpin + q * 1.8 * envTail;
      return [r[0], seq, r[1] + 0.55 * shift, r[2] + 0.75 * shift, r[3] + 0.35 * shift];
    });
    return {
      label: 'PDB 1UBQ · Ubiquitin β1–β2 Pincer',
      gateLabel: 'Thr9–Asp39 Pincer',
      spec: { rows: morphedUbq, chain: 'A' },
      selA: 8,  // Thr9
      selB: 38, // Asp39
      colorMode: 'spectrum',
    };
  }

  function render3DStage() {
    if (typeof Mol3D === 'undefined') return;
    const cvs = byId('sim-3d-canvas');
    if (!viewer3d) {
      viewer3d = Mol3D.createViewer(cvs, { theme: 'light', rep: state.rep3d, showLabels: true, showAxes: true });
    }

    const r = currentResult;
    let coordQ = 0;
    if (r.mode === 'force') {
      const f = r.trajFrames[Math.min(r.trajFrames.length - 1, state.frameIdx)];
      coordQ = (r.blewUp ? f.xRef : f.xHat) * 0.75;
    } else {
      const idx = Math.min(r.qSeries.length - 1, state.frameIdx);
      coordQ = r.land.discrete ? (r.qSeries[idx] ? 0.95 : -0.85) : r.qSeries[idx];
    }

    const built = buildMorphedProteinSpec(state.protein3d, coordQ);
    const norm = Mol3D.normalize(built.spec);
    viewer3d.setColorMode(state.colorblind ? 'colorblind' : built.colorMode);
    viewer3d.setRepresentation(state.rep3d);
    viewer3d.setModel(norm, { a: built.selA, b: built.selB, keepCamera: Boolean(viewer3d.state.model) });

    const dist = Mol3D.vDist(norm.residues[built.selA].xyz, norm.residues[built.selB].xyz);
    byId('hud-protein').textContent = built.label;
    byId('hud-conformer').textContent = `${built.gateLabel}: ${dist.toFixed(2)} Å (${coordQ >= 0 ? 'Open B' : 'Closed A'})`;

    byId('stage3d-analysis').innerHTML = `
      <div class="sw-explain-top">
        <span class="sw-explain-title">Structural Coupling · Collective Coordinate → 3D Pocket Geometry</span>
        <span class="sw-eq-pill">${esc(built.gateLabel)} = ${dist.toFixed(2)} Å</span>
      </div>
      <p>Projects the active collective coordinate q(t) = ${coordQ.toFixed(2)} onto localized Cα conformational breathing of real deposited/AlphaFold structures. Press <strong>▶ Play</strong> or drag the frame scrubber above to watch pocket opening/closing synchronized with the free-energy or force-field trajectory.</p>
    `;
  }

  // ---------------------------------------------------------------------------
  // 8. RENDER LEADERBOARD TABLE & SYNTHESIS
  // ---------------------------------------------------------------------------
  function renderLeaderboard() {
    const r = currentResult;
    const head = byId('leaderboard-head');
    const body = byId('leaderboard-body');
    body.replaceChildren();

    if (r.mode === 'force') {
      head.innerHTML = `<tr>
        <th>Force-Field Architecture</th>
        <th>Family</th>
        <th>In-Domain RMSE</th>
        <th>OOD Extrap RMSE</th>
        <th>Traj Force MAE</th>
        <th>Traj Force RMSE</th>
        <th>PES Energy MAE</th>
        <th>Lin’s CCC</th>
        <th>Verlet Drift</th>
        <th>MD Verdict</th>
      </tr>`;
      for (const m of r.leaderboard) {
        const tr = body.insertRow();
        tr.className = 'clickable-row' + (m.id === state.surrogateId ? ' active-row' : '');
        tr.onclick = () => {
          state.surrogateId = m.id;
          buildControls();
          computeAndRender();
        };
        const cells = [
          `<strong>${esc(m.name)}</strong>`,
          esc(m.family),
          fmtNum(m.inDomainRmse, 4),
          `<strong>${fmtNum(m.oodRmse, 3)}</strong>`,
          fmtNum(m.trajMae, 3),
          `<strong>${fmtNum(m.trajRmse, 3)}</strong>`,
          fmtNum(m.energyMae, 3),
          fmtNum(m.ccc, 3),
          m.stable ? `${fmtNum(m.verletDriftPct, 2)}%` : '<span style="color:#991b1b;font-weight:700">Blew Up</span>',
          `<span class="sw-verdict ${m.tone}">${esc(m.verdict)}</span>`,
        ];
        cells.forEach(h => { tr.insertCell().innerHTML = h; });
      }
      const bestStable = [...r.leaderboard].filter(m => m.stable).sort((a, b) => a.trajRmse - b.trajRmse)[0];
      const unstableModels = r.leaderboard.filter(m => !m.stable);
      byId('leaderboard-synthesis').innerHTML =
        `<strong>Automated MDsim &amp; MACE Audit (${esc(r.pot.name)}):</strong> ` +
        `Among MD-stable architectures at x₀ = ${r.amplitude.toFixed(2)} (trained on [−${r.width}, +${r.width}] + ${r.extraAnchors.length} AL anchors), ` +
        `<strong>${esc(bestStable ? bestStable.name : 'MACE Radial–Bessel')}</strong> achieves the lowest trajectory force RMSE (${bestStable ? bestStable.trajRmse.toFixed(3) : '—'}). ` +
        (unstableModels.length
          ? `Crucially, <strong>${unstableModels.map(u => esc(u.short)).join(', ')}</strong> achieved low in-domain training error yet suffered catastrophic OOD trajectory blowup—proving concretely why static force MAE alone cannot certify an MD potential!`
          : `All five architectures remained dynamically confined over the tested trajectory horizon.`);
    } else {
      head.innerHTML = `<tr>
        <th>Sampling / Emulation Paradigm</th>
        <th>Sampled p̂(B)</th>
        <th>Exact Boltzmann p(B)</th>
        <th>Sampled ΔG (kBT)</th>
        <th>|ΔG Error|</th>
        <th>PMF RMSE</th>
        <th>Crossings</th>
        <th>τ_int (steps)</th>
        <th>Effective N_eff</th>
        <th>Ensemble Verdict</th>
      </tr>`;
      for (const m of r.leaderboard) {
        const tr = body.insertRow();
        tr.className = 'clickable-row' + (m.id === state.samplerId ? ' active-row' : '');
        tr.onclick = () => {
          state.samplerId = m.id;
          buildControls();
          computeAndRender();
        };
        const cells = [
          `<strong>${esc(m.name)}</strong>`,
          `${(m.observedB * 100).toFixed(1)}%`,
          `${(m.equilibriumB * 100).toFixed(1)}%`,
          fmtNum(m.deltaGSampled, 2),
          `<strong>${fmtNum(m.deltaGError, 2)}</strong>`,
          fmtNum(m.pmfRmse, 2),
          String(m.switches),
          fmtNum(m.tauInt, 1),
          `<strong>${Math.round(m.nEff)}</strong>`,
          `<span class="sw-verdict ${m.tone}">${esc(m.verdict)}</span>`,
        ];
        cells.forEach(h => { tr.insertCell().innerHTML = h; });
      }
      const mdRow = r.leaderboard.find(m => m.id === 'langevin_md');
      const metaRow = r.leaderboard.find(m => m.id === 'metadynamics');
      const bioRow = r.leaderboard.find(m => m.id === 'bioemu_iid');
      byId('leaderboard-synthesis').innerHTML =
        `<strong>Automated BioEmu &amp; Enhanced-Sampling Synthesis (${esc(r.land.name)}):</strong> ` +
        `Standard <strong>Langevin BAOAB MD</strong> yields N_eff = ${Math.round(mdRow.nEff)} independent samples (${mdRow.switches} crossings, |ΔG Error| = ${mdRow.deltaGError.toFixed(2)} kBT), ` +
        `whereas <strong>Well-Tempered Metadynamics</strong> accelerates barrier crossing (${metaRow.switches} crossings, |ΔG Error| = ${metaRow.deltaGError.toFixed(2)} kBT) ` +
        `and <strong>BioEmu Direct Equilibrium Emulation</strong> achieves N_eff = ${Math.round(bioRow.nEff)} with |ΔG Error| = <strong>${bioRow.deltaGError.toFixed(2)} kBT</strong>.`;
    }
  }

  // ---------------------------------------------------------------------------
  // 9. MASTER COMPUTE & RENDER LOOP + PLAYBACK SCRUBBER
  // ---------------------------------------------------------------------------
  function updateScrubberBounds() {
    const fSlider = byId('frame-slider');
    const maxIdx = state.mode === 'force' ? currentResult.trajFrames.length - 1 : currentResult.steps - 1;
    fSlider.max = String(maxIdx);
    if (state.frameIdx > maxIdx) state.frameIdx = Math.floor(maxIdx * 0.3);
    fSlider.value = String(state.frameIdx);
    byId('frame-label').textContent = state.mode === 'force'
      ? `t = ${(state.frameIdx * state.dt).toFixed(2)}`
      : `Step ${state.frameIdx + 1}`;
  }

  function computeAndRender() {
    if (state.mode === 'force') {
      currentResult = SimAnalytics.analyzeForceExperiment({
        potentialId: state.potentialId,
        surrogateId: state.surrogateId,
        integratorId: state.integratorId,
        width: state.width,
        amplitude: state.amplitude,
        dt: state.dt,
        steps: 480,
        kBT: state.kBTForce,
        extraAnchors: state.extraAnchors,
      });
    } else {
      currentResult = SimAnalytics.analyzeEnsembleExperiment({
        landscapeId: state.landscapeId,
        samplerId: state.samplerId,
        gap: state.gap,
        barrier: state.barrier,
        kBT: state.kBTEns,
        steps: state.stepsEns,
        mix: state.mix,
        seed: state.seed,
      });
    }
    byId('reset-anchors').hidden = state.mode !== 'force' || state.extraAnchors.length === 0;
    updateScrubberBounds();
    renderKpis();
    renderLeftStage();
    renderRightStage();
    renderSweepSection();
    render3DStage();
    renderLeaderboard();
    byId('status').textContent = 'Simulation updated.';
  }

  function stopPlayback() {
    state.playing = false;
    if (state.playRaf) { cancelAnimationFrame(state.playRaf); state.playRaf = 0; }
    const btn = byId('play-sim');
    btn.textContent = '▶ Play';
    btn.setAttribute('aria-pressed', 'false');
  }

  let lastPlayTick = 0;
  function stepPlayback(now) {
    if (!state.playing) return;
    if (now - lastPlayTick > 36) {
      lastPlayTick = now;
      const maxIdx = Number(byId('frame-slider').max);
      state.frameIdx = (state.frameIdx + 3) % (maxIdx + 1);
      byId('frame-slider').value = String(state.frameIdx);
      byId('frame-label').textContent = state.mode === 'force'
        ? `t = ${(state.frameIdx * state.dt).toFixed(2)}`
        : `Step ${state.frameIdx + 1}`;
      renderLeftStage();
      renderRightStage();
      render3DStage();
    }
    state.playRaf = requestAnimationFrame(stepPlayback);
  }

  // ---------------------------------------------------------------------------
  // 10. WIRE EVENTS, ACTIVE LEARNING, EXPORTS & EVIDENCE WORKSPACE
  // ---------------------------------------------------------------------------
  byId('track-force').onclick = () => { stopPlayback(); state.mode = 'force'; buildControls(); computeAndRender(); };
  byId('track-ensemble').onclick = () => { stopPlayback(); state.mode = 'ensemble'; buildControls(); computeAndRender(); };
  byId('mode').onchange = e => { stopPlayback(); state.mode = e.target.value; buildControls(); computeAndRender(); };
  byId('run').onclick = () => computeAndRender();

  document.querySelectorAll('[data-audience]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.audience === state.audience));
    btn.onclick = () => {
      state.audience = btn.dataset.audience;
      document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      computeAndRender();
    };
  });

  byId('toggle-unc').onclick = e => {
    state.showUnc = !state.showUnc;
    e.currentTarget.setAttribute('aria-pressed', String(state.showUnc));
    renderLeftStage();
  };
  byId('toggle-cb').onclick = e => {
    state.colorblind = !state.colorblind;
    document.body.classList.toggle('cb-mode', state.colorblind);
    e.currentTarget.setAttribute('aria-pressed', String(state.colorblind));
    computeAndRender();
  };

  // Active-Learning "+ Add DFT Query x*" Live Loop!
  byId('add-active-anchor').onclick = () => {
    if (state.mode !== 'force' || !currentResult) return;
    const xStar = Number(currentResult.activeCandidate.x.toFixed(4));
    state.extraAnchors.push(xStar);
    computeAndRender();
    byId('save-status').textContent =
      `Added DFT reference anchor at x* = ${xStar >= 0 ? '+' : ''}${xStar.toFixed(2)} (${state.extraAnchors.length} active-learned anchor${state.extraAnchors.length === 1 ? '' : 's'} total; OOD RMSE now ${currentResult.oodRmse.toFixed(3)}).`;
  };
  byId('reset-anchors').onclick = () => {
    state.extraAnchors = [];
    computeAndRender();
    byId('save-status').textContent = 'Reset active-learning anchors to initial 21-point window.';
  };

  byId('play-sim').onclick = () => {
    if (state.playing) {
      stopPlayback();
    } else {
      state.playing = true;
      byId('play-sim').textContent = '⏸ Pause';
      byId('play-sim').setAttribute('aria-pressed', 'true');
      lastPlayTick = performance.now();
      state.playRaf = requestAnimationFrame(stepPlayback);
    }
  };

  byId('frame-slider').oninput = e => {
    stopPlayback();
    state.frameIdx = Number(e.target.value);
    byId('frame-label').textContent = state.mode === 'force'
      ? `t = ${(state.frameIdx * state.dt).toFixed(2)}`
      : `Step ${state.frameIdx + 1}`;
    renderLeftStage();
    renderRightStage();
    render3DStage();
  };

  document.querySelectorAll('#rep3d-tabs button').forEach(btn => {
    btn.onclick = () => {
      state.rep3d = btn.dataset.rep;
      document.querySelectorAll('#rep3d-tabs button').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      render3DStage();
    };
  });

  // Figure & Data Exports
  byId('export-left-fig').onclick = () => {
    if (!byId('left-canvas').hidden) {
      const a = document.createElement('a');
      a.href = byId('left-canvas').toDataURL('image/png');
      a.download = `simulation-${state.landscapeId}-2d-landscape.png`;
      a.click();
    } else {
      downloadSvg(byId('left-svg'), `simulation-${state.mode}-left.svg`);
    }
  };
  byId('export-right-svg').onclick = () => downloadSvg(byId('right-svg'), `simulation-${state.mode}-right.svg`);
  byId('export-3d-png').onclick = () => {
    if (!viewer3d) return;
    const a = document.createElement('a');
    a.href = viewer3d.toDataURL();
    a.download = `simulation-3d-${state.protein3d}.png`;
    a.click();
  };

  // Export JSON (100% compatible with python evidence/check_simulation.py when Quartic + Harmonic + Verlet is selected!)
  byId('export').onclick = () => {
    const r = currentResult;
    const payload = r.mode === 'force'
      ? {
          schema: 'scientific-simulation/1',
          mode: 'force',
          params: {
            width: r.width,
            amplitude: r.amplitude,
            potentialId: r.pot.id,
            surrogateId: r.surrogateId,
            integratorId: r.integratorId,
            dt: r.dt,
            extraAnchors: r.extraAnchors,
          },
          prediction: byId('prediction').value,
          result: {
            trace: r.trace,
            curve: r.curve,
            errors: r.errors,
            stiffness: r.stiffness,
            mae: r.mae,
            rmse: r.rmse,
            inDomainRmse: r.inDomainRmse,
            oodRmse: r.oodRmse,
            energyMae: r.energyMae,
            maxRefDriftPct: r.maxRefDriftPct,
          },
          discussion: {
            claim: byId('brief').value,
            review: byId('review').value,
            decision: byId('decision').value,
          },
        }
      : {
          schema: 'scientific-simulation/1',
          mode: 'ensemble',
          params: {
            landscapeId: r.landscapeId,
            samplerId: r.samplerId,
            gap: r.gap,
            barrier: r.barrier,
            kBT: r.kBT,
            mix: r.mix,
            seed: r.seed,
          },
          prediction: byId('prediction').value,
          result: {
            trace: r.trace,
            occupancy: r.occupancy,
            probability: r.probability,
            observed: r.observed,
            switches: r.switches,
            deltaGTrue: r.deltaGTrue,
            deltaGSampled: r.deltaGSampled,
            tauInt: r.tauInt,
            nEff: r.nEff,
          },
          discussion: {
            claim: byId('brief').value,
            review: byId('review').value,
            decision: byId('decision').value,
          },
        };
    downloadBlob('simulation-report.json', JSON.stringify(payload, null, 2) + '\n', 'application/json');
  };

  byId('csv').onclick = () => {
    const r = currentResult;
    const rows = ['plot,x,series_1,series_2'];
    const charts = r.mode === 'force'
      ? { force_reference_fitted: r.curve, trajectory_reference_fitted: r.trace }
      : { state_or_progress: r.trace, occupancy_observed_equilibrium: r.occupancy };
    for (const [name, data] of Object.entries(charts)) {
      for (const [x, a, b] of data) rows.push([name, x, a, b ?? ''].join(','));
    }
    downloadBlob('simulation-curves.csv', rows.join('\n') + '\n', 'text/csv');
  };

  byId('export-md').onclick = () => {
    const r = currentResult;
    const md = r.mode === 'force'
      ? [
          `# Molecular Force-Field & Symplectic MD Audit — ${r.pot.name}`,
          ``,
          `- **Active Surrogate:** ${r.surrogateId} (\`k0 = ${r.stiffness.toFixed(4)}\`)`,
          `- **Integrator:** ${r.integratorId} (\`Δt = ${r.dt}\`, \`x0 = ${r.amplitude}\`, training \`±${r.width}\` + ${r.extraAnchors.length} AL anchors)`,
          `- **Trajectory Force RMSE / MAE:** ${r.rmse.toFixed(4)} / ${r.mae.toFixed(4)} (In-Domain ${r.inDomainRmse.toFixed(4)} vs OOD ${r.oodRmse.toFixed(4)})`,
          ``,
          `## 5-Surrogate Architecture Leaderboard`,
          `| Surrogate | In-Domain RMSE | OOD RMSE | Traj RMSE | Energy MAE | CCC | Verdict |`,
          `|---|---:|---:|---:|---:|---:|---|`,
          ...r.leaderboard.map(m => `| ${m.name} | ${m.inDomainRmse.toFixed(4)} | ${m.oodRmse.toFixed(4)} | ${m.trajRmse.toFixed(4)} | ${m.energyMae.toFixed(4)} | ${m.ccc.toFixed(3)} | ${m.verdict} |`),
        ]
      : [
          `# Biomolecular Conformational Ensemble Audit — ${r.land.name}`,
          ``,
          `- **Active Sampler:** ${r.samplerId} (\`ΔG = ${r.gap}\`, \`ΔG‡ = ${r.barrier}\`, \`kBT = ${r.kBT}\`, \`seed = ${r.seed}\`)`,
          `- **State-B Occupancy:** ${(r.observed * 100).toFixed(1)}% sampled vs ${(r.probability * 100).toFixed(1)}% Boltzmann (\`|ΔG Error| = ${r.deltaGError.toFixed(2)} kBT\`)`,
          `- **Autocorrelation & Efficiency:** \`τ_int = ${r.tauInt.toFixed(1)}\` steps, \`N_eff = ${Math.round(r.nEff)} / ${r.steps}\``,
          ``,
          `## 4-Sampler Convergence Leaderboard`,
          `| Sampler | Sampled p(B) | Exact p(B) | |ΔG Error| | Crossings | τ_int | N_eff | Verdict |`,
          `|---|---:|---:|---:|---:|---:|---:|---|`,
          ...r.leaderboard.map(m => `| ${m.name} | ${(m.observedB * 100).toFixed(1)}% | ${(m.equilibriumB * 100).toFixed(1)}% | ${m.deltaGError.toFixed(2)} | ${m.switches} | ${m.tauInt.toFixed(1)} | ${Math.round(m.nEff)} | ${m.verdict} |`),
        ];
    if (byId('brief').value || byId('decision').value) {
      md.push(``, `## Team Peer-Review Sign-Off`, `- **Hypothesis:** ${byId('prediction').value || '—'}`, `- **Claim:** ${byId('brief').value || '—'}`, `- **Review:** ${byId('review').value || '—'}`, `- **Decision:** ${byId('decision').value || '—'}`);
    }
    downloadBlob(`simulation-${r.mode}-audit.md`, md.join('\n') + '\n', 'text/markdown;charset=utf-8');
  };

  // Evidence Workspace Capture (100% compatible with existing simulation-force-* and simulation-ensemble-* comparison keys!)
  byId('save-evidence').onclick = () => {
    const r = currentResult;
    try {
      if (r.mode === 'force') {
        const title = `${r.pot.short} · ${r.surrogateId} (train ±${r.width}, x₀=${r.amplitude})`;
        evidenceRecords.capture({
          kind: 'simulated',
          title,
          dataset: `${r.pot.name} force-law benchmark`,
          method: `${r.surrogateId} + ${r.integratorId} (Δt=${r.dt})`,
          metric: 'Force RMSE',
          unit: 'reduced force',
          value: Number(r.rmse.toFixed(4)),
          source: 'studio/simulation.html',
          details: {
            comparisonKey: `simulation-force-${r.pot.id}-amp-${r.amplitude}`,
            potential: r.pot.id,
            surrogate: r.surrogateId,
            integrator: r.integratorId,
            trainingHalfWidth: r.width,
            activeAnchorsAdded: r.extraAnchors.length,
            startingAmplitude: r.amplitude,
            inDomainRmse: Number(r.inDomainRmse.toFixed(4)),
            oodRmse: Number(r.oodRmse.toFixed(4)),
            fittedStiffness: Number(r.stiffness.toFixed(4)),
            forceMae: Number(r.mae.toFixed(4)),
            claim: byId('brief').value || undefined,
          },
        });
        byId('save-status').textContent = `Saved "${title}" (Force RMSE ${r.rmse.toFixed(3)}) to the Evidence Workspace.`;
      } else {
        const title = `${r.land.short} · ${r.samplerId} (ΔG=${r.gap}, ΔG‡=${r.barrier})`;
        evidenceRecords.capture({
          kind: 'simulated',
          title,
          dataset: r.land.name,
          method: `${r.samplerId} (${r.steps} steps, kBT=${r.kBT})`,
          metric: 'Free-energy |ΔG error|',
          unit: 'kBT',
          value: Number(r.deltaGError.toFixed(4)),
          source: 'studio/simulation.html',
          details: {
            comparisonKey: `simulation-ensemble-${r.landscapeId}-bar-${r.barrier}`,
            landscape: r.landscapeId,
            sampler: r.samplerId,
            observedB: Number(r.observed.toFixed(4)),
            equilibriumB: Number(r.probability.toFixed(4)),
            tauInt: Number(r.tauInt.toFixed(2)),
            nEff: Math.round(r.nEff),
            stateSwitches: r.switches,
            claim: byId('brief').value || undefined,
          },
        });
        byId('save-status').textContent = `Saved "${title}" (|ΔG Error| ${r.deltaGError.toFixed(2)} kBT, N_eff ${Math.round(r.nEff)}) to the Evidence Workspace.`;
      }
    } catch (err) {
      byId('save-status').textContent = 'Could not save simulation run. ' + err.message;
    }
  };

  buildControls();
  computeAndRender();
})();
