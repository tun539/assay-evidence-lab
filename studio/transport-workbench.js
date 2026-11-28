'use strict';

/**
 * Assay Evidence Studio — 3D Molecular Transport & Single-Particle Tracking (SPT) Workbench UI
 */
(function initTransportWorkbench() {
  const get = id => document.getElementById(id);
  const Engine = globalThis.TransportEngine;
  if (!Engine) return;

  const PRESETS = {
    brownian: {
      mode: 'free', macromolecule: '1GFL', compartment: 'nucleoplasm',
      D: 0.56, strength: 0, sigmaNm: 0, blurR: 0, count: 96, seed: 41,
      leftTab: 'msd', rightTab: 'vacf',
    },
    fbm_sub: {
      mode: 'fbm', macromolecule: '8AW3', compartment: 'nucleoplasm',
      D: 0.44, strength: 0.50, sigmaNm: 0, blurR: 0, count: 96, seed: 41,
      leftTab: 'scaling', rightTab: 'vacf',
    },
    ctrw_trap: {
      mode: 'ctrw', macromolecule: 'Q31BY4', compartment: 'condensate',
      D: 0.22, strength: 0.58, sigmaNm: 0, blurR: 0, count: 96, seed: 41,
      leftTab: 'msd', rightTab: 'inference',
    },
    spoton_tf: {
      mode: 'two_state', macromolecule: 'P04637', compartment: 'nucleoplasm',
      D: 0.32, strength: 0.48, sigmaNm: 15, blurR: 0, count: 144, seed: 33,
      leftTab: 'spoton', rightTab: 'inference',
    },
    noisy_scmos: {
      mode: 'free', macromolecule: 'custom', compartment: 'custom',
      D: 0.20, strength: 0, sigmaNm: 50, blurR: 0.166667, count: 144, seed: 77,
      leftTab: 'msd', rightTab: 'cve',
    },
    kinesin_drift: {
      mode: 'drift', macromolecule: 'P00846', compartment: 'ecoli_cyto',
      D: 0.18, strength: 0.95, sigmaNm: 10, blurR: 0, count: 96, seed: 41,
      leftTab: 'scaling', rightTab: 'fpt',
    },
    optical_trap: {
      mode: 'trap', macromolecule: '1MBO', compartment: 'glycerol85',
      D: 0.25, strength: 1.50, sigmaNm: 0, blurR: 0, count: 96, seed: 41,
      leftTab: 'msd', rightTab: 'frap',
    },
  };

  let catalog = [];
  let runData = null;
  let audience = 'student';
  let cbMode = false;
  let leftTab = 'msd';
  let rightTab = 'vacf';
  let yaw = 0.52;
  let pitch = 0.30;
  let playing = false;
  let rafId = 0;
  let lastTick = 0;
  let activePreset = 'brownian';

  function palette() {
    if (cbMode) {
      return {
        primary: '#0072b2',
        secondary: '#d55e00',
        tertiary: '#009e73',
        purple: '#cc79a7',
        gold: '#e69f00',
        sky: '#56b4e9',
        ink: '#132a38',
        muted: '#4e6472',
        grid: '#dde6ec',
      };
    }
    return {
      primary: '#117a58',
      secondary: '#c05621',
      tertiary: '#2563eb',
      purple: '#7c3aed',
      gold: '#d97706',
      sky: '#0891b2',
      ink: '#15362d',
      muted: '#536d63',
      grid: '#dde8e1',
    };
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function populateSelects() {
    catalog = Engine.getMacromoleculeCatalog();
    const molSel = get('macromolecule');
    molSel.replaceChildren();
    const customOpt = document.createElement('option');
    customOpt.value = 'custom';
    customOpt.textContent = 'Custom Synthetic Tracer (Manual R_h)';
    molSel.append(customOpt);

    for (const item of catalog) {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = `${item.gene} · R_g ${item.rgNm.toFixed(2)} nm / R_h ${item.rhNm.toFixed(2)} nm (${item.residues} aa/nt)`;
      molSel.append(opt);
    }

    const compSel = get('compartment');
    compSel.replaceChildren();
    for (const c of Engine.COMPARTMENT_PRESETS) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      compSel.append(opt);
    }
  }

  function syncStokesEinstein(updateSlider = true) {
    const molId = get('macromolecule').value;
    const compId = get('compartment').value;
    const mol = catalog.find(m => m.id === molId);
    const comp = Engine.COMPARTMENT_PRESETS.find(c => c.id === compId) || Engine.COMPARTMENT_PRESETS[0];
    const link = get('mol-structure-link');

    if (mol) {
      link.href = `structure.html#${encodeURIComponent(mol.id)}`;
      link.hidden = false;
    } else {
      link.href = 'structure.html';
      link.hidden = true;
    }

    if (mol && comp.viscosityMpas) {
      const dSe = Engine.stokesEinsteinD(mol.rhNm, comp.viscosityMpas);
      const clamped = Math.max(0.04, Math.min(1.20, Number(dSe.toFixed(2))));
      if (updateSlider) {
        get('D').value = String(clamped);
      }
      get('mol-meta').innerHTML =
        `<strong>${esc(mol.gene)}</strong> (<code>${esc(mol.id)}</code>): R<sub>g</sub> = ${mol.rgNm.toFixed(2)} nm, ` +
        `hydrodynamic R<sub>h</sub> = 1.29·R<sub>g</sub> = <strong>${mol.rhNm.toFixed(2)} nm</strong> → ` +
        `Stokes–Einstein D<sub>37°C</sub> = <strong>${dSe.toFixed(3)} μm²/s</strong> in ${esc(comp.short)}.`;
    } else if (mol) {
      get('mol-meta').innerHTML =
        `<strong>${esc(mol.gene)}</strong> (<code>${esc(mol.id)}</code>): R<sub>g</sub> = ${mol.rgNm.toFixed(2)} nm, ` +
        `R<sub>h</sub> = <strong>${mol.rhNm.toFixed(2)} nm</strong>. Select a cellular compartment above to couple Stokes–Einstein viscosity.`;
    } else {
      get('mol-meta').textContent = comp.note;
    }
  }

  function syncControls() {
    const modeId = get('mode').value;
    const spec = Engine.TRANSPORT_MODES.find(m => m.id === modeId) || Engine.TRANSPORT_MODES[0];
    const forceWrap = get('forceLabel');
    const sInput = get('strength');

    forceWrap.hidden = !spec.hasParam;
    forceWrap.style.display = spec.hasParam ? 'flex' : 'none';

    if (spec.hasParam) {
      get('forceName').textContent = spec.paramLabel;
      sInput.min = String(spec.paramMin);
      sInput.max = String(spec.paramMax);
      sInput.step = String(spec.paramStep);
      const cur = Number(sInput.value);
      if (cur < spec.paramMin || cur > spec.paramMax || Number.isNaN(cur)) {
        sInput.value = String(spec.paramDefault);
      }
      const valStr = Number(sInput.value).toFixed(spec.paramStep < 0.1 ? 2 : 1);
      get('fval').textContent = spec.paramUnit ? `${valStr} ${spec.paramUnit}` : valStr;
    } else {
      get('fval').textContent = '';
    }

    get('dval').textContent = `${Number(get('D').value).toFixed(2)} μm²/s`;
    get('sigma-val').textContent = `${get('sigma-loc').value} nm`;
  }

  function applyPreset(presetKey) {
    const p = PRESETS[presetKey];
    if (!p) return;
    activePreset = presetKey;
    document.querySelectorAll('.tp-preset-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetKey);
    });

    get('mode').value = p.mode;
    get('macromolecule').value = catalog.some(m => m.id === p.macromolecule) ? p.macromolecule : 'custom';
    get('compartment').value = p.compartment;
    syncStokesEinstein(p.compartment !== 'custom');
    if (p.compartment === 'custom' || p.mode === 'drift' || p.mode === 'trap') {
      get('D').value = String(p.D);
    }
    syncControls();
    if (p.strength !== undefined) {
      get('strength').value = String(p.strength);
      syncControls();
    }
    get('sigma-loc').value = String(p.sigmaNm);
    get('blur-mode').value = String(p.blurR);
    get('tracer-count').value = String(p.count);
    get('seed').value = String(p.seed);
    syncControls();

    leftTab = p.leftTab;
    rightTab = p.rightTab;
    syncTabs();
    runSimulation();
  }

  function syncTabs() {
    document.querySelectorAll('[data-left-tab]').forEach(btn => {
      btn.setAttribute('aria-selected', String(btn.dataset.leftTab === leftTab));
    });
    document.querySelectorAll('[data-right-tab]').forEach(btn => {
      btn.setAttribute('aria-selected', String(btn.dataset.rightTab === rightTab));
    });
  }

  function runSimulation() {
    const seedEl = get('seed');
    if (!seedEl.reportValidity() || !seedEl.value) return;

    const mode = get('mode').value;
    const spec = Engine.TRANSPORT_MODES.find(m => m.id === mode) || Engine.TRANSPORT_MODES[0];
    const D = Number(get('D').value);
    const strength = spec.hasParam ? Number(get('strength').value) : 0;
    const sigmaLoc = Number(get('sigma-loc').value) * 0.001; // nm -> μm
    const blurR = Number(get('blur-mode').value);
    const count = Number(get('tracer-count').value);
    const seed = Number(seedEl.value);

    runData = Engine.runExperiment({
      mode,
      D,
      strength,
      sigmaLoc,
      blurR,
      count,
      seed,
      steps: 160,
      dt: 0.025,
    });

    get('formula').textContent = spec.formula;
    get('investigate').textContent = spec.question;
    get('message').textContent =
      `Simulated ${count} 3D tracers · ${spec.short} · D = ${D.toFixed(2)} μm²/s · ` +
      `σ_loc = ${Math.round(sigmaLoc * 1000)} nm · seed ${seed}`;
    get('inference-split-note').innerHTML =
      `Parameters are fitted strictly on <strong>${runData.config.trainCount} training trajectories</strong> and ranked by out-of-sample negative log predictive density (<code>nats/coord</code>), <code>ΔAIC</code>, and Akaike weights on the <strong>${runData.config.testCount} held-out test trajectories</strong>.`;

    renderLeaderboard();
    stopPlayback();
    renderAll();
  }

  function renderKpis(frameIdx) {
    if (!runData) return;
    const row = runData.stats[frameIdx];
    const [t, obsMsd, expObsMsd] = row;
    get('kpi-msd').textContent = `${obsMsd.toFixed(3)} μm²`;
    get('kpi-msd-sub').textContent = `Theory ${expObsMsd.toFixed(3)} μm² · RMS ${Math.sqrt(obsMsd).toFixed(2)} μm (t=${t.toFixed(2)}s)`;

    const aHat = runData.ta.alphaHat;
    const regimeTag = aHat < 0.85 ? 'Subdiffusive' : aHat > 1.18 ? 'Superdiffusive' : 'Fickian (~1)';
    get('kpi-alpha').textContent = `α̂ = ${aHat.toFixed(2)}`;
    get('kpi-alpha-sub').textContent = `${regimeTag} · TA slope ${runData.ta.alphaTaHat.toFixed(2)}`;

    const cve = runData.cve;
    get('kpi-cve').textContent = `${cve.dCve.toFixed(3)} ± ${cve.crlbStd.toFixed(3)}`;
    get('kpi-cve-sub').textContent = `Naive D̂ ${cve.dNaive1.toFixed(3)} · σ̂_loc ${Math.round(cve.sigmaLocHat * 1000)} nm`;

    get('kpi-ergo').textContent = `EB ${runData.ta.ebAt10.toFixed(2)} · α₂ ${runData.vanHove.alpha2 >= 0 ? '+' : ''}${runData.vanHove.alpha2.toFixed(2)}`;
    get('kpi-ergo-sub').textContent = runData.ta.ebAt10 > 0.22 || runData.vanHove.alpha2 > 0.25
      ? 'Ergodicity breaking / non-Gaussian!'
      : 'Ergodic & near-Gaussian steps';

    const sp = runData.spotOn;
    get('kpi-spoton').textContent = `${(100 * sp.fBoundHat).toFixed(0)}% bound`;
    get('kpi-spoton-sub').textContent = `D̂_b ${sp.dBoundHat.toFixed(3)} / D̂_f ${sp.dFreeHat.toFixed(2)} μm²/s`;

    const best = runData.fits[0];
    const aicWinner = [...runData.fits].sort((a, b) => a.aic - b.aic)[0];
    get('kpi-winner').textContent = aicWinner.model;
    get('kpi-winner-sub').textContent = `NLL ${best.loss.toFixed(3)} · Weight ${(100 * aicWinner.weight).toFixed(1)}%`;
  }

  function renderLeaderboard() {
    const tbody = get('fit');
    tbody.replaceChildren();
    if (!runData) return;

    runData.fits.forEach((r, idx) => {
      const tr = tbody.insertRow();
      if (r.deltaAic === 0) tr.className = 'is-winner';

      const cRank = tr.insertCell();
      cRank.innerHTML = `<span class="tp-rank-badge">${idx + 1}</span>`;

      const cName = tr.insertCell();
      cName.textContent = r.model;

      const cFam = tr.insertCell();
      cFam.textContent = r.family;

      const cLoss = tr.insertCell();
      cLoss.textContent = r.loss.toFixed(5);

      const cDelta = tr.insertCell();
      cDelta.textContent = r.deltaLoss === 0 ? '0.00000' : `+${r.deltaLoss.toFixed(5)}`;

      const cAic = tr.insertCell();
      cAic.textContent = r.deltaAic === 0 ? '0.0 (Best)' : `+${r.deltaAic.toFixed(1)}`;

      const cWeight = tr.insertCell();
      const pct = (100 * r.weight).toFixed(1);
      cWeight.innerHTML = `<span class="tp-weight-bar"><span class="tp-weight-fill" style="width:${Math.max(2, r.weight * 100).toFixed(1)}%"></span></span>${pct}%`;

      const cDiff = tr.insertCell();
      cDiff.textContent = r.diffusivity.map(v => v.toFixed(3)).join(' / ');

      const cParam = tr.insertCell();
      cParam.textContent = r.paramNote;
    });
  }

  // =========================================================================
  // 3D Live-Cell Single-Particle Tracking Viewport Renderer
  // =========================================================================
  function renderWorld(frameIdx) {
    if (!runData) return;
    const canvas = get('world');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 760;
    const H = 460;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const frame = runData.frames[frameIdx];
    const states = runData.stateFrames[frameIdx];
    const [t, obsMsd, expObsMsd, mx, my, mz, , , a2, boundFrac] = runData.stats[frameIdx];
    const count = runData.config.count;
    const colorMode = get('color-mode').value;

    get('clock').textContent = `${t.toFixed(3)} s`;
    get('metric').textContent =
      `Observed EA-MSD ${obsMsd.toFixed(3)} μm² · Expected ${expObsMsd.toFixed(3)} μm² · ` +
      `RMS radius ${Math.sqrt(obsMsd).toFixed(3)} μm · Centroid shift ${Math.hypot(mx, my, mz).toFixed(3)} μm · ` +
      `Immobile/bound ${(100 * boundFrac).toFixed(0)}% · α₂ = ${a2 >= 0 ? '+' : ''}${a2.toFixed(2)}`;

    // Background gradient
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.46, 30, W * 0.5, H * 0.5, W * 0.65);
    bg.addColorStop(0, '#11353f');
    bg.addColorStop(1, '#06161c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const maxSpan = Math.max(2.0, Math.sqrt(Math.max(runData.stats.at(-1)[1], runData.stats.at(-1)[2])) * 1.42);
    const scale = 172 / maxSpan;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    function project(a, b, c) {
      const u = a * cy - c * sy;
      const v = a * sy + c * cy;
      return [
        380 + scale * u,
        236 - scale * (b * cp - v * sp),
        v * cp + b * sp,
      ];
    }

    function strokePoly(pts, stroke, width = 1.2, dash = []) {
      if (!pts.length) return;
      ctx.save();
      ctx.beginPath();
      pts.forEach(([px, py], idx) => (idx ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      if (dash.length) ctx.setLineDash(dash);
      ctx.stroke();
      ctx.restore();
    }

    // 1 μm floor grid on y = 0 plane
    const gridLim = Math.min(5, Math.max(3, Math.ceil(maxSpan)));
    for (let n = -gridLim; n <= gridLim; n++) {
      strokePoly([project(n, 0, -gridLim), project(n, 0, gridLim)], n === 0 ? '#2b616d' : '#1b414a', n === 0 ? 1.3 : 0.9);
      strokePoly([project(-gridLim, 0, n), project(gridLim, 0, n)], n === 0 ? '#2b616d' : '#1b414a', n === 0 ? 1.3 : 0.9);
    }

    // Optional FRAP bleach sphere (w₀) & First-Passage absorbing sphere (R_target)
    if (get('show-frap-roi').checked) {
      const w0 = runData.config.bleachRadius;
      const rTarget = runData.config.targetRadius;
      for (const [rad, col, dash] of [
        [w0, cbMode ? 'rgba(230,159,0,0.55)' : 'rgba(245,196,81,0.55)', [4, 3]],
        [rTarget, cbMode ? 'rgba(213,94,0,0.48)' : 'rgba(251,113,133,0.48)', [6, 4]],
      ]) {
        for (const [uAx, vAx] of [[0, 1], [0, 2]]) {
          const ring = Array.from({ length: 65 }, (_, s) => {
            const p = [0, 0, 0];
            p[uAx] = rad * Math.cos((s * Math.PI) / 32);
            p[vAx] = rad * Math.sin((s * Math.PI) / 32);
            return project(p[0], p[1], p[2]);
          });
          strokePoly(ring, col, 1.3, dash);
        }
      }
    }

    // Coordinate axes (1 μm unit triad)
    const origin = project(0, 0, 0);
    [['x', [1, 0, 0], '#7ce7c9'], ['y', [0, 1, 0], '#8cc8ff'], ['z', [0, 0, 1], '#f9c97c']].forEach(([lbl, vec, col]) => {
      const tip = project(vec[0], vec[1], vec[2]);
      strokePoly([origin, tip], col, 1.8);
      ctx.fillStyle = col;
      ctx.font = '700 12.5px Inter, system-ui, sans-serif';
      ctx.fillText(`${lbl} (1 μm)`, tip[0] + 5, tip[1] - 3);
    });

    // Optional 25-frame comet tails for a subset of tracers + bold gold spotlight trail on Tracer #0
    if (get('show-tails').checked && frameIdx > 0) {
      const tailStart = Math.max(0, frameIdx - 22);
      const stride = Math.max(1, Math.floor(count / 28));
      for (let j = stride; j < count; j += stride) {
        const idx = j * 3;
        const pts = [];
        for (let f = tailStart; f <= frameIdx; f++) {
          const fr = runData.frames[f];
          pts.push(project(fr[idx], fr[idx + 1], fr[idx + 2]));
        }
        strokePoly(pts, 'rgba(92, 225, 230, 0.20)', 1.0);
      }
    }

    // Spotlight tracer #0 trail
    if (frameIdx > 0) {
      const start0 = Math.max(0, frameIdx - 50);
      const pts0 = [];
      for (let f = start0; f <= frameIdx; f++) {
        const fr = runData.frames[f];
        pts0.push(project(fr[0], fr[1], fr[2]));
      }
      strokePoly(pts0, cbMode ? '#e69f00' : '#f7c95c', 2.2);
    }

    // ±1σ triaxial covariance ellipsoids + ensemble centroid path
    if (get('spread').checked) {
      const means = [mx, my, mz];
      const sd = [0, 1, 2].map(ax => {
        let s2 = 0;
        for (let j = 0; j < count; j++) {
          const d = frame[j * 3 + ax] - means[ax];
          s2 += d * d;
        }
        return Math.sqrt(s2 / count);
      });
      for (const [u, v] of [[0, 1], [1, 2], [0, 2]]) {
        const ell = Array.from({ length: 65 }, (_, s) => {
          const p = means.slice();
          p[u] += sd[u] * Math.cos((s * Math.PI) / 32);
          p[v] += sd[v] * Math.sin((s * Math.PI) / 32);
          return project(p[0], p[1], p[2]);
        });
        strokePoly(ell, 'rgba(134, 225, 206, 0.72)', 1.35);
      }
      if (frameIdx > 0) {
        const cPath = runData.stats.slice(0, frameIdx + 1).map(r => project(r[3], r[4], r[5]));
        strokePoly(cPath, cbMode ? '#cc79a7' : '#f48fb1', 2.2);
      }
    }

    // Depth-sorted 3D tracer spheres
    const dots = [];
    for (let j = 0; j < count; j++) {
      const idx = j * 3;
      const [sx, sy2, depth] = project(frame[idx], frame[idx + 1], frame[idx + 2]);
      dots.push([sx, sy2, depth, j]);
    }
    dots.sort((a, b) => a[2] - b[2]);

    const trainCut = runData.config.trainCount;
    for (const [sx, sy2, depth, j] of dots) {
      const isHero = j === 0;
      const r = Math.max(2.8, Math.min(8.2, 4.7 + depth * 0.42)) + (isHero ? 2.2 : 0);
      let cInner = '#d9fff0';
      let cOuter = '#1f9d8b';

      if (isHero) {
        cInner = '#fff8db';
        cOuter = cbMode ? '#e69f00' : '#eab308';
      } else if (colorMode === 'state') {
        const isBound = states[j] === 0;
        if (isBound) {
          cInner = '#ffe4e6';
          cOuter = cbMode ? '#d55e00' : '#f43f5e';
        } else {
          cInner = '#d6faff';
          cOuter = cbMode ? '#56b4e9' : '#14b8a6';
        }
      } else if (colorMode === 'radial') {
        const idx = j * 3;
        const rad = Math.hypot(frame[idx], frame[idx + 1], frame[idx + 2]);
        const u = Math.min(1, rad / Math.max(0.5, maxSpan));
        cInner = '#eefaff';
        cOuter = u > 0.55 ? (cbMode ? '#d55e00' : '#f59e0b') : (cbMode ? '#0072b2' : '#0ea5e9');
      } else {
        // Train vs Held-out Test cohort split!
        const isTrain = j < trainCut;
        cInner = isTrain ? '#dcfce7' : '#fae8ff';
        cOuter = isTrain ? (cbMode ? '#0072b2' : '#10b981') : (cbMode ? '#cc79a7' : '#a855f7');
      }

      const grad = ctx.createRadialGradient(sx - r * 0.32, sy2 - r * 0.32, 0.4, sx, sy2, r);
      grad.addColorStop(0, cInner);
      grad.addColorStop(1, cOuter);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy2, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // HUD Telemetry Overlay (top-left & bottom-left)
    ctx.fillStyle = 'rgba(6, 22, 28, 0.76)';
    ctx.fillRect(12, 12, 266, 46);
    ctx.strokeStyle = 'rgba(92, 225, 230, 0.30)';
    ctx.strokeRect(12, 12, 266, 46);
    ctx.fillStyle = '#e5f7f2';
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.fillText(`${runData.config.modeShort} · Frame ${frameIdx}/${runData.config.steps}`, 20, 30);
    ctx.fillStyle = '#9ecbc0';
    ctx.font = '11.5px Inter, system-ui, sans-serif';
    ctx.fillText(
      colorMode === 'track'
        ? `Cohort split: ${trainCut} Train / ${count - trainCut} Held-out Test`
        : `Cyan: Mobile · Coral: Bound/Trapped · Gold: #1`,
      20, 48
    );

    // 1 μm calibrated scale bar (bottom-right)
    const barPx = Math.max(28, Math.min(140, scale));
    const bx = W - barPx - 20;
    const by = H - 20;
    ctx.strokeStyle = '#d8f3eb';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + barPx, by);
    ctx.stroke();
    ctx.fillStyle = '#d8f3eb';
    ctx.font = '700 11.5px Inter, monospace';
    ctx.fillText('1.0 μm', bx + barPx * 0.5 - 20, by - 6);
  }

  // =========================================================================
  // Left & Right 10-Tab Publication SVG Charts + Scientific Explanations
  // =========================================================================
  function audienceText(explorerStr, studentStr, researcherStr) {
    if (audience === 'explorer') return explorerStr;
    if (audience === 'researcher') return researcherStr;
    return studentStr;
  }

  function renderLeftChart(frameIdx) {
    if (!runData) return;
    const svg = get('graph');
    const explain = get('left-explain');
    const pal = palette();
    const W = 600, H = 320;

    if (leftTab === 'msd') {
      const L = 58, R = 578, T = 26, B = 274;
      const plotW = R - L, plotH = B - T;
      const tMax = runData.config.steps * runData.config.dt;

      let yMax = 0.05;
      for (const r of runData.stats) yMax = Math.max(yMax, r[1], r[2]);
      const lagMaxS = runData.ta.lags.at(-1) || 1;
      for (let tr = 0; tr < Math.min(14, runData.ta.sampleTracks.length); tr++) {
        for (let i = 0; i < runData.ta.lags.length; i++) {
          yMax = Math.max(yMax, Math.min(runData.stats.at(-1)[1] * 2.1, runData.ta.sampleTracks[tr][i]));
        }
      }
      yMax *= 1.08;

      const xOf = t => L + (t / tMax) * plotW;
      const yOf = v => B - (Math.min(yMax, Math.max(0, v)) / yMax) * plotH;

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      // Grid lines
      for (let g = 0; g <= 4; g++) {
        const yv = (yMax * g) / 4;
        const yy = yOf(yv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${pal.grid}" stroke-width="1"/>`;
        out += `<text x="${L - 7}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="${pal.muted}">${yv.toFixed(yv < 1 ? 2 : 1)}</text>`;
      }
      for (let ts = 0; ts <= 4; ts++) {
        const xx = xOf(ts);
        out += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${B}" stroke="${pal.grid}" stroke-width="1"/>`;
        out += `<text x="${xx.toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="11" fill="${pal.muted}">${ts.toFixed(1)} s</text>`;
      }

      // Individual TA-MSD fan trajectories (lags up to lagMaxS)
      for (let tr = 0; tr < Math.min(16, runData.ta.sampleTracks.length); tr++) {
        const track = runData.ta.sampleTracks[tr];
        const pts = [];
        for (let i = 0; i < runData.ta.lags.length; i++) {
          pts.push(`${xOf(runData.ta.lags[i]).toFixed(1)},${yOf(track[i]).toFixed(1)}`);
        }
        out += `<polyline fill="none" stroke="${pal.sky}" stroke-opacity="0.28" stroke-width="1.2" points="${pts.join(' ')}"/>`;
      }

      // Mean TA-MSD
      const meanTaPts = Array.from(runData.ta.lags, (tau, i) => `${xOf(tau).toFixed(1)},${yOf(runData.ta.meanTaMsd[i]).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${pal.tertiary}" stroke-width="2" stroke-dasharray="3 3" points="${meanTaPts}"/>`;

      // Ensemble EA-MSD & Expected Theory
      const eaPts = runData.stats.map(r => `${xOf(r[0]).toFixed(1)},${yOf(r[1]).toFixed(1)}`).join(' ');
      const thPts = runData.stats.map(r => `${xOf(r[0]).toFixed(1)},${yOf(r[2]).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${pal.primary}" stroke-width="2.7" points="${eaPts}"/>`;
      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.2" stroke-dasharray="7 4" points="${thPts}"/>`;

      // Playback cursor
      const curX = xOf(frameIdx * runData.config.dt);
      out += `<line x1="${curX.toFixed(1)}" y1="${T}" x2="${curX.toFixed(1)}" y2="${B}" stroke="${pal.gold}" stroke-width="1.6" stroke-dasharray="4 3"/>`;
      out += `<circle cx="${curX.toFixed(1)}" cy="${yOf(runData.stats[frameIdx][1]).toFixed(1)}" r="4.2" fill="${pal.primary}" stroke="#fff" stroke-width="1.2"/>`;

      // Axes & labels
      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}">Time t / Lag Δ (seconds)</text>`;
      out += `<text x="15" y="${(T + B) / 2}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}" transform="rotate(-90 15 ${(T + B) / 2})">MSD ⟨r²⟩ (μm²)</text>`;

      // Legend box (top-left inside chart)
      out += `<rect x="${L + 8}" y="${T + 6}" width="256" height="60" rx="6" fill="rgba(255,255,255,0.90)" stroke="#d3e0d8"/>`;
      out += `<line x1="${L + 16}" y1="${T + 20}" x2="${L + 38}" y2="${T + 20}" stroke="${pal.primary}" stroke-width="2.7"/>`;
      out += `<text x="${L + 44}" y="${T + 24}" font-size="11" fill="${pal.ink}">Observed Ensemble EA-MSD(t)</text>`;
      out += `<line x1="${L + 16}" y1="${T + 36}" x2="${L + 38}" y2="${T + 36}" stroke="${pal.secondary}" stroke-width="2.2" stroke-dasharray="6 3"/>`;
      out += `<text x="${L + 44}" y="${T + 40}" font-size="11" fill="${pal.ink}">Analytical Expectation (incl. noise)</text>`;
      out += `<line x1="${L + 16}" y1="${T + 52}" x2="${L + 38}" y2="${T + 52}" stroke="${pal.sky}" stroke-width="2"/>`;
      out += `<text x="${L + 44}" y="${T + 56}" font-size="11" fill="${pal.ink}">16 Individual TA-MSD(Δ) (${lagMaxS.toFixed(1)}s)</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Ensemble vs. Single-Track Motion:</strong> The solid curve tracks the average squared distance of all ${runData.config.count} particles, while faint cyan curves show individual trajectories. When cyan tracks fan out widely (as in <code>CTRW</code> traps), individual molecules experience wildly different mobilities.`,
        `<strong>EA-MSD vs. TA-MSD Ergodicity Diagnostic:</strong> In ergodic Brownian or viscoelastic <code>fBm</code> motion, individual time-averaged curves <code>TA-MSD(Δ)</code> cluster tightly around <code>EA-MSD(t)</code> (EB = <strong>${runData.ta.ebAt10.toFixed(3)}</strong>). Under transient Pareto traps (<code>CTRW</code>), individual <code>TA-MSD</code> curves remain linear in lag Δ while their amplitudes scatter broadly—the hallmark of <em>Weak Ergodicity Breaking</em>.`,
        `<strong>Metzler–Barkai Ergodicity Audit:</strong> Observed <code>EA-MSD(4.0 s) = ${runData.stats.at(-1)[1].toFixed(3)} μm²</code> vs. analytical <code>${runData.stats.at(-1)[2].toFixed(3)} μm²</code>. At lag Δ = 0.25 s, <code>EB(Δ) = Var[δ̄²] / ⟨δ̄²⟩² = ${runData.ta.ebAt10.toFixed(3)}</code> (ergodic Gaussian baseline → 0 as T/Δ → ∞; Scher–Montroll <code>CTRW</code> converges to a non-zero Mittag-Leffler variance).`
      );
    } else if (leftTab === 'scaling') {
      const L = 58, R = 578, T1 = 22, B1 = 176, T2 = 206, B2 = 278;
      const lags = runData.ta.lags;
      const lxMin = Math.log10(lags[0]), lxMax = Math.log10(lags.at(-1));
      const xOf = tau => L + ((Math.log10(tau) - lxMin) / Math.max(1e-9, lxMax - lxMin)) * (R - L);

      const vals = [];
      for (let i = 0; i < lags.length; i++) {
        vals.push(Math.max(1e-4, runData.stats[ runData.ta.lagSteps[i] ][1]));
        vals.push(Math.max(1e-4, runData.ta.meanTaMsd[i]));
      }
      const lyMin = Math.log10(Math.min(...vals) * 0.72);
      const lyMax = Math.log10(Math.max(...vals) * 1.45);
      const y1Of = v => B1 - ((Math.log10(Math.max(1e-5, v)) - lyMin) / Math.max(1e-9, lyMax - lyMin)) * (B1 - T1);
      const y2Of = a => B2 - (Math.max(0, Math.min(2.2, a)) / 2.2) * (B2 - T2);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      // Fickian α=1 reference line anchored at lag[3]
      const refIdx = Math.min(3, lags.length - 1);
      const refTau = lags[refIdx];
      const refMsd = Math.max(1e-4, runData.stats[runData.ta.lagSteps[refIdx]][1]);
      const refPts = lags.map(tau => `${xOf(tau).toFixed(1)},${y1Of(refMsd * (tau / refTau)).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="5 4" points="${refPts}"/>`;

      const eaLogPts = lags.map((tau, i) => `${xOf(tau).toFixed(1)},${y1Of(runData.stats[runData.ta.lagSteps[i]][1]).toFixed(1)}`).join(' ');
      const taLogPts = lags.map((tau, i) => `${xOf(tau).toFixed(1)},${y1Of(runData.ta.meanTaMsd[i]).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${pal.primary}" stroke-width="2.6" points="${eaLogPts}"/>`;
      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.0" stroke-dasharray="4 3" points="${taLogPts}"/>`;

      out += `<path d="M${L} ${T1}V${B1}H${R}" fill="none" stroke="#688277" stroke-width="1.2"/>`;
      out += `<text x="16" y="${(T1 + B1) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${pal.ink}" transform="rotate(-90 16 ${(T1 + B1) / 2})">log₁₀ MSD (μm²)</text>`;
      out += `<text x="${L + 10}" y="${T1 + 16}" font-size="11.5" font-weight="700" fill="${pal.primary}">Fitted α̂_EA = ${runData.ta.alphaHat.toFixed(2)} · α̂_TA = ${runData.ta.alphaTaHat.toFixed(2)} (gray dashed: α = 1.0)</text>`;

      // Bottom subplot: local slope α(τ) & EB(τ)
      const yOne = y2Of(1.0);
      out += `<line x1="${L}" y1="${yOne.toFixed(1)}" x2="${R}" y2="${yOne.toFixed(1)}" stroke="#94a3b8" stroke-dasharray="4 3"/>`;
      const alphaPts = lags.map((tau, i) => `${xOf(tau).toFixed(1)},${y2Of(runData.ta.localAlpha[i]).toFixed(1)}`).join(' ');
      const ebPts = lags.map((tau, i) => `${xOf(tau).toFixed(1)},${y2Of(Math.min(2.1, runData.ta.ebSeries[i] * 2)).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${pal.tertiary}" stroke-width="2.3" points="${alphaPts}"/>`;
      out += `<polyline fill="none" stroke="${pal.purple}" stroke-width="1.9" stroke-dasharray="3 3" points="${ebPts}"/>`;
      out += `<path d="M${L} ${T2}V${B2}H${R}" fill="none" stroke="#688277" stroke-width="1.2"/>`;

      for (const tickS of [0.025, 0.05, 0.1, 0.25, 0.5, 1.0]) {
        if (tickS >= lags[0] * 0.98 && tickS <= lags.at(-1) * 1.02) {
          const xx = xOf(tickS);
          out += `<text x="${xx.toFixed(1)}" y="${B2 + 16}" text-anchor="middle" font-size="10.8" fill="${pal.muted}">${tickS}s</text>`;
        }
      }
      out += `<text x="${L - 6}" y="${(y2Of(0) + 3).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${pal.muted}">0</text>`;
      out += `<text x="${L - 6}" y="${(y2Of(1) + 3).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${pal.muted}">1</text>`;
      out += `<text x="${L - 6}" y="${(y2Of(2) + 3).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${pal.muted}">2</text>`;
      out += `<text x="16" y="${(T2 + B2) / 2}" text-anchor="middle" font-size="11" font-weight="600" fill="${pal.ink}" transform="rotate(-90 16 ${(T2 + B2) / 2})">α(τ) / 2·EB</text>`;
      out += `<text x="${R - 8}" y="${T2 + 14}" text-anchor="end" font-size="11" fill="${pal.tertiary}">Solid: local slope α(τ) · Dotted: 2×EB(τ)</text>`;
      out += `<text x="${(L + R) / 2}" y="${H - 7}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}">Lag time τ on logarithmic axis (s)</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Reading the Anomalous Slope α:</strong> A slope of <code>α = 1</code> indicates normal random diffusion. Below 1 means particles are hindered or viscoelastic (subdiffusion); toward 2 means directed motor push (superdiffusion).`,
        `<strong>Scale-Dependent Anomalous Exponent α(τ) = d ln(MSD)/d ln(τ):</strong> Global fit yields <strong>α̂_EA = ${runData.ta.alphaHat.toFixed(2)}</strong> vs. time-averaged <strong>α̂_TA = ${runData.ta.alphaTaHat.toFixed(2)}</strong>. Notice how directed drift transitions from α ≈ 1 at short lags to α → 2 above τ_c = 6D/v², whereas harmonic confinement bends α(τ) → 0 at the trap plateau.`,
        `<strong>AnDi Challenge Power-Law &amp; Ergodicity Separation:</strong> Comparing <code>α̂_EA (${runData.ta.alphaHat.toFixed(2)})</code> against <code>α̂_TA (${runData.ta.alphaTaHat.toFixed(2)})</code> immediately separates viscoelastic <code>fBm</code> (where α̂_EA ≈ α̂_TA = 2H and EB → 0) from renewal <code>CTRW</code> (where α̂_EA ≈ α_trap &lt; 1 while α̂_TA ≈ 1.00).`
      );
    } else if (leftTab === 'vanhove') {
      const L = 58, R = 578, T = 28, B = 272;
      const vh = runData.vanHove;
      const xMax = Math.abs(vh.centers[0]) + (vh.centers[1] - vh.centers[0]) * 0.5;
      const gaussPeak = 1 / (Math.sqrt(2 * Math.PI) * vh.std);
      let yMax = gaussPeak * 1.15;
      for (let i = 0; i < vh.density.length; i++) yMax = Math.max(yMax, vh.density[i] * 1.10);

      const xOf = v => L + ((v + xMax) / (2 * xMax)) * (R - L);
      const yOf = d => B - (Math.min(yMax, d) / yMax) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (let g = 0; g <= 4; g++) {
        const yv = (yMax * g) / 4;
        const yy = yOf(yv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${pal.grid}"/>`;
        out += `<text x="${L - 7}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.8" fill="${pal.muted}">${yv.toFixed(1)}</text>`;
      }

      const barW = ((R - L) / vh.centers.length) * 0.84;
      for (let b = 0; b < vh.centers.length; b++) {
        const cx = xOf(vh.centers[b]);
        const top = yOf(vh.density[b]);
        out += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, B - top).toFixed(1)}" fill="${pal.primary}" fill-opacity="0.36" stroke="${pal.primary}" stroke-width="1"/>`;
      }

      // Variance-matched Gaussian reference curve
      const gPts = [];
      for (let s = 0; s <= 120; s++) {
        const xv = -xMax + (2 * xMax * s) / 120;
        const gd = (1 / (Math.sqrt(2 * Math.PI) * vh.std)) * Math.exp(-(xv * xv) / (2 * vh.std * vh.std));
        gPts.push(`${xOf(xv).toFixed(1)},${yOf(gd).toFixed(1)}`);
      }
      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.4" stroke-dasharray="6 4" points="${gPts.join(' ')}"/>`;

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      for (const frac of [-1, -0.5, 0, 0.5, 1]) {
        const xv = frac * xMax;
        out += `<text x="${xOf(xv).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="11" fill="${pal.muted}">${xv.toFixed(2)}</text>`;
      }
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}">1D Displacement Δx over lag τ = ${vh.lagS.toFixed(2)} s (μm)</text>`;
      out += `<text x="16" y="${(T + B) / 2}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}" transform="rotate(-90 16 ${(T + B) / 2})">Probability density P(Δx, τ)</text>`;

      out += `<rect x="${R - 235}" y="${T + 6}" width="225" height="44" rx="6" fill="rgba(255,255,255,0.92)" stroke="#d3e0d8"/>`;
      out += `<text x="${R - 225}" y="${T + 24}" font-size="11.5" font-weight="700" fill="${pal.ink}">Non-Gaussian α₂ = ${vh.alpha2 >= 0 ? '+' : ''}${vh.alpha2.toFixed(3)}</text>`;
      out += `<text x="${R - 225}" y="${T + 41}" font-size="11" fill="${pal.secondary}">Dashed: Variance-matched Gaussian</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Step Shape (Van Hove Histogram):</strong> Normal random walks form a smooth bell curve (dashed). A tall central spike with wide tails means some molecules are stuck in traps while others diffuse freely!`,
        `<strong>Van Hove Self-Part P(Δx, τ = ${vh.lagS.toFixed(2)} s) &amp; Non-Gaussianity α₂:</strong> Excess kurtosis parameter <strong>α₂ = ${vh.alpha2 >= 0 ? '+' : ''}${vh.alpha2.toFixed(3)}</strong> (0 for any Gaussian process, including fractional Brownian <code>fBm</code>). Both <code>CTRW</code> traps and <code>Spot-On</code> 2-state switching produce leptokurtic cusps (α₂ &gt; 0.25).`,
        `<strong>Brownian-yet-Non-Gaussian &amp; Trap Diagnostics:</strong> Note that <code>Spot-On</code> 2-state switching exhibits linear Fickian MSD (α = 1) yet strongly positive Van Hove kurtosis (<code>α₂ = ${vh.alpha2.toFixed(3)}</code>), proving why MSD linearity alone never suffices to claim homogeneous Brownian diffusion.`
      );
    } else if (leftTab === 'spoton') {
      const L = 58, R = 554, T = 28, B = 272;
      const sp = runData.spotOn;
      const rMax = sp.centers.at(-1) + (sp.centers[1] - sp.centers[0]) * 0.5;
      let yMax = 0.5;
      for (let i = 0; i < sp.centers.length; i++) {
        yMax = Math.max(yMax, sp.pdfHist[i], sp.pdf1State[i], sp.pdf2State[i]);
      }
      yMax *= 1.12;

      const xOf = r => L + (r / rMax) * (R - L);
      const yPdf = d => B - (Math.min(yMax, d) / yMax) * (B - T);
      const yCdf = c => B - Math.max(0, Math.min(1, c)) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      const barW = ((R - L) / sp.centers.length) * 0.82;
      for (let b = 0; b < sp.centers.length; b++) {
        const cx = xOf(sp.centers[b]);
        const top = yPdf(sp.pdfHist[b]);
        out += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, B - top).toFixed(1)}" fill="${pal.sky}" fill-opacity="0.28" stroke="${pal.sky}" stroke-width="0.9"/>`;
      }

      const p1Pts = Array.from(sp.centers, (r, i) => `${xOf(r).toFixed(1)},${yPdf(sp.pdf1State[i]).toFixed(1)}`).join(' ');
      const p2Pts = Array.from(sp.centers, (r, i) => `${xOf(r).toFixed(1)},${yPdf(sp.pdf2State[i]).toFixed(1)}`).join(' ');
      const cEmpPts = Array.from(sp.centers, (r, i) => `${xOf(r).toFixed(1)},${yCdf(sp.cdfEmp[i]).toFixed(1)}`).join(' ');
      const c2Pts = Array.from(sp.centers, (r, i) => `${xOf(r).toFixed(1)},${yCdf(sp.cdf2State[i]).toFixed(1)}`).join(' ');

      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.0" stroke-dasharray="6 4" points="${p1Pts}"/>`;
      out += `<polyline fill="none" stroke="${pal.primary}" stroke-width="2.7" points="${p2Pts}"/>`;
      out += `<polyline fill="none" stroke="${pal.purple}" stroke-width="2.0" stroke-dasharray="3 3" points="${cEmpPts}"/>`;
      out += `<polyline fill="none" stroke="${pal.purple}" stroke-width="1.3" stroke-opacity="0.6" points="${c2Pts}"/>`;

      out += `<path d="M${L} ${T}V${B}H${R}V${T}" fill="none" stroke="#688277" stroke-width="1.2"/>`;
      for (let g = 0; g <= 4; g++) {
        const yy = B - (g / 4) * (B - T);
        out += `<text x="${L - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${pal.muted}">${((yMax * g) / 4).toFixed(1)}</text>`;
        out += `<text x="${R + 6}" y="${(yy + 4).toFixed(1)}" font-size="10.5" fill="${pal.purple}">${(g * 0.25).toFixed(2)}</text>`;
      }
      for (let g = 0; g <= 4; g++) {
        const rv = (rMax * g) / 4;
        out += `<text x="${xOf(rv).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="11" fill="${pal.muted}">${rv.toFixed(2)}</text>`;
      }

      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}">3D Single-Step Jump Length Δr = ‖r(t+Δt) − r(t)‖ (μm)</text>`;
      out += `<text x="16" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${pal.ink}" transform="rotate(-90 16 ${(T + B) / 2})">3D Maxwell PDF p(Δr)</text>`;
      out += `<text x="590" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${pal.purple}" transform="rotate(-90 590 ${(T + B) / 2})">Cumulative CDF</text>`;

      out += `<rect x="${L + 115}" y="${T + 6}" width="290" height="54" rx="6" fill="rgba(255,255,255,0.92)" stroke="#d3e0d8"/>`;
      out += `<text x="${L + 125}" y="${T + 23}" font-size="11.2" font-weight="700" fill="${pal.primary}">2-State Spot-On Fit: f̂_bound = ${(100 * sp.fBoundHat).toFixed(1)}% (KS = ${sp.ks2State.toFixed(3)})</text>`;
      out += `<text x="${L + 125}" y="${T + 39}" font-size="11" fill="${pal.secondary}">Dashed: 1-State Maxwell PDF (KS = ${sp.ks1State.toFixed(3)})</text>`;
      out += `<text x="${L + 125}" y="${T + 53}" font-size="10.8" fill="${pal.muted}">Noise-corrected D̂_bound = ${sp.dBoundHat.toFixed(3)} · D̂_free = ${sp.dFreeHat.toFixed(2)} μm²/s</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Spot-On Bound vs. Free Molecules:</strong> Chromatin-bound transcription factors take tiny steps (left hump), while free proteins take longer 3D steps (right hump). Fitting two Maxwell curves measures the bound percentage without needing ultra-long tracks.`,
        `<strong>Hansen et al. (eLife 2018) 3D Maxwell Jump-Length Modeling:</strong> Single-species isotropic diffusion follows <code>p(r) ∝ r² exp(−r²/2s²)</code> (dashed). Our 2-state EM mixture (solid) recovers <strong>f̂_bound = ${(100 * sp.fBoundHat).toFixed(1)}%</strong> and lowers Kolmogorov–Smirnov CDF error from <code>${sp.ks1State.toFixed(3)}</code> to <code>${sp.ks2State.toFixed(3)}</code>.`,
        `<strong>Localization-Corrected Kinetic Fractions:</strong> Subtracting <code>2σ̂_loc²</code> yields <code>D̂_bound = ${sp.dBoundHat.toFixed(4)} μm²/s</code> and <code>D̂_free = ${sp.dFreeHat.toFixed(3)} μm²/s</code> (variance separation ratio <code>${sp.separation.toFixed(2)}×</code>; bound fraction collapses to 0% when separation &lt; 1.55× to prevent single-state overfitting).`
      );
    } else if (leftTab === 'stokes') {
      const L = 58, R = 576, T = 28, B = 272;
      const compId = get('compartment').value;
      const comp = Engine.COMPARTMENT_PRESETS.find(c => c.id === compId && c.viscosityMpas) ||
        Engine.COMPARTMENT_PRESETS.find(c => c.id === 'nucleoplasm');
      const eta = comp.viscosityMpas;
      const activeMolId = get('macromolecule').value;

      const rhVals = catalog.map(m => m.rhNm).filter(Number.isFinite);
      const rhMin = Math.min(1.45, Math.min(...rhVals) * 0.92);
      const rhMax = Math.max(4.65, Math.max(...rhVals) * 1.06);
      const dMax = Engine.stokesEinsteinD(rhMin, eta) * 1.12;
      const xOf = rh => L + ((rh - rhMin) / (rhMax - rhMin)) * (R - L);
      const yOf = d => B - (Math.min(dMax, Math.max(0, d)) / dMax) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (let g = 0; g <= 4; g++) {
        const dv = (dMax * g) / 4;
        const yy = yOf(dv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${pal.grid}"/>`;
        out += `<text x="${L - 7}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.8" fill="${pal.muted}">${dv.toFixed(2)}</text>`;
      }

      // Exact Stokes-Einstein hyperbola D = k_B T / (6 π η R_h)
      const curvePts = [];
      for (let s = 0; s <= 100; s++) {
        const rh = rhMin + ((rhMax - rhMin) * s) / 100;
        curvePts.push(`${xOf(rh).toFixed(1)},${yOf(Engine.stokesEinsteinD(rh, eta)).toFixed(1)}`);
      }
      out += `<polyline fill="none" stroke="${pal.primary}" stroke-width="2.4" points="${curvePts.join(' ')}"/>`;

      // Plot all 14 AlphaFold/PDB macromolecules with staggered non-overlapping labels on key landmarks
      const labeledIds = new Set(['1BNA', 'P00441', '1GFL', 'P00846', 'Q31BY4', '8AW3', 'P04637', activeMolId]);
      const labelOffsets = {
        '1BNA': [-8, -10],
        'P00441': [-32, 15],
        '1MBO': [8, -9],
        '1GFL': [8, -8],
        'P00846': [8, -8],
        'Q31BY4': [-36, 15],
        '8AW3': [-52, 15],
        'P04637': [7, -9],
      };

      for (const m of catalog) {
        const dVal = Engine.stokesEinsteinD(m.rhNm, eta);
        const cx = xOf(m.rhNm), cy = yOf(dVal);
        const isSel = m.id === activeMolId;
        if (isSel) {
          out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="none" stroke="${pal.gold}" stroke-width="2.4"/>`;
        }
        out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${isSel ? 5.2 : 4.0}" fill="${m.kind === 'RCSB PDB' ? pal.secondary : pal.tertiary}" stroke="#fff" stroke-width="1"/>`;
        if (labeledIds.has(m.id)) {
          const [dx, dy] = labelOffsets[m.id] || [7, -7];
          out += `<text x="${(cx + dx).toFixed(1)}" y="${(cy + dy).toFixed(1)}" font-size="10.6" font-weight="${isSel ? '700' : '600'}" fill="${pal.ink}">${esc(m.gene)}</text>`;
        }
      }

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      for (const rhTick of [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5]) {
        out += `<text x="${xOf(rhTick).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="11" fill="${pal.muted}">${rhTick.toFixed(1)}</text>`;
      }
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}">Hydrodynamic Radius R_h = 1.29 · R_g from 3D Structure (nm)</text>`;
      out += `<text x="16" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${pal.ink}" transform="rotate(-90 16 ${(T + B) / 2})">Stokes–Einstein D (μm²/s)</text>`;
      out += `<text x="${R - 10}" y="${T + 18}" text-anchor="end" font-size="11.5" font-weight="700" fill="${pal.primary}">Medium: ${esc(comp.short)} (η_eff = ${eta} cP, 37 °C)</text>`;
      out += `<text x="${R - 10}" y="${T + 35}" text-anchor="end" font-size="10.8" fill="${pal.muted}">Blue: 10 KEGG AlphaFold v6 · Orange: 4 RCSB PDB</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Size Controls Speed:</strong> Compact folded proteins like <code>SOD1</code> diffuse much faster than large multi-chain complexes (<code>8AW3</code>) or proteins with long disordered tails (<code>TP53</code>).`,
        `<strong>Structural Coupling Across Studio Labs:</strong> Every point computes <code>R_g</code> directly from the bundled 3D Cα/atom coordinates in <code>folds/*.js</code> and <code>experimental.js</code>, then evaluates <code>D = k_B T / (6π η_eff R_h)</code> at 310.15 K (${esc(comp.short)}, η = ${eta} mPa·s).`,
        `<strong>Disordered Tail Hydrodynamic Drag:</strong> Notice why 393-aa <code>TP53</code> (<code>R_h = 4.41 nm</code>) diffuses slower than 471-aa globular TIM-barrel <code>rbcL</code> (<code>R_h = 2.90 nm</code>): unstructured N/C-terminal transactivation domains expand 3D radius of gyration disproportionately to molecular weight.`
      );
    }
  }

  function renderRightChart() {
    if (!runData) return;
    const svg = get('right-graph');
    const explain = get('right-explain');
    const pal = palette();
    const W = 600, H = 320;

    if (rightTab === 'vacf') {
      const L1 = 52, R1 = 296, L2 = 348, R2 = 582, T = 30, B = 270;
      const vacf = runData.correlations.vacf;
      const ang = runData.correlations.angleHist;
      const yZero = (T + B) / 2;
      const yVacf = v => yZero - (Math.max(-0.58, Math.min(0.58, v)) / 0.58) * ((B - T) / 2);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      // Left panel: Normalized VACF C_v(k Δt) for lags 1..12
      out += `<line x1="${L1}" y1="${yZero.toFixed(1)}" x2="${R1}" y2="${yZero.toFixed(1)}" stroke="#64748b" stroke-width="1.2"/>`;
      for (const lv of [-0.5, -0.25, 0, 0.25, 0.5]) {
        const yy = yVacf(lv);
        out += `<line x1="${L1}" y1="${yy.toFixed(1)}" x2="${R1}" y2="${yy.toFixed(1)}" stroke="${pal.grid}"/>`;
        out += `<text x="${L1 - 5}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${pal.muted}">${lv.toFixed(2)}</text>`;
      }
      for (let lag = 1; lag <= 12; lag++) {
        const xx = L1 + ((lag - 0.5) / 12) * (R1 - L1);
        const val = vacf[lag];
        const yy = yVacf(val);
        const col = val < -0.04 ? pal.secondary : pal.primary;
        out += `<line x1="${xx.toFixed(1)}" y1="${yZero.toFixed(1)}" x2="${xx.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="${col}" stroke-width="2.6"/>`;
        out += `<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="3.8" fill="${col}"/>`;
        if (lag % 2 === 1 || lag === 12) {
          out += `<text x="${xx.toFixed(1)}" y="${B + 16}" text-anchor="middle" font-size="10" fill="${pal.muted}">${lag}</text>`;
        }
      }
      out += `<path d="M${L1} ${T}V${B}H${R1}" fill="none" stroke="#688277" stroke-width="1.2"/>`;
      out += `<text x="${(L1 + R1) / 2}" y="${T - 9}" text-anchor="middle" font-size="11.2" font-weight="700" fill="${pal.ink}">Step VACF C_v(k·Δt) · Lag-1 = ${vacf[1] >= 0 ? '+' : ''}${vacf[1].toFixed(3)}</text>`;
      out += `<text x="${(L1 + R1) / 2}" y="${H - 8}" text-anchor="middle" font-size="11.2" font-weight="600" fill="${pal.ink}">Lag index k (× 25 ms)</text>`;

      // Right panel: 3D Turning Angle P(θ) vs Isotropic (π/360) sin(θ)
      let aMax = 0.011;
      for (let b = 0; b < ang.length; b++) aMax = Math.max(aMax, ang[b] * 1.12);
      const xAng = deg => L2 + (deg / 180) * (R2 - L2);
      const yAng = p => B - (Math.min(aMax, p) / aMax) * (B - T);
      const bw = ((R2 - L2) / ang.length) * 0.82;

      for (let b = 0; b < ang.length; b++) {
        const deg = (b + 0.5) * (180 / ang.length);
        const cx = xAng(deg), top = yAng(ang[b]);
        out += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, B - top).toFixed(1)}" fill="${pal.tertiary}" fill-opacity="0.33" stroke="${pal.tertiary}" stroke-width="0.9"/>`;
      }
      const isoPts = [];
      for (let d = 0; d <= 180; d += 3) {
        const pIso = (Math.PI / 360) * Math.sin((d * Math.PI) / 180);
        isoPts.push(`${xAng(d).toFixed(1)},${yAng(pIso).toFixed(1)}`);
      }
      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.1" stroke-dasharray="5 3" points="${isoPts.join(' ')}"/>`;
      out += `<path d="M${L2} ${T}V${B}H${R2}" fill="none" stroke="#688277" stroke-width="1.2"/>`;
      for (const d of [0, 45, 90, 135, 180]) {
        out += `<text x="${xAng(d).toFixed(1)}" y="${B + 16}" text-anchor="middle" font-size="10.2" fill="${pal.muted}">${d}°</text>`;
      }
      out += `<text x="${(L2 + R2) / 2}" y="${T - 9}" text-anchor="middle" font-size="11.2" font-weight="700" fill="${pal.ink}">3D Turning Angle θ (Mean ${runData.correlations.meanAngleDeg.toFixed(1)}°)</text>`;
      out += `<text x="${(L2 + R2) / 2}" y="${H - 8}" text-anchor="middle" font-size="11.2" font-weight="600" fill="${pal.ink}">Successive 3D step angle θ (deg)</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Elastic Recoil vs. Forward Push:</strong> Negative bars on the left (and angles skewing past 90° toward 180° on the right) mean particles bounce backward—caused by viscoelastic crowding (<code>fBm</code>), harmonic tethering, or localization jitter.`,
        `<strong>Velocity Autocorrelation &amp; 3D Turning-Angle Geometry:</strong> Memoryless 3D Brownian walks have <code>C_v(kΔt) = 0</code> for all k ≥ 1 and follow the isotropic Jacobian curve <code>P(θ) = ½ sin θ</code> (mean 90.0°). Here <strong>C_v(Δt) = ${vacf[1] >= 0 ? '+' : ''}${vacf[1].toFixed(3)}</strong> and <strong>⟨θ⟩ = ${runData.correlations.meanAngleDeg.toFixed(1)}°</strong>.`,
        `<strong>Separating Viscoelastic fBm from Localization Noise:</strong> Static camera noise creates a sharp <em>single-lag</em> negative spike at k = 1 (<code>C_v(Δt) → −½</code>) with <code>C_v(2Δt) = 0</code>, whereas subdiffusive <code>fBm</code> exhibits algebraic power-law decay across k = 1, 2, 3… with <code>ρ₁ = 2^(α−1) − 1</code>.`
      );
    } else if (rightTab === 'cve') {
      const L1 = 54, R1 = 294, L2 = 348, R2 = 582, T = 30, B = 270;
      const cve = runData.cve;
      const trueD = runData.config.D;

      let yMax1 = Math.max(trueD * 1.45, cve.dNaive1 * 1.15, cve.dCve * 1.25);
      for (const pt of cve.apparentByLag) yMax1 = Math.max(yMax1, pt.dApp * 1.12);
      const x1Of = lag => L1 + ((lag - 1) / Math.max(1, cve.apparentByLag.length - 1)) * (R1 - L1);
      const y1Of = d => B - (Math.min(yMax1, Math.max(0, d)) / yMax1) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (let g = 0; g <= 4; g++) {
        const dv = (yMax1 * g) / 4;
        const yy = y1Of(dv);
        out += `<line x1="${L1}" y1="${yy.toFixed(1)}" x2="${R1}" y2="${yy.toFixed(1)}" stroke="${pal.grid}"/>`;
        out += `<text x="${L1 - 5}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${pal.muted}">${dv.toFixed(2)}</text>`;
      }

      // CVE ± CRLB band
      const yCveHi = y1Of(cve.dCve + cve.crlbStd);
      const yCveLo = y1Of(Math.max(0, cve.dCve - cve.crlbStd));
      out += `<rect x="${L1}" y="${yCveHi.toFixed(1)}" width="${R1 - L1}" height="${Math.max(2, yCveLo - yCveHi).toFixed(1)}" fill="${pal.primary}" fill-opacity="0.18"/>`;
      out += `<line x1="${L1}" y1="${y1Of(trueD).toFixed(1)}" x2="${R1}" y2="${y1Of(trueD).toFixed(1)}" stroke="#475569" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      out += `<line x1="${L1}" y1="${y1Of(cve.dCve).toFixed(1)}" x2="${R1}" y2="${y1Of(cve.dCve).toFixed(1)}" stroke="${pal.primary}" stroke-width="2.3"/>`;

      const appPts = cve.apparentByLag.map(p => `${x1Of(p.lag).toFixed(1)},${y1Of(p.dApp).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.2" points="${appPts}"/>`;
      for (const p of cve.apparentByLag) {
        out += `<circle cx="${x1Of(p.lag).toFixed(1)}" cy="${y1Of(p.dApp).toFixed(1)}" r="3.2" fill="${pal.secondary}"/>`;
      }
      out += `<path d="M${L1} ${T}V${B}H${R1}" fill="none" stroke="#688277" stroke-width="1.2"/>`;
      for (const lg of [1, 3, 6, 9, 12]) {
        if (lg <= cve.apparentByLag.length) {
          out += `<text x="${x1Of(lg).toFixed(1)}" y="${B + 16}" text-anchor="middle" font-size="10" fill="${pal.muted}">${lg}</text>`;
        }
      }
      out += `<text x="${(L1 + R1) / 2}" y="${T - 9}" text-anchor="middle" font-size="11" font-weight="700" fill="${pal.ink}">Apparent D_app(kΔt) vs. Unbiased CVE</text>`;
      out += `<text x="${(L1 + R1) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="${pal.ink}">MSD lag index k</text>`;

      // Right panel: Bias & CRLB across σ_loc = 0..80 nm
      const yMax2 = Math.max(trueD * 1.6, cve.noiseSweep.at(-1).dNaiveExpected * 1.08);
      const x2Of = nm => L2 + (nm / 80) * (R2 - L2);
      const y2Of = d => B - (Math.min(yMax2, Math.max(0, d)) / yMax2) * (B - T);

      // CRLB funnel around trueD
      const upFunnel = cve.noiseSweep.map(p => `${x2Of(p.sigmaNm).toFixed(1)},${y2Of(p.dTrue + p.crlbSd * 2).toFixed(1)}`);
      const dnFunnel = [...cve.noiseSweep].reverse().map(p => `${x2Of(p.sigmaNm).toFixed(1)},${y2Of(Math.max(0, p.dTrue - p.crlbSd * 2)).toFixed(1)}`);
      out += `<polygon points="${upFunnel.concat(dnFunnel).join(' ')}" fill="${pal.primary}" fill-opacity="0.20"/>`;
      out += `<line x1="${L2}" y1="${y2Of(trueD).toFixed(1)}" x2="${R2}" y2="${y2Of(trueD).toFixed(1)}" stroke="${pal.primary}" stroke-width="2.2"/>`;

      const biasPts = cve.noiseSweep.map(p => `${x2Of(p.sigmaNm).toFixed(1)},${y2Of(p.dNaiveExpected).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.3" stroke-dasharray="6 3" points="${biasPts}"/>`;

      const curNm = runData.config.sigmaLoc * 1000;
      out += `<line x1="${x2Of(curNm).toFixed(1)}" y1="${T}" x2="${x2Of(curNm).toFixed(1)}" y2="${B}" stroke="${pal.gold}" stroke-width="1.6" stroke-dasharray="3 3"/>`;
      out += `<circle cx="${x2Of(curNm).toFixed(1)}" cy="${y2Of(cve.dCve).toFixed(1)}" r="4.5" fill="${pal.primary}" stroke="#fff" stroke-width="1.2"/>`;
      out += `<circle cx="${x2Of(curNm).toFixed(1)}" cy="${y2Of(cve.dNaive1).toFixed(1)}" r="4.2" fill="${pal.secondary}" stroke="#fff" stroke-width="1.2"/>`;

      out += `<path d="M${L2} ${T}V${B}H${R2}" fill="none" stroke="#688277" stroke-width="1.2"/>`;
      for (const nm of [0, 20, 40, 60, 80]) {
        out += `<text x="${x2Of(nm).toFixed(1)}" y="${B + 16}" text-anchor="middle" font-size="10" fill="${pal.muted}">${nm}</text>`;
      }
      out += `<text x="${(L2 + R2) / 2}" y="${T - 9}" text-anchor="middle" font-size="11" font-weight="700" fill="${pal.ink}">Naive Bias vs. CVE ±2σ_CRLB</text>`;
      out += `<text x="${(L2 + R2) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="${pal.ink}">Localization noise σ_loc (nm)</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Removing Microscope Blur &amp; Jitter:</strong> Camera localization noise makes stationary or slow molecules look artificially fast at short steps (orange curve). The Covariance-Based Estimator (<code>CVE</code>, green) cancels both jitter and shutter blur automatically.`,
        `<strong>Michalet–Berglund (2012) &amp; Vestergaard (2014) Optimal Estimation:</strong> Naive 1-lag diffusivity gives <code>${cve.dNaive1.toFixed(3)} μm²/s</code> (biased by <code>+σ_loc²/Δt − 2DR</code>), whereas <strong>CVE recovers D̂ = ${cve.dCve.toFixed(3)} ± ${cve.crlbStd.toFixed(3)} μm²/s</strong> and simultaneously estimates <strong>σ̂_loc = ${Math.round(cve.sigmaLocHat * 1000)} nm</strong> (true: ${Math.round(runData.config.sigmaLoc * 1000)} nm).`,
        `<strong>Exact Cancellation Identity:</strong> Because <code>⟨Δx_n²⟩ = 2DΔt(1−2R) + 2σ²</code> and <code>⟨Δx_n Δx_{n+1}⟩ = 2DΔt R − σ²</code>, forming <code>D̂_CVE = ⟨Δx_n²⟩/(2Δt) + ⟨Δx_n Δx_{n+1}⟩/Δt</code> eliminates both <code>σ²</code> and shutter factor <code>R = ${runData.config.blurR.toFixed(3)}</code> identically, achieving near-CRLB efficiency.`
      );
    } else if (rightTab === 'frap') {
      const L = 58, R = 578, T = 28, B = 272;
      const frap = runData.frap;
      const tMax = runData.config.steps * runData.config.dt;
      const xOf = t => L + (t / tMax) * (R - L);
      const yOf = v => B - Math.max(0, Math.min(1.05, v)) * ((B - T) / 1.05);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (const fv of [0, 0.25, 0.5, 0.75, 1.0]) {
        const yy = yOf(fv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${pal.grid}"/>`;
        out += `<text x="${L - 7}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.8" fill="${pal.muted}">${(100 * fv).toFixed(0)}%</text>`;
      }

      // Mobile fraction plateau & τ_1/2 marker
      const yMf = yOf(frap.mobileFraction);
      out += `<line x1="${L}" y1="${yMf.toFixed(1)}" x2="${R}" y2="${yMf.toFixed(1)}" stroke="${pal.purple}" stroke-width="1.3" stroke-dasharray="4 4"/>`;
      const xHalf = xOf(frap.tauHalf);
      out += `<line x1="${xHalf.toFixed(1)}" y1="${yOf(0.5 * frap.mobileFraction).toFixed(1)}" x2="${xHalf.toFixed(1)}" y2="${B}" stroke="${pal.gold}" stroke-width="1.5" stroke-dasharray="3 3"/>`;

      const empPts = Array.from(frap.empirical, (v, f) => `${xOf(f * runData.config.dt).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
      const refPts = Array.from(frap.brownianRef, (v, f) => `${xOf(f * runData.config.dt).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.1" stroke-dasharray="6 4" points="${refPts}"/>`;
      out += `<polyline fill="none" stroke="${pal.primary}" stroke-width="2.7" points="${empPts}"/>`;

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      for (let ts = 0; ts <= 4; ts++) {
        out += `<text x="${xOf(ts).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="11" fill="${pal.muted}">${ts.toFixed(1)} s</text>`;
      }
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}">Post-bleach recovery time t (seconds · Gaussian ROI w₀ = ${frap.w0.toFixed(2)} μm)</text>`;
      out += `<text x="16" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${pal.ink}" transform="rotate(-90 16 ${(T + B) / 2})">Normalized FRAP Recovery F(t)</text>`;

      out += `<rect x="${R - 252}" y="${T + 8}" width="242" height="52" rx="6" fill="rgba(255,255,255,0.92)" stroke="#d3e0d8"/>`;
      out += `<text x="${R - 242}" y="${T + 25}" font-size="11.2" font-weight="700" fill="${pal.primary}">Mobile M_f = ${(100 * frap.mobileFraction).toFixed(1)}% · τ₁/₂ = ${frap.tauHalf.toFixed(2)} s</text>`;
      out += `<text x="${R - 242}" y="${T + 41}" font-size="10.8" fill="${pal.secondary}">Dashed: Free 3D Brownian (τ₁/₂ = ${frap.tauHalfTheory.toFixed(2)} s)</text>`;
      out += `<text x="${R - 242}" y="${T + 54}" font-size="10.5" fill="${pal.purple}">Immobile / Confined Pool = ${(100 * frap.immobileFraction).toFixed(1)}%</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Bridging Single Particles to Bulk FRAP:</strong> If you photobleach a <code>${frap.w0.toFixed(2)} μm</code> laser spot, fluorescence recovers as particles exchange out of the spot. Harmonic confinement or chromatin binding leaves a persistent immobile fraction!`,
        `<strong>Optical Reciprocity Virtual 3D FRAP:</strong> Evaluating the 3D Gaussian laser profile <code>F(t) = 1 − ⟨exp(−‖r(t)‖²/w₀²)⟩</code> against exact Brownian <code>1 − (1 + 4Dt/w₀²)^(−3/2)</code> yields <strong>Mobile Fraction M_f = ${(100 * frap.mobileFraction).toFixed(1)}%</strong> and half-recovery <strong>τ₁/₂ = ${frap.tauHalf.toFixed(2)} s</strong>.`,
        `<strong>Why Bulk FRAP Alone Confounds Mechanism:</strong> Compare <code>Spot-On</code> 2-state switching, <code>CTRW</code> traps, and <code>fBm</code> viscoelasticity—all three retard bulk FRAP recovery, whereas single-particle <code>TA-MSD</code>, <code>VACF</code>, and 3D jump distributions resolve the underlying microscopic law.`
      );
    } else if (rightTab === 'fpt') {
      const L = 58, R = 578, T = 28, B = 272;
      const fpt = runData.fpt;
      const tMax = runData.config.steps * runData.config.dt;
      const xOf = t => L + (t / tMax) * (R - L);
      const yOf = s => B - Math.max(0, Math.min(1.02, s)) * ((B - T) / 1.02);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (const sv of [0, 0.25, 0.5, 0.75, 1.0]) {
        const yy = yOf(sv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${pal.grid}"/>`;
        out += `<text x="${L - 7}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.8" fill="${pal.muted}">${(100 * sv).toFixed(0)}%</text>`;
      }

      const empPts = Array.from(fpt.survival, (v, f) => `${xOf(f * runData.config.dt).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
      const refPts = Array.from(fpt.brownianSurvival, (v, f) => `${xOf(f * runData.config.dt).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${pal.secondary}" stroke-width="2.1" stroke-dasharray="6 4" points="${refPts}"/>`;
      out += `<polyline fill="none" stroke="${pal.primary}" stroke-width="2.7" points="${empPts}"/>`;

      if (fpt.mfptTheory <= tMax) {
        const xm = xOf(fpt.mfptTheory);
        out += `<line x1="${xm.toFixed(1)}" y1="${T}" x2="${xm.toFixed(1)}" y2="${B}" stroke="${pal.gold}" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      }

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      for (let ts = 0; ts <= 4; ts++) {
        out += `<text x="${xOf(ts).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="11" fill="${pal.muted}">${ts.toFixed(1)} s</text>`;
      }
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${pal.ink}">Search time t to reach spherical boundary R = ${fpt.radius.toFixed(2)} μm (s)</text>`;
      out += `<text x="16" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${pal.ink}" transform="rotate(-90 16 ${(T + B) / 2})">First-Passage Survival S(t)</text>`;

      out += `<rect x="${R - 256}" y="${T + 8}" width="246" height="50" rx="6" fill="rgba(255,255,255,0.92)" stroke="#d3e0d8"/>`;
      out += `<text x="${R - 246}" y="${T + 25}" font-size="11.2" font-weight="700" fill="${pal.primary}">Target Reached: ${(100 * fpt.absorbedFraction).toFixed(1)}% within 4.0 s</text>`;
      out += `<text x="${R - 246}" y="${T + 41}" font-size="10.8" fill="${pal.secondary}">Brownian MFPT R²/(6D) = ${fpt.mfptTheory.toFixed(2)} s · RMST = ${fpt.rmst.toFixed(2)} s</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Nuclear / Cellular Target-Search Kinetics:</strong> Measures how quickly molecules released at the origin reach a boundary <code>R = ${fpt.radius.toFixed(2)} μm</code> away. Motor drift accelerates arrival; subdiffusive traps leave a long-lived unabsorbed tail.`,
        `<strong>3D Spherical First-Passage Survival S(t):</strong> Compares the empirical Kaplan–Meier survival curve against the 16-eigenmode radial Dirichlet PDE solution <code>S_Brownian(t) = 2 ∑ (−1)^(m+1) exp(−m²π²Dt/R²)</code> with exact mean first-passage time <strong>⟨τ⟩ = R²/(6D) = ${fpt.mfptTheory.toFixed(2)} s</strong>.`,
        `<strong>Subdiffusive Search Paradox:</strong> While <code>fBm</code> compact exploration thoroughly samples local neighborhoods, long-range target arrival across <code>R = ${fpt.radius.toFixed(2)} μm</code> is governed by survival tail kinetics (observed 4 s restricted mean survival <code>RMST = ${fpt.rmst.toFixed(2)} s</code>, absorbed <code>${(100 * fpt.absorbedFraction).toFixed(1)}%</code>).`
      );
    } else if (rightTab === 'inference') {
      const L = 178, R = 446, T = 30, B = 278;
      const ordered = [...runData.fits].sort((a, b) => a.aic - b.aic);
      const rowH = (B - T) / ordered.length;

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      out += `<text x="${W / 2}" y="18" text-anchor="middle" font-size="11.5" font-weight="700" fill="${pal.ink}">7-Model Out-of-Sample Akaike Weights &amp; ΔNLL (${runData.config.testCount} Held-Out Tracks)</text>`;

      ordered.forEach((m, i) => {
        const cy = T + (i + 0.5) * rowH;
        const barLen = Math.max(3, m.weight * (R - L));
        const isTop = i === 0;
        const col = isTop ? pal.primary : pal.sky;

        out += `<text x="${L - 8}" y="${(cy + 4).toFixed(1)}" text-anchor="end" font-size="11" font-weight="${isTop ? '700' : '500'}" fill="${pal.ink}">${esc(m.model)}</text>`;
        out += `<rect x="${L}" y="${(cy - 9).toFixed(1)}" width="${R - L}" height="18" rx="4" fill="#edf4f0"/>`;
        out += `<rect x="${L}" y="${(cy - 9).toFixed(1)}" width="${barLen.toFixed(1)}" height="18" rx="4" fill="${col}"/>`;
        const wTxt = `${(100 * m.weight).toFixed(1)}% · +${m.deltaLoss.toFixed(3)}`;
        out += `<text x="${R + 7}" y="${(cy + 4).toFixed(1)}" font-size="10.3" font-weight="${isTop ? '700' : '500'}" fill="${pal.muted}">${wTxt}</text>`;
      });

      out += `<text x="${W / 2}" y="${H - 8}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${pal.ink}">Out-of-sample Akaike weight w_m (%) &amp; ΔNLL (nats/coord)</text>`;
      svg.innerHTML = out;

      const top = ordered[0];
      const runnerUp = ordered[1];
      explain.innerHTML = audienceText(
        `<strong>Objective Blind Test:</strong> All 7 candidate laws learn on two-thirds of the molecules and predict the unseen remaining third. <strong>${esc(top.model)}</strong> wins with <strong>${(100 * top.weight).toFixed(1)}%</strong> evidence weight.`,
        `<strong>Out-of-Sample Conditional Likelihood &amp; Occam Parsimony:</strong> <strong>${esc(top.model)}</strong> (k = ${top.kParams} params) achieves held-out NLL <code>${top.loss.toFixed(5)} nats/coord</code> and leads runner-up <em>${esc(runnerUp.model)}</em> by <code>ΔAIC = +${runnerUp.deltaAic.toFixed(1)}</code>.`,
        `<strong>Nested SDE &amp; Mixture Identifiability:</strong> Raw test NLL between nested models (e.g., 1-param <em>Isotropic</em> vs. 2-param <em>Constant drift</em> under true v = 0) fluctuates by <code>O(1/N_train)</code>; penalizing <code>AIC = 2k + 2 N_test · NLL</code> enforces Occam consistency while preserving decisive power on viscoelastic <code>fBm</code> and 2-state <code>Spot-On</code> mixtures.`
      );
    }
  }

  function renderAll() {
    if (!runData) return;
    const frameIdx = Number(get('time').value);
    renderKpis(frameIdx);
    renderWorld(frameIdx);
    renderLeftChart(frameIdx);
    renderRightChart();
  }

  // =========================================================================
  // Playback, Pointer Orbit, Exports & Workspace Integration
  // =========================================================================
  function stopPlayback() {
    playing = false;
    cancelAnimationFrame(rafId);
    get('play').textContent = 'Play';
  }

  function tickPlayback(now) {
    if (!playing || !runData) return;
    if (now - lastTick >= 28) {
      lastTick = now;
      const tEl = get('time');
      const next = Number(tEl.value) + 1;
      tEl.value = String(next);
      renderKpis(next);
      renderWorld(next);
      if (leftTab === 'msd') renderLeftChart(next);
      if (next >= runData.config.steps) {
        stopPlayback();
        renderAll();
        return;
      }
    }
    rafId = requestAnimationFrame(tickPlayback);
  }

  function downloadBlob(content, mime, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSvg(svgId, tag) {
    const el = get(svgId);
    if (!el) return;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320">${el.innerHTML}</svg>`;
    downloadBlob(xml, 'image/svg+xml', `transport-${runData?.config.mode || 'spt'}-${tag}.svg`);
  }

  function bindEvents() {
    get('play').addEventListener('click', () => {
      if (playing) {
        stopPlayback();
        return;
      }
      if (Number(get('time').value) >= (runData?.config.steps || 160)) {
        get('time').value = '0';
      }
      playing = true;
      get('play').textContent = 'Pause';
      lastTick = 0;
      rafId = requestAnimationFrame(tickPlayback);
    });

    get('reset').addEventListener('click', () => {
      stopPlayback();
      get('time').value = '0';
      renderAll();
    });

    get('time').addEventListener('input', () => {
      stopPlayback();
      renderAll();
    });

    document.querySelectorAll('.tp-preset-chip').forEach(btn => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    });

    document.querySelectorAll('[data-audience]').forEach(btn => {
      btn.addEventListener('click', () => {
        audience = btn.dataset.audience;
        document.querySelectorAll('[data-audience]').forEach(b => {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        renderLeftChart(Number(get('time').value));
        renderRightChart();
      });
    });

    get('cb-toggle').addEventListener('click', () => {
      cbMode = !cbMode;
      document.body.classList.toggle('cb-mode', cbMode);
      get('cb-toggle').classList.toggle('active', cbMode);
      get('cb-toggle').setAttribute('aria-pressed', String(cbMode));
      renderAll();
    });

    document.querySelectorAll('[data-left-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        leftTab = btn.dataset.leftTab;
        syncTabs();
        renderLeftChart(Number(get('time').value));
      });
    });

    document.querySelectorAll('[data-right-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        rightTab = btn.dataset.rightTab;
        syncTabs();
        renderRightChart();
      });
    });

    document.querySelectorAll('[data-cam]').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.cam;
        if (view === 'iso') { yaw = 0.52; pitch = 0.30; }
        else if (view === 'xy') { yaw = 0.0; pitch = 0.0; }
        else if (view === 'xz') { yaw = 0.0; pitch = 1.52; }
        renderWorld(Number(get('time').value));
      });
    });

    for (const id of ['spread', 'show-tails', 'show-frap-roi', 'color-mode']) {
      get(id).addEventListener('change', () => renderWorld(Number(get('time').value)));
    }

    get('macromolecule').addEventListener('change', () => {
      if (get('macromolecule').value !== 'custom' && get('compartment').value === 'custom') {
        get('compartment').value = 'nucleoplasm';
      }
      syncStokesEinstein(true);
      syncControls();
      runSimulation();
    });

    get('compartment').addEventListener('change', () => {
      syncStokesEinstein(get('compartment').value !== 'custom');
      syncControls();
      runSimulation();
    });

    get('D').addEventListener('input', () => {
      get('compartment').value = 'custom';
      syncStokesEinstein(false);
      syncControls();
      get('message').textContent = 'Diffusivity updated — click Run 3D Transport Experiment to recompute ensemble.';
    });

    get('mode').addEventListener('change', () => {
      const spec = Engine.TRANSPORT_MODES.find(m => m.id === get('mode').value);
      if (spec && spec.hasParam) get('strength').value = String(spec.paramDefault);
      syncControls();
      runSimulation();
    });

    for (const id of ['strength', 'sigma-loc', 'blur-mode', 'tracer-count', 'seed']) {
      get(id).addEventListener('input', () => {
        syncControls();
        get('message').textContent = 'Parameters updated — click Run 3D Transport Experiment to apply.';
      });
      get(id).addEventListener('change', () => {
        syncControls();
      });
    }

    get('run').addEventListener('click', runSimulation);

    // 3D Orbit pointer & keyboard handlers
    const world = get('world');
    let drag = null;
    world.addEventListener('pointerdown', e => {
      world.setPointerCapture(e.pointerId);
      drag = [e.clientX, e.clientY];
    });
    world.addEventListener('pointermove', e => {
      if (!drag) return;
      yaw += (e.clientX - drag[0]) * 0.01;
      pitch = Math.max(-1.52, Math.min(1.52, pitch + (e.clientY - drag[1]) * 0.01));
      drag = [e.clientX, e.clientY];
      renderWorld(Number(get('time').value));
    });
    world.addEventListener('lostpointercapture', () => { drag = null; });
    world.addEventListener('keydown', e => {
      const step = {
        ArrowLeft: [-0.1, 0],
        ArrowRight: [0.1, 0],
        ArrowUp: [0, 0.1],
        ArrowDown: [0, -0.1],
      }[e.key];
      if (step) {
        e.preventDefault();
        yaw += step[0];
        pitch = Math.max(-1.52, Math.min(1.52, pitch + step[1]));
        renderWorld(Number(get('time').value));
      }
    });

    get('export-left-svg').addEventListener('click', () => exportSvg('graph', leftTab));
    get('export-right-svg').addEventListener('click', () => exportSvg('right-graph', rightTab));

    get('export').addEventListener('click', () => {
      if (!runData) return;
      const c = runData.config;
      const header = 'model,D_um2_s,param,sigma_loc_nm,blur_R,seed,time_s,obs_MSD_um2,expected_obs_MSD_um2,mean_x_um,mean_y_um,mean_z_um,true_MSD_um2,alpha2,bound_fraction\n';
      const body = runData.stats.map(r => [
        c.mode, c.D, c.k, Math.round(c.sigmaLoc * 1000), c.blurR.toFixed(4), c.seed,
        r[0].toFixed(3), r[1].toFixed(5), r[2].toFixed(5), r[3].toFixed(5), r[4].toFixed(5),
        r[5].toFixed(5), r[6].toFixed(5), r[8].toFixed(4), r[9].toFixed(4),
      ].join(',')).join('\n');
      downloadBlob(header + body, 'text/csv', `transport-${c.mode}-seed${c.seed}.csv`);
    });

    get('export-json').addEventListener('click', () => {
      if (!runData) return;
      const packet = {
        schema: 'assay-transport-spt/1',
        generatedAt: new Date().toISOString(),
        config: runData.config,
        macromolecule: get('macromolecule').value,
        compartment: get('compartment').value,
        anomalousScaling: {
          alphaEaHat: Number(runData.ta.alphaHat.toFixed(4)),
          alphaTaHat: Number(runData.ta.alphaTaHat.toFixed(4)),
          ebAt025s: Number(runData.ta.ebAt10.toFixed(4)),
          vanHoveAlpha2: Number(runData.vanHove.alpha2.toFixed(4)),
          vacfLag1: Number(runData.correlations.vacfLag1.toFixed(4)),
        },
        michaletBerglundCve: {
          dCve: Number(runData.cve.dCve.toFixed(5)),
          crlbStd: Number(runData.cve.crlbStd.toFixed(5)),
          dNaive1Lag: Number(runData.cve.dNaive1.toFixed(5)),
          sigmaLocHatNm: Number((runData.cve.sigmaLocHat * 1000).toFixed(2)),
        },
        spotOnMixture: {
          fBoundHat: Number(runData.spotOn.fBoundHat.toFixed(4)),
          dBoundHat: Number(runData.spotOn.dBoundHat.toFixed(5)),
          dFreeHat: Number(runData.spotOn.dFreeHat.toFixed(5)),
        },
        virtualFrap: {
          mobileFraction: Number(runData.frap.mobileFraction.toFixed(4)),
          tauHalfS: Number(runData.frap.tauHalf.toFixed(3)),
        },
        leaderboard: runData.fits.map(f => ({
          model: f.model,
          heldOutNll: Number(f.loss.toFixed(6)),
          deltaAic: Number(f.deltaAic.toFixed(2)),
          akaikeWeight: Number(f.weight.toFixed(4)),
          diffusivity: f.diffusivity.map(v => Number(v.toFixed(4))),
          paramNote: f.paramNote,
        })),
      };
      downloadBlob(JSON.stringify(packet, null, 2), 'application/json', `transport-spt-${runData.config.mode}.json`);
    });

    get('save-evidence').addEventListener('click', () => {
      if (!runData || typeof evidenceRecords === 'undefined') return;
      const c = runData.config;
      const bestNll = runData.fits[0];
      const aicTop = [...runData.fits].sort((a, b) => a.aic - b.aic)[0];
      const finalRow = runData.stats.at(-1);
      try {
        evidenceRecords.capture({
          kind: 'simulated',
          title: `${c.modeShort} · D=${c.D.toFixed(2)} · σ=${Math.round(c.sigmaLoc * 1000)}nm · seed ${c.seed}`,
          dataset: `3D SPT & Anomalous Transport (${c.count} tracers, 4.0 s)`,
          method: `${c.trainCount}-train / ${c.testCount}-test 7-model NLL & Michalet–Berglund CVE`,
          metric: 'Best held-out NLL',
          unit: 'nats/coord',
          value: Number(bestNll.loss.toFixed(5)),
          source: 'studio/transport.html',
          details: {
            comparisonKey: `transport-${c.mode}-D${c.D.toFixed(2)}`,
            transportMode: c.mode,
            macromolecule: get('macromolecule').value,
            compartment: get('compartment').value,
            diffusivityUm2PerS: c.D,
            strengthParameter: c.k,
            localizationNoiseNm: Math.round(c.sigmaLoc * 1000),
            motionBlurR: Number(c.blurR.toFixed(4)),
            seed: c.seed,
            topNllModel: bestNll.model,
            topAicModel: aicTop.model,
            topAkaikeWeight: Number(aicTop.weight.toFixed(4)),
            alphaEaHat: Number(runData.ta.alphaHat.toFixed(3)),
            ergodicityBreakingEb: Number(runData.ta.ebAt10.toFixed(3)),
            cveUnbiasedD: Number(runData.cve.dCve.toFixed(4)),
            spotOnBoundFraction: Number(runData.spotOn.fBoundHat.toFixed(3)),
            finalMeasuredMsdUm2: Number(finalRow[1].toFixed(3)),
            finalTheoryMsdUm2: Number(finalRow[2].toFixed(3)),
          },
        });
        get('save-status').textContent =
          `Saved 3D SPT evidence record (AIC winner: ${aicTop.model}, CVE D̂ = ${runData.cve.dCve.toFixed(3)} μm²/s) to Evidence Workspace.`;
      } catch (err) {
        get('save-status').textContent = `Could not save transport run: ${err.message}`;
      }
    });
  }

  populateSelects();
  bindEvents();
  applyPreset(activePreset);
})();
