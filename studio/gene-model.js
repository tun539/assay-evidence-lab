// AlphaFold 3 / Mol*-style 3D B-DNA molecular renderer with true asymmetric Major/Minor grooves,
// Catmull-Rom sugar-phosphate ribbons, fused 5+6 purine & 6-ring pyrimidine slabs, all-atom CPK
// ball-and-stick mode, VdW groove surface mode, Mol* axes triad, and live codon-to-protein bridge.
(() => {
  'use strict';
  const get = id => document.getElementById(id);
  const canvas = get('gene-stage');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const pos = get('position');
  const zoomSlider = get('camera-zoom');
  const repSelect = get('dna-rep');
  const hoverTip = get('dna-hover-tip');

  // Exact B-DNA structural constants (Ångströms & radians)
  const RISE = 3.38;                     // Axial rise per base pair (Å)
  const TWIST = (2 * Math.PI) / 10.5;    // 34.2857° right-handed twist per bp
  const MINOR_GROOVE_RAD = (138 * Math.PI) / 180; // True asymmetric B-DNA groove (138° minor / 222° major)
  const R_PHOS = 9.4;                    // Phosphate backbone radius (Å)
  const R_SUGAR = 7.2;                   // Deoxyribose C1'/C4' radius (Å) -> 13.45 Å chord, 2.75 Å H-bonds

  const LIGHT_DIR = vNorm([-0.38, 0.56, 0.74]);
  const HALF_VEC = vNorm([-0.22, 0.34, 0.91]);

  const PALETTES = {
    standard: {
      A: [45, 176, 125],   // Adenine (Emerald-Jade)
      T: [234, 138, 52],   // Thymine (Warm Amber)
      C: [66, 144, 235],   // Cytosine (Cobalt Sky)
      G: [166, 104, 224],  // Guanine (Amethyst)
      bb0: [22, 102, 212], // 5'->3' Coding strand (AlphaFold Sapphire)
      bb1: [16, 148, 136], // 3'->5' Template strand (Botanical Teal)
      hex: { A: '#2db07d', T: '#ea8a34', C: '#4290eb', G: '#a668e0' },
    },
    colorblind: {
      A: [0, 158, 115],
      T: [230, 159, 0],
      C: [86, 180, 233],
      G: [204, 121, 167],
      bb0: [0, 114, 178],
      bb1: [213, 94, 0],
      hex: { A: '#009E73', T: '#E69F00', C: '#56B4E9', G: '#CC79A7' },
    },
  };

  const CPK = {
    P: [255, 128, 0],
    O: [232, 46, 46],
    N: [48, 86, 244],
    C: [96, 112, 122],
  };

  const opposite = { A: 'T', T: 'A', C: 'G', G: 'C' };

  const STD_CODE = {
    TTT:'Phe',TTC:'Phe',TTA:'Leu',TTG:'Leu',CTT:'Leu',CTC:'Leu',CTA:'Leu',CTG:'Leu',
    ATT:'Ile',ATC:'Ile',ATA:'Ile',ATG:'Met',GTT:'Val',GTC:'Val',GTA:'Val',GTG:'Val',
    TCT:'Ser',TCC:'Ser',TCA:'Ser',TCG:'Ser',CCT:'Pro',CCC:'Pro',CCA:'Pro',CCG:'Pro',
    ACT:'Thr',ACC:'Thr',ACA:'Thr',ACG:'Thr',GCT:'Ala',GCC:'Ala',GCA:'Ala',GCG:'Ala',
    TAT:'Tyr',TAC:'Tyr',TAA:'Stop',TAG:'Stop',CAT:'His',CAC:'His',CAA:'Gln',CAG:'Gln',
    AAT:'Asn',AAC:'Asn',AAA:'Lys',AAG:'Lys',GAT:'Asp',GAC:'Asp',GAA:'Glu',GAG:'Glu',
    TGT:'Cys',TGC:'Cys',TGA:'Stop',TGG:'Trp',CGT:'Arg',CGC:'Arg',CGA:'Arg',CGG:'Arg',
    AGT:'Ser',AGC:'Ser',AGA:'Arg',AGG:'Arg',GGT:'Gly',GGC:'Gly',GGA:'Gly',GGG:'Gly',
  };
  const MITO_OVERRIDES = { ATA: 'Met', TGA: 'Trp', AGA: 'Stop', AGG: 'Stop' };
  const ONE_LETTER = {
    Ala:'A',Arg:'R',Asn:'N',Asp:'D',Cys:'C',Gln:'Q',Glu:'E',Gly:'G',His:'H',Ile:'I',
    Leu:'L',Lys:'K',Met:'M',Phe:'F',Pro:'P',Ser:'S',Thr:'T',Trp:'W',Tyr:'Y',Val:'V',Stop:'*',
  };

  function vAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vCross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function vLen(a) { return Math.hypot(a[0], a[1], a[2]); }
  function vNorm(a) { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  function catmullRom(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return [0, 1, 2].map(k =>
      0.5 * (
        (2 * p1[k]) +
        (-p0[k] + p2[k]) * t +
        (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
        (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3
      )
    );
  }

  function shadeRGB(rgb, ndotl, spec, fog, bg) {
    const diff = 0.42 + 0.60 * Math.max(0, ndotl);
    const out = [0, 1, 2].map(k => {
      const lit = Math.min(255, rgb[k] * diff + 255 * spec * 0.48);
      return Math.round(lit * (1 - fog) + bg[k] * fog);
    });
    return out;
  }

  function rgbStr(rgb, a = 1) {
    return a >= 0.999 ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  }

  function mixRGB(a, b, t) {
    return [
      Math.round(a[0] * (1 - t) + b[0] * t),
      Math.round(a[1] * (1 - t) + b[1] * t),
      Math.round(a[2] * (1 - t) + b[2] * t),
    ];
  }

  function translateCodon(codon, isMito) {
    if (!codon || codon.length < 3) return { aa3: '---', aa1: '?', isStop: false };
    const aa3 = (isMito && MITO_OVERRIDES[codon]) || STD_CODE[codon] || 'Xaa';
    return { aa3, aa1: ONE_LETTER[aa3] || '?', isStop: aa3 === 'Stop' };
  }

  let overview = false;
  let repMode = 'cartoon'; // cartoon | atomic | surface
  let darkStage = false;   // Default: Light AlphaFold Server stage!
  let showGrooves = true;
  let colorblind = false;
  let spinning = false;
  let rafId = 0;
  let yaw = -0.44;
  let pitch = 0.32;
  let orientStep = 0;
  let drag = null;
  let hoveredBp = -1;
  let bpHitTargets = [];

  function syncLegend() {
    const pal = colorblind ? PALETTES.colorblind : PALETTES.standard;
    const legend = get('base-legend');
    if (legend) {
      legend.innerHTML =
        `<span style="--color:${pal.hex.A}">A · adenine</span>` +
        `<span style="--color:${pal.hex.T}">T · thymine</span>` +
        `<span style="--color:${pal.hex.C}">C · cytosine</span>` +
        `<span style="--color:${pal.hex.G}">G · guanine</span>`;
    }
    const chem = get('dna-chem-legend');
    if (chem) {
      chem.innerHTML =
        `<span><i class="dna-ring" style="background:${pal.hex.A}"></i>A (Purine 5+6)</span>` +
        `<span><i class="dna-ring" style="background:${pal.hex.T}"></i>T (Pyrimidine 6)</span>` +
        `<span><i class="dna-ring" style="background:${pal.hex.C}"></i>C (Pyrimidine 6)</span>` +
        `<span><i class="dna-ring" style="background:${pal.hex.G}"></i>G (Purine 5+6)</span>` +
        `<span><i class="dna-dot" style="background:#ff8000"></i>Phosphate (P)</span>` +
        `<span><i class="dna-dot" style="background:#1784a6"></i>H-bonds (2 A=T · 3 G≡C)</span>`;
    }
  }

  function updateCodonBridge(r, idx, seq, selected) {
    const isMito = r.id === 'hsa:4508';
    const codonIdx = Math.floor(selected / 3);
    const cStart = codonIdx * 3;
    const codon = seq.slice(cStart, cStart + 3);
    const tr = translateCodon(codon, isMito);
    const uniprot = typeof foldIds !== 'undefined' ? foldIds[idx] : 'P00846';
    const aaCount = Math.floor(seq.length / 3) - (translateCodon(seq.slice(-3), isMito).isStop ? 1 : 0);
    const resNum = Math.min(Math.max(1, codonIdx + 1), Math.max(1, aaCount));

    const readout = get('codon-readout');
    const detail = get('codon-detail');
    const link = get('codon-protein-link');
    if (readout) {
      readout.textContent = tr.isStop
        ? `Codon ${codonIdx + 1} (${codon}) → Translation Stop (*)`
        : `Codon ${codonIdx + 1} (${codon}) → ${tr.aa3} (${tr.aa1}) · Residue ${resNum} of ${r.gene}`;
    }
    if (detail) {
      const hCount = (seq[selected] === 'G' || seq[selected] === 'C') ? 3 : 2;
      const isPur = seq[selected] === 'A' || seq[selected] === 'G';
      detail.textContent =
        `Bases ${cStart + 1}–${Math.min(seq.length, cStart + 3)} (${isMito ? 'human mitochondrial code' : 'standard genetic code'}) · ` +
        `bp ${selected + 1}: ${seq[selected]} (${isPur ? 'Purine 5+6' : 'Pyrimidine 6'}) ${hCount === 3 ? '≡' : '='} ${opposite[seq[selected]]} (${hCount} H-bonds).`;
    }
    if (link) {
      link.href = `structure.html?protein=${encodeURIComponent(uniprot)}&res=${resNum}`;
      link.textContent = tr.isStop
        ? `Inspect ${r.gene} C-terminus in 3D →`
        : `Inspect ${tr.aa3} ${resNum} in 3D Protein →`;
    }

    const badges = get('gene-badges');
    if (badges) {
      const gc = Array.from(seq).filter(b => b === 'G' || b === 'C').length;
      const gcPct = ((100 * gc) / seq.length).toFixed(1);
      badges.innerHTML =
        `<span class="gene-pill">${seq.length.toLocaleString('en-US')} bp CDS</span>` +
        `<span class="gene-pill">${aaCount} aa protein</span>` +
        `<span class="gene-pill">GC ${gcPct}%</span>` +
        `<span class="gene-pill">UniProt ${uniprot}</span>`;
    }
  }

  function rotateVec(v) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = v[0] * cy + v[2] * sy;
    const z1 = v[2] * cy - v[0] * sy;
    const y2 = v[1] * cp - z1 * sp;
    const z2 = v[1] * sp + z1 * cp;
    return [x1, y2, z2];
  }

  // Generate local 2D aromatic ring coordinates (u along base-pair axis from sugar->center, v perpendicular in base plane)
  // Returns { pent, hex, atoms, bonds } in ångströms relative to sugar C1' (u=0) heading toward helix center (u > 0)
  function baseRingGeometry(base) {
    const isPur = base === 'A' || base === 'G';
    if (isPur) {
      // Exact 9-atom fused 5+6 purine silhouette sharing the C4-C5 edge ([3.56, -0.72] to [3.56, 0.72])
      const p5 = [
        [1.48,  0.00], // 0: N9 (glycosidic bond to C1')
        [2.28, -1.14], // 1: C8
        [3.56, -0.72], // 2: C4 (shared)
        [3.56,  0.72], // 3: C5 (shared)
        [2.28,  1.14], // 4: N7
      ];
      const p6 = [
        [3.56,  0.72], // C5 (shared = idx 3)
        [4.76,  1.42], // 5: C6
        [5.96,  0.72], // 6: N1 (WC edge)
        [5.96, -0.72], // 7: C2 (WC edge)
        [4.76, -1.42], // 8: N3
        [3.56, -0.72], // C4 (shared = idx 2)
      ];
      const atoms = [
        { p: p5[0], el: 'N' }, { p: p5[1], el: 'C' }, { p: p5[2], el: 'C' },
        { p: p5[3], el: 'C' }, { p: p5[4], el: 'N' },
        { p: p6[1], el: 'C' }, { p: p6[2], el: 'N' }, { p: p6[3], el: 'C' }, { p: p6[4], el: 'N' },
        // Exocyclic C6 substituent (NH2 on A -> N, =O on G -> O)
        { p: [4.80, 2.58], el: base === 'A' ? 'N' : 'O' },
      ];
      const bonds = [
        [0,1],[1,2],[2,3],[3,4],[4,0], // 5-membered imidazole ring
        [3,5],[5,6],[6,7],[7,8],[8,2], // 6-membered pyrimidine ring
        [5,9],
      ];
      if (base === 'G') {
        atoms.push({ p: [7.02, -1.42], el: 'N' }); // Guanine C2-NH2 (3rd H-bond donor)
        bonds.push([7, 10]);
      }
      return { rings: [p5, p6], atoms, bonds, wcU: 6.05, labelU: 4.55 };
    } else {
      // Pyrimidine (T / C): single 6-ring hexagon (N1-C2-N3-C4-C5-C6) + exocyclic O2, O4/N4 (+ C7 methyl on T)
      const p6 = [
        [1.52,  0.00], // 0: N1 (glycosidic)
        [2.44, -1.16], // 1: C2
        [3.84, -1.16], // 2: N3 (WC edge)
        [4.56,  0.00], // 3: C4 (WC edge)
        [3.84,  1.16], // 4: C5
        [2.44,  1.16], // 5: C6
      ];
      const atoms = [
        { p: p6[0], el: 'N' }, { p: p6[1], el: 'C' }, { p: p6[2], el: 'N' },
        { p: p6[3], el: 'C' }, { p: p6[4], el: 'C' }, { p: p6[5], el: 'C' },
        { p: [2.04, -2.30], el: 'O' },                           // C2=O
        { p: [5.72,  0.22], el: base === 'C' ? 'N' : 'O' },      // C4=O (T) or C4-NH2 (C)
      ];
      const bonds = [[0,1],[1,2],[2,3],[3,4],[4,5],[5,0],[1,6],[3,7]];
      if (base === 'T') {
        atoms.push({ p: [4.38, 2.34], el: 'C' }); // Thymine C5-CH3 methyl in major groove!
        bonds.push([4, 8]);
      }
      return { rings: [p6], atoms, bonds, wcU: 4.65, labelU: 3.05 };
    }
  }

  function render() {
    const idx = get('record').selectedIndex;
    const r = dnaRecords[idx];
    const seq = codingDNA[r.id];
    const selected = Number(pos.value) - 1;
    const codonStart = Math.floor(selected / 3) * 3;
    const pal = colorblind ? PALETTES.colorblind : PALETTES.standard;
    const bgRGB = darkStage ? [12, 32, 39] : [245, 249, 247];

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const w = rect.width, h = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    if (darkStage) {
      bg.addColorStop(0, '#091a21');
      bg.addColorStop(1, '#12303a');
    } else {
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(1, '#edf3f0');
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (overview) {
      renderOverview(r, idx, seq, selected, codonStart, pal, bgRGB, w, h);
      return;
    }

    // Detail mode: 18-bp canonical right-handed B-DNA window centered around selected bp
    const winLen = Math.min(18, seq.length);
    const first = Math.min(Math.max(0, selected - Math.floor(winLen / 2)), Math.max(0, seq.length - winLen));
    const last = first + winLen;
    const halfSpan = ((winLen - 1) * RISE) / 2;
    const modelRadius = Math.hypot(halfSpan + 4, R_PHOS + 3);
    const zoomFactor = Number(zoomSlider.value) / 100;
    const baseScale = (Math.min(w * 0.88 / (halfSpan * 2 + 22), h * 0.72 / (R_PHOS * 2 + 12))) * zoomFactor;
    const camDist = modelRadius * 4.6;
    const cx = w * 0.5, cy = h * 0.5;

    function project(worldPos) {
      const rv = rotateVec(worldPos);
      const persp = camDist / Math.max(12, camDist - rv[2]);
      const fog = Math.max(0, Math.min(0.32, (modelRadius - rv[2]) / (2.6 * modelRadius) * 0.28));
      return {
        x: cx + rv[0] * baseScale * persp,
        y: cy - rv[1] * baseScale * persp,
        z: rv[2],
        rv,
        scale: baseScale * persp,
        fog,
      };
    }

    const drawList = [];
    const strandPhos = [[], []];
    const strandSug = [[], []];
    const bpMeta = [];

    for (let i = first; i < last; i++) {
      const k = i - first;
      const x = (k - (winLen - 1) / 2) * RISE;
      const theta0 = i * TWIST;
      const theta1 = theta0 + MINOR_GROOVE_RAD; // True asymmetric 138° / 222° B-DNA grooves!

      const b0 = seq[i];
      const b1 = opposite[b0];
      const inCodon = i >= codonStart && i < codonStart + 3;
      const isSelected = i === selected;
      const isHovered = i === hoveredBp;

      const p0 = [x, R_PHOS * Math.cos(theta0), R_PHOS * Math.sin(theta0)];
      const p1 = [x, R_PHOS * Math.cos(theta1), R_PHOS * Math.sin(theta1)];
      const s0 = [x + 0.55, R_SUGAR * Math.cos(theta0 + 0.14), R_SUGAR * Math.sin(theta0 + 0.14)];
      const s1 = [x - 0.55, R_SUGAR * Math.cos(theta1 - 0.14), R_SUGAR * Math.sin(theta1 - 0.14)];

      strandPhos[0].push({ pos: p0, inCodon, isSelected, bpIndex: i });
      strandPhos[1].push({ pos: p1, inCodon: false, isSelected, bpIndex: i });
      strandSug[0].push(s0);
      strandSug[1].push(s1);

      // Pair chord vector in the YZ base-pair plane (exact C1' -> opposite C1')
      const pairAxis = vNorm(vSub(s1, s0));
      const helixAxis = [1, 0, 0];
      // inPlane perpendicular to pairAxis and helixAxis (lies in flat base ring plane!)
      const inPlane = vNorm(vCross(helixAxis, pairAxis));
      const baseNormal = vNorm(vCross(pairAxis, inPlane)); // ≈ ±helixAxis

      const midWorld = vScale(vAdd(s0, s1), 0.5);
      bpMeta.push({ i, b0, b1, s0, s1, p0, p1, pairAxis, inPlane, baseNormal, midWorld, inCodon, isSelected, isHovered });
    }

    // Helper to push a Blinn-Phong shaded 3D polygon slab
    function pushPoly(verts3D, rgb, norm3D, strokeAlpha = 0.72, highlightColor = null) {
      const pts = verts3D.map(v => project(v));
      const zAvg = pts.reduce((s, p) => s + p.z, 0) / pts.length;
      const fog = pts.reduce((s, p) => s + p.fog, 0) / pts.length;
      const rotN = vNorm(rotateVec(norm3D));
      const nView = rotN[2] < 0 ? vScale(rotN, -1) : rotN;
      const ndotl = vDot(nView, LIGHT_DIR);
      const spec = Math.pow(Math.max(0, vDot(nView, HALF_VEC)), 22);
      const lit = shadeRGB(rgb, ndotl, spec, fog, bgRGB);
      const edge = highlightColor || lit.map(v => Math.max(0, Math.round(v * (darkStage ? 0.55 : 0.62))));
      drawList.push({
        kind: 'poly',
        z: zAvg,
        pts,
        fill: rgbStr(lit),
        stroke: highlightColor ? highlightColor : rgbStr(edge, strokeAlpha),
        lineWidth: highlightColor ? 1.8 : 1.0,
      });
    }

    // Helper to render a Mol*-style 3D beveled solid slab (top + bottom face + side walls!)
    function pushSlab3D(verts3D, rgb, norm3D, thickness = 0.42, highlightColor = null) {
      const halfT = vScale(norm3D, thickness);
      const topV = verts3D.map(v => vAdd(v, halfT));
      const botV = verts3D.map(v => vSub(v, halfT));
      const sideCol = rgb.map(c => Math.round(c * 0.84));
      for (let ei = 0; ei < verts3D.length; ei++) {
        const ej = (ei + 1) % verts3D.length;
        const edgeDir = vSub(verts3D[ej], verts3D[ei]);
        const sideN = vNorm(vCross(edgeDir, norm3D));
        pushPoly([topV[ei], topV[ej], botV[ej], botV[ei]], sideCol, sideN, 0.65, highlightColor);
      }
      pushPoly(topV, rgb, norm3D, 0.78, highlightColor);
      pushPoly(botV, rgb, vScale(norm3D, -1), 0.78, highlightColor);
    }

    // 1. Sculpted Catmull-Rom Sugar-Phosphate Ribbons (Cartoon mode) OR Phosphate-Sugar Backbone Bonds (Atomic/Surface)
    for (let s = 0; s < 2; s++) {
      const pts = strandPhos[s];
      const baseCol = s === 0 ? pal.bb0 : pal.bb1;
      const sub = 7;

      if (repMode === 'cartoon') {
        const ribbonFrames = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const p0 = pts[Math.max(0, i - 1)].pos;
          const p1 = pts[i].pos;
          const p2 = pts[i + 1].pos;
          const p3 = pts[Math.min(pts.length - 1, i + 2)].pos;
          const inCodon = s === 0 && (pts[i].inCodon && pts[i + 1].inCodon);
          const steps = i === pts.length - 2 ? sub + 1 : sub;
          for (let st = 0; st < steps; st++) {
            const t = st / sub;
            const pos3 = catmullRom(p0, p1, p2, p3, t);
            const radial = vNorm([0, pos3[1], pos3[2]]);
            ribbonFrames.push({ pos: pos3, radial, inCodon });
          }
        }
        for (let f = 0; f < ribbonFrames.length - 1; f++) {
          const a = ribbonFrames[f], b = ribbonFrames[f + 1];
          const tan = vNorm(vSub(b.pos, a.pos));
          const binorm = vNorm(vCross(tan, a.radial));
          const normal = vNorm(vCross(binorm, tan));
          const halfW = 1.08;
          const aL = vAdd(a.pos, vScale(binorm, halfW));
          const aR = vSub(a.pos, vScale(binorm, halfW));
          const bL = vAdd(b.pos, vScale(binorm, halfW));
          const bR = vSub(b.pos, vScale(binorm, halfW));
          const col = a.inCodon ? [238, 178, 32] : baseCol;
          pushPoly([aL, bL, bR, aR], col, normal, 0.58);
        }
      }

      // Backbone Phosphates (P) & Oxygens (O1P/O2P) + Sugar-Phosphate links
      for (let i = 0; i < pts.length; i++) {
        const pWorld = pts[i].pos;
        const sWorld = strandSug[s][i];
        const radOut = vNorm([0, pWorld[1], pWorld[2]]);
        const pProj = project(pWorld);
        const sProj = project(sWorld);

        if (repMode === 'cartoon') {
          // Amber phosphate bead on outer edge + C4'-P link
          const pBead = project(vAdd(pWorld, vScale(radOut, 0.72)));
          drawList.push({
            kind: 'sphere', z: pBead.z, x: pBead.x, y: pBead.y,
            radius: Math.max(2.6, 0.85 * pBead.scale),
            rgb: CPK.P, fog: pBead.fog, gloss: 0.65,
          });
          drawList.push({
            kind: 'tube', z: (pProj.z + sProj.z) * 0.5,
            p0: pProj, p1: sProj, width: Math.max(2.0, 0.42 * pProj.scale),
            rgb: darkStage ? [196, 212, 208] : [188, 202, 198], fog: pProj.fog,
          });
        } else {
          // All-Atom or Surface mode: P + O1P + O2P + C5' + deoxyribose atoms + phosphodiester linkage
          const o1 = vAdd(pWorld, vAdd(vScale(radOut, 1.45), [0.55, 0, 0]));
          const o2 = vAdd(pWorld, vAdd(vScale(radOut, 1.45), [-0.55, 0, 0]));
          const c5 = vScale(vAdd(pWorld, sWorld), 0.52);
          const pO1 = project(o1), pO2 = project(o2), pC5 = project(c5);
          const radScale = repMode === 'surface' ? 1.82 : 0.72;

          if (repMode === 'atomic') {
            drawList.push({ kind: 'tube', z: (pProj.z + pO1.z) * 0.5, p0: pProj, p1: pO1, width: Math.max(1.8, 0.28 * pProj.scale), rgb: CPK.O, fog: pProj.fog });
            drawList.push({ kind: 'tube', z: (pProj.z + pO2.z) * 0.5, p0: pProj, p1: pO2, width: Math.max(1.8, 0.28 * pProj.scale), rgb: CPK.O, fog: pProj.fog });
            drawList.push({ kind: 'tube', z: (pProj.z + pC5.z) * 0.5, p0: pProj, p1: pC5, width: Math.max(2.0, 0.32 * pProj.scale), rgb: CPK.P, fog: pProj.fog });
            drawList.push({ kind: 'tube', z: (pC5.z + sProj.z) * 0.5, p0: pC5, p1: sProj, width: Math.max(2.0, 0.32 * pProj.scale), rgb: CPK.C, fog: sProj.fog });
            if (i < pts.length - 1) {
              const pNext = project(pts[i + 1].pos);
              drawList.push({ kind: 'tube', z: (sProj.z + pNext.z) * 0.5, p0: sProj, p1: pNext, width: Math.max(2.0, 0.34 * sProj.scale), rgb: baseCol, fog: sProj.fog });
            }
          }

          drawList.push({ kind: 'sphere', z: pProj.z, x: pProj.x, y: pProj.y, radius: Math.max(2.8, 1.15 * radScale * pProj.scale), rgb: CPK.P, fog: pProj.fog, gloss: 0.6 });
          drawList.push({ kind: 'sphere', z: pO1.z, x: pO1.x, y: pO1.y, radius: Math.max(2.2, 0.88 * radScale * pO1.scale), rgb: CPK.O, fog: pO1.fog, gloss: 0.55 });
          drawList.push({ kind: 'sphere', z: pO2.z, x: pO2.x, y: pO2.y, radius: Math.max(2.2, 0.88 * radScale * pO2.scale), rgb: CPK.O, fog: pO2.fog, gloss: 0.55 });
          drawList.push({ kind: 'sphere', z: pC5.z, x: pC5.x, y: pC5.y, radius: Math.max(2.2, 0.88 * radScale * pC5.scale), rgb: mixRGB(CPK.C, baseCol, 0.35), fog: pC5.fog, gloss: 0.45 });
        }
      }
    }

    // 2. Render Deoxyribose Pentose Rings + Purine/Pyrimidine Slabs or All-Atom Rings + Watson-Crick H-Bonds
    bpHitTargets = [];
    for (const bp of bpMeta) {
      const midP = project(bp.midWorld);
      bpHitTargets.push({ bpIndex: bp.i, x: midP.x, y: midP.y, z: midP.z, r: Math.max(14, 5.2 * midP.scale) });

      const sugarCol = bp.isSelected
        ? [255, 234, 150]
        : (darkStage ? [204, 218, 214] : [224, 232, 228]);

      const strands = [
        { sPos: bp.s0, dir: bp.pairAxis, base: bp.b0, sign: 1 },
        { sPos: bp.s1, dir: vScale(bp.pairAxis, -1), base: bp.b1, sign: -1 },
      ];

      const wcEdge3D = [];

      for (const st of strands) {
        const baseCol = pal[st.base];
        const geom = baseRingGeometry(st.base);
        const to3D = ([u, v]) => vAdd(st.sPos, vAdd(vScale(st.dir, u), vScale(bp.inPlane, v * st.sign)));

        // Deoxyribose 5-membered pentose ring around C1'
        const sugVerts = [];
        for (let vIdx = 0; vIdx < 5; vIdx++) {
          const ang = (vIdx * 2 * Math.PI) / 5 + 0.2;
          sugVerts.push(vAdd(st.sPos, vAdd(
            vScale(st.dir, -0.45 + 1.05 * Math.cos(ang)),
            vScale(bp.inPlane, 1.05 * Math.sin(ang))
          )));
        }

        if (repMode === 'cartoon') {
          pushSlab3D(sugVerts, sugarCol, bp.baseNormal, 0.28);

          // Glycosidic C1' -> N9/N1 cylinder
          const pSug = project(st.sPos);
          const pGly = project(to3D([1.5, 0]));
          drawList.push({
            kind: 'tube', z: (pSug.z + pGly.z) * 0.5 - 0.1,
            p0: pSug, p1: pGly, width: Math.max(2.0, 0.36 * pSug.scale),
            rgb: sugarCol, fog: pSug.fog,
          });

          // Sculpted 3D-extruded Purine (5+6 bicyclic) or Pyrimidine (6-ring) Mol* nucleotide blocks!
          const hiOutline = bp.isSelected
            ? (darkStage ? '#ffffff' : '#112c24')
            : (bp.isHovered ? '#ffd25a' : null);
          for (const ring of geom.rings) {
            pushSlab3D(ring.map(to3D), baseCol, bp.baseNormal, 0.42, hiOutline);
          }

          // Crisp base letter label on slab center
          const lblP = project(to3D([geom.labelU, 0]));
          if (lblP.scale > 4.2) {
            drawList.push({
              kind: 'label', z: lblP.z + 0.4, x: lblP.x, y: lblP.y,
              text: st.base, color: '#ffffff',
              size: Math.round(Math.max(10, Math.min(13, lblP.scale * 1.15))),
            });
          }
        } else {
          // Atomic Ball & Stick OR Groove Spacefill Surface
          const radScale = repMode === 'surface' ? 1.78 : 0.68;
          const atomPts = geom.atoms.map(a => ({ ...a, w3: to3D(a.p), p: project(to3D(a.p)) }));
          const pSug = project(st.sPos);

          if (repMode === 'atomic') {
            // Pentose ring sticks
            const pSugPts = sugVerts.map(v => project(v));
            for (let si = 0; si < 5; si++) {
              const pa = pSugPts[si], pb = pSugPts[(si + 1) % 5];
              drawList.push({
                kind: 'tube', z: (pa.z + pb.z) * 0.5, p0: pa, p1: pb,
                width: Math.max(1.7, 0.26 * pa.scale), rgb: si === 0 ? CPK.O : CPK.C, fog: pa.fog,
              });
            }
            // Glycosidic stick
            drawList.push({
              kind: 'tube', z: (pSug.z + atomPts[0].p.z) * 0.5,
              p0: pSug, p1: atomPts[0].p,
              width: Math.max(1.9, 0.30 * pSug.scale), rgb: CPK.C, fog: pSug.fog,
            });
            // Aromatic covalent bonds
            for (const [ai, bi] of geom.bonds) {
              const pa = atomPts[ai].p, pb = atomPts[bi].p;
              drawList.push({
                kind: 'tube', z: (pa.z + pb.z) * 0.5,
                p0: pa, p1: pb,
                width: Math.max(1.8, 0.28 * pa.scale),
                rgb: mixRGB(CPK.C, baseCol, 0.45), fog: (pa.fog + pb.fog) * 0.5,
              });
            }
          }

          // Atom spheres (CPK tinted gently with base color for C atoms so base identity remains legible!)
          for (const at of atomPts) {
            const col = at.el === 'C'
              ? mixRGB(baseCol, CPK.C, repMode === 'surface' ? 0.18 : 0.35)
              : (repMode === 'surface' ? mixRGB(baseCol, CPK[at.el], 0.55) : CPK[at.el]);
            const baseR = at.el === 'C' ? 0.92 : 0.86;
            drawList.push({
              kind: 'sphere', z: at.p.z, x: at.p.x, y: at.p.y,
              radius: Math.max(2.2, baseR * radScale * at.p.scale),
              rgb: col, fog: at.p.fog, gloss: 0.55,
            });
          }
        }

        wcEdge3D.push({ u: geom.wcU, to3D });
      }

      // 3. Exact Watson-Crick Hydrogen Bonds (2 for A=T, 3 for G≡C)
      if (repMode !== 'surface') {
        const isGC = bp.b0 === 'G' || bp.b0 === 'C';
        const nBonds = isGC ? 3 : 2;
        const hbColor = bp.isSelected
          ? (darkStage ? '#ffe07d' : '#c44510')
          : (darkStage ? 'rgba(128, 236, 255, 0.88)' : 'rgba(18, 128, 162, 0.86)');
        for (let hb = 0; hb < nBonds; hb++) {
          const vOff = (hb - (nBonds - 1) / 2) * 1.15;
          const a3 = wcEdge3D[0].to3D([wcEdge3D[0].u + 0.18, vOff]);
          const b3 = wcEdge3D[1].to3D([wcEdge3D[1].u + 0.18, -vOff]);
          const pa = project(a3), pb = project(b3);
          drawList.push({
            kind: 'dash',
            z: (pa.z + pb.z) * 0.5,
            p0: pa, p1: pb,
            color: hbColor,
            width: bp.isSelected ? 2.2 : 1.6,
          });
        }
      }
    }

    // Painter's algorithm sort (back to front)
    drawList.sort((a, b) => a.z - b.z);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const item of drawList) {
      if (item.kind === 'poly') {
        const pts = item.pts;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let pi = 1; pi < pts.length; pi++) ctx.lineTo(pts[pi].x, pts[pi].y);
        ctx.closePath();
        ctx.fillStyle = item.fill;
        ctx.fill();
        ctx.strokeStyle = item.stroke;
        ctx.lineWidth = item.lineWidth || 1;
        ctx.stroke();
      } else if (item.kind === 'tube') {
        const darkEdge = item.rgb.map(v => Math.max(0, Math.round(v * 0.58 * (1 - item.fog) + bgRGB[0] * item.fog * 0.4)));
        const midLit = shadeRGB(item.rgb, 0.58, 0.08, item.fog, bgRGB);
        const hiLit = shadeRGB(item.rgb, 0.94, 0.45, item.fog * 0.5, bgRGB);
        ctx.beginPath();
        ctx.moveTo(item.p0.x, item.p0.y);
        ctx.lineTo(item.p1.x, item.p1.y);
        ctx.strokeStyle = rgbStr(darkEdge);
        ctx.lineWidth = item.width + 1.1;
        ctx.stroke();
        ctx.strokeStyle = rgbStr(midLit);
        ctx.lineWidth = item.width;
        ctx.stroke();
        if (item.width > 2.8) {
          ctx.strokeStyle = rgbStr(hiLit, 0.5);
          ctx.lineWidth = item.width * 0.32;
          ctx.stroke();
        }
      } else if (item.kind === 'dash') {
        ctx.save();
        ctx.setLineDash([4, 3.5]);
        ctx.beginPath();
        ctx.moveTo(item.p0.x, item.p0.y);
        ctx.lineTo(item.p1.x, item.p1.y);
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.width || 1.6;
        ctx.stroke();
        ctx.restore();
      } else if (item.kind === 'sphere') {
        const rRad = item.radius;
        const hi = shadeRGB(item.rgb, 1.0, item.gloss || 0.5, item.fog * 0.4, bgRGB);
        const mid = shadeRGB(item.rgb, 0.54, 0.06, item.fog, bgRGB);
        const sh = item.rgb.map(v => Math.max(0, Math.round(v * 0.34 * (1 - item.fog) + bgRGB[0] * item.fog * 0.3)));
        const grad = ctx.createRadialGradient(item.x - rRad * 0.32, item.y - rRad * 0.34, rRad * 0.08, item.x, item.y, rRad);
        grad.addColorStop(0, rgbStr(hi));
        grad.addColorStop(0.55, rgbStr(mid));
        grad.addColorStop(1, rgbStr(sh));
        ctx.beginPath();
        ctx.arc(item.x, item.y, rRad, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      } else if (item.kind === 'label') {
        ctx.font = `700 ${item.size}px "Inter",monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillText(item.text, item.x + 0.7, item.y + 0.8);
        ctx.fillStyle = item.color;
        ctx.fillText(item.text, item.x, item.y);
      }
    }

    // 4. Overlay selected base-pair callout pill + 5'/3' strand caps & Major/Minor groove labels
    const selMeta = bpMeta.find(b => b.isSelected);
    if (selMeta) {
      const mp = project(selMeta.midWorld);
      const isGC = selMeta.b0 === 'G' || selMeta.b0 === 'C';
      const pill = `bp ${selMeta.i + 1}: ${selMeta.b0}${isGC ? '≡' : '='}${selMeta.b1} · Codon ${Math.floor(selMeta.i / 3) + 1}`;
      ctx.font = '700 12px "Inter",system-ui,sans-serif';
      const tw = ctx.measureText(pill).width;
      const px = Math.max(tw / 2 + 12, Math.min(w - tw / 2 - 12, mp.x));
      const py = Math.max(48, mp.y - Math.max(28, R_PHOS * mp.scale * 0.65));
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(mp.x, mp.y);
      ctx.lineTo(px, py + 11);
      ctx.strokeStyle = darkStage ? '#ffe07d' : '#c04416';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = darkStage ? 'rgba(12,26,33,0.92)' : 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = darkStage ? '#ffe07d' : '#c04416';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(px - tw / 2 - 8, py - 11, tw + 16, 22, 11);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = darkStage ? '#fff5cc' : '#8a2c0c';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pill, px, py);
    }

    if (showGrooves && bpMeta.length >= 8) {
      // 5' and 3' polarity end badges on both strands
      const firstBp = bpMeta[0], lastBp = bpMeta[bpMeta.length - 1];
      const endTags = [
        [project(firstBp.p0), '5′', pal.bb0],
        [project(lastBp.p0),  '3′', pal.bb0],
        [project(firstBp.p1), '3′', pal.bb1],
        [project(lastBp.p1),  '5′', pal.bb1],
      ];
      for (const [ep, txt, col] of endTags) {
        const ex = Math.max(18, Math.min(w - 18, ep.x + (txt === '5′' && ep.x < w / 2 ? -14 : 14)));
        const ey = Math.max(44, Math.min(h - 18, ep.y));
        ctx.fillStyle = rgbStr(col);
        ctx.beginPath();
        ctx.roundRect(ex - 13, ey - 10, 26, 20, 6);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 11.5px "Inter",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt, ex, ey);
      }

      // Subtle Major Groove vs Minor Groove annotation when viewed roughly from side
      if (Math.abs(Math.sin(yaw)) < 0.72) {
        const gx1 = w * 0.34, gx2 = w * 0.67, gy = h - 22;
        ctx.font = '600 11.5px "Inter",sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = darkStage ? 'rgba(178,220,214,0.82)' : 'rgba(30,74,64,0.78)';
        ctx.fillText('⟷ Major groove (~22 Å wide · protein-binding face)', gx1, gy);
        ctx.fillText('⟷ Minor groove (~12 Å narrow)', gx2, gy);
      }
    }

    // 5. Mol*-style RGB XYZ Orientation Axes Triad (bottom-left)
    drawAxesTriad(w, h);

    // Update badge, caption & live codon-to-protein bridge
    const repLabels = {
      cartoon: 'B-DNA Cartoon + Purine/Pyrimidine Rings',
      atomic: 'All-Atom B-DNA (CPK Ball & Stick)',
      surface: 'B-DNA Groove Spacefill (VdW Surface)',
    };
    const stageBadge = get('dna-stage-badge');
    if (stageBadge) {
      stageBadge.textContent = `${repLabels[repMode]} · ${r.gene} · 3.38 Å/bp · 10.5 bp/turn`;
    }
    get('model-caption').textContent =
      `${r.species} · ${r.gene} · ${seq.length.toLocaleString('en-US')} bp complete coding DNA sequence (${r.group}).`;
    get('model-position').textContent =
      `bp ${selected + 1} · ${seq[selected]}–${opposite[seq[selected]]} · view ${first + 1}–${last}`;
    canvas.setAttribute('aria-label', `${get('model-caption').textContent} ${get('model-position').textContent} Arrow keys rotate the 3D B-DNA double helix.`);

    updateCodonBridge(r, idx, seq, selected);
  }

  // Whole-gene compact coiled overview (rows of 60 bp)
  function renderOverview(r, idx, seq, selected, codonStart, pal, bgRGB, w, h) {
    const columns = 60;
    const rows = Math.max(1, Math.ceil(seq.length / columns));
    const rowSpace = 3.6;
    const scale = Math.min(
      (w - 56) / ((columns - 1) * 0.36 + 2.8),
      (h - 72) / (Math.max(1, rows - 1) * rowSpace + 3.4)
    ) * Number(zoomSlider.value) / 100;

    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    function proj(x, y, z) {
      const u = x * cy + z * sy;
      const v = z * cy - x * sy;
      return { x: w / 2 + scale * u, y: h / 2 - scale * (y * cp - v * sp), z: y * sp + v * cp };
    }

    const items = [];
    let prev = [];
    bpHitTargets = [];
    for (let i = 0; i < seq.length; i++) {
      const col = i % columns, row = Math.floor(i / columns);
      const x = (col - (columns - 1) / 2) * 0.36;
      const midY = ((rows - 1) / 2 - row) * rowSpace;
      const ph0 = i * TWIST;
      const ph1 = ph0 + MINOR_GROOVE_RAD;
      const p0 = proj(x, midY + Math.cos(ph0), Math.sin(ph0));
      const p1 = proj(x, midY + Math.cos(ph1), Math.sin(ph1));
      const mid = proj(x, midY, 0);
      const inCodon = i >= codonStart && i < codonStart + 3;
      const isSel = i === selected;

      bpHitTargets.push({ bpIndex: i, x: mid.x, y: mid.y, z: mid.z, r: Math.max(5, scale * 0.35) });
      if (col) {
        items.push({ kind: 'line', a: prev[0], b: p0, col: inCodon ? '#eab308' : rgbStr(pal.bb0), w: Math.max(1.2, scale * 0.18), z: (prev[0].z + p0.z) * 0.5 });
        items.push({ kind: 'line', a: prev[1], b: p1, col: rgbStr(pal.bb1), w: Math.max(1.2, scale * 0.18), z: (prev[1].z + p1.z) * 0.5 });
      }
      items.push({ kind: 'line', a: p0, b: mid, col: pal.hex[seq[i]], w: Math.max(0.8, scale * 0.11), z: (p0.z + mid.z) * 0.5 - 0.01 });
      items.push({ kind: 'line', a: p1, b: mid, col: pal.hex[opposite[seq[i]]], w: Math.max(0.8, scale * 0.11), z: (p1.z + mid.z) * 0.5 - 0.01 });
      if (isSel) {
        items.push({ kind: 'halo', p: mid, r: Math.max(5, scale * 0.7), z: mid.z + 5 });
      }
      prev = [p0, p1];
    }

    items.sort((a, b) => a.z - b.z);
    ctx.lineCap = 'round';
    for (const it of items) {
      if (it.kind === 'line') {
        ctx.beginPath();
        ctx.moveTo(it.a.x, it.a.y);
        ctx.lineTo(it.b.x, it.b.y);
        ctx.strokeStyle = it.col;
        ctx.lineWidth = it.w;
        ctx.stroke();
      } else if (it.kind === 'halo') {
        ctx.beginPath();
        ctx.arc(it.p.x, it.p.y, it.r, 0, Math.PI * 2);
        ctx.strokeStyle = darkStage ? '#ffffff' : '#c04416';
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
    }

    drawAxesTriad(w, h);
    const stageBadge = get('dna-stage-badge');
    if (stageBadge) stageBadge.textContent = `Whole Coding Gene Overview · ${r.gene} (${seq.length.toLocaleString('en-US')} bp · 60 bp/row)`;
    get('model-caption').textContent = `${r.species} · ${r.gene} · ${seq.length.toLocaleString('en-US')} bp complete coding DNA sequence (${r.group}).`;
    get('model-position').textContent = `bp ${selected + 1} · ${seq[selected]}–${opposite[seq[selected]]} · full CDS 1–${seq.length}`;
    updateCodonBridge(r, idx, seq, selected);
  }

  function drawAxesTriad(w, h) {
    const ox = 36, oy = h - 34, len = 20;
    const axes = [
      { v: [1, 0, 0], name: 'X', color: '#dc2626' },
      { v: [0, 1, 0], name: 'Y', color: '#16a34a' },
      { v: [0, 0, 1], name: 'Z', color: '#2563eb' },
    ].map(ax => ({ ...ax, r: rotateVec(ax.v) })).sort((a, b) => a.r[2] - b.r[2]);
    for (const ax of axes) {
      const tx = ox + ax.r[0] * len, ty = oy - ax.r[1] * len;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(tx, ty);
      ctx.strokeStyle = ax.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = '700 10px "Inter",sans-serif';
      ctx.fillStyle = ax.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ax.name, ox + ax.r[0] * (len + 9), oy - ax.r[1] * (len + 9));
    }
  }

  function pickBpAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const mx = clientX - rect.left, my = clientY - rect.top;
    let best = -1, bestZ = -Infinity;
    for (const t of bpHitTargets) {
      if (Math.hypot(t.x - mx, t.y - my) <= t.r && t.z > bestZ) {
        bestZ = t.z;
        best = t.bpIndex;
      }
    }
    return { bpIndex: best, mx, my };
  }

  function tick() {
    if (!spinning) { rafId = 0; return; }
    yaw += 0.008;
    render();
    rafId = requestAnimationFrame(tick);
  }

  function setSpin(on) {
    spinning = on;
    const btn = get('dna-spin');
    if (btn) btn.setAttribute('aria-pressed', String(on));
    if (on && !rafId) rafId = requestAnimationFrame(tick);
  }

  function reset() {
    yaw = -0.44;
    pitch = 0.32;
    orientStep = 0;
    zoomSlider.value = 112;
    render();
  }

  function mode(full) {
    overview = full;
    get('detail-mode').setAttribute('aria-pressed', String(!full));
    get('full-mode').setAttribute('aria-pressed', String(full));
    reset();
  }

  function changeRecord() {
    const r = dnaRecords[get('record').selectedIndex];
    pos.max = codingDNA[r.id].length;
    pos.value = 1;
    hoveredBp = -1;
    reset();
  }

  // Pointer orbit, click-to-select bp, hover tooltip & scroll zoom
  canvas.onpointerdown = e => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    if (spinning) setSpin(false);
  };
  canvas.onpointermove = e => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.hypot(dx, dy);
      yaw += dx * 0.01;
      pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.01));
      drag.x = e.clientX;
      drag.y = e.clientY;
      render();
      return;
    }
    const { bpIndex, mx, my } = pickBpAt(e.clientX, e.clientY);
    if (bpIndex !== hoveredBp) {
      hoveredBp = bpIndex;
      render();
    }
    if (hoverTip) {
      if (bpIndex >= 0) {
        const r = dnaRecords[get('record').selectedIndex];
        const seq = codingDNA[r.id];
        const b0 = seq[bpIndex], b1 = opposite[b0];
        const cIdx = Math.floor(bpIndex / 3);
        const codon = seq.slice(cIdx * 3, cIdx * 3 + 3);
        const tr = translateCodon(codon, r.id === 'hsa:4508');
        const hCount = (b0 === 'G' || b0 === 'C') ? 3 : 2;
        hoverTip.textContent = `bp ${bpIndex + 1} · ${b0}${hCount === 3 ? '≡' : '='}${b1} (${hCount} H-bonds) · Codon ${cIdx + 1} (${codon} → ${tr.aa3})`;
        hoverTip.style.left = Math.min(canvas.clientWidth - 270, Math.max(12, mx + 14)) + 'px';
        hoverTip.style.top = Math.max(46, my - 26) + 'px';
        hoverTip.hidden = false;
      } else {
        hoverTip.hidden = true;
      }
    }
  };
  canvas.onpointerup = e => {
    if (drag && drag.moved < 5) {
      const { bpIndex } = pickBpAt(e.clientX, e.clientY);
      if (bpIndex >= 0) {
        pos.value = String(bpIndex + 1);
        render();
      }
    }
    drag = null;
  };
  canvas.onpointerleave = () => {
    if (hoveredBp >= 0) { hoveredBp = -1; render(); }
    if (hoverTip) hoverTip.hidden = true;
  };
  canvas.onlostpointercapture = () => { drag = null; };
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const cur = Number(zoomSlider.value);
    const next = Math.max(65, Math.min(200, Math.round(cur + (e.deltaY < 0 ? 10 : -10))));
    zoomSlider.value = String(next);
    render();
  }, { passive: false });

  canvas.onkeydown = e => {
    const turn = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.12], ArrowDown: [0, 0.12] }[e.key];
    if (turn) { e.preventDefault(); yaw += turn[0]; pitch = Math.max(-1.45, Math.min(1.45, pitch + turn[1])); render(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomSlider.value = String(Math.min(200, Number(zoomSlider.value) + 12)); render(); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomSlider.value = String(Math.max(65, Number(zoomSlider.value) - 12)); render(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); reset(); }
    else if (e.key === ' ') { e.preventDefault(); setSpin(!spinning); }
  };

  get('record').addEventListener('change', changeRecord);
  get('full-mode').onclick = () => mode(true);
  get('detail-mode').onclick = () => mode(false);
  get('reset-camera').onclick = reset;
  if (repSelect) {
    repSelect.onchange = () => { repMode = repSelect.value; render(); };
  }
  const orientBtn = get('dna-orient');
  if (orientBtn) {
    const presets = [
      [-0.18, 0.24],   // Canonical side duplex (major & minor grooves)
      [-0.58, 0.42],   // Diagonal groove close-up
      [Math.PI / 2, 0], // End-on straight down the helical axis (iconic base rosette!)
      [0.32, -0.35],   // Underside groove view
    ];
    orientBtn.onclick = () => {
      orientStep = (orientStep + 1) % presets.length;
      [yaw, pitch] = presets[orientStep];
      render();
    };
  }
  const spinBtn = get('dna-spin');
  if (spinBtn) spinBtn.onclick = () => setSpin(!spinning);
  const themeBtn = get('dna-theme');
  if (themeBtn) {
    themeBtn.onclick = () => {
      darkStage = !darkStage;
      themeBtn.setAttribute('aria-pressed', String(darkStage));
      themeBtn.textContent = darkStage ? 'Light stage' : 'Dark stage';
      render();
    };
  }
  const grooveBtn = get('dna-grooves');
  if (grooveBtn) {
    grooveBtn.onclick = () => {
      showGrooves = !showGrooves;
      grooveBtn.setAttribute('aria-pressed', String(showGrooves));
      render();
    };
  }
  const cbBtn = get('dna-cb');
  if (cbBtn) {
    cbBtn.onclick = () => {
      colorblind = !colorblind;
      cbBtn.setAttribute('aria-pressed', String(colorblind));
      syncLegend();
      render();
    };
  }
  const pngBtn = get('dna-png');
  if (pngBtn) {
    pngBtn.onclick = () => {
      const r = dnaRecords[get('record').selectedIndex];
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${r.gene}-bdna-${repMode}.png`;
      a.click();
    };
  }

  pos.oninput = zoomSlider.oninput = render;
  new ResizeObserver(render).observe(canvas);
  syncLegend();
  changeRecord();
})();
