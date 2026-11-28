'use strict';

(() => {
  const E = window.TomographyEngine;
  const svgNs = 'http://www.w3.org/2000/svg';
  const get = id => document.getElementById(id);

  // Interactive Workbench State
  const state = {
    audience: 'student',
    cbMode: false,
    colormap: 'cryo',
    reconMode: 'recon', // 'recon' | 'diff' | 'contour'
    leftTab: 'frc',
    rightTab: 'conv',
    yaw: 0.48,
    pitch: 0.36,
    hoverAngleIdx: -1,
    sweepingZ: false,
    sweepDir: 1,
    sweepTimer: 0,
    run: null,
    lcurveCacheKey: '',
    lcurveData: null,
    lotoCacheKey: '',
    lotoData: null,
  };

  let record = null;

  // Scientific Colormaps: v ∈ [0, 1] -> [R, G, B]
  const COLORMAPS = {
    cryo(v) {
      const t = Math.max(0, Math.min(1, v));
      if (t < 0.35) {
        const u = t / 0.35;
        return [6 + 10 * u, 21 + 56 * u, 28 + 76 * u];
      }
      if (t < 0.72) {
        const u = (t - 0.35) / 0.37;
        return [16 + 52 * u, 77 + 114 * u, 104 + 98 * u];
      }
      const u = (t - 0.72) / 0.28;
      return [68 + 178 * u, 191 + 60 * u, 202 + 46 * u];
    },
    viridis(v) {
      const stops = [
        [68, 1, 84],
        [59, 82, 139],
        [33, 145, 140],
        [94, 201, 98],
        [253, 231, 37],
      ];
      const t = Math.max(0, Math.min(1, v)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      const f = t - i;
      return [
        stops[i][0] + f * (stops[i + 1][0] - stops[i][0]),
        stops[i][1] + f * (stops[i + 1][1] - stops[i][1]),
        stops[i][2] + f * (stops[i + 1][2] - stops[i][2]),
      ];
    },
    magma(v) {
      const stops = [
        [4, 3, 18],
        [79, 18, 123],
        [181, 54, 122],
        [251, 136, 97],
        [252, 253, 191],
      ];
      const t = Math.max(0, Math.min(1, v)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(t));
      const f = t - i;
      return [
        stops[i][0] + f * (stops[i + 1][0] - stops[i][0]),
        stops[i][1] + f * (stops[i + 1][1] - stops[i][1]),
        stops[i][2] + f * (stops[i + 1][2] - stops[i][2]),
      ];
    },
    gray(v) {
      const c = 8 + 242 * Math.max(0, Math.min(1, v));
      return [c, c + 2, c + 3];
    },
  };

  // Diverging colormap for signed error d ∈ [-maxAbs, +maxAbs] (Okabe-Ito Blue <-> Dark <-> Vermilion/Gold)
  function divergingRGB(normDiff) {
    const d = Math.max(-1, Math.min(1, normDiff));
    if (d < 0) {
      const u = -d;
      return [12 + 32 * u, 28 + 118 * u, 36 + 195 * u];
    }
    const u = d;
    return [12 + 234 * u, 28 + 115 * u, 36 + 18 * u];
  }

  function plddtColor(score) {
    if (state.cbMode) {
      if (score >= 90) return '#0072b2';
      if (score >= 70) return '#56b4e9';
      if (score >= 50) return '#f0e442';
      return '#d55e00';
    }
    if (score >= 90) return '#3b82f6';
    if (score >= 70) return '#38bdf8';
    if (score >= 50) return '#facc15';
    return '#fb7185';
  }

  function solverColor(meta) {
    return state.cbMode ? meta.cbColor : meta.color;
  }

  function svgEl(parent, tag, attrs = {}, text) {
    const node = document.createElementNS(svgNs, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  }

  function populateSpecimenMenu() {
    const sel = get('specimen');
    const catalog = E.getSpecimenCatalog();
    sel.replaceChildren();
    const groups = new Map();
    for (const item of catalog) {
      if (!groups.has(item.group)) {
        const og = document.createElement('optgroup');
        og.label = item.group;
        groups.set(item.group, og);
        sel.appendChild(og);
      }
      const opt = document.createElement('option');
      opt.value = item.id === 'calibration' ? 'calibration' : item.id;
      opt.textContent = item.optionLabel;
      groups.get(item.group).appendChild(opt);
    }
    sel.value = 'P00846';
  }

  function updateSpecimenBanner(spec) {
    get('identity').textContent = spec.title;
    get('biology').textContent = spec.biology;
    get('question').textContent = 'Investigate: ' + spec.question;
    get('measurement').textContent = spec.measurement;

    const srcEl = get('sources');
    srcEl.replaceChildren();
    (spec.sources || []).forEach((s, idx) => {
      const href = s?.url || 'methods.html#tomography';
      if (idx > 0) srcEl.append(' · ');
      const a = document.createElement('a');
      a.href = href;
      if (href.startsWith('http')) {
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
      }
      a.textContent = s?.label || 'Source';
      srcEl.appendChild(a);
    });
  }

  function readConfigFromUI() {
    const N = Number(get('grid-size').value) || 64;
    const scanInput = get('scanline');
    if (Number(scanInput.max) !== N - 1) {
      const ratio = Number(scanInput.value) / Math.max(1, Number(scanInput.max));
      scanInput.max = String(N - 1);
      scanInput.value = String(Math.round(ratio * (N - 1)));
    }
    const doseRaw = get('dose').value;
    const dose = doseRaw === 'inf' ? Infinity : Number(doseRaw);
    const spanDeg = Number(get('tilt-span').value) || 180;
    get('limited').checked = spanDeg === 90;

    return {
      specimenId: get('specimen').value || 'calibration',
      z: Number(get('slice').value) / 100,
      N,
      angles: Number(get('angles').value) || 24,
      spanDeg,
      passes: Number(get('steps').value) || 20,
      solver: get('solver').value || 'sirt',
      dose,
      ctfMode: get('ctf-mode').value || 'none',
      defocusUm: Number(get('defocus').value) || 1.5,
      honestForward: get('honest-forward').checked,
      tvLambda: Number(get('tv-lambda').value) || 0.0035,
      weightMode: get('weight-mode').value || 'uniform',
      seed: Math.max(1, Number(get('seed').value) || 42),
      compareAllSolvers: true,
    };
  }

  // Render Pane 1: 3D Specimen + Slicing Slab + Parallel-Beam Tilt Fan & Missing Wedge
  function render3DStage() {
    const r = state.run;
    if (!r) return;
    const cvs = get('volume');
    const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    const cx = W * 0.5, cy = H * 0.52;
    const scale = W * 0.39;
    const z = r.config.z;

    const grad = ctx.createRadialGradient(cx, cy, 12, cx, cy, W * 0.65);
    grad.addColorStop(0, '#10333e');
    grad.addColorStop(1, '#06151b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const cyaw = Math.cos(state.yaw), syaw = Math.sin(state.yaw);
    const cpitch = Math.cos(state.pitch), spitch = Math.sin(state.pitch);

    function project3D(x, y, zp) {
      const u = x * cyaw - y * syaw;
      const v = x * syaw + y * cyaw;
      const sy = zp * cpitch - v * spitch;
      const depth = zp * spitch + v * cpitch;
      const persp = 4.2 / (4.2 - depth * 0.55);
      return [cx + scale * u * persp, cy - scale * sy * persp, depth];
    }

    function strokePoly(pts, color, width = 1.6, dash = []) {
      if (pts.length < 2) return;
      ctx.save();
      ctx.setLineDash(dash);
      ctx.beginPath();
      pts.forEach((p, idx) => {
        const [px, py] = project3D(p[0], p[1], p[2]);
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    }

    // Optional Parallel-Beam Tilt Fan & Missing-Wedge Overlay on slice plane z
    if (get('show-beams').checked) {
      const thetas = r.op.thetas;
      const ringR = 0.96;
      // Draw subtle detector ring in slice plane
      const ringPts = Array.from({ length: 49 }, (_, k) => {
        const a = (k * 2 * Math.PI) / 48;
        return [ringR * Math.cos(a), ringR * Math.sin(a), z];
      });
      strokePoly(ringPts, 'rgba(92, 225, 230, 0.22)', 1, [3, 3]);

      // Shade Missing-Wedge sector if spanDeg < 180
      if (r.config.spanDeg < 180) {
        const startA = r.op.spanRad;
        const endA = Math.PI;
        for (const sign of [1, -1]) {
          ctx.save();
          ctx.beginPath();
          const [ox, oy] = project3D(0, 0, z);
          ctx.moveTo(ox, oy);
          for (let s = 0; s <= 16; s++) {
            const a = startA + ((endA - startA) * s) / 16;
            const [px, py] = project3D(sign * ringR * Math.cos(a), sign * ringR * Math.sin(a), z);
            ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = state.cbMode ? 'rgba(213, 94, 0, 0.16)' : 'rgba(251, 113, 133, 0.16)';
          ctx.fill();
          ctx.restore();
        }
      }

      // Draw measured projection ray directions (up to 24 rays for visual clarity)
      const stride = Math.max(1, Math.ceil(thetas.length / 24));
      for (let a = 0; a < thetas.length; a += stride) {
        const th = thetas[a];
        // Ray perpendicular to detector direction (cos th, sin th) is (-sin th, cos th)
        const rx = -Math.sin(th) * ringR;
        const ry = Math.cos(th) * ringR;
        strokePoly([[-rx, -ry, z], [rx, ry, z]], 'rgba(92, 225, 230, 0.16)', 1);
      }

      if (state.hoverAngleIdx >= 0 && state.hoverAngleIdx < thetas.length) {
        const th = thetas[state.hoverAngleIdx];
        const rx = -Math.sin(th) * 1.02;
        const ry = Math.cos(th) * 1.02;
        strokePoly([[-rx, -ry, z], [rx, ry, z]], '#ffd166', 2.6);
      }
    }

    // Draw Translucent Cutting Slab at height z
    const slabCorners = [[-0.92, -0.92, z], [0.92, -0.92, z], [0.92, 0.92, z], [-0.92, 0.92, z], [-0.92, -0.92, z]];
    ctx.save();
    ctx.beginPath();
    slabCorners.forEach((p, i) => {
      const [px, py] = project3D(p[0], p[1], p[2]);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.fillStyle = 'rgba(245, 196, 81, 0.11)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(245, 196, 81, 0.72)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();

    const spec = r.specimen;
    const slabTol = Math.max(0.045, (2.5 / (spec.radius || 40)) * 1.35);

    if (spec.kind === 'alphafold' || spec.kind === 'pdb') {
      const chainPalette = state.cbMode
        ? ['#56b4e9', '#009e73', '#cc79a7', '#e69f00']
        : ['#5eead4', '#60a5fa', '#f472b6', '#a78bfa'];

      // Depth-sorted segments across all chains
      const segs = [];
      spec.chains.forEach((ch, cIdx) => {
        const baseCol = ch.type === 'rna' || ch.type === 'dna'
          ? (state.cbMode ? '#e69f00' : '#fb923c')
          : chainPalette[cIdx % chainPalette.length];
        for (let i = 1; i < ch.points.length; i++) {
          const a = ch.points[i - 1];
          const b = ch.points[i];
          // Skip chain breaks (> 0.35 normalized jump)
          if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 0.38) continue;
          const pa = project3D(a.x, a.y, a.z);
          const pb = project3D(b.x, b.y, b.z);
          const inSlab = Math.min(a.z, b.z) <= z + slabTol && Math.max(a.z, b.z) >= z - slabTol;
          let col = baseCol;
          if (r.config.weightMode === 'plddt' && typeof b.plddt === 'number') {
            col = plddtColor(b.plddt);
          }
          segs.push({
            pa,
            pb,
            depth: 0.5 * (pa[2] + pb[2]),
            inSlab,
            col,
          });
        }
      });

      segs.sort((a, b) => a.depth - b.depth);
      for (const s of segs) {
        ctx.beginPath();
        ctx.moveTo(s.pa[0], s.pa[1]);
        ctx.lineTo(s.pb[0], s.pb[1]);
        ctx.strokeStyle = s.inSlab ? '#ffd166' : s.col;
        ctx.lineWidth = s.inSlab ? 3.8 : 2.2;
        ctx.lineCap = 'round';
        ctx.stroke();
      }

      // Render ligands / heavy metal ions (Zn²⁺, Fe-Heme)
      for (const lig of spec.ligands || []) {
        const [lx, ly] = project3D(lig.x, lig.y, lig.z);
        const nearSlab = Math.abs(lig.z - z) <= slabTol * 1.3;
        const rad = lig.kind === 'ion' ? 5.2 : 2.6;
        ctx.beginPath();
        ctx.arc(lx, ly, rad, 0, 2 * Math.PI);
        ctx.fillStyle = nearSlab ? '#fde047' : (lig.kind === 'ion' ? '#38bdf8' : '#f87171');
        ctx.fill();
        if (lig.kind === 'ion') {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
    } else {
      // Render 3D wireframe ellipsoids for calibration / Shepp–Logan phantoms
      const shapes = spec.id === 'shepp_logan'
        ? [
            [[0, 0, 0], [0.69, 0.92, 0.88], '#4ecdc4'],
            [[0.22, 0, 0], [0.11, 0.31, 0.48], '#60a5fa'],
            [[-0.22, 0, 0], [0.16, 0.41, 0.48], '#60a5fa'],
            [[0, 0.35, -0.05], [0.21, 0.25, 0.45], '#f59e0b'],
          ]
        : [
            [[0, 0, 0], [0.84, 0.69, 0.78], '#3b7a78'],
            [[-0.22, 0.12, 0.04], [0.35, 0.32, 0.40], '#64bfa0'],
            [[0.29, -0.16, -0.16], [0.15, 0.22, 0.30], '#e09f67'],
            [[0.21, 0.32, 0.22], [0.11, 0.11, 0.16], '#c4b5fd'],
          ];
      for (const [c, rad, col] of shapes) {
        for (let m = 0; m < 10; m++) {
          const phi = (m * Math.PI) / 5;
          const pts = Array.from({ length: 29 }, (_, k) => {
            const t = (k * Math.PI) / 28;
            return [
              c[0] + rad[0] * Math.cos(phi) * Math.sin(t),
              c[1] + rad[1] * Math.sin(phi) * Math.sin(t),
              c[2] + rad[2] * Math.cos(t),
            ];
          });
          strokePoly(pts, col, 1.15);
        }
      }
    }

    // HUD corner label inside 3D canvas
    ctx.fillStyle = 'rgba(226, 245, 239, 0.86)';
    ctx.font = '600 11px monospace';
    const zAng = ((r.physWidth * 0.5) * z).toFixed(1);
    ctx.fillText(`z = ${z >= 0 ? '+' : ''}${z.toFixed(2)} (${zAng} Å)`, 10, 18);
    if (r.config.spanDeg < 180) {
      ctx.fillStyle = state.cbMode ? '#f59e0b' : '#fda4af';
      ctx.fillText(`Missing wedge: ${180 - r.config.spanDeg}°`, 10, H - 10);
    }
  }

  // Render 2D grid onto 256×256 canvas with crisp nearest/subpixel clarity + scanline + scale bar
  function renderSliceCanvas(canvasId, data, N, options = {}) {
    const cvs = get(canvasId);
    const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    const img = ctx.createImageData(W, H);
    const cmap = COLORMAPS[state.colormap] || COLORMAPS.cryo;
    const mode = options.mode || 'density'; // 'density' | 'diff'
    const diffScale = options.diffScale || 0.25;

    for (let py = 0; py < H; py++) {
      const gj = Math.min(N - 1, Math.floor((py * N) / H));
      for (let px = 0; px < W; px++) {
        const gi = Math.min(N - 1, Math.floor((px * N) / W));
        const val = data[gj * N + gi];
        const [r, g, b] = mode === 'diff' ? divergingRGB(val / diffScale) : cmap(val);
        const off = 4 * (py * W + px);
        img.data[off] = r;
        img.data[off + 1] = g;
        img.data[off + 2] = b;
        img.data[off + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Optional target iso-contour overlay (x_true = 0.28)
    if (options.contourSource) {
      const src = options.contourSource;
      const level = 0.28;
      ctx.save();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.5;
      const cell = W / N;
      ctx.beginPath();
      for (let j = 0; j < N - 1; j++) {
        for (let i = 0; i < N - 1; i++) {
          const v00 = src[j * N + i] >= level;
          const v10 = src[j * N + i + 1] >= level;
          const v01 = src[(j + 1) * N + i] >= level;
          if (v00 !== v10) {
            ctx.moveTo((i + 1) * cell, j * cell);
            ctx.lineTo((i + 1) * cell, (j + 1) * cell);
          }
          if (v00 !== v01) {
            ctx.moveTo(i * cell, (j + 1) * cell);
            ctx.lineTo((i + 1) * cell, (j + 1) * cell);
          }
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // Synchronized scanline y₀
    const scanRow = Number(get('scanline').value) || Math.floor(N / 2);
    const scanY = ((scanRow + 0.5) / N) * H;
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = mode === 'diff' ? '#e2e8f0' : '#ffd166';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, scanY);
    ctx.lineTo(W, scanY);
    ctx.stroke();
    ctx.restore();

    // Physical 20 Å scale bar on Ground-Truth pane
    if (options.physWidth) {
      const barAng = options.physWidth >= 60 ? 20 : 10;
      const barPx = Math.max(18, Math.min(W * 0.45, (barAng / options.physWidth) * W));
      ctx.save();
      ctx.fillStyle = 'rgba(6, 20, 26, 0.72)';
      ctx.fillRect(8, H - 26, barPx + 14, 19);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(15, H - 13, barPx, 3);
      ctx.font = '600 10px monospace';
      ctx.fillText(`${barAng} Å`, 15, H - 16);
      ctx.restore();
    }
  }

  // Render Pane 3: Radon Sinogram across full [0°, 180°) so Missing Wedge is directly visible!
  function renderSinogramCanvas() {
    const r = state.run;
    if (!r) return;
    const cvs = get('sino');
    const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    const img = ctx.createImageData(W, H);
    const cmap = COLORMAPS[state.colormap] || COLORMAPS.cryo;
    const { angles, B, spanDeg } = r.config;
    const sino = r.rawMeasured;

    let maxVal = 1e-6;
    for (let i = 0; i < sino.length; i++) if (sino[i] > maxVal) maxVal = sino[i];

    // Map X across full 180° angular span so missing wedge (spanDeg..180°) appears clearly!
    const measWidthPx = Math.max(16, Math.round((spanDeg / 180) * W));

    for (let py = 0; py < H; py++) {
      const b = Math.min(B - 1, Math.floor((py * B) / H));
      for (let px = 0; px < W; px++) {
        const off = 4 * (py * W + px);
        if (px < measWidthPx) {
          const a = Math.min(angles - 1, Math.floor((px * angles) / measWidthPx));
          const v = Math.max(0, sino[a * B + b]) / maxVal;
          const [cr, cg, cb] = cmap(v);
          img.data[off] = cr;
          img.data[off + 1] = cg;
          img.data[off + 2] = cb;
          img.data[off + 3] = 255;
        } else {
          // Diagonal hatch inside unmeasured missing-wedge zone
          const stripe = (px + py) % 10 < 2;
          img.data[off] = stripe ? 42 : 12;
          img.data[off + 1] = stripe ? 22 : 18;
          img.data[off + 2] = stripe ? 28 : 24;
          img.data[off + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    if (spanDeg < 180) {
      ctx.save();
      ctx.strokeStyle = state.cbMode ? '#e69f00' : '#fb7185';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(measWidthPx, 0);
      ctx.lineTo(measWidthPx, H);
      ctx.stroke();
      ctx.fillStyle = state.cbMode ? '#fde68a' : '#fecdd3';
      ctx.font = '700 10.5px monospace';
      ctx.save();
      ctx.translate(measWidthPx + Math.min(26, (W - measWidthPx) * 0.5), H * 0.5);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(`MISSING WEDGE (${180 - spanDeg}°)`, 0, 0);
      ctx.restore();
      ctx.restore();
    }

    if (state.hoverAngleIdx >= 0 && state.hoverAngleIdx < angles) {
      const hx = ((state.hoverAngleIdx + 0.5) / angles) * measWidthPx;
      ctx.save();
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(hx, 0);
      ctx.lineTo(hx, H);
      ctx.stroke();
      ctx.restore();
    }

    ctx.fillStyle = 'rgba(236, 250, 246, 0.86)';
    ctx.font = '600 10px monospace';
    ctx.fillText('0°', 6, H - 6);
    ctx.fillText(`${spanDeg}°`, Math.max(28, measWidthPx - 28), H - 6);
  }

  function updateKPIStrip() {
    const r = state.run;
    const m = r.metrics;
    const doseLabel = Number.isFinite(r.config.dose) ? `${r.config.dose} e⁻/Å²` : 'Noise-free ∞';
    const activeSolver = E.SOLVER_CATALOG.find(s => s.id === r.config.solver) || E.SOLVER_CATALOG[0];

    get('kpi-rmse').textContent = m.rmse.toFixed(4);
    get('kpi-rmse-sub').textContent = `MAE ${m.mae.toFixed(4)} · ${activeSolver.short}`;

    get('kpi-ssim').textContent = m.ssim.toFixed(3);
    get('kpi-ssim-sub').textContent = `Lin CCC ${m.ccc.toFixed(3)}`;

    get('kpi-psnr').textContent = `${m.psnr.toFixed(1)} dB`;
    get('kpi-psnr-sub').textContent = doseLabel;

    get('kpi-frc').textContent = `${m.frc0143.toFixed(1)} Å`;
    get('kpi-frc-sub').textContent = `Crowther ${m.crowtherRes.toFixed(1)} Å · Nyquist ${m.nyquistRes.toFixed(1)} Å`;

    get('kpi-sino').textContent = m.sinoResidual.toFixed(3);
    get('kpi-sino-sub').textContent = activeSolver.iterative
      ? `Min RMSE @ pass ${r.bestPass}/${r.config.passes}`
      : 'Direct 1-step inversion';

    const vEl = get('kpi-verdict');
    vEl.textContent = r.verdict.label;
    vEl.className = `tw-verdict ${r.verdict.tone}`;
    get('kpi-verdict-sub').textContent = `Wedge anisotropy ${m.anisotropyRatio.toFixed(2)}×`;

    const zAng = ((r.physWidth * 0.5) * r.config.z).toFixed(1);
    get('slice-out').textContent = `${r.config.z >= 0 ? '+' : ''}${r.config.z.toFixed(2)} (${zAng} Å)`;
    get('scanline-out').textContent = `Row ${get('scanline').value}/${r.config.N - 1}`;
    get('tv-lambda-out').textContent = r.config.tvLambda.toFixed(4);
    get('defocus-out').textContent = `${r.config.defocusUm.toFixed(1)} μm`;

    get('truth-tag').textContent = `${r.config.N} × ${r.config.N}`;
    get('sino-tag').textContent = `${r.config.angles} × ${r.config.B} (${r.config.spanDeg}°)`;
    get('recon-tag').textContent = activeSolver.short;
    get('metrics').textContent =
      `Slice z = ${r.config.z.toFixed(2)} · ${r.config.angles} tilts across ${r.config.spanDeg}° · ${activeSolver.short} · RMSE ${m.rmse.toFixed(4)} · FRC₀.₁₄₃ ${m.frc0143.toFixed(1)} Å`;
  }

  // Audience-calibrated scientific prose helper
  function audienceText(explorerHtml, studentHtml, researcherHtml) {
    if (state.audience === 'explorer') return explorerHtml;
    if (state.audience === 'researcher') return researcherHtml;
    return studentHtml;
  }

  // Plot coordinate mapper helper
  function createPlotFrame(svg, cfg) {
    svg.replaceChildren();
    const {
      W = 580, H = 310,
      padL = 58, padR = 22, padT = 22, padB = 44,
      xMin = 0, xMax = 1, yMin = 0, yMax = 1,
      xLabel = '', yLabel = '',
      xTicks = 5, yTicks = 5,
      xFmt = v => v.toFixed(2),
      yFmt = v => v.toFixed(2),
    } = cfg;
    const pw = W - padL - padR;
    const ph = H - padT - padB;
    const sx = v => padL + ((v - xMin) / Math.max(1e-12, xMax - xMin)) * pw;
    const sy = v => padT + ph - ((v - yMin) / Math.max(1e-12, yMax - yMin)) * ph;

    svgEl(svg, 'rect', { x: padL, y: padT, width: pw, height: ph, fill: '#ffffff', stroke: '#d6e3dc' });

    for (let i = 0; i <= yTicks; i++) {
      const val = yMin + ((yMax - yMin) * i) / yTicks;
      const py = sy(val);
      svgEl(svg, 'line', { x1: padL, x2: padL + pw, y1: py, y2: py, stroke: '#edf3ef' });
      svgEl(svg, 'text', { x: padL - 7, y: py + 4, 'text-anchor': 'end', fill: '#4a6358', 'font-size': 11 }, yFmt(val));
    }
    for (let i = 0; i <= xTicks; i++) {
      const val = xMin + ((xMax - xMin) * i) / xTicks;
      const px = sx(val);
      svgEl(svg, 'line', { x1: px, x2: px, y1: padT, y2: padT + ph, stroke: '#f1f6f3' });
      svgEl(svg, 'text', { x: px, y: padT + ph + 16, 'text-anchor': 'middle', fill: '#4a6358', 'font-size': 11 }, xFmt(val));
    }

    if (xLabel) {
      svgEl(svg, 'text', { x: padL + pw * 0.5, y: H - 7, 'text-anchor': 'middle', fill: '#1c3f35', 'font-size': 12, 'font-weight': 600 }, xLabel);
    }
    if (yLabel) {
      svgEl(svg, 'text', {
        x: 15, y: padT + ph * 0.5, 'text-anchor': 'middle', fill: '#1c3f35', 'font-size': 12, 'font-weight': 600,
        transform: `rotate(-90 15 ${padT + ph * 0.5})`,
      }, yLabel);
    }
    return { sx, sy, padL, padT, pw, ph, W, H };
  }

  function drawPolyline(svg, pts, color, width = 2.3, dash = '') {
    if (!pts.length) return;
    const attrs = {
      fill: 'none',
      stroke: color,
      'stroke-width': width,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      points: pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '),
    };
    if (dash) attrs['stroke-dasharray'] = dash;
    svgEl(svg, 'polyline', attrs);
  }

  // ==================== LEFT STAGE DIAGNOSTICS ====================
  function renderLeftStage() {
    const r = state.run;
    const svg = get('left-svg');
    const canvas = get('left-canvas');
    const titleEl = get('left-plot-title');
    const expEl = get('left-explain');

    if (state.leftTab === 'kspace') {
      svg.style.display = 'none';
      canvas.style.display = 'block';
      renderKSpaceCanvas(canvas, r, titleEl, expEl);
      return;
    }

    canvas.style.display = 'none';
    svg.style.display = 'block';

    if (state.leftTab === 'frc') {
      titleEl.textContent = 'Fourier Ring Correlation FRC(k) & Gold-Standard 0.143 Resolution';
      const shells = r.frc.shells;
      const fMax = Math.max(0.05, shells.at(-1)?.freqInvAng || 0.4);
      const frame = createPlotFrame(svg, {
        xMin: 0, xMax: fMax, yMin: -0.2, yMax: 1.05,
        xLabel: 'Spatial frequency k (Å⁻¹)',
        yLabel: 'Fourier Ring Correlation FRC(k)',
        xFmt: v => v.toFixed(2),
        yFmt: v => v.toFixed(1),
      });

      // Zero, 0.143 Gold-Standard, and 0.5 thresholds
      for (const [th, label, col] of [
        [0, '', '#cbd5e1'],
        [0.143, '0.143 Gold-Standard', '#b45309'],
        [0.5, '0.50 Criterion', '#64748b'],
      ]) {
        const py = frame.sy(th);
        svgEl(svg, 'line', { x1: frame.padL, x2: frame.padL + frame.pw, y1: py, y2: py, stroke: col, 'stroke-dasharray': th === 0 ? '' : '5,4' });
        if (label) {
          svgEl(svg, 'text', { x: frame.padL + frame.pw - 4, y: py - 4, 'text-anchor': 'end', fill: col, 'font-size': 10.5, 'font-weight': 600 }, label);
        }
      }

      // Crowther frequency marker k_Crowther = 1 / d_Crowther
      const kCrow = 1 / Math.max(1e-6, r.crowtherRes);
      if (kCrow <= fMax) {
        const cx = frame.sx(kCrow);
        svgEl(svg, 'line', { x1: cx, x2: cx, y1: frame.padT, y2: frame.padT + frame.ph, stroke: '#7c3aed', 'stroke-dasharray': '3,3' });
        svgEl(svg, 'text', { x: Math.min(frame.padL + frame.pw - 95, cx + 4), y: frame.padT + frame.ph - 8, fill: '#6d28d9', 'font-size': 10, 'font-weight': 600 }, `Crowther (${r.crowtherRes.toFixed(1)} Å)`);
      }

      // Half-bit significance threshold curve
      drawPolyline(svg, shells.map(s => [frame.sx(s.freqInvAng), frame.sy(s.halfBit)]), '#94a3b8', 1.4, '2,3');

      // Overlay comparison FRC curves: FBP, SIRT, CS-TV + Active solver in clean 2x2 legend
      const compareIds = [...new Set(['fbp_ramlak', 'sirt', 'tv_fista', r.config.solver])];
      const legX0 = frame.padL + frame.pw - 266;
      svgEl(svg, 'rect', { x: legX0 - 6, y: frame.padT + 4, width: 268, height: compareIds.length > 2 ? 34 : 20, rx: 5, fill: 'rgba(255,255,255,0.88)', stroke: '#e2ece6' });
      compareIds.forEach((sid, idx) => {
        const row = r.leaderboard.find(item => item.id === sid);
        if (!row) return;
        const dftM = sid === r.config.solver ? r.dftHat : E.dft2dReal(row.estimate, r.config.N);
        const frcM = sid === r.config.solver ? r.frc : E.computeFRCFromDFTs(r.dftTrue, dftM, r.config.N, r.physWidth);
        const isPrimary = sid === r.config.solver;
        const col = solverColor(row);
        drawPolyline(
          svg,
          frcM.shells.map(s => [frame.sx(s.freqInvAng), frame.sy(s.frc)]),
          col,
          isPrimary ? 3.0 : 1.6,
          isPrimary ? '' : '4,3'
        );
        const colIdx = idx % 2;
        const rowIdx = Math.floor(idx / 2);
        svgEl(svg, 'text', {
          x: legX0 + colIdx * 134,
          y: frame.padT + 16 + rowIdx * 14,
          fill: col,
          'font-size': 10,
          'font-weight': isPrimary ? 700 : 600,
        }, `${isPrimary ? '● ' : '╌ '}${row.short} (${frcM.res0143.toFixed(1)} Å)`);
      });

      expEl.innerHTML = audienceText(
        `<strong>Plain-language reading:</strong> Higher curves mean finer structural details survive reconstruction. Your active solver resolves features down to <strong>${r.metrics.frc0143.toFixed(1)} Å</strong> before correlation drops below the cryo-EM <code>0.143</code> clarity line.`,
        `<strong>Fourier Ring Correlation Analysis:</strong> Comparing concentric spatial-frequency rings between <em>x̂</em> and <em>x</em> yields <strong>d₀.₁₄₃ = ${r.metrics.frc0143.toFixed(1)} Å</strong> (d₀.₅₀ = ${r.metrics.frc050.toFixed(1)} Å), versus the angular Crowther sampling limit <em>πD/Nθ</em> = <strong>${r.crowtherRes.toFixed(1)} Å</strong>.`,
        `<strong>Cryo-EM Spectral Fidelity (Rosenthal &amp; Henderson 2003):</strong> Shell correlation FRC(k) crosses <code>0.143</code> at k = ${(1 / r.metrics.frc0143).toFixed(3)} Å⁻¹ (<strong>${r.metrics.frc0143.toFixed(2)} Å</strong>; Nyquist 2Δx = ${r.metrics.nyquistRes.toFixed(2)} Å). Dotted gray shows the van Heel ½-bit information threshold; dashed comparison traces contrast analytical ramp amplification vs. variational TV regularization.`
      );
      return;
    }

    if (state.leftTab === 'profile') {
      const N = r.config.N;
      const rowIdx = Math.min(N - 1, Math.max(0, Number(get('scanline').value) || Math.floor(N / 2)));
      const halfAng = r.physWidth * 0.5;
      titleEl.textContent = `1D Cross-Section Scanline Profile (Row y₀ = ${rowIdx}/${N - 1})`;

      const xs = Array.from({ length: N }, (_, i) => -halfAng + ((i + 0.5) / N) * r.physWidth);
      const trueRow = Array.from({ length: N }, (_, i) => r.target[rowIdx * N + i]);
      const hatRow = Array.from({ length: N }, (_, i) => r.estimate[rowIdx * N + i]);
      const fbpEntry = r.leaderboard.find(s => s.id === 'fbp_ramlak');
      const fbpRow = fbpEntry ? Array.from({ length: N }, (_, i) => fbpEntry.estimate[rowIdx * N + i]) : null;

      const yLow = Math.min(-0.08, ...hatRow, ...(fbpRow || [0]));
      const yHigh = Math.max(1.05, ...trueRow, ...hatRow);

      const frame = createPlotFrame(svg, {
        xMin: -halfAng, xMax: halfAng, yMin: yLow, yMax: yHigh,
        xLabel: 'Lateral slice coordinate u (Å)',
        yLabel: 'Normalized electron density',
        xFmt: v => `${v.toFixed(0)}`,
        yFmt: v => v.toFixed(2),
      });

      const zeroY = frame.sy(0);
      svgEl(svg, 'line', { x1: frame.padL, x2: frame.padL + frame.pw, y1: zeroY, y2: zeroY, stroke: '#cbd5e1' });

      // Shaded discrepancy polygon between True and Active Estimate
      const polyPts = [
        ...xs.map((x, i) => `${frame.sx(x).toFixed(1)},${frame.sy(trueRow[i]).toFixed(1)}`),
        ...xs.slice().reverse().map((x, idx) => {
          const i = N - 1 - idx;
          return `${frame.sx(x).toFixed(1)},${frame.sy(hatRow[i]).toFixed(1)}`;
        }),
      ].join(' ');
      svgEl(svg, 'polygon', { points: polyPts, fill: 'rgba(184, 86, 39, 0.14)' });

      if (fbpRow && r.config.solver !== 'fbp_ramlak') {
        drawPolyline(svg, xs.map((x, i) => [frame.sx(x), frame.sy(fbpRow[i])]), '#94a3b8', 1.5, '4,3');
      }
      drawPolyline(svg, xs.map((x, i) => [frame.sx(x), frame.sy(trueRow[i])]), '#0b7a5c', 2.6);
      drawPolyline(svg, xs.map((x, i) => [frame.sx(x), frame.sy(hatRow[i])]), '#b85627', 2.4);

      svgEl(svg, 'text', { x: frame.padL + 10, y: frame.padT + 16, fill: '#0b7a5c', 'font-size': 11, 'font-weight': 700 }, '● True slice x(u, y₀)');
      svgEl(svg, 'text', { x: frame.padL + 165, y: frame.padT + 16, fill: '#b85627', 'font-size': 11, 'font-weight': 700 }, `● ${r.config.solver.toUpperCase()} x̂(u, y₀)`);
      if (fbpRow && r.config.solver !== 'fbp_ramlak') {
        svgEl(svg, 'text', { x: frame.padL + 340, y: frame.padT + 16, fill: '#64748b', 'font-size': 11, 'font-weight': 600 }, '╌ FBP reference');
      }

      const rowRmse = Math.sqrt(trueRow.reduce((s, v, i) => s + (v - hatRow[i]) ** 2, 0) / N);
      expEl.innerHTML = audienceText(
        `<strong>Cross-section check:</strong> Green shows the true slice brightness along the dashed horizontal line; orange shows the reconstructed density (line error <strong>${rowRmse.toFixed(4)}</strong>). Click anywhere on the slice image above to inspect another row!`,
        `<strong>1D Scanline Fidelity:</strong> Along row <code>y₀ = ${rowIdx}</code>, scanline RMSE is <strong>${rowRmse.toFixed(4)}</strong>. Compare peak sharpness, internal cavity dips (e.g., globin pockets or β-barrels), and whether FBP exhibits negative streak undershoots below zero.`,
        `<strong>Point-Spread &amp; Edge Response:</strong> Shaded area quantifies local integral discrepancy ∫|x̂ − x|du along y₀. Positivity-constrained solvers (<code>SIRT</code>, <code>SART</code>, <code>MLEM</code>, <code>CS-TV</code>) eliminate non-physical negative ramp lobes while <code>CS-TV</code> preserves step discontinuities without Gibbs ringing.`
      );
      return;
    }

    if (state.leftTab === 'loto') {
      titleEl.textContent = 'Reference-Free Leave-One-Tilt-Out Cross-Validation (Cardone et al. 2005)';
      const key = `${r.config.specimenId}|${r.config.z}|${r.config.N}|${r.config.angles}|${r.config.spanDeg}|${r.config.solver}|${r.config.passes}|${r.config.dose}|${r.config.ctfMode}|${r.config.tvLambda}|${r.config.seed}`;
      if (state.lotoCacheKey !== key) {
        state.lotoData = E.computeLeaveOneTiltOut(
          r.config.N, r.config.B, r.config.angles, r.config.spanDeg,
          r.reconInput, r.config.solver, r.config.passes, r.config.tvLambda, r.physWidth
        );
        state.lotoCacheKey = key;
      }
      const loto = state.lotoData;
      const B = r.config.B;
      const yMax = Math.max(1, ...loto.measView, ...loto.predView) * 1.08;
      const yMin = Math.min(0, ...loto.measView, ...loto.predView);

      const frame = createPlotFrame(svg, {
        xMin: 0, xMax: B - 1, yMin, yMax,
        xLabel: `Detector bin s at omitted tilt θ* = ${loto.heldAngleDeg.toFixed(1)}°`,
        yLabel: 'Ray-integrated projection y(θ*, s)',
        xFmt: v => v.toFixed(0),
        yFmt: v => v.toFixed(1),
      });

      drawPolyline(svg, Array.from({ length: B }, (_, b) => [frame.sx(b), frame.sy(loto.measView[b])]), '#0b7a5c', 2.5);
      drawPolyline(svg, Array.from({ length: B }, (_, b) => [frame.sx(b), frame.sy(loto.predView[b])]), '#b85627', 2.3, '5,3');

      svgEl(svg, 'text', { x: frame.padL + 10, y: frame.padT + 16, fill: '#0b7a5c', 'font-size': 11, 'font-weight': 700 }, `● Held-out measured view (θ* = ${loto.heldAngleDeg.toFixed(1)}°)`);
      svgEl(svg, 'text', { x: frame.padL + 265, y: frame.padT + 16, fill: '#b85627', 'font-size': 11, 'font-weight': 700 }, `╌ Reprojected x̂₋₁ (RMSE ${loto.projRmse.toFixed(3)})`);

      expEl.innerHTML = audienceText(
        `<strong>How do scientists test real tomograms without knowing the true answer?</strong> We hide one camera angle (<strong>${loto.heldAngleDeg.toFixed(1)}°</strong>), rebuild the slice from the remaining ${r.config.angles - 1} angles, and check if the model accurately predicts the hidden view (error <strong>${loto.projRmse.toFixed(3)}</strong>).`,
        `<strong>Leave-One-Tilt-Out Validation:</strong> Reconstructing from <code>${r.config.angles - 1}</code> tilts and forward-projecting onto omitted angle <strong>θ* = ${loto.heldAngleDeg.toFixed(1)}°</strong> gives held-out projection RMSE <strong>${loto.projRmse.toFixed(3)}</strong>—providing an honest, ground-truth-free check against overfitting.`,
        `<strong>Cryo-ET Cross-Validation (Cardone et al. 2005):</strong> Unlike training-set sinogram residual ‖Ax̂ − y‖ (which monotonically shrinks even when fitting shot noise), leave-one-tilt-out reprojection error (<strong>${loto.projRmse.toFixed(4)}</strong>) rises when angular spacing violates Crowther sampling or when high pass counts overfit detector noise.`
      );
      return;
    }

    // Left Tab 5: Cryo-EM Contrast Transfer Function CTF(k)
    titleEl.textContent = `300 kV Cryo-EM Contrast Transfer Function CTF(k) · Δz = ${r.config.defocusUm.toFixed(1)} μm`;
    const kMax = 0.45;
    const nPts = 180;
    const ks = Array.from({ length: nPts }, (_, i) => (i * kMax) / (nPts - 1));
    const rawCtf = ks.map(k => E.evalCryoCTF(k, r.config.defocusUm, 45));
    const flipCtf = rawCtf.map(v => Math.abs(v));
    const envCurve = ks.map(k => Math.exp(-0.25 * 45 * k * k));

    const frame = createPlotFrame(svg, {
      xMin: 0, xMax: kMax, yMin: -1.05, yMax: 1.05,
      xLabel: 'Spatial frequency k (Å⁻¹)',
      yLabel: 'Contrast Transfer Amplitude CTF(k)',
      xFmt: v => v.toFixed(2),
      yFmt: v => v.toFixed(1),
    });

    const zeroY = frame.sy(0);
    svgEl(svg, 'line', { x1: frame.padL, x2: frame.padL + frame.pw, y1: zeroY, y2: zeroY, stroke: '#94a3b8' });
    // Nyquist frequency of current specimen grid
    const kNyq = 1 / Math.max(1e-6, r.metrics.nyquistRes);
    if (kNyq < kMax) {
      const nx = frame.sx(kNyq);
      svgEl(svg, 'line', { x1: nx, x2: nx, y1: frame.padT, y2: frame.padT + frame.ph, stroke: '#7c3aed', 'stroke-dasharray': '3,3' });
      svgEl(svg, 'text', { x: nx + 4, y: frame.padT + frame.ph - 8, fill: '#6d28d9', 'font-size': 10.5, 'font-weight': 600 }, `Grid Nyquist (${r.metrics.nyquistRes.toFixed(1)} Å)`);
    }

    drawPolyline(svg, ks.map((k, i) => [frame.sx(k), frame.sy(envCurve[i])]), '#94a3b8', 1.4, '3,3');
    drawPolyline(svg, ks.map((k, i) => [frame.sx(k), frame.sy(flipCtf[i])]), '#2563eb', 1.8, '5,3');
    drawPolyline(svg, ks.map((k, i) => [frame.sx(k), frame.sy(rawCtf[i])]), '#be123c', 2.4);

    svgEl(svg, 'text', { x: frame.padL + 10, y: frame.padT + 15, fill: '#be123c', 'font-size': 11, 'font-weight': 700 }, '● Raw Weak-Phase CTF(k)');
    svgEl(svg, 'text', { x: frame.padL + 195, y: frame.padT + 15, fill: '#2563eb', 'font-size': 11, 'font-weight': 700 }, '╌ Phase-Flipped |CTF(k)|');
    svgEl(svg, 'text', { x: frame.padL + 380, y: frame.padT + 15, fill: '#64748b', 'font-size': 11, 'font-weight': 600 }, '⋯ B-factor envelope');

    // First zero crossing resolution
    let firstZeroK = kMax;
    for (let i = 2; i < nPts; i++) {
      if (rawCtf[i] <= 0 && rawCtf[i - 1] > 0) {
        firstZeroK = ks[i];
        break;
      }
    }
    expEl.innerHTML = audienceText(
      `<strong>Microscope lens physics:</strong> Electron microscopes must slightly defocus (<strong>Δz = ${r.config.defocusUm.toFixed(1)} μm</strong>) to make transparent proteins visible, causing contrast waves that flip negative beyond <strong>${(1 / firstZeroK).toFixed(1)} Å</strong> unless corrected by Phase-Flipping.`,
      `<strong>Thon Oscillations &amp; Phase Reversal:</strong> At 300 kV (λ = 0.0197 Å, Cₛ = 2.7 mm) and Δz = <strong>${r.config.defocusUm.toFixed(1)} μm</strong>, the first CTF zero crossing occurs at k = <strong>${firstZeroK.toFixed(3)} Å⁻¹ (${(1 / firstZeroK).toFixed(1)} Å)</strong>. Switching CTF mode to <em>Phase-Flip restoration</em> rectifies inverted negative lobes.`,
      `<strong>Weak-Phase Transfer &amp; Zero-Crossing Nulls:</strong> CTF(k) = [wₐ cos χ(k) + √(1−wₐ²) sin χ(k)] e^(−Bk²/4) with wₐ = 0.10. Phase-flipping restores sign(CTF) across Thon rings but cannot recover information exactly at zero crossings—motivating multi-defocus tilt-series acquisition in RELION/CryoSPARC.`
    );
  }

  // Left Tab 2: Side-by-side 2D Fourier K-Space Spectrum & Missing Wedge on #left-canvas
  function renderKSpaceCanvas(canvas, r, titleEl, expEl) {
    titleEl.textContent = '2D Fourier K-Space Log-Power Spectrum & Central-Slice Missing Wedge';
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#07171d';
    ctx.fillRect(0, 0, W, H);

    const N = r.config.N;
    const cmap = COLORMAPS[state.colormap] || COLORMAPS.cryo;
    const boxSize = 236;
    const panels = [
      { data: r.kSpaceTrue, x0: 36, y0: 38, title: 'Ground-Truth 2D FFT log(1+|X(k)|)' },
      { data: r.kSpaceHat, x0: 308, y0: 38, title: `Reconstructed FFT (${r.config.solver.toUpperCase()} · ${r.config.spanDeg}°)` },
    ];

    for (const pan of panels) {
      const img = ctx.createImageData(boxSize, boxSize);
      for (let py = 0; py < boxSize; py++) {
        const gj = Math.min(N - 1, Math.floor((py * N) / boxSize));
        for (let px = 0; px < boxSize; px++) {
          const gi = Math.min(N - 1, Math.floor((px * N) / boxSize));
          const [cr, cg, cb] = cmap(pan.data[gj * N + gi]);
          const off = 4 * (py * boxSize + px);
          img.data[off] = cr;
          img.data[off + 1] = cg;
          img.data[off + 2] = cb;
          img.data[off + 3] = 255;
        }
      }
      ctx.putImageData(img, pan.x0, pan.y0);
      ctx.strokeStyle = '#2d5c68';
      ctx.lineWidth = 1.2;
      ctx.strokeRect(pan.x0, pan.y0, boxSize, boxSize);

      const cx = pan.x0 + boxSize * 0.5;
      const cy = pan.y0 + boxSize * 0.5;
      // Crowther frequency circle radius in k-space pixels: r_Crowther = N * (physWidth / crowtherRes) / N = angles / π
      const rCrowPx = Math.min(boxSize * 0.48, ((r.config.angles / Math.PI) / (N * 0.5)) * (boxSize * 0.5));
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(cx, cy, rCrowPx, 0, 2 * Math.PI);
      ctx.stroke();

      // Overlay Missing-Wedge boundary lines on Reconstructed FFT if spanDeg < 180
      if (pan.data === r.kSpaceHat && r.config.spanDeg < 180) {
        const spanRad = r.op.spanRad;
        ctx.strokeStyle = state.cbMode ? '#f59e0b' : '#fb7185';
        ctx.lineWidth = 1.6;
        for (const a of [spanRad, Math.PI]) {
          const R = boxSize * 0.48;
          ctx.beginPath();
          ctx.moveTo(cx - R * Math.cos(a), cy - R * Math.sin(a));
          ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
          ctx.stroke();
        }
      }
      ctx.restore();

      ctx.fillStyle = '#e2f3ee';
      ctx.font = '600 11.5px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pan.title, pan.x0 + boxSize * 0.5, 25);
    }

    ctx.fillStyle = '#a7ccc4';
    ctx.font = '600 10.5px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      `Gold ring: Crowther limit (d ≥ ${r.crowtherRes.toFixed(1)} Å)` +
      (r.config.spanDeg < 180 ? ` · Rose lines: ${180 - r.config.spanDeg}° Missing Wedge` : ' · Full 180° Fourier coverage'),
      W * 0.5,
      H - 12
    );
    ctx.textAlign = 'left';

    expEl.innerHTML = audienceText(
      `<strong>Fourier Central-Slice Theorem in action:</strong> Each camera angle fills one straight spoke through the center of frequency space. At ${r.config.angles} angles over ${r.config.spanDeg}°, notice the star-like spokes—and when tilt is restricted below 180°, an entire dark <strong>missing wedge</strong> goes unmeasured!`,
      `<strong>2D K-Space &amp; Crowther Criterion:</strong> Spokes remain densely packed inside the dashed gold Crowther circle (<strong>d ≥ ${r.crowtherRes.toFixed(1)} Å</strong>) and separate outside it, creating real-space streak artifacts in <code>FBP</code> while <code>CS-TV</code> inpaints dark wedge frequencies via sparse-gradient priors.`,
      `<strong>Bracewell Projection-Slice Theorem:</strong> ℱ₁{pθ}(ν) populates radial line (ν cos θ, ν sin θ) in 2D k-space. Under a ${r.config.spanDeg}° tilt span, the (${180 - r.config.spanDeg}°) missing cone causes anisotropic PSF elongation (${r.metrics.anisotropyRatio.toFixed(2)}× Fourier error ratio) orthogonal to unmeasured tilts.`
    );
  }

  // ==================== RIGHT STAGE DIAGNOSTICS ====================
  function renderRightStage() {
    const r = state.run;
    const svg = get('right-svg');
    const titleEl = get('right-plot-title');
    const expEl = get('right-explain');

    if (state.rightTab === 'conv') {
      titleEl.textContent = 'Pass-by-Pass Convergence & Morozov Semi-Convergence Audit';
      const K = Math.max(1, r.rmseHistory.length - 1);
      const yMax = Math.max(0.05, ...r.rmseHistory) * 1.08;
      const frame = createPlotFrame(svg, {
        xMin: 0, xMax: K, yMin: 0, yMax,
        xLabel: 'Solver iteration / pass k',
        yLabel: 'Density & Sinogram RMSE',
        xFmt: v => v.toFixed(0),
        yFmt: v => v.toFixed(3),
      });

      const sinoScale = r.sinoRmseHistory[0] > 1e-9 ? (r.rmseHistory[0] / r.sinoRmseHistory[0]) : 1;
      const scaledSino = r.sinoRmseHistory.map((v, i) => [frame.sx(i), frame.sy(Math.min(yMax, v * sinoScale))]);
      const slicePts = r.rmseHistory.map((v, i) => [frame.sx(i), frame.sy(v)]);

      drawPolyline(svg, scaledSino, '#64748b', 1.8, '5,4');
      drawPolyline(svg, slicePts, '#0b7a5c', 2.8);

      // Mark optimal pass k*
      const bx = frame.sx(r.bestPass);
      const by = frame.sy(r.bestRmse);
      svgEl(svg, 'circle', { cx: bx, cy: by, r: 5, fill: '#b85627', stroke: '#ffffff', 'stroke-width': 1.5 });
      svgEl(svg, 'text', {
        x: Math.min(frame.padL + frame.pw - 132, bx + 8),
        y: Math.max(frame.padT + 28, by - 8),
        fill: '#b85627', 'font-size': 11, 'font-weight': 700,
      }, `Best k* = ${r.bestPass} (${r.bestRmse.toFixed(4)})`);

      svgEl(svg, 'text', { x: frame.padL + 10, y: frame.padT + 15, fill: '#0b7a5c', 'font-size': 11, 'font-weight': 700 }, '● True-slice RMSE(x⁽ᵏ⁾, x)');
      svgEl(svg, 'text', { x: frame.padL + 195, y: frame.padT + 15, fill: '#64748b', 'font-size': 11, 'font-weight': 600 }, '╌ Scaled sinogram ‖Ax⁽ᵏ⁾ − y‖');

      // Also keep legacy hidden #curve populated cleanly
      const legacyMax = Math.max(0.001, r.rmseHistory[0]);
      const legacyPts = r.rmseHistory.map((v, i) => `${60 + (510 * i) / K},${95 - (75 * v) / legacyMax}`).join(' ');
      get('curve').innerHTML = `<polyline fill="none" stroke="#167356" stroke-width="3" points="${legacyPts}"/>`;

      const semiConv = r.metrics.rmse > r.bestRmse * 1.06;
      expEl.innerHTML = audienceText(
        `<strong>Watching the image sharpen pass by pass:</strong> Error drops from <strong>${r.rmseHistory[0].toFixed(3)}</strong> to <strong>${r.metrics.rmse.toFixed(4)}</strong>${semiConv ? `, though noisy data caused error to creep back up after pass <strong>${r.bestPass}</strong>!` : '.'}`,
        `<strong>Convergence vs. Semi-Convergence:</strong> Sinogram discrepancy (dashed) always decreases with more passes, whereas true-slice RMSE reaches its minimum <strong>${r.bestRmse.toFixed(4)}</strong> at pass <strong>k* = ${r.bestPass}</strong>${semiConv ? ' before overfitting low-dose shot noise (classic ill-posed semi-convergence).' : '.'}`,
        `<strong>Morozov Discrepancy Principle:</strong> Iterative Landweber/EM methods act as spectral low-pass filters at early k, then invert small singular values σᵢ of A at large k, amplifying noise variance σ²/σᵢ². Stopping near k* = ${r.bestPass} or adding Total Variation regularization stabilizes high-k iterations.`
      );
      return;
    }

    if (state.rightTab === 'pareto') {
      titleEl.textContent = '6-Solver Accuracy vs. Resolution Pareto Frontier';
      const rows = r.leaderboard;
      const xs = rows.map(s => s.frc0143);
      const ys = rows.map(s => s.rmse);
      const xMin = Math.max(0, Math.min(...xs) * 0.85);
      const xMax = Math.max(...xs) * 1.12 + 0.5;
      const yMax = Math.max(...ys) * 1.16 + 0.005;

      const frame = createPlotFrame(svg, {
        xMin, xMax, yMin: 0, yMax,
        xLabel: 'Gold-Standard FRC₀.₁₄₃ Resolution (Å · left is sharper)',
        yLabel: 'Slice Density RMSE ↓',
        xFmt: v => `${v.toFixed(1)}`,
        yFmt: v => v.toFixed(3),
      });

      // Ideal bottom-left corner callout
      svgEl(svg, 'text', { x: frame.padL + 8, y: frame.padT + frame.ph - 8, fill: '#15803d', 'font-size': 10.5, 'font-weight': 700 }, '↙ Pareto-optimal corner (low RMSE + fine Å)');

      const placed = rows.map(row => {
        const px = frame.sx(row.frc0143);
        const py = frame.sy(row.rmse);
        const rad = 5 + Math.max(0, row.ssim) * 5.2;
        return { row, px, py, rad, labelY: py + 4 };
      }).sort((a, b) => a.py - b.py);

      // De-overlap vertical label positions
      for (let i = 1; i < placed.length; i++) {
        if (Math.abs(placed[i].px - placed[i - 1].px) < 75 && placed[i].labelY - placed[i - 1].labelY < 13) {
          placed[i].labelY = placed[i - 1].labelY + 13;
        }
      }

      placed.forEach(({ row, px, py, rad, labelY }) => {
        const isCurrent = row.id === r.config.solver;
        const col = solverColor(row);
        svgEl(svg, 'circle', {
          cx: px, cy: py, r: rad,
          fill: col, 'fill-opacity': isCurrent ? 0.92 : 0.68,
          stroke: isCurrent ? '#0f172a' : '#ffffff',
          'stroke-width': isCurrent ? 2.2 : 1.2,
        });
        svgEl(svg, 'text', {
          x: Math.min(frame.padL + frame.pw - 86, px + rad + 5),
          y: Math.min(frame.padT + frame.ph - 18, labelY),
          fill: '#12312a',
          'font-size': 10.5,
          'font-weight': isCurrent ? 700 : 600,
        }, row.short);
      });

      const bestRmseRow = rows.reduce((a, b) => (a.rmse < b.rmse ? a : b));
      const bestResRow = rows.reduce((a, b) => (a.frc0143 < b.frc0143 ? a : b));
      expEl.innerHTML = audienceText(
        `<strong>Comparing all 6 algorithms at once:</strong> Models closer to the bottom-left achieve both lower error and sharper resolution. Currently <strong>${bestRmseRow.short}</strong> leads on overall accuracy (RMSE <strong>${bestRmseRow.rmse.toFixed(4)}</strong>).`,
        `<strong>Multi-Solver Trade-off:</strong> On this slice, <strong>${bestRmseRow.short}</strong> achieves the lowest pixel RMSE (<strong>${bestRmseRow.rmse.toFixed(4)}</strong>, SSIM ${bestRmseRow.ssim.toFixed(3)}) while <strong>${bestResRow.short}</strong> reaches the finest FRC₀.₁₄₃ cutoff (<strong>${bestResRow.frc0143.toFixed(1)} Å</strong>). Bubble size encodes SSIM.`,
        `<strong>Bias–Variance &amp; Prior Trade-off:</strong> Unapodized <code>FBP (Ram-Lak)</code> maximizes high-frequency gain at dense 180° views, whereas positivity + gradient-sparsity priors in <code>SART</code>, <code>MLEM</code>, and <code>CS-TV</code> dominate the Pareto frontier under sparse tilts or low-dose shot noise.`
      );
      return;
    }

    if (state.rightTab === 'lcurve') {
      titleEl.textContent = 'Hansen Regularization L-Curve (Total Variation ‖∇x̂‖₂,₁ vs. ‖Ax̂ − y‖₂)';
      const key = `${r.config.specimenId}|${r.config.z}|${r.config.N}|${r.config.angles}|${r.config.spanDeg}|${r.config.passes}|${r.config.dose}|${r.config.ctfMode}|${r.config.honestForward}|${r.config.seed}`;
      if (state.lcurveCacheKey !== key) {
        state.lcurveData = E.computeTVLCurve(r.op, r.reconInput, r.target, r.config.passes);
        state.lcurveCacheKey = key;
      }
      const lc = state.lcurveData;
      const pts = lc.points;
      const xVals = pts.map(p => p.logData);
      const yVals = pts.map(p => p.logTV);
      const padX = Math.max(0.08, (Math.max(...xVals) - Math.min(...xVals)) * 0.14);
      const padY = Math.max(0.08, (Math.max(...yVals) - Math.min(...yVals)) * 0.14);

      const frame = createPlotFrame(svg, {
        xMin: Math.min(...xVals) - padX,
        xMax: Math.max(...xVals) + padX,
        yMin: Math.min(...yVals) - padY,
        yMax: Math.max(...yVals) + padY,
        xLabel: 'log₁₀ Data Residual Norm log₁₀‖Ax̂λ − y‖₂',
        yLabel: 'log₁₀ Isotropic TV Norm log₁₀‖∇x̂λ‖₂,₁',
        xFmt: v => v.toFixed(2),
        yFmt: v => v.toFixed(2),
      });

      drawPolyline(svg, pts.map(p => [frame.sx(p.logData), frame.sy(p.logTV)]), '#be123c', 2.4);

      pts.forEach((p, idx) => {
        const px = frame.sx(p.logData);
        const py = frame.sy(p.logTV);
        const isCorner = idx === lc.cornerIndex;
        const g = svgEl(svg, 'g', { style: 'cursor:pointer' });
        svgEl(g, 'circle', {
          cx: px, cy: py,
          r: isCorner ? 6.5 : 4.2,
          fill: isCorner ? '#d97706' : '#be123c',
          stroke: '#ffffff',
          'stroke-width': 1.5,
        });
        svgEl(g, 'text', {
          x: Math.min(frame.padL + frame.pw - 52, px + 7),
          y: py - 5,
          fill: isCorner ? '#b45309' : '#334155',
          'font-size': 10,
          'font-weight': isCorner ? 700 : 500,
        }, isCorner ? `★ λ*=${p.lambda}` : `λ=${p.lambda}`);
        g.addEventListener('click', () => {
          get('solver').value = 'tv_fista';
          get('tv-lambda').value = String(p.lambda);
          run();
        });
      });

      const cornerPt = pts[lc.cornerIndex];
      expEl.innerHTML = audienceText(
        `<strong>Balancing smoothness vs. sharpness:</strong> Too little regularization leaves noisy streaks (top-left); too much blurs small details into flat blocks (bottom-right). Click the gold star (<strong>λ* = ${cornerPt.lambda}</strong>) to apply the sweet-spot setting!`,
        `<strong>Regularization L-Curve (Hansen 1992):</strong> Sweeping <code>λ_TV</code> from 0.0005 to 0.085 identifies maximum log–log curvature at <strong>λ* = ${cornerPt.lambda}</strong> (slice RMSE <strong>${cornerPt.sliceRmse.toFixed(4)}</strong>). Click any point on the curve to test that λ in CS-TV.`,
        `<strong>Variational Pareto Corner:</strong> Plotting log₁₀‖∇x̂λ‖₂,₁ against log₁₀‖Ax̂λ − y‖₂ separates the noise/streak-dominated vertical branch (small λ) from the over-regularized staircasing horizontal branch (large λ) without requiring oracle ground truth.`
      );
      return;
    }

    if (state.rightTab === 'parity') {
      titleEl.textContent = `Pixelwise Density Parity & Concordance (Lin CCC = ${r.metrics.ccc.toFixed(3)})`;
      const N = r.config.N;
      const step = N > 64 ? 3 : 2;
      const maxV = Math.max(1.02, ...r.estimate);
      const minV = Math.min(-0.05, ...r.estimate);

      const frame = createPlotFrame(svg, {
        xMin: 0, xMax: 1.02, yMin: minV, yMax: maxV,
        xLabel: 'Ground-truth pixel density xᵢ',
        yLabel: 'Reconstructed pixel density x̂ᵢ',
        xFmt: v => v.toFixed(2),
        yFmt: v => v.toFixed(2),
      });

      // Identity line y = x
      drawPolyline(svg, [[frame.sx(0), frame.sy(0)], [frame.sx(1), frame.sy(1)]], '#0b7a5c', 1.8, '5,4');

      for (let j = 0; j < N; j += step) {
        for (let i = 0; i < N; i += step) {
          const idx = j * N + i;
          const tx = r.target[idx];
          const hy = r.estimate[idx];
          if (tx < 0.005 && Math.abs(hy) < 0.01 && (i + j) % 4 !== 0) continue;
          svgEl(svg, 'circle', {
            cx: frame.sx(tx),
            cy: frame.sy(hy),
            r: 2.3,
            fill: '#2563eb',
            'fill-opacity': 0.42,
          });
        }
      }

      svgEl(svg, 'text', {
        x: frame.padL + 10, y: frame.padT + 16, fill: '#12312a', 'font-size': 11, 'font-weight': 700,
      }, `Pearson r = ${r.metrics.pearson.toFixed(4)} · Lin CCC = ${r.metrics.ccc.toFixed(4)} · RMSE = ${r.metrics.rmse.toFixed(4)}`);

      expEl.innerHTML = audienceText(
        `<strong>Pixel-by-pixel truth check:</strong> Each dot compares a true pixel against its reconstructed brightness. Tight clustering along the dashed diagonal indicates faithful quantitative recovery (agreement <strong>${(r.metrics.ccc * 100).toFixed(1)}%</strong>).`,
        `<strong>Calibration &amp; Shrinkage Check:</strong> Unlike Pearson <em>r</em> (<strong>${r.metrics.pearson.toFixed(3)}</strong>), Lin’s Concordance Correlation Coefficient (<strong>CCC = ${r.metrics.ccc.toFixed(3)}</strong>) penalizes additive bias and high-density amplitude compression.`,
        `<strong>Quantitative Tomographic Photometry:</strong> Vertical dispersion at xᵢ ≈ 0 reflects background streak/noise floor, while slope < 1 at xᵢ > 0.7 diagnoses peak attenuation from missing-wedge Fourier loss, Hann apodization, or excessive L₁ gradient shrinkage.`
      );
      return;
    }

    // Right Tab 5: Directional Missing-Wedge Error Anisotropy
    titleEl.textContent = `Directional Fourier Error Anisotropy (${r.config.spanDeg}° Tilt Span)`;
    const secs = r.anisotropy.sectors;
    const yMax = Math.max(0.01, r.anisotropy.maxRms * 1.18);
    const frame = createPlotFrame(svg, {
      xMin: 0, xMax: 180, yMin: 0, yMax,
      xLabel: 'Fourier azimuth θ (degrees · rose bars lie inside Missing Wedge)',
      yLabel: 'Directional Fourier RMS Error',
      xTicks: 6,
      xFmt: v => `${v.toFixed(0)}°`,
      yFmt: v => v.toFixed(3),
    });

    const barW = (frame.pw / secs.length) * 0.74;
    secs.forEach(s => {
      const cx = frame.sx(s.angleDeg);
      const py = frame.sy(s.rmsError);
      const h = Math.max(1.5, frame.padT + frame.ph - py);
      const col = s.inMissingWedge
        ? (state.cbMode ? '#d55e00' : '#e11d48')
        : (state.cbMode ? '#0072b2' : '#0b7a5c');
      svgEl(svg, 'rect', {
        x: cx - barW * 0.5,
        y: py,
        width: barW,
        height: h,
        rx: 3,
        fill: col,
        'fill-opacity': 0.85,
      });
    });

    svgEl(svg, 'text', { x: frame.padL + 10, y: frame.padT + 16, fill: state.cbMode ? '#0072b2' : '#0b7a5c', 'font-size': 11, 'font-weight': 700 }, `■ Measured tilt sector (0°–${r.config.spanDeg}°)`);
    if (r.config.spanDeg < 180) {
      svgEl(svg, 'text', { x: frame.padL + 225, y: frame.padT + 16, fill: state.cbMode ? '#d55e00' : '#e11d48', 'font-size': 11, 'font-weight': 700 }, `■ Missing wedge (${r.config.spanDeg}°–180° · ${r.metrics.anisotropyRatio.toFixed(2)}× error)`);
    }

    expEl.innerHTML = audienceText(
      `<strong>Directional blur audit:</strong> ${r.config.spanDeg < 180 ? `Because the specimen could only tilt across ${r.config.spanDeg}°, error in the unmeasured rose angles is <strong>${r.metrics.anisotropyRatio.toFixed(2)}× higher</strong> than in measured directions!` : 'With a full 180° rotation, reconstruction error stays balanced across every compass direction.'}`,
      `<strong>Missing-Wedge Anisotropy:</strong> Partitioning 2D Fourier error |X̂(k) − X(k)| across 12 angular sectors shows a <strong>${r.metrics.anisotropyRatio.toFixed(2)}×</strong> wedge-to-measured error ratio. Try switching between <code>SIRT</code> and <code>CS-TV</code> at 90° or 120° to test wedge compensation.`,
      `<strong>Cryo-ET Anisotropic Resolution:</strong> Mechanical goniometer limits (±60° → 120° span) leave a 60° missing wedge in reciprocal space, elongating z/axial features by ~1.5–2.2× and confounding template matching unless accounted for via wedge-masked FSC or variational priors.`
    );
  }

  // Render 6-Solver Leaderboard Table
  function renderLeaderboard() {
    const r = state.run;
    const tbody = get('leaderboard-body');
    tbody.replaceChildren();
    const bestRmse = Math.min(...r.leaderboard.map(s => s.rmse));

    for (const row of r.leaderboard) {
      const tr = document.createElement('tr');
      if (row.id === r.config.solver) tr.className = 'active-row';
      const isWinner = Math.abs(row.rmse - bestRmse) < 1e-6;
      const col = solverColor(row);

      tr.innerHTML =
        `<td><span class="tw-swatch" style="background:${col}"></span>${row.short}${isWinner ? ' <span class="tw-pill-badge">Best RMSE</span>' : ''}</td>` +
        `<td>${row.family}</td>` +
        `<td><strong>${row.rmse.toFixed(4)}</strong></td>` +
        `<td>${row.mae.toFixed(4)}</td>` +
        `<td>${row.ssim.toFixed(3)}</td>` +
        `<td>${row.psnr.toFixed(1)}</td>` +
        `<td>${row.ccc.toFixed(3)}</td>` +
        `<td>${row.frc0143.toFixed(1)} Å</td>` +
        `<td>${row.sinoRmse.toFixed(3)}</td>` +
        `<td>${row.runtimeMs.toFixed(1)} ms</td>`;

      tr.onclick = () => {
        get('solver').value = row.id;
        run();
      };
      tbody.appendChild(tr);
    }
  }

  // ==================== 10-GENE SURVEY & HOLDOUT ML / INVERSE-CRIME ====================
  const surveyProteins = [...new Set(surveyRows.map(r => r.id))];
  const surveyGene = id => surveyRows.find(r => r.id === id)?.gene || id;

  function initSurveyControls() {
    const hold = get('hold');
    hold.replaceChildren();
    for (const id of surveyProteins) {
      hold.add(new Option(`${surveyGene(id)} (${id})`, id));
    }
    hold.value = 'P04637';
  }

  function renderSurveyHeatmap() {
    const span = Number(get('surveySpan').value) || 180;
    const metricKey = get('surveyMetric').value || 'error';
    const counts = [4, 8, 24, 48];
    const rows = surveyRows.filter(r => r.span === span);
    const allVals = surveyRows.map(r => Number(r[metricKey]));
    const low = Math.min(...allVals);
    const high = Math.max(...allVals);
    const isAng = metricKey === 'frc0143';

    const heat = get('heat');
    heat.innerHTML =
      `<caption>10-Gene Tomographic Benchmark · ${span}° tilt span</caption>` +
      `<thead><tr><th scope="col">Gene</th>` +
      counts.map(n => `<th scope="col">${n} views</th>`).join('') +
      `</tr></thead>`;

    const tbody = document.createElement('tbody');
    for (const id of surveyProteins) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = surveyGene(id);
      tr.appendChild(th);

      for (const rRow of rows.filter(item => item.id === id)) {
        const td = document.createElement('td');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tw-heat-btn';
        if (state.run && state.run.config.specimenId === id && state.run.config.angles === rRow.angles && state.run.config.spanDeg === span) {
          btn.classList.add('current');
        }
        const val = Number(rRow[metricKey]);
        const t = Math.max(0, Math.min(1, (val - low) / Math.max(1e-9, high - low)));
        const light = 94 - 62 * t;
        btn.style.background = state.cbMode ? `hsl(204 52% ${light}%)` : `hsl(161 36% ${light}%)`;
        btn.style.color = light < 53 ? '#ffffff' : '#102e29';
        btn.textContent = isAng ? `${val.toFixed(1)} Å` : val.toFixed(4);
        btn.setAttribute('aria-label', `${surveyGene(id)}, ${rRow.angles} views at ${span}°, ${btn.textContent}. Load into workbench`);
        btn.onclick = () => {
          get('specimen').value = id;
          get('angles').value = String(rRow.angles);
          get('tilt-span').value = String(span);
          get('steps').value = '20';
          get('slice').value = '0';
          if (metricKey === 'tvError') get('solver').value = 'tv_fista';
          else if (metricKey === 'fbpError') get('solver').value = 'fbp_ramlak';
          else get('solver').value = 'sirt';
          run();
          get('volume').scrollIntoView({ behavior: 'smooth', block: 'center' });
        };
        td.appendChild(btn);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    heat.appendChild(tbody);

    const gain = id => {
      const r4 = rows.find(x => x.id === id && x.angles === 4);
      const r48 = rows.find(x => x.id === id && x.angles === 48);
      return (r4 ? Number(r4[metricKey]) : 0) - (r48 ? Number(r48[metricKey]) : 0);
    };
    const best = surveyProteins.reduce((a, b) => (gain(a) > gain(b) ? a : b));
    get('finding').innerHTML =
      `<strong>10-Gene Survey Finding (${span}°):</strong> Across all ten central slices, <strong>${surveyGene(best)}</strong> (${best}) shows the largest improvement from 4 to 48 views ` +
      `(<strong>${isAng ? gain(best).toFixed(1) + ' Å finer FRC₀.₁₄₃' : gain(best).toFixed(4) + ' RMSE reduction'}</strong>).`;

    evaluateSurveyHoldout();
  }

  function evaluateSurveyHoldout() {
    const held = get('hold').value || 'P04637';
    const span = Number(get('surveySpan').value) || 180;
    const learner = get('learner').value || 'proj_knn';
    const res = E.evaluateProteinHoldout(surveyRows, held, span, learner);

    const badge = res.usesReference
      ? `<span class="tw-pill-badge warn">Oracle · Requires Known Reference Slice</span>`
      : (learner === 'proj_knn'
          ? `<span class="tw-pill-badge info">Zero Leakage · Uses Sinogram Features Only</span>`
          : `<span class="tw-pill-badge">Baseline · Angle-Only Mean</span>`);

    const rowsHtml = res.rows.map(r =>
      `<tr><td style="text-align:left">${r.angles} views</td><td>${r.predicted.toFixed(4)}</td><td>${r.actual.toFixed(4)}</td><td>${r.absErr.toFixed(4)}</td></tr>`
    ).join('');

    get('evaluation').innerHTML =
      `<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:6px;align-items:center;margin-bottom:6px">` +
      `<span>Trained on <strong>${res.trainCount}</strong> runs (9 proteins) · Held-out <strong>${surveyGene(held)}</strong> MAE: <strong>${res.mae.toFixed(4)}</strong></span>${badge}</div>` +
      `<table class="tw-board-table" style="font-size:12px"><thead><tr><th>Angle Count</th><th>Predicted RMSE</th><th>Simulated RMSE</th><th>|Error|</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
  }

  function renderInverseCrimeAudit() {
    const r = state.run;
    if (!r) return;
    const baseCfg = {
      specimenId: r.config.specimenId,
      z: r.config.z,
      N: r.config.N,
      angles: r.config.angles,
      spanDeg: r.config.spanDeg,
      passes: r.config.passes,
      dose: r.config.dose,
      ctfMode: r.config.ctfMode,
      defocusUm: r.config.defocusUm,
      tvLambda: r.config.tvLambda,
      weightMode: r.config.weightMode,
      seed: r.config.seed,
      compareAllSolvers: true,
    };
    const matched = r.config.honestForward ? E.runExperiment({ ...baseCfg, honestForward: false }) : r;
    const honest = r.config.honestForward ? r : E.runExperiment({ ...baseCfg, honestForward: true });

    const subsetIds = ['fbp_ramlak', 'sirt', 'sart', 'tv_fista'];
    const rowsHtml = subsetIds.map(sid => {
      const mRow = matched.leaderboard.find(x => x.id === sid);
      const hRow = honest.leaderboard.find(x => x.id === sid);
      const delta = hRow.rmse - mRow.rmse;
      return `<tr><td style="text-align:left"><strong>${mRow.short}</strong></td><td>${mRow.rmse.toFixed(4)}</td><td>${hRow.rmse.toFixed(4)}</td><td>+${delta.toFixed(4)}</td></tr>`;
    }).join('');

    get('inverse-crime-box').innerHTML =
      `<table class="tw-board-table" style="font-size:12px"><thead><tr><th>Solver</th><th>Matched Grid (A_fwd = A_inv)</th><th>2× Fine + 0.35 px Shift</th><th>Discretization ΔRMSE</th></tr></thead><tbody>${rowsHtml}</tbody></table>` +
      `<p style="margin:6px 0 0;font-size:12px;color:var(--tw-muted)">Testing only on <code>A_fwd = A_inv</code> commits Kaipio &amp; Somersalo’s <em>Inverse Crime</em>, understating real-detector interpolation &amp; sub-pixel alignment error.</p>`;
  }

  // ==================== MAIN WORKBENCH UPDATE ====================
  function renderFourPanes() {
    const r = state.run;
    if (!r) return;
    render3DStage();
    renderSliceCanvas('truth', r.target, r.config.N, { mode: 'density', physWidth: r.physWidth });
    renderSinogramCanvas();

    const reconTitle = get('recon-head-title');
    const reconCap = get('recon-caption');
    if (state.reconMode === 'diff') {
      const diff = Float64Array.from({ length: r.estimate.length }, (_, i) => r.estimate[i] - r.target[i]);
      const maxAbs = Math.max(0.08, ...Array.from(diff, v => Math.abs(v)));
      reconTitle.textContent = '4 · Signed Error (x̂ − x)';
      reconCap.textContent = `Diverging residual map (±${maxAbs.toFixed(2)}): blue = underpredicted density, vermilion/gold = streak overshoot.`;
      renderSliceCanvas('recon', diff, r.config.N, { mode: 'diff', diffScale: maxAbs });
    } else if (state.reconMode === 'contour') {
      reconTitle.textContent = '4 · Reconstruction + Target Contour';
      reconCap.textContent = 'Gold iso-contour marks true slice boundary (x = 0.28) overlaid directly onto x̂(u, v).';
      renderSliceCanvas('recon', r.estimate, r.config.N, { mode: 'density', contourSource: r.target });
    } else {
      reconTitle.textContent = '4 · Reconstructed Slice x̂(u, v)';
      reconCap.textContent = 'Same physical density scale [0, 1] as ground truth; toggle Signed Error to inspect streak & wedge residuals.';
      renderSliceCanvas('recon', r.estimate, r.config.N, { mode: 'density' });
    }
  }

  function buildExportRecord(r) {
    return {
      schema: 'assay-tomography/2',
      specimen: r.specimen.id,
      width_angstrom: r.specimen.widthAngstrom,
      z: r.config.z,
      angles: r.config.angles,
      span_degrees: r.config.spanDeg,
      passes: r.config.passes,
      solver: r.config.solver,
      dose_electrons_per_ang2: Number.isFinite(r.config.dose) ? r.config.dose : 'infinite',
      ctf_mode: r.config.ctfMode,
      defocus_um: r.config.defocusUm,
      inverse_crime_free: r.config.honestForward,
      tv_lambda: r.config.tvLambda,
      grid: r.config.N,
      bins_per_view: r.config.B,
      metrics: {
        rmse: Number(r.metrics.rmse.toFixed(6)),
        mae: Number(r.metrics.mae.toFixed(6)),
        ssim: Number(r.metrics.ssim.toFixed(6)),
        psnr_db: Number(r.metrics.psnr.toFixed(3)),
        ccc: Number(r.metrics.ccc.toFixed(6)),
        frc_0143_angstrom: Number(r.metrics.frc0143.toFixed(3)),
        crowther_angstrom: Number(r.metrics.crowtherRes.toFixed(3)),
        wedge_anisotropy: Number(r.metrics.anisotropyRatio.toFixed(4)),
      },
      target: Array.from(r.target),
      angle_major_projections: Array.from(r.rawMeasured),
      reconstruction: Array.from(r.estimate),
      rmse: r.rmseHistory,
    };
  }

  function run() {
    const cfg = readConfigFromUI();
    state.run = E.runExperiment(cfg);
    record = buildExportRecord(state.run);

    updateSpecimenBanner(state.run.specimen);
    updateKPIStrip();
    renderFourPanes();
    renderLeftStage();
    renderRightStage();
    renderLeaderboard();
    renderSurveyHeatmap();
    renderInverseCrimeAudit();
  }

  // ==================== INTERACTIONS & EXPORTS ====================
  function wireSliceCrosshair(canvasId) {
    const cvs = get(canvasId);
    let dragging = false;
    function updateAtEvent(e) {
      const r = state.run;
      if (!r) return;
      const rect = cvs.getBoundingClientRect();
      const fx = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const fy = Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / Math.max(1, rect.height)));
      const N = r.config.N;
      const gi = Math.floor(fx * N);
      const gj = Math.floor(fy * N);
      const xAng = ((fx - 0.5) * r.physWidth).toFixed(1);
      const yAng = ((0.5 - fy) * r.physWidth).toFixed(1);
      const tVal = r.target[gj * N + gi];
      const hVal = r.estimate[gj * N + gi];
      const diff = hVal - tVal;
      get('stage-readout').textContent =
        `Pixel (${gi}, ${gj}) · (${xAng} Å, ${yAng} Å) · True x = ${tVal.toFixed(3)} · Recon x̂ = ${hVal.toFixed(3)} · Δ = ${diff >= 0 ? '+' : ''}${diff.toFixed(3)}`;

      if (dragging) {
        get('scanline').value = String(gj);
        get('scanline-out').textContent = `Row ${gj}/${N - 1}`;
        renderFourPanes();
        if (state.leftTab === 'profile') renderLeftStage();
      }
    }
    cvs.addEventListener('pointerdown', e => {
      dragging = true;
      cvs.setPointerCapture(e.pointerId);
      updateAtEvent(e);
    });
    cvs.addEventListener('pointermove', updateAtEvent);
    cvs.addEventListener('lostpointercapture', () => { dragging = false; });
  }

  function wireSinogramHover() {
    const cvs = get('sino');
    cvs.addEventListener('pointermove', e => {
      const r = state.run;
      if (!r) return;
      const rect = cvs.getBoundingClientRect();
      const fx = Math.max(0, Math.min(0.9999, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const fy = Math.max(0, Math.min(0.9999, (e.clientY - rect.top) / Math.max(1, rect.height)));
      const deg = fx * 180;
      const bin = Math.floor(fy * r.config.B);
      if (deg <= r.config.spanDeg) {
        const a = Math.min(r.config.angles - 1, Math.floor((deg / r.config.spanDeg) * r.config.angles));
        state.hoverAngleIdx = a;
        const thDeg = (r.op.thetas[a] * 180) / Math.PI;
        const rayVal = r.rawMeasured[a * r.config.B + bin];
        get('stage-readout').textContent =
          `Sinogram view #${a + 1}/${r.config.angles} · Tilt θ = ${thDeg.toFixed(1)}° · Detector bin s = ${bin}/${r.config.B - 1} · Ray sum y = ${rayVal.toFixed(3)}`;
      } else {
        state.hoverAngleIdx = -1;
        get('stage-readout').textContent =
          `Unmeasured Missing Wedge (θ = ${deg.toFixed(1)}° > ${r.config.spanDeg}° stage limit) · Zero direct Fourier spoke data.`;
      }
      render3DStage();
      renderSinogramCanvas();
    });
    cvs.addEventListener('pointerleave', () => {
      state.hoverAngleIdx = -1;
      render3DStage();
      renderSinogramCanvas();
    });
  }

  function wire3DOrbit() {
    const cvs = get('volume');
    let drag = null;
    cvs.addEventListener('pointerdown', e => {
      cvs.setPointerCapture(e.pointerId);
      drag = [e.clientX, e.clientY];
    });
    cvs.addEventListener('pointermove', e => {
      if (!drag) return;
      state.yaw += (e.clientX - drag[0]) * 0.014;
      state.pitch = Math.max(-1.35, Math.min(1.35, state.pitch + (e.clientY - drag[1]) * 0.014));
      drag = [e.clientX, e.clientY];
      render3DStage();
    });
    cvs.addEventListener('lostpointercapture', () => { drag = null; });
    cvs.addEventListener('keydown', e => {
      const delta = {
        ArrowLeft: [-0.1, 0],
        ArrowRight: [0.1, 0],
        ArrowUp: [0, 0.1],
        ArrowDown: [0, -0.1],
      }[e.key];
      if (delta) {
        e.preventDefault();
        state.yaw += delta[0];
        state.pitch = Math.max(-1.35, Math.min(1.35, state.pitch + delta[1]));
        render3DStage();
      }
    });
  }

  function downloadBlob(filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function wireControls() {
    const changeIds = [
      'specimen', 'weight-mode', 'solver', 'angles', 'tilt-span',
      'steps', 'dose', 'ctf-mode', 'grid-size', 'seed',
      'slice', 'tv-lambda', 'defocus', 'honest-forward',
    ];
    for (const id of changeIds) {
      const el = get(id);
      if (!el) continue;
      el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input', () => {
        if (id === 'specimen') get('slice').value = '0';
        run();
      });
    }

    get('scanline').addEventListener('input', () => {
      if (!state.run) return;
      get('scanline-out').textContent = `Row ${get('scanline').value}/${state.run.config.N - 1}`;
      renderFourPanes();
      if (state.leftTab === 'profile') renderLeftStage();
    });

    get('show-beams').addEventListener('change', render3DStage);
    get('colormap').addEventListener('change', e => {
      state.colormap = e.target.value;
      renderFourPanes();
      if (state.leftTab === 'kspace') renderLeftStage();
    });

    // Audience pills
    document.querySelectorAll('[data-audience]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.audience = btn.dataset.audience;
        document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        renderLeftStage();
        renderRightStage();
      });
    });

    // Colorblind Okabe-Ito mode
    get('toggle-cb').addEventListener('click', () => {
      state.cbMode = !state.cbMode;
      document.body.classList.toggle('cb-mode', state.cbMode);
      get('toggle-cb').classList.toggle('active', state.cbMode);
      get('toggle-cb').setAttribute('aria-pressed', String(state.cbMode));
      renderFourPanes();
      renderLeftStage();
      renderRightStage();
      renderLeaderboard();
      renderSurveyHeatmap();
    });

    // Pane 4 display mode pills
    document.querySelectorAll('[data-recon-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.reconMode = btn.dataset.reconMode;
        document.querySelectorAll('[data-recon-mode]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
        renderFourPanes();
      });
    });

    // Left & Right diagnostic tab switchers
    document.querySelectorAll('[data-ltab]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.leftTab = btn.dataset.ltab;
        document.querySelectorAll('[data-ltab]').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
        renderLeftStage();
      });
    });
    document.querySelectorAll('[data-rtab]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.rightTab = btn.dataset.rtab;
        document.querySelectorAll('[data-rtab]').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
        renderRightStage();
      });
    });

    // Z-Stack sweep animation & 3D reset
    get('play-z').addEventListener('click', () => {
      state.sweepingZ = !state.sweepingZ;
      get('play-z').textContent = state.sweepingZ ? '⏸ Pause Z-sweep' : '▶ Sweep Z-stack';
      get('play-z').classList.toggle('active', state.sweepingZ);
      if (state.sweepingZ) {
        state.sweepTimer = window.setInterval(() => {
          const sl = get('slice');
          let next = Number(sl.value) + state.sweepDir * 6;
          if (next >= 72) { next = 72; state.sweepDir = -1; }
          if (next <= -72) { next = -72; state.sweepDir = 1; }
          sl.value = String(next);
          run();
        }, 120);
      } else {
        window.clearInterval(state.sweepTimer);
      }
    });

    get('reset-view').addEventListener('click', () => {
      state.yaw = 0.48;
      state.pitch = 0.36;
      render3DStage();
    });

    // Survey & Holdout controls
    get('surveySpan').addEventListener('change', renderSurveyHeatmap);
    get('surveyMetric').addEventListener('change', renderSurveyHeatmap);
    get('hold').addEventListener('change', evaluateSurveyHoldout);
    get('learner').addEventListener('change', evaluateSurveyHoldout);
    get('train').addEventListener('click', evaluateSurveyHoldout);
    get('run-inverse-crime').addEventListener('click', () => {
      get('honest-forward').checked = !get('honest-forward').checked;
      run();
    });

    // Exports
    get('save').addEventListener('click', () => {
      if (!record) return;
      downloadBlob('tomography-experiment.json', JSON.stringify(record, null, 2), 'application/json');
    });

    get('export-left-svg').addEventListener('click', () => {
      if (state.leftTab === 'kspace') {
        get('left-canvas').toBlob(b => { if (b) downloadBlob('tomography-kspace.png', b, 'image/png'); });
      } else {
        const xml = new XMLSerializer().serializeToString(get('left-svg'));
        downloadBlob(`tomography-${state.leftTab}.svg`, xml, 'image/svg+xml;charset=utf-8');
      }
    });

    get('export-right-svg').addEventListener('click', () => {
      const xml = new XMLSerializer().serializeToString(get('right-svg'));
      downloadBlob(`tomography-${state.rightTab}.svg`, xml, 'image/svg+xml;charset=utf-8');
    });

    get('surveyExport').addEventListener('click', () => {
      const cols = ['accession', 'gene', 'width_angstrom', 'span_degrees', 'angles', 'mean_reference_density', 'density_rmse', 'cs_tv_rmse', 'fbp_rmse', 'frc_0143_angstrom', 'sino_mean', 'sino_contrast', 'z', 'passes'];
      const lines = [
        cols.join(','),
        ...surveyRows.map(r => [
          r.id, r.gene, r.widthAng, r.span, r.angles, r.mean,
          r.error, r.tvError, r.fbpError, r.frc0143, r.sinoMean, r.sinoContrast, 0, 20,
        ].join(',')),
      ];
      downloadBlob('protein-scan-survey.csv', lines.join('\n'), 'text/csv;charset=utf-8');
    });

    get('save-evidence').addEventListener('click', () => {
      if (!record || !state.run) return;
      const r = state.run;
      const solverMeta = E.SOLVER_CATALOG.find(s => s.id === r.config.solver) || E.SOLVER_CATALOG[0];
      const finalRmse = r.metrics.rmse;
      try {
        evidenceRecords.capture({
          kind: 'simulated',
          title: `${r.specimen.gene} · ${solverMeta.short} · ${r.config.angles} views (${r.config.spanDeg}°)`,
          dataset: `Simulated Cryo-ET / parallel-beam tomography · ${r.specimen.title}`,
          method: `${solverMeta.label} (${r.config.passes} passes · ${Number.isFinite(r.config.dose) ? r.config.dose + ' e⁻/Å²' : 'noise-free'})`,
          metric: 'Density RMSE',
          unit: 'normalized density',
          value: Number(finalRmse.toFixed(4)),
          source: r.specimen.sources?.[0]?.url || 'studio/tomography.html',
          details: {
            comparisonKey: `tomography-${record.specimen}-z${record.z.toFixed(2)}`,
            specimen: record.specimen,
            solver: r.config.solver,
            sliceZ: record.z,
            angles: record.angles,
            spanDegrees: record.span_degrees,
            passes: record.passes,
            dose: record.dose_electrons_per_ang2,
            ctfMode: r.config.ctfMode,
            inverseCrimeFree: r.config.honestForward,
            ssim: Number(r.metrics.ssim.toFixed(4)),
            frc0143Angstrom: Number(r.metrics.frc0143.toFixed(2)),
            widthAngstrom: record.width_angstrom ? Number(record.width_angstrom.toFixed(1)) : null,
          },
        });
        get('save-status').textContent =
          `Saved ${solverMeta.short} tomography run (RMSE ${finalRmse.toFixed(4)}, SSIM ${r.metrics.ssim.toFixed(3)}, FRC₀.₁₄₃ ${r.metrics.frc0143.toFixed(1)} Å) to the Evidence Workspace.`;
      } catch (err) {
        get('save-status').textContent = 'Could not save reconstruction: ' + err.message;
      }
    });
  }

  populateSpecimenMenu();
  initSurveyControls();
  wireSliceCrosshair('truth');
  wireSliceCrosshair('recon');
  wireSinogramHover();
  wire3DOrbit();
  wireControls();
  run();
})();
