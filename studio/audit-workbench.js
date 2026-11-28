'use strict';

/**
 * Assay Evidence Studio — Cellpose Instance Segmentation & AlphaFold Structural Confidence Audit Workbench UI
 */
(function initAuditWorkbench() {
  const get = id => document.getElementById(id);
  const Engine = globalThis.AuditEngine;
  if (!Engine) return;

  const PRESETS = {
    flagship_tp53: {
      scenario: 'touching_clusters',
      method: 'unet_semantic',
      iouTh: 0.50,
      shiftPx: 0,
      morphRad: 0,
      structure: 'P04637',
      residuePos: 32,
      logitTemp: 1.00,
      leftTab: 'ap_curve',
      rightTab: 'plddt_chain',
    },
    myoblast_8aw3: {
      scenario: 'elongated_myoblasts',
      method: 'watershed_otsu',
      iouTh: 0.50,
      shiftPx: 0,
      morphRad: 0,
      structure: '8AW3',
      residuePos: 120,
      logitTemp: 1.00,
      leftTab: 'taxonomy',
      rightTab: 'pae_slice',
    },
    confluent_sod1: {
      scenario: 'confluent_epithelium',
      method: 'cellpose_cyto3',
      iouTh: 0.75,
      shiftPx: 0,
      morphRad: 0,
      structure: 'P00441',
      residuePos: 65,
      logitTemp: 1.00,
      leftTab: 'iou_matrix',
      rightTab: 'proteome',
    },
    low_snr_rbcl: {
      scenario: 'low_snr_debris',
      method: 'undertuned_flow',
      iouTh: 0.50,
      shiftPx: 0,
      morphRad: 0,
      structure: 'Q31BY4',
      residuePos: 185,
      logitTemp: 0.75,
      leftTab: 'area_iou',
      rightTab: 'calibration',
    },
    classroom_upstream: {
      scenario: 'classroom_demo',
      method: 'cellpose_cyto3',
      iouTh: 0.75,
      shiftPx: 0,
      morphRad: 0,
      structure: 'classroom_4res',
      residuePos: 1,
      logitTemp: 1.00,
      leftTab: 'shift_cliff',
      rightTab: 'logit_dist',
    },
  };

  let structCatalog = [];
  let scenarioData = null;
  let allMethodEvals = {};
  let activeSegEval = null;
  let activeStruct = null;
  let activeCal = null;
  let selectedCellTrueId = null;

  let audience = 'student';
  let cbMode = false;
  let leftTab = 'ap_curve';
  let rightTab = 'plddt_chain';

  function pal() {
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

  function afBandColors() {
    if (cbMode) {
      return ['#0072b2', '#56b4e9', '#f0e442', '#d55e00']; // >=90, 70..90, 50..70, <50
    }
    return ['#0053D6', '#65CBF3', '#FFDB13', '#FF7D45'];
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function audienceText(exp, stu, res) {
    if (audience === 'explorer') return exp;
    if (audience === 'researcher') return res;
    return stu;
  }

  function populateSelectors() {
    const scenSel = get('scenario');
    scenSel.replaceChildren();
    for (const s of Engine.SEGMENTATION_SCENARIOS) {
      scenSel.add(new Option(s.label, s.id));
    }

    const methSel = get('seg-method');
    methSel.replaceChildren();
    for (const m of Engine.SEGMENTATION_METHODS) {
      methSel.add(new Option(m.label, m.id));
    }

    structCatalog = Engine.getStructureConfidenceCatalog();
    const stSel = get('structure-select');
    stSel.replaceChildren();
    for (const st of structCatalog) {
      stSel.add(new Option(st.title, st.id));
    }
  }

  function syncOutputs() {
    get('iou-th-val').textContent = Number(get('iou-th').value).toFixed(2);
    const sp = Number(get('shift-px').value);
    get('shift-px-val').textContent = `${sp > 0 ? '+' : ''}${sp} px`;
    const mr = Number(get('morph-rad').value);
    get('morph-rad-val').textContent = mr === 0 ? '0 px' : mr > 0 ? `+${mr} dilate` : `${mr} erode`;

    const rIdx = Number(get('residue-pos').value);
    const lbl = activeStruct?.residueLabels?.[rIdx - 1] || `#${rIdx}`;
    get('residue-pos-val').textContent = `${rIdx} (${lbl})`;
    get('logit-temp-val').textContent = Number(get('logit-temp').value).toFixed(2);
  }

  function recomputeAll(rebuildScenario = false) {
    const scenId = get('scenario').value;
    if (rebuildScenario || !scenarioData || scenarioData.id !== scenId) {
      scenarioData = Engine.buildMicroscopyScenario(scenId);
      selectedCellTrueId = null;
    }

    const iouTh = Number(get('iou-th').value);
    const shiftPx = Number(get('shift-px').value);
    const morphRad = Number(get('morph-rad').value);
    const activeMethId = get('seg-method').value;

    allMethodEvals = {};
    for (const m of Engine.SEGMENTATION_METHODS) {
      const basePred = scenarioData.predictions[m.id];
      const pred = (m.id === activeMethId && (shiftPx !== 0 || morphRad !== 0))
        ? Engine.perturbMask(basePred, scenarioData.width, scenarioData.height, shiftPx, morphRad)
        : basePred;
      allMethodEvals[m.id] = Engine.evaluateMaskPair(
        scenarioData.truth,
        pred,
        scenarioData.width,
        scenarioData.height,
        iouTh
      );
    }
    activeSegEval = allMethodEvals[activeMethId];

    // Structure confidence & calibration evaluation
    const stId = get('structure-select').value;
    activeStruct = structCatalog.find(s => s.id === stId) || structCatalog[0];
    const posEl = get('residue-pos');
    posEl.max = String(activeStruct.residues);
    if (Number(posEl.value) > activeStruct.residues) posEl.value = '1';
    get('af-3d-link').href = activeStruct.structureHref;

    const T = Number(get('logit-temp').value);
    activeCal = Engine.computeCalibrationAudit(activeStruct.logits, activeStruct.trueLddt, T);

    syncOutputs();
    renderKpis();
    renderMaskCanvas();
    renderPaeCanvas();
    renderLeftChart();
    renderRightChart();
    renderLeaderboard();
  }

  function renderKpis() {
    const act = activeSegEval.active;
    const apStr = act.score === null ? 'Undefined' : act.score.toFixed(3);
    get('kpi-ap').textContent = `${apStr} (τ=${act.threshold.toFixed(2)})`;
    get('kpi-ap-sub').textContent = `TP ${act.tp} · FP ${act.fp} · FN ${act.fn} (${activeSegEval.reference_objects} ref)`;

    get('kpi-map').textContent = `mAP ${activeSegEval.mAP50_95.toFixed(3)}`;
    get('kpi-map-sub').textContent = `F1 ${act.f1.toFixed(3)} · 1-px BF1 ${activeSegEval.boundaryF1.toFixed(3)}`;

    const tax = activeSegEval.taxonomy;
    get('kpi-pq').textContent = `PQ ${act.pq.toFixed(3)}`;
    get('kpi-pq-sub').textContent = `SQ ${act.sq.toFixed(2)} × RQ ${act.rq.toFixed(2)} · ${tax.merges}M / ${tax.splits}S`;

    const conf = activeCal.conf;
    const idrPct = (100 * conf.bandShares[0]).toFixed(0);
    get('kpi-plddt').textContent = `${conf.mean.toFixed(1)} pLDDT`;
    get('kpi-plddt-sub').textContent = `Median ${conf.median.toFixed(1)} · <50 IDR ${idrPct}% (${activeStruct.gene})`;

    const ptm = activeStruct.paeInfo.ptm;
    const iptm = activeStruct.paeInfo.iptm;
    get('kpi-ptm').textContent = ptm !== null ? `pTM ${ptm.toFixed(2)}${iptm ? ` · ipTM ${iptm.toFixed(2)}` : ''}` : '—';
    get('kpi-ptm-sub').textContent = `${activeStruct.paeInfo.domains.length} rigid block(s) · ⟨PAE⟩ ${(activeStruct.paeInfo.meanPae || 0).toFixed(1)} Å`;

    const rIdx = Math.max(0, Number(get('residue-pos').value) - 1);
    const rScore = conf.scores[rIdx];
    const rStd = conf.stdDevs[rIdx];
    get('kpi-ece').textContent = `ECE ${activeCal.ecePts.toFixed(2)} pts`;
    get('kpi-ece-sub').textContent = `Res #${rIdx + 1}: ${rScore.toFixed(1)} ± ${rStd.toFixed(1)} (Ĥ=${conf.normEntropies[rIdx].toFixed(2)})`;
  }

  // =========================================================================
  // Track A Visual Canvas: 2D Microscopy Instance Matching & Contours
  // =========================================================================
  function computeCentroids(map, count, w, h) {
    const sx = new Float64Array(count + 1);
    const sy = new Float64Array(count + 1);
    const sc = new Int32Array(count + 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const id = map[y * w + x];
        if (id > 0) { sx[id] += x + 0.5; sy[id] += y + 0.5; sc[id]++; }
      }
    }
    const out = [];
    for (let k = 1; k <= count; k++) {
      out.push(sc[k] > 0 ? [sx[k] / sc[k], sy[k] / sc[k]] : [0, 0]);
    }
    return out;
  }

  function hslInstanceColor(id, sat = 70, light = 52) {
    const hue = (id * 137.508) % 360;
    const c = ((1 - Math.abs((2 * light) / 100 - 1)) * sat) / 100;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = light / 100 - c / 2;
    let r = 0, g = 0, b = 0;
    if (hue < 60) { r = c; g = x; }
    else if (hue < 120) { r = x; g = c; }
    else if (hue < 180) { g = c; b = x; }
    else if (hue < 240) { g = x; b = c; }
    else if (hue < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function renderMaskCanvas() {
    const canvas = get('mask-canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const CW = 560, CH = 350;
    if (canvas.width !== Math.round(CW * dpr) || canvas.height !== Math.round(CH * dpr)) {
      canvas.width = Math.round(CW * dpr);
      canvas.height = Math.round(CH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#06161d';
    ctx.fillRect(0, 0, CW, CH);

    const gw = activeSegEval.width;
    const gh = activeSegEval.height;
    const padX = 16, padY = 14;
    const availW = 368, availH = CH - 2 * padY;
    const scale = Math.min(availW / gw, availH / gh);
    const drawW = gw * scale, drawH = gh * scale;
    const ox = padX + (availW - drawW) / 2;
    const oy = padY + (availH - drawH) / 2;

    canvas._geom = { ox, oy, scale, gw, gh };

    const viewMode = get('mask-view-mode').value;
    const tMap = activeSegEval.truthMap;
    const pMap = activeSegEval.predMap;
    const intensity = scenarioData.intensity;
    const act = activeSegEval.active;
    const tax = activeSegEval.taxonomy;

    // Offscreen pixel buffer scaled crisply
    const off = document.createElement('canvas');
    off.width = gw;
    off.height = gh;
    const octx = off.getContext('2d');
    const img = octx.createImageData(gw, gh);
    const buf = img.data;

    for (let i = 0; i < gw * gh; i++) {
      const base = Math.round((intensity ? intensity[i] : 0.12) * 85);
      let r = Math.round(base * 0.45);
      let g = Math.round(base * 0.78);
      let b = Math.round(base * 0.95);

      const tid = tMap[i];
      const pid = pMap[i];

      if (viewMode === 'truth' && tid > 0) {
        const [cr, cg, cb] = hslInstanceColor(tid, 74, 54);
        r = cr; g = cg; b = cb;
      } else if (viewMode === 'pred' && pid > 0) {
        const [cr, cg, cb] = hslInstanceColor(pid + 5, 74, 54);
        r = cr; g = cg; b = cb;
      } else if (viewMode === 'taxonomy') {
        if (pid > 0 && tax.predMergeSet.has(pid)) {
          r = cbMode ? 204 : 168; g = cbMode ? 121 : 85; b = cbMode ? 167 : 247; // Purple Merge
        } else if (tid > 0 && tax.trueSplitSet.has(tid) && pid > 0) {
          r = 245; g = 158; b = 11; // Amber Split
        } else if (pid > 0 && act.matchedPredSet.has(pid)) {
          r = cbMode ? 0 : 16; g = cbMode ? 114 : 185; b = cbMode ? 178 : 129; // Matched
        } else if (tid > 0 && pid === 0) {
          r = cbMode ? 213 : 244; g = cbMode ? 94 : 63; b = cbMode ? 0 : 94; // Missed FN
        } else if (pid > 0) {
          r = 234; g = 179; b = 8; // Extra / boundary FP
        }
      } else {
        // Default 'audit': TP vs FP vs FN overlay
        if (pid > 0 && act.matchedPredSet.has(pid) && tid > 0 && act.matchedTrueSet.has(tid)) {
          r = cbMode ? 0 : 20; g = cbMode ? 114 : 184; b = cbMode ? 178 : 136; // Matched TP
        } else if (pid > 0 && !act.matchedPredSet.has(pid)) {
          r = cbMode ? 230 : 245; g = cbMode ? 159 : 158; b = cbMode ? 0 : 11; // Unmatched Pred (FP)
        } else if (tid > 0 && !act.matchedTrueSet.has(tid)) {
          r = cbMode ? 213 : 244; g = cbMode ? 94 : 63; b = cbMode ? 0 : 94; // Missed GT (FN)
        } else if (pid > 0 || tid > 0) {
          r = 56; g = 138; b = 152; // Rim difference on matched pair
        }
      }

      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = 255;
    }
    octx.putImageData(img, 0, 0);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, ox, oy, drawW, drawH);
    ctx.restore();

    // Draw crisp Ground-Truth boundary contours (thin white/cream) & selected cell highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const idx = y * gw + x;
        const lbl = tMap[idx];
        if (!lbl) continue;
        const isEdge = (x > 0 && tMap[idx - 1] !== lbl) || (x < gw - 1 && tMap[idx + 1] !== lbl) ||
                       (y > 0 && tMap[idx - gw] !== lbl) || (y < gh - 1 && tMap[idx + gw] !== lbl);
        if (isEdge) {
          if (lbl === selectedCellTrueId) {
            ctx.fillStyle = '#fde047';
            ctx.fillRect(ox + x * scale - 0.5, oy + y * scale - 0.5, Math.max(1.8, scale * 0.55), Math.max(1.8, scale * 0.55));
            ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
          } else {
            ctx.fillRect(ox + x * scale, oy + y * scale, Math.max(1.1, scale * 0.28), Math.max(1.1, scale * 0.28));
          }
        }
      }
    }

    // Draw Hungarian bipartite assignment vectors between matched centroids
    const cTrue = computeCentroids(tMap, activeSegEval.reference_objects, gw, gh);
    const cPred = computeCentroids(pMap, activeSegEval.predicted_objects, gw, gh);
    if (viewMode === 'audit') {
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.4;
      for (const pair of act.matchedPairs) {
        const [tx, ty] = cTrue[pair.trueId - 1];
        const [px, py] = cPred[pair.predId - 1];
        ctx.beginPath();
        ctx.moveTo(ox + tx * scale, oy + ty * scale);
        ctx.lineTo(ox + px * scale, oy + py * scale);
        ctx.stroke();
        ctx.fillStyle = '#fef08a';
        ctx.beginPath();
        ctx.arc(ox + tx * scale, oy + ty * scale, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Right-hand HUD Legend Panel inside the 560×350 canvas (x: 396..548)
    const lx = 396, lw = 152;
    ctx.fillStyle = 'rgba(11, 34, 43, 0.94)';
    ctx.fillRect(lx, 14, lw, CH - 28);
    ctx.strokeStyle = '#255362';
    ctx.strokeRect(lx, 14, lw, CH - 28);

    ctx.fillStyle = '#e5f7f1';
    ctx.font = '700 11.5px Inter, system-ui, sans-serif';
    ctx.fillText('Instance Audit Key', lx + 10, 34);

    const legendItems = viewMode === 'taxonomy'
      ? [
          [cbMode ? '#0072b2' : '#10b981', `Clean/Shift TP (${act.tp})`],
          [cbMode ? '#cc79a7' : '#a855f7', `Merged Clumps (${tax.merges})`],
          ['#f59e0b', `Split Cells (${tax.splits})`],
          [cbMode ? '#d55e00' : '#f43f5e', `Missed FN (${tax.missedFn})`],
          ['#eab308', `Extra/Debris FP (${tax.debrisFp})`],
        ]
      : [
          [cbMode ? '#0072b2' : '#14b888', `Matched TP (${act.tp})`],
          [cbMode ? '#e69f00' : '#f59e0b', `Extra Pred FP (${act.fp})`],
          [cbMode ? '#d55e00' : '#f43f5e', `Missed Ref FN (${act.fn})`],
          ['#ffffff', 'GT Nuclear Rim'],
          ['#fef08a', 'Hungarian 1:1 Link'],
        ];

    legendItems.forEach(([col, txt], i) => {
      const yy = 52 + i * 21;
      ctx.fillStyle = col;
      ctx.fillRect(lx + 10, yy - 8, 10, 10);
      ctx.fillStyle = '#cbe7de';
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillText(txt, lx + 25, yy + 1);
    });

    // Multi-threshold mini summary inside HUD
    ctx.strokeStyle = '#214b59';
    ctx.beginPath();
    ctx.moveTo(lx + 10, 168);
    ctx.lineTo(lx + lw - 10, 168);
    ctx.stroke();

    ctx.fillStyle = '#ffd97d';
    ctx.font = '700 11px Inter, monospace';
    ctx.fillText('Cellpose Thresholds', lx + 10, 186);
    activeSegEval.rows.forEach((r, idx) => {
      const yy = 205 + idx * 19;
      ctx.fillStyle = '#bfe2d7';
      ctx.font = '11px Inter, monospace';
      const scTxt = r.score === null ? 'undef' : r.score.toFixed(3);
      ctx.fillText(`IoU ${r.threshold.toFixed(2)}: ${scTxt}`, lx + 10, yy);
    });

    ctx.fillStyle = '#9ac5b8';
    ctx.font = '10.8px Inter, system-ui, sans-serif';
    ctx.fillText(`Pixel Dice: ${activeSegEval.pixelDice.toFixed(3)}`, lx + 10, 274);
    ctx.fillText(`1-px BF1:   ${activeSegEval.boundaryF1.toFixed(3)}`, lx + 10, 292);
    ctx.fillText(`Ref / Pred: ${activeSegEval.reference_objects} / ${activeSegEval.predicted_objects}`, lx + 10, 310);
    ctx.fillText(`Grid: ${gw}×${gh} px`, lx + 10, 328);
  }

  // =========================================================================
  // Track B Visual Canvas: AlphaFold 48×48 PAE Matrix & Confidence Summary
  // =========================================================================
  function paeGreenColor(paeAngstrom) {
    // Official AlphaFold Server green-to-white continuous PAE colormap (0 Å = deep #0b5d34, 30 Å = #f5f9f6)
    const u = Math.max(0, Math.min(1, paeAngstrom / 30));
    if (cbMode) {
      // Viridis-like blue-teal-light ramp for colorblind mode
      const r = Math.round(12 + 232 * Math.pow(u, 1.15));
      const g = Math.round(58 + 188 * u);
      const b = Math.round(115 + 132 * Math.pow(u, 0.85));
      return [r, g, b];
    }
    const r = Math.round(10 + 236 * Math.pow(u, 1.15));
    const g = Math.round(88 + 160 * Math.pow(u, 0.95));
    const b = Math.round(48 + 198 * Math.pow(u, 1.10));
    return [r, g, b];
  }

  function renderPaeCanvas() {
    const canvas = get('pae-canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const CW = 560, CH = 350;
    if (canvas.width !== Math.round(CW * dpr) || canvas.height !== Math.round(CH * dpr)) {
      canvas.width = Math.round(CW * dpr);
      canvas.height = Math.round(CH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#06161d';
    ctx.fillRect(0, 0, CW, CH);

    const sz = activeStruct.paeSize || 48;
    const pae = activeStruct.pae;
    const padX = 34, padY = 18;
    const mapPx = 304;
    canvas._paeGeom = { ox: padX, oy: padY, mapPx, nRes: activeStruct.residues };

    if (pae && pae.length === sz * sz) {
      const off = document.createElement('canvas');
      off.width = sz;
      off.height = sz;
      const octx = off.getContext('2d');
      const img = octx.createImageData(sz, sz);
      for (let i = 0; i < sz * sz; i++) {
        const [r, g, b] = paeGreenColor(pae[i]);
        img.data[i * 4] = r;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = b;
        img.data[i * 4 + 3] = 255;
      }
      octx.putImageData(img, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, padX, padY, mapPx, mapPx);
      ctx.restore();

      // Rigid domain block outlines
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      for (const dom of activeStruct.paeInfo.domains) {
        const x0 = padX + (dom.binStart / sz) * mapPx;
        const w0 = ((dom.binEnd - dom.binStart + 1) / sz) * mapPx;
        ctx.strokeRect(x0, padY + (dom.binStart / sz) * mapPx, w0, w0);
      }
      ctx.setLineDash([]);
    }

    // Per-residue pLDDT color strip right above PAE matrix (height 7 px)
    const conf = activeCal.conf;
    const bCols = afBandColors();
    for (let i = 0; i < conf.numResidues; i++) {
      const s = conf.scores[i];
      const col = s >= 90 ? bCols[0] : s >= 70 ? bCols[1] : s >= 50 ? bCols[2] : bCols[3];
      const x0 = padX + (i / conf.numResidues) * mapPx;
      const w0 = Math.max(1.2, mapPx / conf.numResidues + 0.5);
      ctx.fillStyle = col;
      ctx.fillRect(x0, padY - 9, w0, 6);
    }

    // Interactive crosshair at inspected residue
    const rIdx = Math.max(0, Number(get('residue-pos').value) - 1);
    const frac = (rIdx + 0.5) / conf.numResidues;
    const cx = padX + frac * mapPx;
    const cy = padY + frac * mapPx;
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx, padY); ctx.lineTo(cx, padY + mapPx);
    ctx.moveTo(padX, cy); ctx.lineTo(padX + mapPx, cy);
    ctx.stroke();

    ctx.strokeStyle = '#4c7b8a';
    ctx.strokeRect(padX, padY, mapPx, mapPx);
    ctx.fillStyle = '#b9ded3';
    ctx.font = '10.5px Inter, sans-serif';
    ctx.fillText('1', padX, padY + mapPx + 14);
    ctx.fillText(`Aligned residue (${conf.numResidues})`, padX + 92, padY + mapPx + 14);
    ctx.save();
    ctx.translate(18, padY + mapPx / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('Scored residue', 0, 0);
    ctx.restore();

    // Right-hand AlphaFold Telemetry Panel inside canvas (x: 352..548)
    const lx = 352, lw = 196;
    ctx.fillStyle = 'rgba(11, 34, 43, 0.94)';
    ctx.fillRect(lx, 14, lw, CH - 28);
    ctx.strokeStyle = '#255362';
    ctx.strokeRect(lx, 14, lw, CH - 28);

    ctx.fillStyle = '#e5f7f1';
    ctx.font = '700 11.5px Inter, sans-serif';
    ctx.fillText(`${activeStruct.gene} · pLDDT Bands`, lx + 10, 33);

    const bandMeta = [
      [bCols[0], '≥ 90 Very high', conf.bands[3]],
      [bCols[1], '70–90 Confident', conf.bands[2]],
      [bCols[2], '50–70 Low', conf.bands[1]],
      [bCols[3], '< 50 Very low (IDR)', conf.bands[0]],
    ];
    bandMeta.forEach(([col, name, cnt], idx) => {
      const yy = 52 + idx * 22;
      const pct = ((100 * cnt) / conf.numResidues).toFixed(0);
      ctx.fillStyle = col;
      ctx.fillRect(lx + 10, yy - 8, 10, 10);
      ctx.fillStyle = '#cbe7de';
      ctx.font = '10.8px Inter, sans-serif';
      ctx.fillText(`${name}: ${pct}%`, lx + 25, yy + 1);
    });

    // Continuous 0–30 Å PAE colorbar
    ctx.fillStyle = '#bfe2d7';
    ctx.font = '700 10.8px Inter, sans-serif';
    ctx.fillText('Expected Position Error (Å)', lx + 10, 152);
    for (let s = 0; s < 160; s++) {
      const [r, g, b] = paeGreenColor((s / 159) * 30);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(lx + 10 + s, 158, 1.5, 10);
    }
    ctx.fillStyle = '#9ec6b9';
    ctx.font = '10px Inter, monospace';
    ctx.fillText('0 Å', lx + 10, 180);
    ctx.fillText('15 Å', lx + 78, 180);
    ctx.fillText('30 Å', lx + 148, 180);

    // Inspected residue box
    const rLbl = activeStruct.residueLabels[rIdx] || `Res ${rIdx + 1}`;
    const rVal = conf.scores[rIdx];
    const rSig = conf.stdDevs[rIdx];
    const rEnt = conf.normEntropies[rIdx];
    const paeBin = Math.min(sz - 1, Math.floor((rIdx / conf.numResidues) * sz));
    let rowPaeMean = 0;
    if (pae) {
      for (let c = 0; c < sz; c++) rowPaeMean += pae[paeBin * sz + c];
      rowPaeMean /= sz;
    }

    ctx.strokeStyle = '#23505e';
    ctx.beginPath(); ctx.moveTo(lx + 10, 192); ctx.lineTo(lx + lw - 10, 192); ctx.stroke();
    ctx.fillStyle = '#ffd97d';
    ctx.font = '700 11.2px Inter, monospace';
    ctx.fillText(`Residue #${rIdx + 1} (${rLbl})`, lx + 10, 210);
    ctx.fillStyle = '#d9f3eb';
    ctx.font = '11px Inter, monospace';
    ctx.fillText(`pLDDT:   ${rVal.toFixed(2)} ± ${rSig.toFixed(1)}`, lx + 10, 230);
    ctx.fillText(`True Cα: ${activeStruct.trueLddt[rIdx].toFixed(1)} lDDT`, lx + 10, 248);
    ctx.fillText(`Entropy: Ĥ = ${rEnt.toFixed(3)}`, lx + 10, 266);
    ctx.fillText(`Row PAE: ${rowPaeMean.toFixed(1)} Å`, lx + 10, 284);
    ctx.fillText(`pTM:     ${(activeStruct.paeInfo.ptm || 0).toFixed(3)}`, lx + 10, 302);
    ctx.fillStyle = '#96c2b5';
    ctx.font = '10.4px Inter, sans-serif';
    ctx.fillText(`Yellow boxes: ${activeStruct.paeInfo.domains.length} rigid block(s)`, lx + 10, 324);

    get('af-inspect').textContent =
      `${activeStruct.gene} #${rIdx + 1} (${rLbl}): pLDDT = ${rVal.toFixed(2)} ± ${rSig.toFixed(1)} · ` +
      `Normalized Shannon Entropy Ĥ = ${rEnt.toFixed(3)} · Mean chain pLDDT = ${conf.mean.toFixed(2)} (conceals ${conf.bands[0]} disordered <50 residues).`;
  }

  // =========================================================================
  // Left 5 SVG Diagnostic Tabs (Cellpose & Instance Segmentation)
  // =========================================================================
  function renderLeftChart() {
    const svg = get('seg-graph');
    const explain = get('seg-explain');
    const p = pal();
    const W = 600, H = 320;
    const activeMethId = get('seg-method').value;
    const activeTh = Number(get('iou-th').value);

    if (leftTab === 'ap_curve') {
      const L = 54, R = 578, T = 28, B = 270;
      const thMin = 0.30, thMax = 0.95;
      const xOf = th => L + ((th - thMin) / (thMax - thMin)) * (R - L);
      const yOf = v => B - Math.max(0, Math.min(1.02, v ?? 0)) * ((B - T) / 1.02);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (const yv of [0, 0.25, 0.5, 0.75, 1.0]) {
        const yy = yOf(yv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${p.grid}"/>`;
        out += `<text x="${L - 7}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.8" fill="${p.muted}">${yv.toFixed(2)}</text>`;
      }
      for (const tv of [0.3, 0.5, 0.75, 0.9]) {
        const xx = xOf(tv);
        out += `<line x1="${xx.toFixed(1)}" y1="${T}" x2="${xx.toFixed(1)}" y2="${B}" stroke="${p.grid}"/>`;
        out += `<text x="${xx.toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="10.8" fill="${p.muted}">${tv.toFixed(2)}</text>`;
      }

      // Draw all 5 methods' AP(τ) curves + dashed PQ(τ) for active method
      Engine.SEGMENTATION_METHODS.forEach(m => {
        const ev = allMethodEvals[m.id];
        const col = cbMode ? m.cbColor : m.color;
        const isSel = m.id === activeMethId;
        const pts = ev.sweep.map(s => `${xOf(s.threshold).toFixed(1)},${yOf(s.score ?? 1).toFixed(1)}`).join(' ');
        out += `<polyline fill="none" stroke="${col}" stroke-width="${isSel ? '3.0' : '1.6'}" stroke-opacity="${isSel ? '1' : '0.62'}" points="${pts}"/>`;
        if (isSel) {
          const pqPts = ev.sweep.map(s => `${xOf(s.threshold).toFixed(1)},${yOf(s.pq).toFixed(1)}`).join(' ');
          out += `<polyline fill="none" stroke="${col}" stroke-width="2.0" stroke-dasharray="5 3" points="${pqPts}"/>`;
        }
      });

      const curX = xOf(activeTh);
      out += `<line x1="${curX.toFixed(1)}" y1="${T}" x2="${curX.toFixed(1)}" y2="${B}" stroke="${p.gold}" stroke-width="1.7" stroke-dasharray="4 3"/>`;
      out += `<circle cx="${curX.toFixed(1)}" cy="${yOf(activeSegEval.active.score ?? 1).toFixed(1)}" r="4.5" fill="${p.primary}" stroke="#fff" stroke-width="1.3"/>`;

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${p.ink}">Minimum Intersection-over-Union Threshold τ_IoU</text>`;
      out += `<text x="15" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}" transform="rotate(-90 15 ${(T + B) / 2})">Object AP(τ) = TP/(TP+FP+FN)</text>`;

      // Compact non-overlapping legend
      out += `<rect x="${L + 8}" y="${B - 88}" width="212" height="80" rx="6" fill="rgba(255,255,255,0.92)" stroke="#d3e0d8"/>`;
      Engine.SEGMENTATION_METHODS.forEach((m, i) => {
        const col = cbMode ? m.cbColor : m.color;
        const yy = B - 73 + i * 14.5;
        out += `<line x1="${L + 15}" y1="${yy}" x2="${L + 31}" y2="${yy}" stroke="${col}" stroke-width="${m.id === activeMethId ? '2.8' : '1.8'}"/>`;
        out += `<text x="${L + 36}" y="${yy + 3.5}" font-size="10.2" font-weight="${m.id === activeMethId ? '700' : '500'}" fill="${p.ink}">${esc(m.short)} (mAP ${allMethodEvals[m.id].mAP50_95.toFixed(2)})</text>`;
      });

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Strictness Cliff:</strong> At lenient overlap (<code>τ = 0.50</code>), sloppy masks can still count as matches. Raising <code>τ</code> toward <code>0.75–0.90</code> reveals which pipeline truly traces cell boundaries accurately.`,
        `<strong>Multi-Threshold Cellpose AP(τ) &amp; Panoptic Quality:</strong> Solid curves plot <code>TP / (TP + FP + FN)</code> for all 5 pipelines; the dashed curve shows active <code>PQ(τ) = SQ × RQ</code>. At <strong>τ = ${activeTh.toFixed(2)}</strong>, the active pipeline scores <strong>AP = ${(activeSegEval.active.score ?? 0).toFixed(3)}</strong> and <strong>COCO mAP@[.5:.95] = ${activeSegEval.mAP50_95.toFixed(3)}</strong>.`,
        `<strong>Why Pixel Dice Misleads Instance Counting:</strong> Notice that <em>Semantic U-Net</em> achieves high foreground <code>Pixel Dice = ${allMethodEvals.unet_semantic.pixelDice.toFixed(3)}</code> even when touching nuclei fuse into giant connected components—collapsing instance <code>mAP@[.5:.95]</code> to <code>${allMethodEvals.unet_semantic.mAP50_95.toFixed(3)}</code>!`
      );
    } else if (leftTab === 'iou_matrix') {
      const L = 74, R = 420, T = 34, B = 274;
      const nT = Math.min(18, activeSegEval.reference_objects);
      const nP = Math.min(18, activeSegEval.predicted_objects);
      const iou = activeSegEval.iouMatrix.iou;
      const fullNP = activeSegEval.predicted_objects;

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      out += `<text x="${W / 2}" y="20" text-anchor="middle" font-size="11.5" font-weight="700" fill="${p.ink}">Pairwise IoU Matrix &amp; Hungarian 1-to-1 Optimal Assignment (First ${nT}×${nP} Objects)</text>`;

      if (nT > 0 && nP > 0) {
        const cw = (R - L) / nP;
        const ch = (B - T) / nT;
        const matchedKey = new Set(activeSegEval.active.matchedPairs.map(mp => `${mp.trueId}-${mp.predId}`));

        for (let r = 0; r < nT; r++) {
          out += `<text x="${L - 5}" y="${(T + (r + 0.68) * ch).toFixed(1)}" text-anchor="end" font-size="9.5" fill="${p.muted}">T${r + 1}</text>`;
          for (let c = 0; c < nP; c++) {
            const val = iou[r * fullNP + c];
            const xx = L + c * cw, yy = T + r * ch;
            const alpha = Math.min(1, val * 1.05);
            const fill = val > 0.01 ? `rgba(17, 122, 88, ${alpha.toFixed(2)})` : '#f4f8f5';
            out += `<rect x="${xx.toFixed(1)}" y="${yy.toFixed(1)}" width="${cw.toFixed(1)}" height="${ch.toFixed(1)}" fill="${fill}" stroke="#e2ece5" stroke-width="0.6"/>`;
            if (matchedKey.has(`${r + 1}-${c + 1}`)) {
              out += `<rect x="${(xx + 1).toFixed(1)}" y="${(yy + 1).toFixed(1)}" width="${Math.max(2, cw - 2).toFixed(1)}" height="${Math.max(2, ch - 2).toFixed(1)}" fill="none" stroke="${p.gold}" stroke-width="2.0"/>`;
            }
            if (nT <= 8 && nP <= 8 && val > 0.02) {
              out += `<text x="${(xx + cw / 2).toFixed(1)}" y="${(yy + ch / 2 + 3.5).toFixed(1)}" text-anchor="middle" font-size="9.5" fill="${val > 0.55 ? '#fff' : p.ink}">${val.toFixed(2)}</text>`;
            }
          }
        }
        for (let c = 0; c < nP; c++) {
          if (nP <= 12 || c % 2 === 0) {
            out += `<text x="${(L + (c + 0.5) * cw).toFixed(1)}" y="${B + 14}" text-anchor="middle" font-size="9.5" fill="${p.muted}">P${c + 1}</text>`;
          }
        }
      }

      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}">Predicted Instance Index P_j</text>`;
      out += `<text x="20" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}" transform="rotate(-90 20 ${(T + B) / 2})">Ground-Truth Object T_i</text>`;

      // Right annotation box
      out += `<rect x="436" y="${T}" width="148" height="156" rx="6" fill="#f2f7f4" stroke="#cfe0d5"/>`;
      out += `<text x="446" y="${T + 20}" font-size="11" font-weight="700" fill="${p.ink}">Kuhn–Munkres Solver</text>`;
      out += `<text x="446" y="${T + 40}" font-size="10.4" fill="${p.muted}">Gold boxes: 1-to-1</text>`;
      out += `<text x="446" y="${T + 54}" font-size="10.4" fill="${p.muted}">optimal assignment</text>`;
      out += `<text x="446" y="${T + 72}" font-size="10.4" fill="${p.muted}">with IoU ≥ ${activeTh.toFixed(2)}.</text>`;
      out += `<text x="446" y="${T + 96}" font-size="10.6" font-weight="600" fill="${p.primary}">SQ = ${activeSegEval.active.sq.toFixed(3)}</text>`;
      out += `<text x="446" y="${T + 114}" font-size="10.6" font-weight="600" fill="${p.tertiary}">RQ = ${activeSegEval.active.rq.toFixed(3)}</text>`;
      out += `<text x="446" y="${T + 132}" font-size="10.6" font-weight="700" fill="${p.secondary}">PQ = ${activeSegEval.active.pq.toFixed(3)}</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>One-to-One Matching Rules:</strong> One predicted blob cannot claim credit for two real cells! Gold outlines mark the unique 1-to-1 pairings chosen by the optimal assignment solver.`,
        `<strong>Exact Cellpose Linear Sum Assignment:</strong> Minimizing <code>cost = −𝕀(IoU ≥ τ) − IoU / (2 N_min)</code> guarantees maximum <code>TP</code> cardinality first and maximum total overlap <code>SQ</code> second. Off-diagonal green cells in the same column reveal <em>Merge</em> collisions; multiple columns in one row reveal <em>Split</em> fragments.`,
        `<strong>Primal–Dual Optimality vs. Greedy Matching:</strong> Greedy IoU sorting fails whenever a split fragment slightly out-overlaps a neighbor; our exact <code>O(N²M)</code> augmenting-path solver matches <code>scipy.optimize.linear_sum_assignment</code> identically.`
      );
    } else if (leftTab === 'taxonomy') {
      const L = 148, R = 568, T = 34, B = 266;
      const rowH = (B - T) / Engine.SEGMENTATION_METHODS.length;
      const cats = [
        ['cleanTp', 'Clean TP (≥.80)', p.primary],
        ['boundaryShift', 'Rim Shift', p.sky],
        ['merges', 'Merges', p.purple],
        ['splits', 'Splits', p.gold],
        ['missedFn', 'Missed FN', p.secondary],
        ['debrisFp', 'Debris FP', '#dc2626'],
      ];

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      out += `<text x="${W / 2}" y="20" text-anchor="middle" font-size="11.5" font-weight="700" fill="${p.ink}">Morphometric Failure-Mode Decomposition Across All 5 Segmentation Pipelines</text>`;

      Engine.SEGMENTATION_METHODS.forEach((m, idx) => {
        const tx = allMethodEvals[m.id].taxonomy;
        const tot = Math.max(1, cats.reduce((s, [k]) => s + tx[k], 0));
        const cy = T + (idx + 0.5) * rowH;
        const isSel = m.id === activeMethId;

        out += `<text x="${L - 8}" y="${(cy + 4).toFixed(1)}" text-anchor="end" font-size="11" font-weight="${isSel ? '700' : '500'}" fill="${p.ink}">${esc(m.short)}</text>`;
        let curX = L;
        for (const [k, , col] of cats) {
          const w = (tx[k] / tot) * (R - L);
          if (w > 0.5) {
            out += `<rect x="${curX.toFixed(1)}" y="${(cy - 11).toFixed(1)}" width="${w.toFixed(1)}" height="22" fill="${col}" stroke="#fff" stroke-width="0.8"/>`;
            if (w >= 24) {
              out += `<text x="${(curX + w / 2).toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${tx[k]}</text>`;
            }
            curX += w;
          }
        }
      });

      // Legend along bottom
      cats.forEach(([, lbl, col], i) => {
        const lx = 26 + i * 95;
        out += `<rect x="${lx}" y="${H - 22}" width="9" height="9" rx="2" fill="${col}"/>`;
        out += `<text x="${lx + 13}" y="${H - 14}" font-size="9.8" fill="${p.ink}">${lbl}</text>`;
      });

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Why Segmenters Fail Differently:</strong> <em>Semantic U-Net</em> glues touching cells together (purple Merges), while <em>Watershed</em> and <em>StarDist</em> chop long spindle cells into pieces (gold Splits).`,
        `<strong>Topology-Aware Morphometric Error Taxonomy:</strong> Rather than collapsing all errors into scalar <code>FP/FN</code>, overlap-graph inspection separates <strong>Under-Segmentation Merges (${activeSegEval.taxonomy.merges})</strong> from <strong>Over-Segmentation Splits (${activeSegEval.taxonomy.splits})</strong>, <strong>Missed Dim Nuclei (${activeSegEval.taxonomy.missedFn})</strong>, and <strong>Debris FP (${activeSegEval.taxonomy.debrisFp})</strong>.`,
        `<strong>Architectural Inductive Biases:</strong> <code>Cellpose-cyto3</code> integrates reversible diffusion gradient flows toward cell sinks, accommodating non-star-convex elongated morphologies where radial polygon priors (<code>StarDist</code>) and Euclidean basin peaks (<code>Watershed</code>) systematically over-split.`
      );
    } else if (leftTab === 'shift_cliff') {
      const L = 56, R = 576, T = 28, B = 270;
      const basePred = scenarioData.predictions[get('seg-method').value];
      const curve = Engine.computeShiftSensitivity(scenarioData.truth, basePred, scenarioData.width, scenarioData.height);
      const xOf = s => L + (s / 5) * (R - L);
      const yOf = v => B - Math.max(0, Math.min(1.02, v)) * ((B - T) / 1.02);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (const yv of [0, 0.25, 0.5, 0.75, 1.0]) {
        const yy = yOf(yv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${p.grid}"/>`;
        out += `<text x="${L - 7}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.8" fill="${p.muted}">${yv.toFixed(2)}</text>`;
      }
      for (let s = 0; s <= 5; s++) {
        out += `<text x="${xOf(s).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="11" fill="${p.muted}">+${s} px</text>`;
      }

      const series = [
        ['ap50', 'AP @ IoU 0.50', p.primary, ''],
        ['mAP', 'COCO mAP@[.50:.95]', p.tertiary, '5 3'],
        ['ap75', 'AP @ IoU 0.75', p.gold, ''],
        ['ap90', 'AP @ IoU 0.90', p.secondary, ''],
      ];
      series.forEach(([key, , col, dash]) => {
        const pts = curve.map(c => `${xOf(c.shiftPx).toFixed(1)},${yOf(c[key]).toFixed(1)}`).join(' ');
        out += `<polyline fill="none" stroke="${col}" stroke-width="2.5" ${dash ? `stroke-dasharray="${dash}"` : ''} points="${pts}"/>`;
        for (const c of curve) {
          out += `<circle cx="${xOf(c.shiftPx).toFixed(1)}" cy="${yOf(c[key]).toFixed(1)}" r="3.6" fill="${col}"/>`;
        }
      });

      const curShift = Math.max(0, Math.min(5, Math.abs(Number(get('shift-px').value))));
      out += `<line x1="${xOf(curShift).toFixed(1)}" y1="${T}" x2="${xOf(curShift).toFixed(1)}" y2="${B}" stroke="#475569" stroke-width="1.4" stroke-dasharray="3 3"/>`;

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${p.ink}">Systematic Lateral Mask Registration Shift Δx (pixels)</text>`;
      out += `<text x="15" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}" transform="rotate(-90 15 ${(T + B) / 2})">Instance Match Score</text>`;

      out += `<rect x="${R - 200}" y="${T + 8}" width="190" height="68" rx="6" fill="rgba(255,255,255,0.92)" stroke="#d3e0d8"/>`;
      series.forEach(([, lbl, col, dash], i) => {
        const yy = T + 22 + i * 15;
        out += `<line x1="${R - 190}" y1="${yy}" x2="${R - 170}" y2="${yy}" stroke="${col}" stroke-width="2.4" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
        out += `<text x="${R - 164}" y="${yy + 3.5}" font-size="10.4" fill="${p.ink}">${lbl}</text>`;
      });

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>The 1-Pixel Registration Cliff:</strong> Shifting a <code>6×6</code> nucleus by just <code>+1 pixel</code> drops its overlap from <code>1.00</code> to <code>30/42 = 0.714</code>—passing <code>IoU 0.50</code> cleanly while failing <code>IoU 0.75</code>!`,
        `<strong>Sensitivity to Sub-Nuclear Misregistration:</strong> At <code>+1 px</code> shift, <code>AP@0.90</code> plunges to <strong>${curve[1].ap90.toFixed(2)}</strong> and <code>AP@0.75</code> drops to <strong>${curve[1].ap75.toFixed(2)}</strong>, whereas <code>AP@0.50</code> stays at <strong>${curve[1].ap50.toFixed(2)}</strong>. Reporting only <code>AP@0.50</code> conceals systematic boundary bias.`,
        `<strong>Analytical Overlap Decay:</strong> For an object of diameter <code>D</code> pixels, a translation <code>Δx</code> reduces IoU as <code>(D − Δx)/(D + Δx)</code>; thus <code>IoU &lt; 0.75</code> occurs whenever <code>Δx &gt; D/7</code>, making small nuclei dramatically more vulnerable to strict IoU cutoffs.`
      );
    } else if (leftTab === 'area_iou') {
      const L = 56, R = 576, T = 28, B = 270;
      const objs = activeSegEval.perObject;
      const maxArea = Math.max(40, ...objs.map(o => o.areaPx)) * 1.10;
      const minArea = Math.max(0, Math.min(...objs.map(o => o.areaPx)) * 0.80);
      const xOf = a => L + ((a - minArea) / Math.max(1, maxArea - minArea)) * (R - L);
      const yOf = v => B - Math.max(0, Math.min(1.02, v)) * ((B - T) / 1.02);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (const yv of [0, 0.25, 0.5, 0.75, 1.0]) {
        const yy = yOf(yv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${p.grid}"/>`;
        out += `<text x="${L - 7}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.8" fill="${p.muted}">${yv.toFixed(2)}</text>`;
      }
      const yTh = yOf(activeTh);
      out += `<line x1="${L}" y1="${yTh.toFixed(1)}" x2="${R}" y2="${yTh.toFixed(1)}" stroke="${p.gold}" stroke-width="1.8" stroke-dasharray="6 4"/>`;
      out += `<text x="${R - 8}" y="${(yTh - 6).toFixed(1)}" text-anchor="end" font-size="10.5" font-weight="700" fill="${p.gold}">Active Match Cutoff τ = ${activeTh.toFixed(2)}</text>`;

      for (const o of objs) {
        const cx = xOf(o.areaPx), cy = yOf(o.bestIou);
        const col = o.matchedAtActive ? p.primary : p.secondary;
        out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5.2" fill="${col}" fill-opacity="0.82" stroke="#fff" stroke-width="1.2"/>`;
      }

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      for (let g = 0; g <= 4; g++) {
        const av = minArea + ((maxArea - minArea) * g) / 4;
        out += `<text x="${xOf(av).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="10.8" fill="${p.muted}">${Math.round(av)} px</text>`;
      }
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${p.ink}">Ground-Truth Nucleus Area (pixels²)</text>`;
      out += `<text x="15" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}" transform="rotate(-90 15 ${(T + B) / 2})">Best Pairwise Object IoU</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Small &amp; Dim Cells Are Missed First:</strong> Each dot is one real cell. Smaller nuclei on the left lose a larger fraction of their area to 1-pixel rim errors and low-contrast drop-outs.`,
        `<strong>Size-Stratified Recall Audit:</strong> Green dots are matched <code>TP</code> objects at <code>τ = ${activeTh.toFixed(2)}</code>; orange dots fall below cutoff or lose 1-to-1 Hungarian contention. Perimeter-to-area scaling <code>P/A ∝ 1/√A</code> penalizes small organelles more severely at high <code>τ</code>.`,
        `<strong>COCO Small/Medium/Large Stratification Principle:</strong> Auditing per-instance IoU against reference area exposes size-dependent recall bias—essential before downstream single-cell fluorescence intensity quantification.`
      );
    }
  }

  // =========================================================================
  // Right 5 SVG Diagnostic Tabs (AlphaFold pLDDT, Logit Entropy, ECE & PAE)
  // =========================================================================
  function renderRightChart() {
    const svg = get('af-graph');
    const explain = get('af-explain');
    const p = pal();
    const bCols = afBandColors();
    const W = 600, H = 320;
    const conf = activeCal.conf;
    const rIdx = Math.max(0, Number(get('residue-pos').value) - 1);

    if (rightTab === 'plddt_chain') {
      const L = 52, R = 578, T = 26, B = 270;
      const N = conf.numResidues;
      const xOf = i => L + (i / Math.max(1, N - 1)) * (R - L);
      const yOf = v => B - (Math.max(0, Math.min(100, v)) / 100) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      // Background AlphaFold confidence tier bands (90, 70, 50)
      const tiers = [
        [90, 100, bCols[0], '0.07', '≥90 Very High'],
        [70, 90, bCols[1], '0.07', '70–90 Confident'],
        [50, 70, bCols[2], '0.08', '50–70 Low'],
        [0, 50, bCols[3], '0.07', '<50 IDR / Unstructured'],
      ];
      for (const [lo, hi, col, op] of tiers) {
        out += `<rect x="${L}" y="${yOf(hi).toFixed(1)}" width="${R - L}" height="${(yOf(lo) - yOf(hi)).toFixed(1)}" fill="${col}" fill-opacity="${op}"/>`;
      }
      for (const yv of [0, 50, 70, 90, 100]) {
        const yy = yOf(yv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="#cbd5e1" stroke-dasharray="${yv === 50 || yv === 70 || yv === 90 ? '4 3' : ''}"/>`;
        out += `<text x="${L - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${p.muted}">${yv}</text>`;
      }

      // ±1σ predictive uncertainty ribbon from softmax bin variance
      if (N > 1) {
        const upPts = [];
        const dnPts = [];
        for (let i = 0; i < N; i++) {
          upPts.push(`${xOf(i).toFixed(1)},${yOf(conf.scores[i] + conf.stdDevs[i]).toFixed(1)}`);
          dnPts.push(`${xOf(N - 1 - i).toFixed(1)},${yOf(conf.scores[N - 1 - i] - conf.stdDevs[N - 1 - i]).toFixed(1)}`);
        }
        out += `<polygon points="${upPts.concat(dnPts).join(' ')}" fill="${p.primary}" fill-opacity="0.18"/>`;
        const linePts = conf.scores.map((s, i) => `${xOf(i).toFixed(1)},${yOf(s).toFixed(1)}`).join(' ');
        out += `<polyline fill="none" stroke="${p.primary}" stroke-width="2.2" points="${linePts}"/>`;
      }

      if (N <= 16) {
        conf.scores.forEach((s, i) => {
          out += `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(s).toFixed(1)}" r="4.5" fill="${p.primary}"/>`;
        });
      }

      // Chain Mean horizontal line (highlighting what the mean hides!)
      const yMean = yOf(conf.mean);
      out += `<line x1="${L}" y1="${yMean.toFixed(1)}" x2="${R}" y2="${yMean.toFixed(1)}" stroke="${p.secondary}" stroke-width="1.8" stroke-dasharray="7 4"/>`;
      out += `<text x="${R - 6}" y="${(yMean - 5).toFixed(1)}" text-anchor="end" font-size="10.5" font-weight="700" fill="${p.secondary}">Chain Mean = ${conf.mean.toFixed(1)} (min ${conf.minScore.toFixed(1)})</text>`;

      // Active residue cursor
      const cx = xOf(rIdx);
      out += `<line x1="${cx.toFixed(1)}" y1="${T}" x2="${cx.toFixed(1)}" y2="${B}" stroke="#e11d48" stroke-width="1.6" stroke-dasharray="3 3"/>`;
      out += `<circle cx="${cx.toFixed(1)}" cy="${yOf(conf.scores[rIdx]).toFixed(1)}" r="4.8" fill="#e11d48" stroke="#fff" stroke-width="1.3"/>`;

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      for (let g = 0; g <= 4; g++) {
        const idx = Math.round(((N - 1) * g) / 4);
        out += `<text x="${xOf(idx).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="10.8" fill="${p.muted}">${idx + 1}</text>`;
      }
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${p.ink}">Sequence Residue Position i (1 … ${N} · ${esc(activeStruct.gene)})</text>`;
      out += `<text x="15" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}" transform="rotate(-90 15 ${(T + B) / 2})">Predicted lDDT-Cα (0–100)</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Why Chain Averages Deceive:</strong> ${esc(activeStruct.gene)} has a respectable average score of <strong>${conf.mean.toFixed(1)}</strong>, yet plunges to <strong>${conf.minScore.toFixed(1)}</strong> in flexible loops/tails (${conf.bands[0]} residues below 50!).`,
        `<strong>Per-Residue pLDDT ± σ_logit Ribbon:</strong> Shading shows ±1 standard deviation across the softmax probability bins at <code>T = ${Number(get('logit-temp').value).toFixed(2)}</code>. Notice how unstructured regions (<code>&lt; 50</code>, Ruff &amp; Pappu disorder indicator) carry much wider per-residue distributional spread than core β-sheets/α-helices.`,
        `<strong>Local vs. Global Structural Evidence:</strong> Because <code>pLDDT</code> evaluates local Cα distance-difference within a 15 Å inclusion sphere, two rigid domains separated by a flexible linker both score <code>&gt; 90</code> locally while remaining globally unaligned—requiring joint inspection with the 48×48 <code>PAE</code> matrix.`
      );
    } else if (rightTab === 'logit_dist') {
      const L = 56, R = 576, T = 32, B = 270;
      const probs = conf.probsMatrix[rIdx];
      const centers = conf.binCenters;
      const Bcount = probs.length;
      const pMax = Math.max(0.18, ...probs) * 1.16;
      const xOf = c => L + (c / 100) * (R - L);
      const yOf = pr => B - (Math.min(pMax, pr) / pMax) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (let g = 0; g <= 4; g++) {
        const pv = (pMax * g) / 4;
        const yy = yOf(pv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${p.grid}"/>`;
        out += `<text x="${L - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${p.muted}">${pv.toFixed(2)}</text>`;
      }

      const barW = ((R - L) / Bcount) * 0.82;
      for (let b = 0; b < Bcount; b++) {
        const c = centers[b];
        const col = c >= 90 ? bCols[0] : c >= 70 ? bCols[1] : c >= 50 ? bCols[2] : bCols[3];
        const cx = xOf(c), top = yOf(probs[b]);
        out += `<rect x="${(cx - barW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, B - top).toFixed(1)}" fill="${col}" fill-opacity="0.82" stroke="#1e293b" stroke-width="0.6"/>`;
      }

      // Expected value E[pLDDT] vertical line
      const mu = conf.scores[rIdx];
      const sig = conf.stdDevs[rIdx];
      const xMu = xOf(mu);
      out += `<line x1="${xMu.toFixed(1)}" y1="${T}" x2="${xMu.toFixed(1)}" y2="${B}" stroke="#0f172a" stroke-width="2.2" stroke-dasharray="5 3"/>`;

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      for (const xv of [0, 25, 50, 70, 90, 100]) {
        out += `<text x="${xOf(xv).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="10.8" fill="${p.muted}">${xv}</text>`;
      }
      out += `<text x="${W / 2}" y="20" text-anchor="middle" font-size="11.5" font-weight="700" fill="${p.ink}">Residue #${rIdx + 1} (${esc(activeStruct.residueLabels[rIdx] || '')}) · ${Bcount}-Bin PredictedLDDTHead Softmax Distribution</text>`;
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${p.ink}">Confidence Bin Center c_b (0–100 lDDT scale)</text>`;
      out += `<text x="15" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}" transform="rotate(-90 15 ${(T + B) / 2})">Softmax Probability p_{i,b}</text>`;

      out += `<rect x="${L + 10}" y="${T + 8}" width="248" height="50" rx="6" fill="rgba(255,255,255,0.92)" stroke="#d3e0d8"/>`;
      out += `<text x="${L + 18}" y="${T + 25}" font-size="11" font-weight="700" fill="${p.ink}">E[pLDDT] = ${mu.toFixed(2)} ± ${sig.toFixed(1)} pts</text>`;
      out += `<text x="${L + 18}" y="${T + 42}" font-size="10.6" fill="${p.muted}">Shannon H = ${conf.entropies[rIdx].toFixed(2)} nats (Ĥ_norm = ${conf.normEntropies[rIdx].toFixed(2)})</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Inside AlphaFold's Brain at One Residue:</strong> AlphaFold doesn't just guess one number—it assigns probabilities across ${Bcount} score bins. A flat or two-humped bar chart means high uncertainty even if the average looks moderate!`,
        `<strong>Exact Softmax Expectation <code>∑ p_{i,b} c_b</code>:</strong> At residue #${rIdx + 1}, probability-weighted bin centers yield <strong>pLDDT = ${mu.toFixed(2)}</strong> with predictive spread <strong>±${sig.toFixed(1)}</strong> and normalized entropy <strong>Ĥ = ${conf.normEntropies[rIdx].toFixed(2)}</strong> (try Preset 5 Position #1 to inspect uniform <code>[0,0,0,0] → pLDDT 50.0, Ĥ = 1.00</code>).`,
        `<strong>Bimodal Hinge vs. Unimodal Epistemic Spread:</strong> Conformational switches and crystal-contact loops produce bimodal logit peaks whose point expectation <code>E[pLDDT] ≈ 65</code> masks alternative folded vs. detached states—recoverable only from raw pre-B-factor logits.`
      );
    } else if (rightTab === 'calibration') {
      const L1 = 50, R1 = 292, L2 = 348, R2 = 582, T = 32, B = 270;
      const x1Of = v => L1 + (v / 100) * (R1 - L1);
      const y1Of = v => B - (v / 100) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      // Left subplot: Reliability diagram (Predicted pLDDT vs Empirical lDDT-Cα)
      out += `<line x1="${L1}" y1="${B}" x2="${R1}" y2="${T}" stroke="#94a3b8" stroke-width="1.6" stroke-dasharray="5 4"/>`;
      const relPts = [];
      for (const bin of activeCal.reliability) {
        if (bin.count > 0 && bin.meanTrue !== null) {
          const bx = x1Of(bin.meanPred), by = y1Of(bin.meanTrue);
          const diagY = y1Of(bin.meanPred);
          // Calibration gap bar
          out += `<line x1="${bx.toFixed(1)}" y1="${diagY.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${p.secondary}" stroke-width="3.2" stroke-opacity="0.55"/>`;
          out += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="4.5" fill="${p.primary}" stroke="#fff" stroke-width="1.2"/>`;
          relPts.push(`${bx.toFixed(1)},${by.toFixed(1)}`);
        }
      }
      if (relPts.length > 1) {
        out += `<polyline fill="none" stroke="${p.primary}" stroke-width="2.1" points="${relPts.join(' ')}"/>`;
      }
      out += `<path d="M${L1} ${T}V${B}H${R1}" fill="none" stroke="#688277" stroke-width="1.2"/>`;
      for (const v of [0, 50, 100]) {
        out += `<text x="${x1Of(v).toFixed(1)}" y="${B + 16}" text-anchor="middle" font-size="10" fill="${p.muted}">${v}</text>`;
        out += `<text x="${L1 - 5}" y="${(y1Of(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="10" fill="${p.muted}">${v}</text>`;
      }
      out += `<text x="${(L1 + R1) / 2}" y="${T - 10}" text-anchor="middle" font-size="11" font-weight="700" fill="${p.ink}">Reliability Curve (ECE = ${activeCal.ecePts.toFixed(2)} pts)</text>`;
      out += `<text x="${(L1 + R1) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="${p.ink}">Predicted pLDDT vs. True lDDT</text>`;

      // Right subplot: Strictly convex Binned Cross-Entropy NLL(T) vs Temperature T ∈ [0.45..2.20]
      const sw = activeCal.tempSweep;
      const nllMin = Math.min(...sw.map(s => s.binNll)) * 0.92;
      const nllMax = Math.min(nllMin + 2.8, Math.max(...sw.map(s => s.binNll)) * 1.04);
      const x2Of = tv => L2 + ((tv - 0.45) / 1.75) * (R2 - L2);
      const y2Of = v => B - ((Math.min(nllMax, Math.max(nllMin, v)) - nllMin) / Math.max(0.1, nllMax - nllMin)) * (B - T);

      const swPts = sw.map(s => `${x2Of(s.T).toFixed(1)},${y2Of(s.binNll).toFixed(1)}`).join(' ');
      out += `<polyline fill="none" stroke="${p.tertiary}" stroke-width="2.4" points="${swPts}"/>`;
      const curT = Number(get('logit-temp').value);
      out += `<line x1="${x2Of(curT).toFixed(1)}" y1="${T}" x2="${x2Of(curT).toFixed(1)}" y2="${B}" stroke="${p.gold}" stroke-width="1.6" stroke-dasharray="3 3"/>`;
      out += `<circle cx="${x2Of(activeCal.optimalTemp).toFixed(1)}" cy="${y2Of(activeCal.optimalBinNll).toFixed(1)}" r="4.8" fill="${p.primary}" stroke="#fff" stroke-width="1.2"/>`;

      out += `<path d="M${L2} ${T}V${B}H${R2}" fill="none" stroke="#688277" stroke-width="1.2"/>`;
      for (const tv of [0.5, 1.0, 1.5, 2.0]) {
        out += `<text x="${x2Of(tv).toFixed(1)}" y="${B + 16}" text-anchor="middle" font-size="10" fill="${p.muted}">${tv.toFixed(1)}</text>`;
      }
      out += `<text x="${(L2 + R2) / 2}" y="${T - 10}" text-anchor="middle" font-size="10.8" font-weight="700" fill="${p.ink}">Logit NLL(T) · T* = ${activeCal.optimalTemp.toFixed(2)} (${activeCal.optimalBinNll.toFixed(2)} nats)</text>`;
      out += `<text x="${(L2 + R2) / 2}" y="${H - 8}" text-anchor="middle" font-size="11" font-weight="600" fill="${p.ink}">Softmax Temperature T</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Checking Honesty of Confidence:</strong> On a perfectly honest model, residues predicted at 80 actually average 80 accuracy (dashed diagonal). Click <strong>Fit T*</strong> above to find the U-curve minimum of binned log-loss.`,
        `<strong>Guo et al. (ICML 2017) Post-Hoc Temperature Calibration:</strong> Scaling logits by <code>z / T</code> yields a strictly convex U-shaped cross-entropy curve <code>NLL(T)</code>, reaching its global optimum at <strong>T* = ${activeCal.optimalTemp.toFixed(2)}</strong> (<code>NLL = ${activeCal.optimalBinNll.toFixed(2)} nats</code>, <code>ECE = ${activeCal.ecePts.toFixed(2)} pts</code>).`,
        `<strong>Overconfident Sharpness vs. High-T Underconfidence:</strong> Small <code>T &lt; 1</code> over-sharpens hinge-loop logits (penalizing off-peak true lDDT bins exponentially), while large <code>T &gt; 1.8</code> washes core certainty toward uniform <code>ln(B)</code>.`
      );
    } else if (rightTab === 'pae_slice') {
      const L = 54, R = 576, T = 30, B = 270;
      const sz = activeStruct.paeSize || 48;
      const pae = activeStruct.pae;
      const paeBin = Math.min(sz - 1, Math.floor((rIdx / conf.numResidues) * sz));
      const d0 = activeStruct.paeInfo.d0 || 4.0;
      const xOf = b => L + (b / Math.max(1, sz - 1)) * (R - L);
      const yPae = e => B - (Math.min(30, Math.max(0, e)) / 30) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (const ev of [0, 5, 10, 20, 30]) {
        const yy = yPae(ev);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${p.grid}"/>`;
        out += `<text x="${L - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${p.muted}">${ev} Å</text>`;
      }

      if (pae) {
        const rowPts = [];
        const tmPts = [];
        for (let j = 0; j < sz; j++) {
          const e = pae[paeBin * sz + j];
          const tmKernel = 30 * (1 / (1 + (e * e) / (d0 * d0))); // scaled to 0..30 axis (= 0..1.0)
          rowPts.push(`${xOf(j).toFixed(1)},${yPae(e).toFixed(1)}`);
          tmPts.push(`${xOf(j).toFixed(1)},${yPae(tmKernel).toFixed(1)}`);
        }
        out += `<polyline fill="none" stroke="${p.primary}" stroke-width="2.6" points="${rowPts.join(' ')}"/>`;
        out += `<polyline fill="none" stroke="${p.tertiary}" stroke-width="2.0" stroke-dasharray="5 3" points="${tmPts.join(' ')}"/>`;
      }

      const cx = xOf(paeBin);
      out += `<line x1="${cx.toFixed(1)}" y1="${T}" x2="${cx.toFixed(1)}" y2="${B}" stroke="#e11d48" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      out += `<text x="${W / 2}" y="19" text-anchor="middle" font-size="11.4" font-weight="700" fill="${p.ink}">PAE Alignment Profile from Residue #${rIdx + 1} (Solid: PAE Å · Dashed: Jumper Eq.38 TM Kernel)</text>`;
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${p.ink}">Target Residue Bin j Across ${esc(activeStruct.gene)} Chain</text>`;
      out += `<text x="15" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}" transform="rotate(-90 15 ${(T + B) / 2})">Expected Position Error (Å)</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Rigid Domain Lock vs. Flexible Floppy Tails:</strong> Where the green curve hugs the bottom (<code>&lt; 5 Å</code>), those residues move together as one solid 3D block with Residue #${rIdx + 1}. Where it jumps above <code>20 Å</code>, their relative 3D orientation is uncertain.`,
        `<strong>Jumper et al. (Nature 2021, Eq. 38) pTM Derivation:</strong> AlphaFold converts pairwise <code>PAE(i,j)</code> into global fold confidence via the Lorentzian kernel <code>1 / [1 + (PAE_{ij}/d₀(L))²]</code> (blue dashed, <code>d₀ = ${d0.toFixed(2)} Å</code>), yielding <strong>pTM = ${(activeStruct.paeInfo.ptm || 0).toFixed(3)}</strong>.`,
        `<strong>Anchor-Residue Selection:</strong> Maximizing row-averaged Lorentzian weights selects the stiffest core anchor residue automatically, explaining why compact single-domain β-barrels (<code>SOD1</code>) score <code>pTM ≈ 0.90</code> while IDR-flanked transcription factors (<code>TP53</code>) drop to <code>pTM ≈ 0.45</code>.`
      );
    } else if (rightTab === 'proteome') {
      const L = 56, R = 574, T = 30, B = 270;
      const xOf = ptm => L + ((Math.max(0.30, Math.min(0.98, ptm)) - 0.30) / 0.68) * (R - L);
      const yOf = m => B - ((Math.max(45, Math.min(100, m)) - 45) / 55) * (B - T);

      let out = `<rect width="${W}" height="${H}" fill="#fbfdfb"/>`;
      for (const mv of [50, 65, 80, 95]) {
        const yy = yOf(mv);
        out += `<line x1="${L}" y1="${yy.toFixed(1)}" x2="${R}" y2="${yy.toFixed(1)}" stroke="${p.grid}"/>`;
        out += `<text x="${L - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" font-size="10.5" fill="${p.muted}">${mv}</text>`;
      }
      for (const pv of [0.35, 0.50, 0.65, 0.80, 0.95]) {
        out += `<text x="${xOf(pv).toFixed(1)}" y="${B + 17}" text-anchor="middle" font-size="10.8" fill="${p.muted}">${pv.toFixed(2)}</text>`;
      }

      const offsets = {
        'P04637': [9, -7],
        'P01308': [9, 12],
        'O23290': [-66, -7],
        '8AW3': [-58, 14],
        'P00846': [-54, 14],
        'P0A7J3': [8, 12],
        'P0A7G6': [-36, -9],
        'Q31BY4': [-36, 17],
        'P00359': [-42, -9],
        'P68871': [-62, 4],
        'P00441': [7, 13],
        'classroom_4res': [9, -6],
      };

      for (const st of structCatalog) {
        const ptm = st.paeInfo.ptm ?? 0.5;
        const cx = xOf(ptm), cy = yOf(st.rawMean);
        const isSel = st.id === activeStruct.id;
        const idrFrac = st.bands[0] / st.residues;
        const r = 4.5 + 8 * idrFrac;
        if (isSel) {
          out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r + 4).toFixed(1)}" fill="none" stroke="${p.gold}" stroke-width="2.4"/>`;
        }
        const col = st.kind.includes('PDB') ? p.secondary : st.kind.includes('Classroom') ? p.purple : p.primary;
        out += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${col}" fill-opacity="0.82" stroke="#fff" stroke-width="1.1"/>`;
        const [dx, dy] = offsets[st.id] || [7, -6];
        out += `<text x="${(cx + dx).toFixed(1)}" y="${(cy + dy).toFixed(1)}" font-size="10" font-weight="${isSel ? '700' : '600'}" fill="${p.ink}">${esc(st.gene)}</text>`;
      }

      out += `<path d="M${L} ${T}V${B}H${R}" fill="none" stroke="#688277" stroke-width="1.3"/>`;
      out += `<text x="${W / 2}" y="19" text-anchor="middle" font-size="11.2" font-weight="700" fill="${p.ink}">12-Specimen Confidence Atlas · Mean pLDDT vs. PAE pTM (Bubble = % IDR &lt;50)</text>`;
      out += `<text x="${(L + R) / 2}" y="${H - 8}" text-anchor="middle" font-size="12" font-weight="600" fill="${p.ink}">Global Domain Packing Confidence pTM (Jumper Eq. 38)</text>`;
      out += `<text x="15" y="${(T + B) / 2}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${p.ink}" transform="rotate(-90 15 ${(T + B) / 2})">Chain Mean pLDDT (0–100)</text>`;

      svg.innerHTML = out;
      explain.innerHTML = audienceText(
        `<strong>Comparing All 12 Bundled Structures:</strong> Globular enzymes (<code>SOD1</code>, <code>TDH3</code>, <code>rbcL</code>, <code>HBB</code>) cluster in the top-right high-confidence corner, while <code>TP53</code> and <code>INS</code> carry large disordered bubbles that pull global <code>pTM</code> leftward.`,
        `<strong>Joint Local (pLDDT) vs. Global (pTM) Proteome Audit:</strong> Plotting mean <code>pLDDT</code> against <code>PAE pTM</code> across all 10 KEGG AlphaFold DB v6 folds + <code>PDB 8AW3</code> separates compact single-domain folds from multi-domain or intrinsically disordered architectures.`,
        `<strong>Multi-Chain ipTM Benchmark (PDB 8AW3):</strong> Flagship ribonucleoprotein <code>8AW3</code> combines two protein subunits, a 73-nt tRNA, and 2× Zn²⁺ ions with reference <code>pTM = 0.75</code> and interface <code>ipTM = 0.78</code>.`
      );
    }
  }

  // =========================================================================
  // 5-Pipeline Segmentation Benchmark Leaderboard & Custom JSON Upload
  // =========================================================================
  function renderLeaderboard() {
    const tbody = get('seg-leaderboard');
    tbody.replaceChildren();
    const activeMethId = get('seg-method').value;

    const ranked = Engine.SEGMENTATION_METHODS.map(m => ({
      spec: m,
      ev: allMethodEvals[m.id],
    })).sort((a, b) => b.ev.mAP50_95 - a.ev.mAP50_95);

    ranked.forEach(({ spec, ev }, idx) => {
      const tr = tbody.insertRow();
      if (spec.id === activeMethId) tr.className = 'is-active';
      tr.addEventListener('click', () => {
        get('seg-method').value = spec.id;
        recomputeAll(false);
      });

      const r50 = ev.rows[0].score === null ? '—' : ev.rows[0].score.toFixed(3);
      const r75 = ev.rows[1].score === null ? '—' : ev.rows[1].score.toFixed(3);
      const r90 = ev.rows[2].score === null ? '—' : ev.rows[2].score.toFixed(3);
      const act = ev.active;
      const tax = ev.taxonomy;

      tr.insertCell().innerHTML = `<span class="au-rank">${idx + 1}</span>`;
      tr.insertCell().textContent = spec.label;
      tr.insertCell().textContent = r50;
      tr.insertCell().textContent = r75;
      tr.insertCell().textContent = r90;
      tr.insertCell().textContent = ev.mAP50_95.toFixed(3);
      tr.insertCell().textContent = `${act.pq.toFixed(3)} (${act.sq.toFixed(2)}×${act.rq.toFixed(2)})`;
      tr.insertCell().textContent = ev.boundaryF1.toFixed(3);
      tr.insertCell().textContent = `${act.tp} / ${act.fp} / ${act.fn}`;
      tr.insertCell().textContent = `${tax.merges} / ${tax.splits}`;
    });
  }

  function renderUploadedAuditReport(rawJson) {
    const parsed = Engine.validateAuditReport(rawJson);
    const card = get('uploaded-report-card');
    const wrap = get('uploaded-tables');
    wrap.replaceChildren();
    card.hidden = false;
    get('uploaded-summary').textContent = `Source: ${parsed.source} · Validated against schema evidence-audit/1.`;

    if (parsed.maskRun) {
      const div = document.createElement('div');
      div.className = 'au-table-wrap';
      const rowsHtml = parsed.maskRun.rows.map(r =>
        `<tr><td>${r.threshold}</td><td>${r.tp}</td><td>${r.fp}</td><td>${r.fn}</td><td>${r.score === null ? 'undefined' : r.score.toFixed(4)}</td></tr>`
      ).join('');
      div.innerHTML = `<table class="au-table"><thead><tr><th>IoU τ</th><th>TP</th><th>FP</th><th>FN</th><th>Score TP/(TP+FP+FN)</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
      wrap.append(div);
    }

    if (parsed.confidenceRun) {
      const c = parsed.confidenceRun;
      const bands = [0, 0, 0, 0];
      for (const s of c.scores) bands[s < 50 ? 0 : s < 70 ? 1 : s < 90 ? 2 : 3]++;
      const div = document.createElement('div');
      div.className = 'au-table-wrap';
      div.innerHTML = `<table class="au-table"><thead><tr><th>Residues</th><th>Mean pLDDT</th><th>Min / Max</th><th>&lt;50 / 50–70 / 70–90 / ≥90</th></tr></thead>` +
        `<tbody><tr><td>${c.scores.length}</td><td>${c.mean.toFixed(2)}</td><td>${Math.min(...c.scores).toFixed(1)} / ${Math.max(...c.scores).toFixed(1)}</td><td>${bands.join(' / ')}</td></tr></tbody></table>`;
      wrap.append(div);
    }

    get('status').textContent = `Loaded custom evidence-audit/1 JSON report: ${parsed.source}`;
  }

  // =========================================================================
  // Exports, Canvas Click Inspection & Workspace Capture
  // =========================================================================
  function downloadBlob(content, mime, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function applyPreset(key) {
    const p = PRESETS[key];
    if (!p) return;
    document.querySelectorAll('.au-preset-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === key);
    });
    get('scenario').value = p.scenario;
    get('seg-method').value = p.method;
    get('iou-th').value = String(p.iouTh);
    get('shift-px').value = String(p.shiftPx);
    get('morph-rad').value = String(p.morphRad);
    if (structCatalog.some(s => s.id === p.structure)) {
      get('structure-select').value = p.structure;
    }
    get('residue-pos').value = String(p.residuePos);
    get('logit-temp').value = String(p.logitTemp);
    leftTab = p.leftTab;
    rightTab = p.rightTab;
    syncTabs();
    recomputeAll(true);
  }

  function syncTabs() {
    document.querySelectorAll('[data-left-tab]').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.leftTab === leftTab));
    });
    document.querySelectorAll('[data-right-tab]').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.rightTab === rightTab));
    });
  }

  function bindEvents() {
    document.querySelectorAll('.au-preset-chip').forEach(btn => {
      btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
    });

    document.querySelectorAll('[data-audience]').forEach(btn => {
      btn.addEventListener('click', () => {
        audience = btn.dataset.audience;
        document.querySelectorAll('[data-audience]').forEach(b => {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        renderLeftChart();
        renderRightChart();
      });
    });

    get('cb-toggle').addEventListener('click', () => {
      cbMode = !cbMode;
      document.body.classList.toggle('cb-mode', cbMode);
      get('cb-toggle').classList.toggle('active', cbMode);
      get('cb-toggle').setAttribute('aria-pressed', String(cbMode));
      recomputeAll(false);
    });

    get('scenario').addEventListener('change', () => recomputeAll(true));
    for (const id of ['seg-method', 'iou-th', 'shift-px', 'morph-rad', 'structure-select', 'residue-pos', 'logit-temp']) {
      get(id).addEventListener('input', () => recomputeAll(false));
    }
    get('mask-view-mode').addEventListener('change', renderMaskCanvas);

    get('auto-cal-btn').addEventListener('click', () => {
      if (!activeCal) return;
      get('logit-temp').value = String(activeCal.optimalTemp);
      recomputeAll(false);
      get('status').textContent =
        `Calibrated PredictedLDDTHead temperature to T* = ${activeCal.optimalTemp.toFixed(2)} (ECE = ${activeCal.ecePts.toFixed(2)} lDDT pts on ${activeStruct.gene}).`;
    });

    document.querySelectorAll('[data-left-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        leftTab = btn.dataset.leftTab;
        syncTabs();
        renderLeftChart();
      });
    });

    document.querySelectorAll('[data-right-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        rightTab = btn.dataset.rightTab;
        syncTabs();
        renderRightChart();
      });
    });

    // Click to inspect nucleus on #mask-canvas
    get('mask-canvas').addEventListener('click', e => {
      const canvas = get('mask-canvas');
      const g = canvas._geom;
      if (!g) return;
      const rect = canvas.getBoundingClientRect();
      const cx = ((e.clientX - rect.left) / rect.width) * 560;
      const cy = ((e.clientY - rect.top) / rect.height) * 350;
      const gx = Math.floor((cx - g.ox) / g.scale);
      const gy = Math.floor((cy - g.oy) / g.scale);
      if (gx < 0 || gx >= g.gw || gy < 0 || gy >= g.gh) return;
      const idx = gy * g.gw + gx;
      const tid = activeSegEval.truthMap[idx];
      const pid = activeSegEval.predMap[idx];
      selectedCellTrueId = tid || null;
      renderMaskCanvas();

      if (tid > 0) {
        const obj = activeSegEval.perObject[tid - 1];
        const status = obj.matchedAtActive
          ? `Matched TP → Pred #${obj.assignedPredId} (IoU = ${obj.assignedIou.toFixed(3)})`
          : `Unmatched FN at τ=${activeSegEval.active.threshold.toFixed(2)} (best IoU = ${obj.bestIou.toFixed(3)} with Pred #${obj.bestPredId || 'none'})`;
        get('mask-inspect').textContent = `Ground-Truth Cell #${tid} (area ${obj.areaPx} px²): ${status}`;
      } else if (pid > 0) {
        const isMatched = activeSegEval.active.matchedPredSet.has(pid);
        get('mask-inspect').textContent = `Predicted Mask #${pid}: ${isMatched ? 'Matched rim pixel outside GT core' : 'Unmatched False Positive (FP) mask'}`;
      } else {
        get('mask-inspect').textContent = `Background pixel (${gx}, ${gy}) · Click any nucleus to inspect Hungarian match & IoU.`;
      }
    });

    // Click PAE canvas to jump to residue
    get('pae-canvas').addEventListener('click', e => {
      const canvas = get('pae-canvas');
      const g = canvas._paeGeom;
      if (!g) return;
      const rect = canvas.getBoundingClientRect();
      const cx = ((e.clientX - rect.left) / rect.width) * 560;
      const cy = ((e.clientY - rect.top) / rect.height) * 350;
      if (cx >= g.ox && cx <= g.ox + g.mapPx && cy >= g.oy && cy <= g.oy + g.mapPx) {
        const frac = (cx - g.ox) / g.mapPx;
        const pos = Math.max(1, Math.min(g.nRes, Math.floor(frac * g.nRes) + 1));
        get('residue-pos').value = String(pos);
        recomputeAll(false);
      }
    });

    // Upstream `#demo` button & `#input` JSON file import
    get('demo').addEventListener('click', () => {
      get('input').value = '';
      get('uploaded-report-card').hidden = true;
      applyPreset('classroom_upstream');
      get('status').textContent = 'Loaded upstream classroom validation fixture (12×22 shifted 6×6 nuclei + 4-residue 4-bin logits).';
    });

    get('input').addEventListener('change', async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        if (f.size > 5000000) throw new Error('Use a report smaller than 5 MB.');
        const report = JSON.parse(await f.text());
        renderUploadedAuditReport(report);
      } catch (err) {
        get('status').textContent = `Audit JSON error: ${err.message}`;
      }
    });

    get('clear-upload').addEventListener('click', () => {
      get('uploaded-report-card').hidden = true;
      get('input').value = '';
    });

    // SVG, JSON (`evidence-audit/1`), and CSV exports
    get('export-seg-svg').addEventListener('click', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320">${get('seg-graph').innerHTML}</svg>`;
      downloadBlob(xml, 'image/svg+xml', `audit-cellpose-${leftTab}.svg`);
    });
    get('export-af-svg').addEventListener('click', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 320">${get('af-graph').innerHTML}</svg>`;
      downloadBlob(xml, 'image/svg+xml', `audit-alphafold-${rightTab}.svg`);
    });

    get('export-json').addEventListener('click', () => {
      const conf = activeCal.conf;
      const report = {
        schema: 'evidence-audit/1',
        source: `${scenarioData.id} (${get('seg-method').value}) + ${activeStruct.id} (T=${Number(get('logit-temp').value).toFixed(2)})`,
        upstream: Engine.UPSTREAM_VERSIONS,
        runs: [
          {
            kind: 'mask',
            reference_objects: activeSegEval.reference_objects,
            predicted_objects: activeSegEval.predicted_objects,
            rows: activeSegEval.rows,
          },
          {
            kind: 'confidence',
            scores: conf.scores.map(s => Number(s.toFixed(6))),
            mean: Number(conf.mean.toFixed(6)),
          },
        ],
      };
      downloadBlob(JSON.stringify(report, null, 2) + '\n', 'application/json', `audit-${scenarioData.id}-${activeStruct.id}.json`);
    });

    get('export-csv').addEventListener('click', () => {
      const header = 'pipeline,scenario,AP_050,AP_075,AP_090,mAP_50_95,PQ,SQ,RQ,BF1_1px,merges,splits\n';
      const rows = Engine.SEGMENTATION_METHODS.map(m => {
        const ev = allMethodEvals[m.id];
        return [
          m.id, scenarioData.id,
          (ev.rows[0].score ?? 0).toFixed(4),
          (ev.rows[1].score ?? 0).toFixed(4),
          (ev.rows[2].score ?? 0).toFixed(4),
          ev.mAP50_95.toFixed(4),
          ev.active.pq.toFixed(4),
          ev.active.sq.toFixed(4),
          ev.active.rq.toFixed(4),
          ev.boundaryF1.toFixed(4),
          ev.taxonomy.merges,
          ev.taxonomy.splits,
        ].join(',');
      }).join('\n');
      downloadBlob(header + rows, 'text/csv', `audit-segmentation-${scenarioData.id}.csv`);
    });

    // Save Cellpose Mask Audit & AlphaFold Confidence Audit to Evidence Workspace
    get('save-mask-evidence').addEventListener('click', () => {
      if (!activeSegEval || typeof evidenceRecords === 'undefined') return;
      const act = activeSegEval.active;
      if (act.score === null) {
        get('status').textContent = 'Cannot save an undefined empty-mask match score.';
        return;
      }
      const methId = get('seg-method').value;
      const methLabel = Engine.SEGMENTATION_METHODS.find(m => m.id === methId)?.short || methId;
      try {
        evidenceRecords.capture({
          kind: 'simulated',
          title: `${methLabel} · ${scenarioData.id} · IoU ${act.threshold.toFixed(2)}`,
          dataset: `Cellpose segmentation audit · ${scenarioData.id}`,
          method: 'Cellpose Kuhn–Munkres one-to-one instance matching',
          metric: 'Object match score TP/(TP+FP+FN)',
          unit: 'score (0–1)',
          value: Number(act.score.toFixed(4)),
          source: 'studio/audit.html',
          details: {
            comparisonKey: `audit-mask-${scenarioData.id}-th${act.threshold.toFixed(2)}`,
            pipeline: methId,
            threshold: act.threshold,
            tp: act.tp,
            fp: act.fp,
            fn: act.fn,
            mAP50_95: Number(activeSegEval.mAP50_95.toFixed(4)),
            panopticPQ: Number(act.pq.toFixed(4)),
            merges: activeSegEval.taxonomy.merges,
            splits: activeSegEval.taxonomy.splits,
          },
        });
        get('status').textContent =
          `Saved Cellpose segmentation audit (${methLabel}, AP@${act.threshold.toFixed(2)} = ${act.score.toFixed(3)}, PQ = ${act.pq.toFixed(3)}) to Evidence Workspace.`;
      } catch (err) {
        get('status').textContent = `Could not save mask audit: ${err.message}`;
      }
    });

    get('save-conf-evidence').addEventListener('click', () => {
      if (!activeCal || !activeStruct || typeof evidenceRecords === 'undefined') return;
      const conf = activeCal.conf;
      const rIdx = Math.max(1, Number(get('residue-pos').value));
      const rVal = conf.scores[rIdx - 1];
      try {
        evidenceRecords.capture({
          kind: 'simulated',
          title: `AlphaFold audit · ${activeStruct.gene} (${activeStruct.id}) · T=${activeCal.temperature.toFixed(2)}`,
          dataset: `AlphaFold confidence & PAE audit · ${activeStruct.id}`,
          method: 'AlphaFold PredictedLDDTHead softmax & PAE Eq.38 pTM',
          metric: 'Mean pLDDT',
          unit: 'pLDDT (0–100)',
          value: Number(conf.mean.toFixed(2)),
          source: 'studio/audit.html',
          details: {
            comparisonKey: `audit-plddt-${activeStruct.id}`,
            structureId: activeStruct.id,
            residues: conf.numResidues,
            temperature: activeCal.temperature,
            ecePts: Number(activeCal.ecePts.toFixed(3)),
            ptm: activeStruct.paeInfo.ptm ? Number(activeStruct.paeInfo.ptm.toFixed(3)) : null,
            inspectedPosition: rIdx,
            inspectedPlddt: Number(rVal.toFixed(2)),
            below50: conf.bands[0],
            between50And70: conf.bands[1],
            between70And90: conf.bands[2],
            above90: conf.bands[3],
          },
        });
        get('status').textContent =
          `Saved AlphaFold confidence audit (${activeStruct.gene}, mean pLDDT = ${conf.mean.toFixed(2)}, pTM = ${(activeStruct.paeInfo.ptm || 0).toFixed(2)}) to Evidence Workspace.`;
      } catch (err) {
        get('status').textContent = `Could not save confidence audit: ${err.message}`;
      }
    });
  }

  populateSelectors();
  bindEvents();
  applyPreset('flagship_tp53');
})();
