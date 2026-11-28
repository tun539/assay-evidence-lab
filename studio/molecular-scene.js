'use strict';

/**
 * Synchronized Dual WebGL2 3D Enzyme Active-Site Docking & Turnover Scene
 * Uses real AlphaFold DB v6 Rossmann-fold enzyme coordinates (TDH3 / P00359)
 * with dynamic substrate docking into the Cys150–His177 catalytic cleft,
 * transition-state H-bond formation, and product release scaled by Michaelis–Menten velocity.
 */
const molecularScene = (() => {
  const get = id => document.getElementById(id);
  const canvases = [get('scene-selected'), get('scene-fixed')];
  const slider = get('scene-time');
  const toggle = get('play-scene');
  const modelSel = get('rate-model');
  const repSel = get('ml-rep');
  const colSel = get('ml-col');
  const themeBtn = get('ml-theme');

  if (modelSel) {
    modelSel.append(...Object.keys(molecularData.metrics).map(name => new Option(name, name)));
  }

  const previewParams = [180, 0.10];
  let assay = null;
  let frame = 0;
  let playing = false;
  let previous = 0;
  let currentRep = 'cartoon';
  let currentCol = 'plddt';
  let currentTheme = 'dark';
  let lastPhases = [0, 0];
  let onPhaseChangeCb = null;

  // Base folded enzyme coordinates from bundledFolds['P00359'] (TDH3 GAPDH, 332 res)
  const rawFold = typeof bundledFolds !== 'undefined' && bundledFolds['P00359'];
  const baseRows = rawFold
    ? rawFold.rows
    : Array.from({ length: 60 }, (_, i) => [
        'ALA', i + 1,
        14 * Math.cos(i * 0.45), 10 * Math.sin(i * 0.3), (i - 30) * 0.85, 92,
      ]);

  // Catalytic pocket center near Cys150 (idx 149) & His177 (idx 176) in P00359
  const cysPos = baseRows[149] ? [baseRows[149][2], baseRows[149][3], baseRows[149][4]] : [-7.2, 2.2, -1.5];
  const hisPos = baseRows[176] ? [baseRows[176][2], baseRows[176][3], baseRows[176][4]] : [-16.1, 5.9, -4.3];
  const pocketCenter = [
    (cysPos[0] + hisPos[0]) * 0.5,
    (cysPos[1] + hisPos[1]) * 0.5,
    (cysPos[2] + hisPos[2]) * 0.5,
  ];

  // Solvent entry vector & product exit vector
  const approachStart = [pocketCenter[0] - 13.5, pocketCenter[1] + 9.5, pocketCenter[2] + 13.0];
  const exitEnd = [pocketCenter[0] - 11.0, pocketCenter[1] - 12.0, pocketCenter[2] + 14.5];

  function lerp3(a, b, t) {
    return [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ];
  }

  function buildEnzymeSpec(phase) {
    const product = phase >= 0.63;
    const docked = phase >= 0.36 && phase < 0.63;
    let center;
    if (phase < 0.36) {
      const f = phase / 0.36;
      const ease = 1 - Math.pow(1 - f, 2);
      center = lerp3(approachStart, pocketCenter, ease);
    } else if (docked) {
      const vib = Math.sin((phase - 0.36) * 48) * 0.35;
      center = [pocketCenter[0] + vib, pocketCenter[1] + vib * 0.5, pocketCenter[2]];
    } else {
      const f = (phase - 0.63) / 0.37;
      center = lerp3(pocketCenter, exitEnd, f * f);
    }

    // Build 5-atom ligand cluster (Substrate = golden/phospho-hexose analog; Product = violet/acyl-product)
    const ligName = product ? 'PRD' : 'SUB';
    const ligElemCore = product ? 'N' : 'P';
    const ligElemOuter = product ? 'MG' : 'S';
    const ligAtoms = [
      [ligName, 'L', 501, 'P1', ligElemCore, center[0], center[1], center[2]],
      [ligName, 'L', 501, 'C1', 'C', center[0] + 1.4, center[1] + 0.4, center[2] - 0.3],
      [ligName, 'L', 501, 'O1', 'O', center[0] - 1.3, center[1] + 0.9, center[2] + 0.5],
      [ligName, 'L', 501, 'C2', 'C', center[0] + 0.4, center[1] - 1.3, center[2] + 0.7],
      [ligName, 'L', 501, 'X1', ligElemOuter, center[0] - 0.5, center[1] - 0.2, center[2] - 1.4],
    ];

    return {
      id: 'P00359-CATALYSIS',
      name: 'GAPDH / Rossmann Enzyme Catalysis (P00359)',
      hasPlddt: true,
      chains: [{ id: 'A', type: 'protein', label: 'Enzyme Chain A (P00359)', rows: baseRows }],
      ligands: ligAtoms,
    };
  }

  const viewers = canvases.map((cvs, idx) => {
    if (typeof Mol3D === 'undefined' || !cvs) return null;
    const v = Mol3D.createViewer(cvs, {
      theme: currentTheme,
      rep: currentRep,
      colorMode: currentCol,
      showLabels: true,
      showAxes: true,
      showPocket: true,
      showLigands: true,
    });
    // Sync camera rotation between both 3D canvases when dragging or scrolling
    const origMove = cvs.onpointermove;
    cvs.onpointermove = e => {
      if (origMove) origMove(e);
      if (v.state.drag) {
        const other = viewers[1 - idx];
        if (other) {
          other.state.yaw = v.state.yaw;
          other.state.pitch = v.state.pitch;
          other.state.panX = v.state.panX;
          other.state.panY = v.state.panY;
          other.render();
        }
      }
    };
    return v;
  });

  function render() {
    const { example, dose, fixed } = assay || {
      example: null,
      dose: molecularData.actions[Number(get('dose').value)],
      fixed: molecularData.fixedDose,
    };
    const truth = example?.params || previewParams;
    const [vmax, km] = modelSel && modelSel.value ? example.estimates[modelSel.value] : truth;

    [dose, fixed].forEach((index, i) => {
      const concentration = molecularData.doses[index];
      const rate = vmax * concentration / (km + concentration);
      const reference = truth[0] * concentration / (truth[1] + concentration);
      const suffix = i ? 'fixed' : 'selected';
      const lblEl = get('label-' + suffix);
      if (lblEl) {
        lblEl.textContent = concentration + ' ppm · ' + rate.toFixed(1) + ' counts/min/min'
          + (modelSel && modelSel.value ? ' · error ' + (rate - reference).toFixed(1) + ' vs truth' : '');
      }

      const phase = (Number(slider.value) * Math.max(0, rate) / 120) % 1;
      lastPhases[i] = phase;
      const cycles = Math.floor(Number(slider.value) * Math.max(0, rate) / 120);
      const phaseEl = get('phase-' + suffix);
      if (phaseEl) {
        const stage = phase < 0.36 ? 'Substrate approaching pocket' : phase < 0.63 ? 'Bound in Cys150–His177 active site' : 'Product release';
        phaseEl.textContent = `${stage} · ${cycles} completed cycles`;
      }

      const v = viewers[i];
      if (v) {
        const norm = Mol3D.normalize(buildEnzymeSpec(phase));
        v.setRepresentation(currentRep);
        v.setColorMode(currentCol);
        v.setTheme(currentTheme);
        // Highlight catalytic Cys150 (149) and His177 (176) in active-site pocket
        v.setModel(norm, { a: Math.min(149, norm.residues.length - 1), b: Math.min(176, norm.residues.length - 1), keepCamera: Boolean(v.state.model) });
      }
    });

    if (get('time-readout')) get('time-readout').textContent = Number(slider.value).toFixed(1) + ' / 8 s';
    if (get('model-detail')) {
      get('model-detail').textContent = (modelSel?.value || (example ? 'Generating model' : 'Illustrative preview'))
        + ' · Vmax ' + vmax.toFixed(1) + ' counts/min/min · Km ' + km.toFixed(3) + ' ppm';
    }
    if (onPhaseChangeCb) onPhaseChangeCb(lastPhases[0]);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(frame);
    if (toggle) toggle.textContent = 'Play simulation';
  }

  function animate(now) {
    const delta = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    const time = Number(slider.value) + delta;
    slider.value = Math.min(8, time).toFixed(3);
    if (get('auto-orbit')?.checked) {
      viewers.forEach(v => { if (v) v.state.yaw += delta * 0.45; });
    }
    render();
    if (time >= 8) pause();
    else frame = requestAnimationFrame(animate);
  }

  if (toggle) {
    toggle.onclick = () => {
      if (playing) { pause(); return; }
      if (Number(slider.value) >= 8) slider.value = 0;
      playing = true;
      toggle.textContent = 'Pause simulation';
      previous = performance.now();
      frame = requestAnimationFrame(animate);
    };
  }
  if (slider) slider.oninput = () => { pause(); render(); };
  if (modelSel) modelSel.onchange = render;
  if (repSel) repSel.onchange = () => { currentRep = repSel.value; render(); };
  if (colSel) colSel.onchange = () => { currentCol = colSel.value; render(); };
  if (themeBtn) {
    themeBtn.onclick = () => {
      currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
      themeBtn.setAttribute('aria-pressed', String(currentTheme === 'dark'));
      themeBtn.textContent = currentTheme === 'dark' ? 'Dark stage' : 'Light stage';
      render();
    };
  }
  if (get('reset-camera')) {
    get('reset-camera').onclick = () => viewers.forEach(v => { if (v) v.resetCamera(); });
  }
  if (get('ml-png')) {
    get('ml-png').onclick = () => {
      if (!viewers[0]) return;
      const a = document.createElement('a');
      a.href = viewers[0].toDataURL();
      a.download = 'molecular-enzyme-3d.png';
      a.click();
    };
  }

  return {
    render,
    setColorMode(mode) {
      currentCol = mode;
      if (colSel && Array.from(colSel.options).some(o => o.value === mode)) colSel.value = mode;
      render();
    },
    onPhaseChange(fn) { onPhaseChangeCb = fn; },
    getPhase() { return lastPhases[0]; },
    load(data) {
      pause();
      assay = data;
      slider.value = 0;
      if (modelSel) {
        modelSel.value = '';
        modelSel.disabled = !data;
      }
      if (get('scene-mode')) {
        get('scene-mode').textContent = data
          ? 'Held-out assay revealed. Switch estimators to compare predicted active-site turnover.'
          : 'Preview uses illustrative parameters on P00359. Reveal the second rate to compare trained estimators.';
      }
      render();
    },
  };
})();
