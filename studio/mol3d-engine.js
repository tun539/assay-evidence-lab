'use strict';

/**
 * High-DPI 3D molecular visualization engine with AlphaFold-style cartoon ribbons,
 * nucleic acid base-pair rungs, metal ion & ligand rendering, Blinn-Phong lighting,
 * depth cueing, interactive residue picking, and local PDB parsing.
 */
const Mol3D = (() => {
  const AA1 = {
    ALA:'A',ARG:'R',ASN:'N',ASP:'D',CYS:'C',GLN:'Q',GLU:'E',GLY:'G',HIS:'H',ILE:'I',
    LEU:'L',LYS:'K',MET:'M',PHE:'F',PRO:'P',SER:'S',THR:'T',TRP:'W',TYR:'Y',VAL:'V',
    A:'A',U:'U',G:'G',C:'C',DA:'A',DT:'T',DG:'G',DC:'C',
  };
  const HYDRO = {
    ILE:4.5,VAL:4.2,LEU:3.8,PHE:2.8,CYS:2.5,MET:1.9,ALA:1.8,GLY:-0.4,THR:-0.7,SER:-0.8,
    TRP:-0.9,TYR:-1.3,PRO:-1.6,HIS:-3.2,GLU:-3.5,GLN:-3.5,ASP:-3.5,ASN:-3.5,LYS:-3.9,ARG:-4.5,
  };
  const ELEMENT_COLORS = {
    FE:[224,102,51], ZN:[125,128,176], MG:[48,185,90], CA:[61,210,120],
    N:[48,80,248], O:[235,38,38], S:[230,198,48], P:[255,128,0], C:[104,118,128],
  };
  const BASE_COLORS = {
    A:[45,176,125], DA:[45,176,125],
    U:[234,138,52], T:[234,138,52], DT:[234,138,52],
    C:[66,144,235], DC:[66,144,235],
    G:[166,104,224], DG:[166,104,224],
  };
  const CHAIN_PALETTE = [
    [22,98,214],   // AlphaFold Sapphire
    [13,148,136],  // Botanical Teal
    [214,68,108],  // Nucleic Coral-Rose
    [217,119,6],   // Ochre Amber
    [124,58,237],  // Structural Violet
    [37,150,190],  // Cerulean
  ];
  const CB_CHAIN_PALETTE = [
    [0,114,178], [0,158,115], [213,94,0], [204,121,167], [230,159,0], [86,180,233],
  ];

  // Exact AlphaFold Server pLDDT 4-band RGB colors
  function plddtRGB(score, colorblind = false) {
    if (!Number.isFinite(score)) return [120, 140, 148];
    if (colorblind) {
      if (score >= 90) return [0, 68, 136];
      if (score >= 70) return [68, 170, 153];
      if (score >= 50) return [221, 170, 51];
      return [187, 85, 102];
    }
    if (score >= 90) return [0, 83, 214];     // #0053D6 Very high
    if (score >= 70) return [101, 203, 243];  // #65CBF3 Confident
    if (score >= 50) return [255, 219, 19];   // #FFDB13 Low
    return [255, 125, 69];                    // #FF7D45 Very low
  }

  function plddtBandLabel(score) {
    if (!Number.isFinite(score)) return 'Experimental';
    if (score >= 90) return 'Very high (>90)';
    if (score >= 70) return 'Confident (70–90)';
    if (score >= 50) return 'Low (50–70)';
    return 'Very low (<50)';
  }

  function spectrumRGB(t) {
    // Smooth perceptual teal -> emerald -> gold -> coral (N -> C)
    const stops = [
      [0.00, [18, 92, 186]],
      [0.33, [20, 168, 146]],
      [0.66, [238, 188, 56]],
      [1.00, [224, 88, 66]],
    ];
    const u = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
      if (u <= t1) {
        const f = (u - t0) / (t1 - t0);
        return [
          Math.round(c0[0] + (c1[0] - c0[0]) * f),
          Math.round(c0[1] + (c1[1] - c0[1]) * f),
          Math.round(c0[2] + (c1[2] - c0[2]) * f),
        ];
      }
    }
    return stops[stops.length - 1][1];
  }

  function hydroRGB(resName) {
    const val = HYDRO[resName] ?? 0;
    const t = Math.max(0, Math.min(1, (val + 4.5) / 9.0));
    // Hydrophilic cobalt -> neutral alabaster-slate -> hydrophobic warm ochre
    const c0 = [24, 110, 198], c1 = [194, 206, 202], c2 = [214, 114, 34];
    if (t < 0.5) {
      const f = t * 2;
      return [0, 1, 2].map(k => Math.round(c0[k] + (c1[k] - c0[k]) * f));
    }
    const f = (t - 0.5) * 2;
    return [0, 1, 2].map(k => Math.round(c1[k] + (c2[k] - c1[k]) * f));
  }

  function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vCross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function vLen(a) { return Math.hypot(a[0], a[1], a[2]); }
  function vNorm(a) {
    const l = vLen(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  function vDist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

  /** Detect protein secondary structure (H / E / C) from C-alpha trace geometry. */
  function detectSecondaryStructure(coords) {
    const n = coords.length;
    const raw = Array(n).fill('C');
    for (let i = 0; i < n; i++) {
      const d2 = i + 2 < n ? vDist(coords[i], coords[i + 2]) : null;
      const d3 = i + 3 < n ? vDist(coords[i], coords[i + 3]) : null;
      const d4 = i + 4 < n ? vDist(coords[i], coords[i + 4]) : null;
      if (d2 !== null && d3 !== null && d2 >= 4.7 && d2 <= 6.2 && d3 >= 4.3 && d3 <= 6.2 && (d4 === null || (d4 >= 5.2 && d4 <= 7.4))) {
        raw[i] = 'H';
        if (i + 1 < n) raw[i + 1] = 'H';
        if (i + 2 < n) raw[i + 2] = 'H';
      }
    }
    for (let i = 0; i < n; i++) {
      if (raw[i] === 'H') continue;
      const d2 = i + 2 < n ? vDist(coords[i], coords[i + 2]) : null;
      const d3 = i + 3 < n ? vDist(coords[i], coords[i + 3]) : null;
      if (d2 !== null && d3 !== null && d2 >= 6.0 && d2 <= 7.6 && d3 >= 8.4 && d3 <= 11.4) {
        if (raw[i] === 'C') raw[i] = 'E';
        if (i + 1 < n && raw[i + 1] === 'C') raw[i + 1] = 'E';
        if (i + 2 < n && raw[i + 2] === 'C') raw[i + 2] = 'E';
      }
    }
    // Filter out tiny isolated runs (<4 for H, <3 for E)
    const out = raw.slice();
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n && out[j] === out[i]) j++;
      const len = j - i;
      if ((out[i] === 'H' && len < 4) || (out[i] === 'E' && len < 3)) {
        for (let k = i; k < j; k++) out[k] = 'C';
      }
      i = j;
    }
    return out;
  }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map(k =>
      0.5 * (
        (2 * p1[k])
        + (-p0[k] + p2[k]) * t
        + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2
        + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
      )
    );
  }

  /** Normalize any bundled fold, experimental complex, or parsed PDB into a unified 3D structure object. */
  function normalize(spec) {
    const chains = [];
    const residues = [];
    let hasPlddt = Boolean(spec.hasPlddt);

    const rawChains = spec.chains && spec.chains.length
      ? spec.chains
      : [{ id: spec.chain || 'A', type: 'protein', label: spec.chainLabel || 'Chain A', rows: spec.rows }];

    rawChains.forEach((ch, chainIdx) => {
      const startIndex = residues.length;
      const chainCoords = ch.rows.map(r => [r[2], r[3], r[4]]);
      const ssList = ch.type === 'protein' ? detectSecondaryStructure(chainCoords) : Array(ch.rows.length).fill(ch.type === 'rna' ? 'R' : 'D');
      ch.rows.forEach((r, localIdx) => {
        const plddt = spec.hasPlddt && Number.isFinite(r[5]) ? r[5] : null;
        if (plddt !== null) hasPlddt = true;
        const baseTip = r.length >= 9 ? [r[6], r[7], r[8]] : null;
        residues.push({
          index: residues.length,
          chainIndex: chainIdx,
          chainId: ch.id,
          chainType: ch.type || 'protein',
          localIndex: localIdx,
          resName: r[0],
          oneLetter: AA1[r[0]] || r[0][0] || 'X',
          resSeq: r[1],
          xyz: [r[2], r[3], r[4]],
          baseTip,
          plddt,
          ss: ssList[localIdx],
        });
      });
      chains.push({
        index: chainIdx,
        id: ch.id,
        type: ch.type || 'protein',
        label: ch.label || ((ch.type === 'rna' ? 'RNA' : ch.type === 'dna' ? 'DNA' : 'Protein') + ' Chain ' + ch.id),
        start: startIndex,
        length: ch.rows.length,
      });
    });

    const ligands = (spec.ligands || []).map(item => ({
      resName: item[0],
      chainId: item[1],
      resSeq: item[2],
      atomName: item[3],
      element: item[4],
      xyz: [item[5], item[6], item[7]],
    }));

    const allPts = [...residues.map(r => r.xyz), ...ligands.map(l => l.xyz)];
    const count = allPts.length || 1;
    const center = [0, 1, 2].map(k => allPts.reduce((s, p) => s + p[k], 0) / count);
    const radius = Math.max(8, ...allPts.map(p => vDist(p, center)));

    // Precompute centered coordinates
    for (const r of residues) {
      r.pos = vSub(r.xyz, center);
      if (r.baseTip) r.tipPos = vSub(r.baseTip, center);
    }
    for (const l of ligands) {
      l.pos = vSub(l.xyz, center);
    }

    // Build ligand covalent bonds (< 1.95 Å within same residue) and ion coordination links
    const ligandBonds = [];
    for (let i = 0; i < ligands.length; i++) {
      for (let j = i + 1; j < ligands.length; j++) {
        if (ligands[i].resName === ligands[j].resName && ligands[i].resSeq === ligands[j].resSeq) {
          const d = vDist(ligands[i].xyz, ligands[j].xyz);
          if (d > 0.4 && d < 1.95) ligandBonds.push([i, j]);
        }
      }
    }
    const ionLinks = [];
    ligands.forEach((lig, li) => {
      if (['ZN', 'MG', 'CA', 'FE'].includes(lig.element) && lig.resName === lig.element) {
        const nearby = residues
          .map(r => ({ r, d: vDist(r.xyz, lig.xyz) }))
          .filter(x => x.d < 6.8 && ['CYS', 'HIS', 'ASP', 'GLU'].includes(x.r.resName))
          .sort((a, b) => a.d - b.d)
          .slice(0, 4);
        for (const nb of nearby) ionLinks.push({ ligIndex: li, resIndex: nb.r.index, dist: nb.d });
      }
    });

    // Confidence summary
    const plddtScores = residues.map(r => r.plddt).filter(Number.isFinite);
    const plddtMean = plddtScores.length
      ? plddtScores.reduce((a, b) => a + b, 0) / plddtScores.length
      : (Number.isFinite(spec.plddtMean) ? spec.plddtMean : null);
    const bands = [0, 0, 0, 0]; // veryHigh, confident, low, veryLow
    for (const s of plddtScores) {
      if (s >= 90) bands[0]++;
      else if (s >= 70) bands[1]++;
      else if (s >= 50) bands[2]++;
      else bands[3]++;
    }

    // Radius of gyration across backbone residues
    const resCenter = [0, 1, 2].map(k => residues.reduce((s, r) => s + r.xyz[k], 0) / (residues.length || 1));
    const rg = Math.sqrt(residues.reduce((s, r) => s + vDist(r.xyz, resCenter) ** 2, 0) / (residues.length || 1));

    return {
      id: spec.id,
      name: spec.name || spec.id,
      subtitle: spec.subtitle || '',
      summary: spec.summary || '',
      source: spec.source || '',
      paeSource: spec.paeSource || '',
      method: spec.method || (hasPlddt ? 'AlphaFold DB v6 prediction' : 'Experimental structure'),
      resolution: spec.resolution || '',
      iptm: spec.iptm ?? null,
      ptm: spec.ptm ?? null,
      paeSize: spec.paeSize || 0,
      paeMax: spec.paeMax || 31.75,
      pae: spec.pae || null,
      hasPlddt,
      plddtMean,
      bands,
      rg,
      center,
      radius,
      chains,
      residues,
      ligands,
      ligandBonds,
      ionLinks,
    };
  }

  /** Parse a user-supplied local .pdb file into a normalized Mol3D model. */
  function parsePDB(text, filename = 'Uploaded PDB') {
    const chainMap = new Map();
    const ligands = [];
    const nucleic = new Set(['A', 'U', 'G', 'C', 'DA', 'DT', 'DG', 'DC']);
    let hasPlddtLike = false;
    let bMax = 0, bMin = 999;

    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith('ATOM  ')) {
        const alt = line[16] || ' ';
        if (alt !== ' ' && alt !== 'A') continue;
        const atom = line.slice(12, 16).trim();
        const res = line.slice(17, 20).trim();
        const ch = line[21] || 'A';
        const resSeq = parseInt(line.slice(22, 26), 10);
        const x = parseFloat(line.slice(30, 38));
        const y = parseFloat(line.slice(38, 46));
        const z = parseFloat(line.slice(46, 54));
        const bfac = parseFloat(line.slice(60, 66));
        if (![x, y, z, resSeq].every(Number.isFinite)) continue;
        if (Number.isFinite(bfac)) { bMax = Math.max(bMax, bfac); bMin = Math.min(bMin, bfac); }
        if (!chainMap.has(ch)) chainMap.set(ch, new Map());
        const resMap = chainMap.get(ch);
        const key = resSeq + ':' + res;
        if (!resMap.has(key)) resMap.set(key, { res, resSeq, atoms: {} });
        const slot = resMap.get(key).atoms;
        if (!slot[atom]) slot[atom] = [x, y, z, Number.isFinite(bfac) ? bfac : null];
      } else if (line.startsWith('HETATM')) {
        const res = line.slice(17, 20).trim();
        if (res === 'HOH' || res === 'WAT') continue;
        const ch = line[21] || 'A';
        const resSeq = parseInt(line.slice(22, 26), 10);
        const atom = line.slice(12, 16).trim();
        const elem = (line.slice(76, 78).trim() || atom[0] || 'C').toUpperCase();
        const x = parseFloat(line.slice(30, 38));
        const y = parseFloat(line.slice(38, 46));
        const z = parseFloat(line.slice(46, 54));
        if ([x, y, z, resSeq].every(Number.isFinite) && ligands.length < 240) {
          ligands.push([res, ch, resSeq, atom, elem, x, y, z]);
        }
      }
    }

    if (text.includes('ALPHAFOLD') || (bMax <= 100 && bMin >= 0 && bMax > 50)) {
      hasPlddtLike = text.toUpperCase().includes('ALPHAFOLD');
    }

    const chains = [];
    for (const [ch, resMap] of chainMap.entries()) {
      const items = [...resMap.values()].sort((a, b) => a.resSeq - b.resSeq);
      const isNuc = items.some(it => nucleic.has(it.res));
      const rows = [];
      for (const it of items) {
        if (isNuc) {
          const anchor = it.atoms["C4'"] || it.atoms['P'];
          if (!anchor) continue;
          const tip = it.atoms['C4'] || it.atoms['C6'] || it.atoms['N1'] || it.atoms['N9'];
          rows.push(tip
            ? [it.res, it.resSeq, anchor[0], anchor[1], anchor[2], anchor[3], tip[0], tip[1], tip[2]]
            : [it.res, it.resSeq, anchor[0], anchor[1], anchor[2], anchor[3]]);
        } else if (it.atoms['CA']) {
          const a = it.atoms['CA'];
          rows.push([it.res, it.resSeq, a[0], a[1], a[2], a[3]]);
        }
      }
      if (rows.length) {
        const type = isNuc ? (rows.some(r => r[0].startsWith('D')) ? 'dna' : 'rna') : 'protein';
        chains.push({ id: ch, type, label: (type === 'protein' ? 'Protein' : type.toUpperCase()) + ' Chain ' + ch, rows });
      }
    }
    if (!chains.length) throw Error('No backbone CA or nucleotide C4\'/P coordinates were found in this PDB file.');
    const cleanName = filename.replace(/\.[^.]+$/, '');
    return normalize({
      id: cleanName.slice(0, 32),
      name: cleanName,
      subtitle: 'Local PDB upload · ' + chains.length + (chains.length === 1 ? ' chain' : ' chains'),
      summary: 'Loaded locally in your browser. No coordinates were uploaded to any external server.',
      source: 'Local file: ' + filename,
      method: hasPlddtLike ? 'Uploaded AlphaFold PDB (B-factor read as pLDDT)' : 'Uploaded PDB coordinates',
      hasPlddt: hasPlddtLike,
      chains,
      ligands,
    });
  }

  function rgbStr(c, alpha = 1) {
    return alpha >= 0.999 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
  }

  function shadeRGB(base, ndotl, spec, fog, bgRGB) {
    const ambient = 0.30;
    const diff = 0.72 * Math.max(0, ndotl);
    const rim = 0.14 * Math.pow(1 - Math.abs(ndotl), 2);
    const factor = ambient + diff + rim;
    const sAdd = 255 * 0.42 * spec;
    return [0, 1, 2].map(k => {
      const lit = Math.min(255, base[k] * factor + sAdd);
      return Math.round(lit * (1 - fog) + bgRGB[k] * fog);
    });
  }

  /** Create an interactive 3D viewport controller attached to a <canvas>. */
  function createViewer(canvas, options = {}) {
    const ctx = canvas.getContext('2d');
    const state = {
      model: null,
      yaw: -0.45,
      pitch: 0.28,
      roll: 0,
      zoom: 1.0,
      panX: 0,
      panY: 0,
      rep: 'cartoon',       // cartoon | tube | trace | surface
      colorMode: 'plddt',   // plddt | chain | ss | spectrum | hydro | colorblind
      theme: 'light',       // light (AlphaFold Server) | dark (Cosmos Specimen)
      selectedA: 0,
      selectedB: 16,
      hoveredIndex: -1,
      autoRotate: false,
      reducedMotion: false,
      showLabels: true,
      showAxes: true,
      spinRaf: 0,
      lastFrame: 0,
      hitTargets: [],
      drag: null,
    };

    const LIGHT_DIR = vNorm([-0.36, 0.54, 0.76]);
    const VIEW_DIR = [0, 0, 1];
    const HALF_VEC = vNorm(vAdd(LIGHT_DIR, VIEW_DIR));

    function rotateVec(p) {
      const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
      const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      const cr = Math.cos(state.roll), sr = Math.sin(state.roll);
      // Y-axis yaw
      const x1 = p[0] * cy + p[2] * sy;
      const y1 = p[1];
      const z1 = -p[0] * sy + p[2] * cy;
      // X-axis pitch
      const x2 = x1;
      const y2 = y1 * cp - z1 * sp;
      const z2 = y1 * sp + z1 * cp;
      // Z-axis roll
      return [
        x2 * cr - y2 * sr,
        x2 * sr + y2 * cr,
        z2,
      ];
    }

    function residueColor(r) {
      const mode = state.colorMode;
      const cb = mode === 'colorblind';
      if (mode === 'plddt' || cb) {
        if (r.plddt !== null) return plddtRGB(r.plddt, cb);
        const pal = cb ? CB_CHAIN_PALETTE : CHAIN_PALETTE;
        if (state.model.chains.length > 1) return pal[r.chainIndex % pal.length];
        return spectrumRGB(r.index / Math.max(1, state.model.residues.length - 1));
      }
      if (mode === 'chain') {
        return CHAIN_PALETTE[r.chainIndex % CHAIN_PALETTE.length];
      }
      if (mode === 'ss') {
        if (r.chainType === 'rna' || r.chainType === 'dna') return [134, 78, 214];
        if (r.ss === 'H') return [214, 62, 102];
        if (r.ss === 'E') return [28, 100, 218];
        return [96, 134, 124];
      }
      if (mode === 'hydro') {
        if (r.chainType !== 'protein') return BASE_COLORS[r.resName] || [142, 92, 214];
        return hydroRGB(r.resName);
      }
      return spectrumRGB(r.index / Math.max(1, state.model.residues.length - 1));
    }

    function render() {
      const m = state.model;
      if (!m) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(280, rect.width || canvas.width || 680);
      const h = Math.max(240, rect.height || canvas.height || 520);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const isDark = state.theme === 'dark';
      const bgRGB = isDark ? [13, 25, 31] : [249, 251, 250];
      const bgGrad = ctx.createRadialGradient(w * 0.48, h * 0.44, 24, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      if (isDark) {
        bgGrad.addColorStop(0, '#162d36');
        bgGrad.addColorStop(1, '#09141a');
      } else {
        bgGrad.addColorStop(0, '#ffffff');
        bgGrad.addColorStop(1, '#eef3f0');
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      const baseScale = (Math.min(w, h) * 0.40 / m.radius) * state.zoom;
      const camDist = m.radius * 4.4;
      const cx = w / 2 + state.panX;
      const cy = h / 2 + state.panY;

      function projectWorld(worldPos) {
        const rv = rotateVec(worldPos);
        const persp = camDist / Math.max(10, camDist - rv[2]);
        const fog = Math.max(0, Math.min(0.32, (m.radius - rv[2]) / (2.7 * m.radius) * 0.28));
        return {
          x: cx + rv[0] * baseScale * persp,
          y: cy - rv[1] * baseScale * persp,
          z: rv[2],
          rv,
          persp,
          scale: baseScale * persp,
          fog,
        };
      }

      const drawList = [];
      const projRes = m.residues.map(r => projectWorld(r.pos));
      state.hitTargets = projRes.map((p, i) => ({ i, x: p.x, y: p.y, z: p.z, r: Math.max(7, 2.2 * p.scale) }));

      const rep = state.rep;

      if (rep === 'surface' || rep === 'trace') {
        const radWorld = rep === 'surface' ? 2.45 : 0.85;
        // Bonds for trace
        if (rep === 'trace') {
          for (const ch of m.chains) {
            for (let k = 0; k < ch.length - 1; k++) {
              const i0 = ch.start + k, i1 = i0 + 1;
              const r0 = m.residues[i0], r1 = m.residues[i1];
              if (vDist(r0.xyz, r1.xyz) > 8.5) continue;
              const p0 = projRes[i0], p1 = projRes[i1];
              drawList.push({
                kind: 'seg',
                z: (p0.z + p1.z) * 0.5,
                p0, p1,
                width: Math.max(1.8, 0.44 * (p0.scale + p1.scale) * 0.5),
                rgb: residueColor(r0),
                fog: (p0.fog + p1.fog) * 0.5,
              });
            }
          }
        }
        // Spheres for each residue
        m.residues.forEach((r, idx) => {
          const p = projRes[idx];
          const rgb = residueColor(r);
          drawList.push({
            kind: 'sphere',
            z: p.z,
            x: p.x,
            y: p.y,
            radius: Math.max(2.6, radWorld * p.scale),
            rgb,
            fog: p.fog,
            gloss: rep === 'surface' ? 0.42 : 0.55,
          });
          if (r.tipPos) {
            const pt = projectWorld(r.tipPos);
            const bRgb = BASE_COLORS[r.resName] || rgb;
            drawList.push({
              kind: 'seg',
              z: (p.z + pt.z) * 0.5,
              p0: p, p1: pt,
              width: Math.max(2.2, 0.5 * p.scale),
              rgb: bRgb,
              fog: (p.fog + pt.fog) * 0.5,
            });
            drawList.push({
              kind: 'sphere',
              z: pt.z,
              x: pt.x,
              y: pt.y,
              radius: Math.max(2.5, 0.9 * pt.scale),
              rgb: bRgb,
              fog: pt.fog,
              gloss: 0.5,
            });
          }
        });
      } else {
        // Cartoon / Ribbon OR Smooth Backbone Tube
        const sub = m.residues.length > 420 ? 3 : 4;
        for (const ch of m.chains) {
          const isNuc = ch.type === 'rna' || ch.type === 'dna';
          const pts = [];
          const meta = [];
          for (let k = 0; k < ch.length; k++) {
            const r = m.residues[ch.start + k];
            pts.push(r.pos);
            meta.push(r);
          }

          // Break into contiguous segments (gap > 8.5 Å breaks chain continuity)
          let segStart = 0;
          while (segStart < pts.length) {
            let segEnd = segStart + 1;
            while (segEnd < pts.length && vDist(pts[segEnd - 1], pts[segEnd]) <= 8.8) segEnd++;
            const segLen = segEnd - segStart;

            if (segLen >= 2) {
              const spline = [];
              for (let i = segStart; i < segEnd - 1; i++) {
                const p0 = pts[Math.max(segStart, i - 1)];
                const p1 = pts[i];
                const p2 = pts[i + 1];
                const p3 = pts[Math.min(segEnd - 1, i + 2)];
                const r1 = meta[i], r2 = meta[i + 1];
                const isLastSheet = r1.ss === 'E' && (i + 1 === segEnd - 1 || meta[i + 1].ss !== 'E');
                for (let s = 0; s < sub; s++) {
                  const t = s / sub;
                  const pos = catmullRom(p0, p1, p2, p3, t);
                  const owner = t < 0.5 ? r1 : r2;
                  spline.push({ pos, owner, ss: r1.ss, isArrow: isLastSheet, arrowT: t });
                }
              }
              spline.push({ pos: pts[segEnd - 1], owner: meta[segEnd - 1], ss: meta[segEnd - 1].ss, isArrow: false, arrowT: 1 });

              // Compute smooth ribbon binormals along spline
              let prevBinorm = [0, 1, 0];
              const frames = spline.map((node, idx) => {
                const prev = spline[Math.max(0, idx - 1)].pos;
                const next = spline[Math.min(spline.length - 1, idx + 1)].pos;
                const tang = vNorm(vSub(next, prev));
                let acc;
                if (idx > 0 && idx < spline.length - 1) {
                  acc = vSub(vAdd(prev, next), vScale(node.pos, 2));
                } else {
                  acc = prevBinorm;
                }
                let binorm = vLen(acc) > 1e-4 ? vNorm(acc) : prevBinorm;
                // Orthogonalize to tangent
                binorm = vSub(binorm, vScale(tang, vDot(binorm, tang)));
                binorm = vLen(binorm) > 1e-4 ? vNorm(binorm) : vNorm(vCross(tang, [0, 0, 1]));
                if (vDot(binorm, prevBinorm) < 0) binorm = vScale(binorm, -1);
                // Gently blend with previous binormal for silky ribbon stability
                binorm = vNorm(vAdd(vScale(binorm, 0.42), vScale(prevBinorm, 0.58)));
                prevBinorm = binorm;
                const normal = vNorm(vCross(tang, binorm));
                return { tang, binorm, normal, proj: projectWorld(node.pos) };
              });

              for (let idx = 0; idx < spline.length - 1; idx++) {
                const a = spline[idx], b = spline[idx + 1];
                const fa = frames[idx], fb = frames[idx + 1];
                const rgb = residueColor(a.owner);
                const ss = a.ss;

                if (rep === 'cartoon' && (ss === 'H' || ss === 'E' || isNuc)) {
                  let halfW0 = ss === 'H' ? 1.12 : (ss === 'E' ? 1.18 : 0.72);
                  let halfW1 = halfW0;
                  if (a.isArrow) {
                    // Sculpted β-strand arrowhead!
                    halfW0 = a.arrowT < 0.28 ? 1.65 : 1.65 * Math.max(0.08, 1 - (a.arrowT - 0.28) / 0.72);
                    const tNext = Math.min(1, a.arrowT + 1 / sub);
                    halfW1 = tNext < 0.28 ? 1.65 : 1.65 * Math.max(0.06, 1 - (tNext - 0.28) / 0.72);
                  }
                  const aL = projectWorld(vAdd(a.pos, vScale(fa.binorm, halfW0)));
                  const aR = projectWorld(vSub(a.pos, vScale(fa.binorm, halfW0)));
                  const bL = projectWorld(vAdd(b.pos, vScale(fb.binorm, halfW1)));
                  const bR = projectWorld(vSub(b.pos, vScale(fb.binorm, halfW1)));

                  const rotNorm = vNorm(rotateVec(fa.normal));
                  const backFacing = rotNorm[2] < 0;
                  const nView = backFacing ? vScale(rotNorm, -1) : rotNorm;
                  const ndotl = vDot(nView, LIGHT_DIR);
                  const spec = Math.pow(Math.max(0, vDot(nView, HALF_VEC)), 22);
                  const zAvg = (fa.proj.z + fb.proj.z) * 0.5;
                  const fog = (fa.proj.fog + fb.proj.fog) * 0.5;

                  // Subtle darker inner face on helices gives crisp 3D depth like Mol*
                  const baseColor = backFacing && ss === 'H'
                    ? rgb.map(v => Math.round(v * 0.78))
                    : rgb;
                  const lit = shadeRGB(baseColor, ndotl, spec, fog, bgRGB);
                  const edge = lit.map(v => Math.max(0, Math.round(v * (isDark ? 0.65 : 0.72))));
                  drawList.push({
                    kind: 'quad',
                    z: zAvg,
                    pts: [aL, bL, bR, aR],
                    fill: rgbStr(lit),
                    stroke: rgbStr(edge, 0.58),
                  });
                } else {
                  // Sleek shaded cylindrical tube for coils & Tube mode
                  const zAvg = (fa.proj.z + fb.proj.z) * 0.5;
                  const fog = (fa.proj.fog + fb.proj.fog) * 0.5;
                  const width = Math.max(2.1, (rep === 'tube' ? 0.78 : 0.52) * (fa.proj.scale + fb.proj.scale) * 0.5);
                  drawList.push({
                    kind: 'tube',
                    z: zAvg,
                    p0: fa.proj,
                    p1: fb.proj,
                    width,
                    rgb,
                    fog,
                  });
                }
              }
            }
            segStart = segEnd;
          }

          // AlphaFold 3 / Mol*-style 3D nucleic acid nucleobase slabs (purine 5+6 bicyclic, pyrimidine 6-ring) + pentose
          if (isNuc) {
            const CB_BASES = {
              A:[0,158,115], DA:[0,158,115],
              U:[230,159,0], T:[230,159,0], DT:[230,159,0],
              C:[86,180,233], DC:[86,180,233],
              G:[204,121,167], DG:[204,121,167],
            };
            const pushSlab = (verts3D, slabRgb, norm3D, strokeAlpha = 0.65) => {
              const pts = verts3D.map(v => projectWorld(v));
              const zAvg = pts.reduce((s, p) => s + p.z, 0) / pts.length;
              const fog = pts.reduce((s, p) => s + p.fog, 0) / pts.length;
              const rotN = vNorm(rotateVec(norm3D));
              const nView = rotN[2] < 0 ? vScale(rotN, -1) : rotN;
              const ndotl = vDot(nView, LIGHT_DIR);
              const spec = Math.pow(Math.max(0, vDot(nView, HALF_VEC)), 24);
              const lit = shadeRGB(slabRgb, ndotl, spec, fog, bgRGB);
              const edge = lit.map(v => Math.max(0, Math.round(v * (isDark ? 0.58 : 0.62))));
              drawList.push({
                kind: 'poly',
                z: zAvg,
                pts,
                fill: rgbStr(lit),
                stroke: rgbStr(edge, strokeAlpha),
              });
            };

            for (let k = 0; k < ch.length; k++) {
              const r = m.residues[ch.start + k];
              if (!r.tipPos) continue;
              const prevR = m.residues[ch.start + Math.max(0, k - 1)];
              const nextR = m.residues[ch.start + Math.min(ch.length - 1, k + 1)];
              const tipVec = vSub(r.tipPos, r.pos);
              const tipLen = vLen(tipVec);
              if (tipLen < 0.8) continue;
              const axis = vScale(tipVec, 1 / tipLen);
              let sTan = vSub(nextR.pos, prevR.pos);
              if (vLen(sTan) < 0.2) sTan = [0, 0, 1];
              sTan = vNorm(sTan);
              let inPlane = vCross(sTan, axis);
              if (vLen(inPlane) < 0.15) inPlane = vCross([1, 0, 0], axis);
              inPlane = vNorm(inPlane);
              const planeNorm = vNorm(vCross(axis, inPlane));

              const baseRgb = (state.colorMode === 'colorblind' ? CB_BASES[r.resName] : BASE_COLORS[r.resName]) || residueColor(r);
              const sugarRgb = isDark ? [214, 224, 219] : [224, 232, 228];

              // Deoxyribose / ribose pentose ring near C4'
              const sugarCenter = vAdd(r.pos, vScale(axis, Math.min(1.5, tipLen * 0.22)));
              const sugarVerts = [];
              for (let s = 0; s < 5; s++) {
                const a = (s * 2 * Math.PI) / 5 + 0.3;
                sugarVerts.push(vAdd(sugarCenter, vAdd(vScale(axis, 0.85 * Math.cos(a)), vScale(inPlane, 0.85 * Math.sin(a)))));
              }
              pushSlab(sugarVerts, sugarRgb, planeNorm, 0.55);

              // Glycosidic connector from C4' to base ring
              const p0 = projRes[r.index];
              const pBaseStart = projectWorld(vAdd(r.pos, vScale(axis, tipLen * 0.38)));
              drawList.push({
                kind: 'tube',
                z: (p0.z + pBaseStart.z) * 0.5 - 0.12,
                p0, p1: pBaseStart,
                width: Math.max(2.0, 0.36 * p0.scale),
                rgb: sugarRgb,
                fog: (p0.fog + pBaseStart.fog) * 0.5,
              });

              const isPurine = ['A', 'DA', 'G', 'DG'].includes(r.resName);
              if (isPurine) {
                // Fused bicyclic Purine: 5-ring (proximal) + 6-ring (distal projecting toward helix axis)
                const c5 = vAdd(r.pos, vScale(axis, tipLen * 0.54));
                const r5 = Math.min(1.18, tipLen * 0.24);
                const pent = [];
                for (let s = 0; s < 5; s++) {
                  const a = (s * 2 * Math.PI) / 5;
                  pent.push(vAdd(c5, vAdd(vScale(axis, r5 * Math.cos(a)), vScale(inPlane, r5 * Math.sin(a)))));
                }
                pushSlab(pent, baseRgb, planeNorm, 0.72);

                const c6 = vAdd(r.pos, vScale(axis, tipLen * 0.84));
                const r6 = Math.min(1.42, tipLen * 0.29);
                const hex = [];
                for (let s = 0; s < 6; s++) {
                  const a = (s * Math.PI) / 3 + Math.PI / 6;
                  hex.push(vAdd(c6, vAdd(vScale(axis, r6 * Math.cos(a)), vScale(inPlane, r6 * Math.sin(a)))));
                }
                pushSlab(hex, baseRgb, planeNorm, 0.78);
              } else {
                // Compact single 6-ring Pyrimidine slab
                const c6 = vAdd(r.pos, vScale(axis, tipLen * 0.72));
                const r6 = Math.min(1.38, tipLen * 0.29);
                const hex = [];
                for (let s = 0; s < 6; s++) {
                  const a = (s * Math.PI) / 3 + Math.PI / 6;
                  hex.push(vAdd(c6, vAdd(vScale(axis, r6 * Math.cos(a)), vScale(inPlane, r6 * Math.sin(a)))));
                }
                pushSlab(hex, baseRgb, planeNorm, 0.78);
              }
            }
          }
        }

        // Automatic Watson-Crick Hydrogen Bonds across antiparallel DNA duplexes & RNA stems
        const nucRes = m.residues.filter(r => r.tipPos && (r.chainType === 'dna' || r.chainType === 'rna'));
        if (nucRes.length >= 4) {
          const compMap = { A: 'TU', DA: 'DT', T: 'A', DT: 'DA', U: 'A', G: 'C', DG: 'DC', C: 'G', DC: 'DG' };
          const paired = new Set();
          for (let i = 0; i < nucRes.length; i++) {
            const ri = nucRes[i];
            if (paired.has(ri.index)) continue;
            const target = compMap[ri.resName];
            if (!target) continue;
            let bestJ = null, bestD = 7.8;
            for (let j = i + 1; j < nucRes.length; j++) {
              const rj = nucRes[j];
              if (paired.has(rj.index)) continue;
              if (ri.chainId === rj.chainId && Math.abs(ri.index - rj.index) < 4) continue;
              if (!target.includes(rj.resName)) continue;
              const d = vDist(ri.tipPos, rj.tipPos);
              if (d < bestD) { bestD = d; bestJ = rj; }
            }
            if (bestJ) {
              paired.add(ri.index);
              paired.add(bestJ.index);
              const isGC = ['G', 'DG', 'C', 'DC'].includes(ri.resName);
              const nBonds = isGC ? 3 : 2;
              const axis = vNorm(vSub(bestJ.tipPos, ri.tipPos));
              let perp = vCross(axis, [0, 0, 1]);
              if (vLen(perp) < 0.2) perp = vCross(axis, [1, 0, 0]);
              perp = vNorm(perp);
              const hbColor = isDark ? 'rgba(130, 232, 255, 0.85)' : 'rgba(18, 118, 152, 0.82)';
              for (let b = 0; b < nBonds; b++) {
                const off = (b - (nBonds - 1) / 2) * 0.92;
                const a3 = vAdd(vAdd(ri.tipPos, vScale(axis, 0.35)), vScale(perp, off));
                const b3 = vAdd(vSub(bestJ.tipPos, vScale(axis, 0.35)), vScale(perp, off));
                const pa = projectWorld(a3), pb = projectWorld(b3);
                drawList.push({ kind: 'dash', z: (pa.z + pb.z) * 0.5, p0: pa, p1: pb, color: hbColor });
              }
            }
          }
        }
      }

      // Metal ion coordination dashed links
      for (const link of m.ionLinks) {
        const pl = projectWorld(m.ligands[link.ligIndex].pos);
        const pr = projRes[link.resIndex];
        drawList.push({ kind: 'dash', z: (pl.z + pr.z) * 0.5, p0: pl, p1: pr, color: isDark ? '#9ecbff' : '#4a6491' });
      }

      // Ligand covalent bonds (e.g., Heme ring & O2 in 1MBO)
      for (const [i, j] of m.ligandBonds) {
        const la = m.ligands[i], lb = m.ligands[j];
        const p0 = projectWorld(la.pos), p1 = projectWorld(lb.pos);
        drawList.push({
          kind: 'tube',
          z: (p0.z + p1.z) * 0.5,
          p0, p1,
          width: Math.max(2.0, 0.34 * p0.scale),
          rgb: ELEMENT_COLORS[la.element] || [130, 140, 150],
          fog: (p0.fog + p1.fog) * 0.5,
        });
      }

      // Ligand & Metal Ion spheres (Zn2+, Fe, Heme, O2)
      m.ligands.forEach(lig => {
        const p = projectWorld(lig.pos);
        const isMetal = ['ZN', 'MG', 'CA', 'FE'].includes(lig.element);
        const rgb = ELEMENT_COLORS[lig.element] || [120, 130, 140];
        drawList.push({
          kind: 'sphere',
          z: p.z + 0.2,
          x: p.x,
          y: p.y,
          radius: Math.max(isMetal ? 6.5 : 3.2, (isMetal ? 1.55 : 0.62) * p.scale),
          rgb,
          fog: p.fog * 0.5,
          gloss: isMetal ? 0.85 : 0.5,
          label: isMetal && state.showLabels ? (lig.element === 'ZN' ? 'Zn²⁺' : lig.element) : null,
        });
      });

      // Painter's algorithm sort (back to front)
      drawList.sort((a, b) => a.z - b.z);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (const item of drawList) {
        if (item.kind === 'quad' || item.kind === 'poly') {
          const pts = item.pts;
          if (!pts || pts.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let pi = 1; pi < pts.length; pi++) ctx.lineTo(pts[pi].x, pts[pi].y);
          ctx.closePath();
          ctx.fillStyle = item.fill;
          ctx.fill();
          ctx.strokeStyle = item.stroke;
          ctx.lineWidth = item.kind === 'poly' ? 0.95 : 0.75;
          ctx.stroke();
        } else if (item.kind === 'tube') {
          const darkEdge = item.rgb.map(v => Math.max(0, Math.round(v * 0.58 * (1 - item.fog) + bgRGB[0] * item.fog * 0.5)));
          const midLit = shadeRGB(item.rgb, 0.55, 0.08, item.fog, bgRGB);
          const hiLit = shadeRGB(item.rgb, 0.92, 0.45, item.fog * 0.6, bgRGB);
          ctx.beginPath();
          ctx.moveTo(item.p0.x, item.p0.y);
          ctx.lineTo(item.p1.x, item.p1.y);
          ctx.strokeStyle = rgbStr(darkEdge);
          ctx.lineWidth = item.width + 1.2;
          ctx.stroke();
          ctx.strokeStyle = rgbStr(midLit);
          ctx.lineWidth = item.width;
          ctx.stroke();
          if (item.width > 3.2) {
            ctx.strokeStyle = rgbStr(hiLit, 0.55);
            ctx.lineWidth = item.width * 0.34;
            ctx.stroke();
          }
        } else if (item.kind === 'seg') {
          const lit = shadeRGB(item.rgb, 0.55, 0.1, item.fog, bgRGB);
          ctx.beginPath();
          ctx.moveTo(item.p0.x, item.p0.y);
          ctx.lineTo(item.p1.x, item.p1.y);
          ctx.strokeStyle = rgbStr(lit);
          ctx.lineWidth = item.width;
          ctx.stroke();
        } else if (item.kind === 'dash') {
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(item.p0.x, item.p0.y);
          ctx.lineTo(item.p1.x, item.p1.y);
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.restore();
        } else if (item.kind === 'sphere') {
          const r = item.radius;
          const hi = shadeRGB(item.rgb, 1.0, item.gloss, item.fog * 0.4, bgRGB);
          const mid = shadeRGB(item.rgb, 0.52, 0.06, item.fog, bgRGB);
          const sh = item.rgb.map(v => Math.max(0, Math.round(v * 0.32 * (1 - item.fog) + bgRGB[0] * item.fog * 0.4)));
          const grad = ctx.createRadialGradient(item.x - r * 0.32, item.y - r * 0.34, r * 0.08, item.x, item.y, r);
          grad.addColorStop(0, rgbStr(hi));
          grad.addColorStop(0.55, rgbStr(mid));
          grad.addColorStop(1, rgbStr(sh));
          ctx.beginPath();
          ctx.arc(item.x, item.y, r, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
          if (item.label) {
            ctx.font = '700 12px "Inter",system-ui,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = isDark ? '#ffffff' : '#172830';
            ctx.fillText(item.label, item.x, item.y - r - 5);
          }
        }
      }

      // Draw selected pair distance cylinder + glowing halos on top
      const aIdx = Math.max(0, Math.min(m.residues.length - 1, state.selectedA));
      const bIdx = Math.max(0, Math.min(m.residues.length - 1, state.selectedB));
      const pA = projRes[aIdx], pB = projRes[bIdx];
      if (pA && pB) {
        const distVal = vDist(m.residues[aIdx].xyz, m.residues[bIdx].xyz);
        ctx.save();
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.strokeStyle = isDark ? '#ffe08a' : '#c04416';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        ctx.restore();

        // Distance pill offset perpendicularly from the A-B segment to avoid colliding with A/B tags
        const dxAB = pB.x - pA.x, dyAB = pB.y - pA.y;
        const segLen = Math.hypot(dxAB, dyAB) || 1;
        if (aIdx !== bIdx && state.showLabels) {
          const nx = -dyAB / segLen, ny = dxAB / segLen;
          const nudge = segLen < 110 ? 22 : 14;
          const mx = Math.max(46, Math.min(w - 46, (pA.x + pB.x) * 0.5 + nx * nudge));
          const my = Math.max(44, Math.min(h - 24, (pA.y + pB.y) * 0.5 + ny * nudge));
          const badge = distVal.toFixed(2) + ' Å';
          ctx.font = '700 12px "Inter",system-ui,sans-serif';
          const tw = ctx.measureText(badge).width;
          ctx.fillStyle = isDark ? 'rgba(13,25,31,0.92)' : 'rgba(255,255,255,0.95)';
          ctx.strokeStyle = isDark ? '#ffe08a' : '#c04416';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.roundRect(mx - tw / 2 - 7, my - 11, tw + 14, 22, 11);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isDark ? '#fff5d1' : '#8b2d0d';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badge, mx, my);
        }

        // Halos and collision-free outward labels for A and B
        for (const [idx, p, other, ringColor, tag] of [
          [aIdx, pA, pB, '#e59a1a', 'A'],
          [bIdx, pB, pA, '#7c3aed', 'B'],
        ]) {
          const r = m.residues[idx];
          ctx.beginPath();
          ctx.arc(p.x, p.y, 9.5, 0, Math.PI * 2);
          ctx.strokeStyle = ringColor;
          ctx.lineWidth = 2.6;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = ringColor;
          ctx.fill();
          if (state.showLabels) {
            const lbl = `${tag}: ${r.resName} ${r.resSeq}`;
            ctx.font = '600 12px "Inter",system-ui,sans-serif';
            const lw = ctx.measureText(lbl).width;
            const placeLeft = p.x < other.x;
            const rawLx = placeLeft ? (p.x - lw - 16) : (p.x + 14);
            const lx = Math.min(w - lw - 12, Math.max(10, rawLx));
            const rawLy = p.y < other.y ? (p.y - 14) : (p.y + 14);
            const ly = Math.max(44, Math.min(h - 16, rawLy));
            ctx.fillStyle = isDark ? 'rgba(10,20,26,0.9)' : 'rgba(255,255,255,0.94)';
            ctx.strokeStyle = ringColor;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(lx - 5, ly - 10, lw + 10, 20, 6);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = isDark ? '#f1f7f5' : '#142c26';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(lbl, lx, ly);
          }
        }
      }

      // Hovered residue highlight ring
      if (state.hoveredIndex >= 0 && projRes[state.hoveredIndex]) {
        const hp = projRes[state.hoveredIndex];
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = isDark ? '#ffffff' : '#17483d';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 3D Orientation Axes Triad (bottom-left, Mol* style)
      if (state.showAxes) {
        const ox = 42, oy = h - 40, axisLen = 24;
        const axes = [
          ['X', [1, 0, 0], '#dc3545'],
          ['Y', [0, 1, 0], '#198754'],
          ['Z', [0, 0, 1], '#0d6efd'],
        ].map(([name, vec, color]) => {
          const rv = rotateVec(vec);
          return { name, color, x: ox + rv[0] * axisLen, y: oy - rv[1] * axisLen, z: rv[2] };
        }).sort((a, b) => a.z - b.z);

        ctx.beginPath();
        ctx.arc(ox, oy, 3, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? '#8ba3ad' : '#5e736b';
        ctx.fill();
        ctx.font = '700 11px "Inter",system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (const ax of axes) {
          ctx.beginPath();
          ctx.moveTo(ox, oy);
          ctx.lineTo(ax.x, ax.y);
          ctx.strokeStyle = ax.color;
          ctx.lineWidth = 2.2;
          ctx.stroke();
          ctx.fillStyle = ax.color;
          const tx = ox + (ax.x - ox) * 1.32;
          const ty = oy + (ax.y - oy) * 1.32;
          ctx.fillText(ax.name, tx, ty);
        }
      }
    }

    function pickAt(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left, y = clientY - rect.top;
      let best = -1, bestZ = -Infinity;
      for (const h of state.hitTargets) {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d <= Math.min(18, Math.max(9, h.r)) && h.z > bestZ) {
          best = h.i;
          bestZ = h.z;
        }
      }
      return best;
    }

    function tickSpin(now) {
      if (!state.autoRotate || state.reducedMotion) { state.spinRaf = 0; return; }
      const dt = Math.min(40, now - (state.lastFrame || now));
      state.lastFrame = now;
      state.yaw += dt * 0.00055;
      render();
      state.spinRaf = requestAnimationFrame(tickSpin);
    }

    // Pointer & keyboard controls
    canvas.onpointerdown = e => {
      canvas.setPointerCapture(e.pointerId);
      state.drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.shiftKey || e.button === 2 };
    };
    canvas.oncontextmenu = e => e.preventDefault();
    canvas.onpointermove = e => {
      if (state.drag) {
        const dx = e.clientX - state.drag.x, dy = e.clientY - state.drag.y;
        state.drag.moved += Math.hypot(dx, dy);
        state.drag.x = e.clientX;
        state.drag.y = e.clientY;
        if (state.drag.pan) {
          state.panX += dx;
          state.panY += dy;
        } else {
          state.yaw += dx * 0.009;
          state.pitch = Math.max(-1.5, Math.min(1.5, state.pitch + dy * 0.009));
        }
        render();
        return;
      }
      const idx = pickAt(e.clientX, e.clientY);
      if (idx !== state.hoveredIndex) {
        state.hoveredIndex = idx;
        canvas.style.cursor = idx >= 0 ? 'pointer' : 'grab';
        render();
        if (options.onHover) options.onHover(idx >= 0 ? state.model.residues[idx] : null, e);
      } else if (idx >= 0 && options.onHover) {
        options.onHover(state.model.residues[idx], e);
      }
    };
    canvas.onpointerup = e => {
      if (state.drag && state.drag.moved < 5) {
        const idx = pickAt(e.clientX, e.clientY);
        if (idx >= 0 && options.onPick) options.onPick(state.model.residues[idx], e.shiftKey);
      }
      state.drag = null;
    };
    canvas.onpointerleave = () => {
      if (state.hoveredIndex !== -1) {
        state.hoveredIndex = -1;
        render();
        if (options.onHover) options.onHover(null);
      }
    };
    canvas.onlostpointercapture = () => { state.drag = null; };
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.09 : 0.92;
      state.zoom = Math.max(0.45, Math.min(3.5, state.zoom * factor));
      if (options.onZoom) options.onZoom(state.zoom);
      render();
    }, { passive: false });

    canvas.onkeydown = e => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); state.yaw -= 0.14; render(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); state.yaw += 0.14; render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); state.pitch = Math.max(-1.5, state.pitch - 0.14); render(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); state.pitch = Math.min(1.5, state.pitch + 0.14); render(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); state.zoom = Math.min(3.5, state.zoom * 1.12); if (options.onZoom) options.onZoom(state.zoom); render(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); state.zoom = Math.max(0.45, state.zoom * 0.88); if (options.onZoom) options.onZoom(state.zoom); render(); }
      else if (e.key.toLowerCase() === 'r') { e.preventDefault(); api.resetCamera(); }
      else if (e.key === ' ') { e.preventDefault(); api.setAutoRotate(!state.autoRotate); if (options.onSpinChange) options.onSpinChange(state.autoRotate); }
    };

    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => render()).observe(canvas);
    }

    const api = {
      state,
      setModel(model, opts = {}) {
        state.model = model;
        state.hoveredIndex = -1;
        state.selectedA = opts.a ?? 0;
        state.selectedB = opts.b ?? Math.min(16, Math.max(0, model.residues.length - 1));
        if (!opts.keepCamera) {
          state.yaw = -0.45;
          state.pitch = 0.28;
          state.roll = 0;
          state.zoom = 1.0;
          state.panX = 0;
          state.panY = 0;
        }
        render();
      },
      setSelection(a, b) {
        state.selectedA = a;
        state.selectedB = b;
        render();
      },
      setRepresentation(rep) { state.rep = rep; render(); },
      setColorMode(mode) { state.colorMode = mode; render(); },
      setTheme(theme) { state.theme = theme; render(); },
      setZoom(z) { state.zoom = Math.max(0.45, Math.min(3.5, z)); render(); },
      setReducedMotion(flag) {
        state.reducedMotion = Boolean(flag);
        if (state.reducedMotion) api.setAutoRotate(false);
      },
      setAutoRotate(flag) {
        state.autoRotate = Boolean(flag) && !state.reducedMotion;
        if (state.autoRotate && !state.spinRaf) {
          state.lastFrame = performance.now();
          state.spinRaf = requestAnimationFrame(tickSpin);
        } else if (!state.autoRotate && state.spinRaf) {
          cancelAnimationFrame(state.spinRaf);
          state.spinRaf = 0;
        }
      },
      orientAxes(preset) {
        if (preset === 'xy') { state.yaw = 0; state.pitch = 0; state.roll = 0; }
        else if (preset === 'xz') { state.yaw = 0; state.pitch = Math.PI / 2; state.roll = 0; }
        else if (preset === 'yz') { state.yaw = Math.PI / 2; state.pitch = 0; state.roll = 0; }
        else { state.yaw = -0.45; state.pitch = 0.28; state.roll = 0; }
        state.panX = 0;
        state.panY = 0;
        render();
      },
      resetCamera() {
        state.yaw = -0.45;
        state.pitch = 0.28;
        state.roll = 0;
        state.zoom = 1.0;
        state.panX = 0;
        state.panY = 0;
        if (options.onZoom) options.onZoom(1.0);
        render();
      },
      toDataURL() { return canvas.toDataURL('image/png'); },
      render,
    };
    return api;
  }

  return {
    normalize,
    parsePDB,
    createViewer,
    plddtRGB,
    plddtBandLabel,
    vDist,
    CHAIN_PALETTE,
  };
})();
