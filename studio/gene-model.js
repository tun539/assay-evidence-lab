// High-DPI shaded 3D double-helix renderer with live codon-to-AlphaFold protein bridge.
(() => {
  'use strict';
  const get = id => document.getElementById(id);
  const canvas = get('gene-stage');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const pos = get('position');
  const zoom = get('camera-zoom');

  const PALETTES = {
    standard: { A: '#54cfa0', T: '#ff9e5e', C: '#6caeff', G: '#d98ff5', bb0: '#49bba6', bb1: '#8ab7cc' },
    colorblind: { A: '#009E73', T: '#E69F00', C: '#56B4E9', G: '#CC79A7', bb0: '#0072B2', bb1: '#D55E00' },
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

  function translateCodon(codon, isMito) {
    if (!codon || codon.length < 3) return { aa3: '---', aa1: '?', isStop: false };
    const aa3 = (isMito && MITO_OVERRIDES[codon]) || STD_CODE[codon] || 'Xaa';
    return { aa3, aa1: ONE_LETTER[aa3] || '?', isStop: aa3 === 'Stop' };
  }

  let overview = false;
  let yaw = -0.24;
  let pitch = 0.22;
  let drag = null;
  let colorblind = false;
  let spinning = false;
  let rafId = 0;

  function shadeHex(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((n >> 16) & 255) * factor)));
    const g = Math.min(255, Math.max(0, Math.round(((n >> 8) & 255) * factor)));
    const b = Math.min(255, Math.max(0, Math.round((n & 255) * factor)));
    return `rgb(${r},${g},${b})`;
  }

  function mixWhite(hex, t) {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * (1 - t) + 255 * t);
    const g = Math.round(((n >> 8) & 255) * (1 - t) + 255 * t);
    const b = Math.round((n & 255) * (1 - t) + 255 * t);
    return `rgb(${r},${g},${b})`;
  }

  function syncLegend() {
    const pal = colorblind ? PALETTES.colorblind : PALETTES.standard;
    const legend = get('base-legend');
    if (legend) {
      legend.innerHTML =
        `<span style="--color:${pal.A}">A · adenine</span>` +
        `<span style="--color:${pal.T}">T · thymine</span>` +
        `<span style="--color:${pal.C}">C · cytosine</span>` +
        `<span style="--color:${pal.G}">G · guanine</span>`;
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
      detail.textContent =
        `Bases ${cStart + 1}–${Math.min(seq.length, cStart + 3)} (${isMito ? 'human mitochondrial code' : 'standard genetic code'}) · ` +
        `Selected base ${selected + 1} is ${seq[selected]}≡${opposite[seq[selected]]}${seq[selected] === 'A' || seq[selected] === 'T' ? ' (2 H-bonds)' : ' (3 H-bonds)'}.`;
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

  function render() {
    const idx = get('record').selectedIndex;
    const r = dnaRecords[idx];
    const seq = codingDNA[r.id];
    const selected = Number(pos.value) - 1;
    const codonStart = Math.floor(selected / 3) * 3;
    const pal = colorblind ? PALETTES.colorblind : PALETTES.standard;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const w = rect.width;
    const h = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0a1d24');
    bg.addColorStop(1, '#123039');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle Cosmos radial vignette light
    const glow = ctx.createRadialGradient(w * 0.5, h * 0.45, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.65);
    glow.addColorStop(0, 'rgba(84,207,160,0.08)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const first = overview ? 0 : Math.min(Math.max(0, selected - 11), Math.max(0, seq.length - 24));
    const last = overview ? seq.length : Math.min(seq.length, first + 24);
    const columns = overview ? 60 : Math.min(24, last - first);
    const rows = Math.max(1, Math.ceil((last - first) / columns));
    const rowSpace = 3.55;
    const scale = Math.min(
      (w - 56) / (Math.max(1, columns - 1) * 0.36 + 2.8),
      (h - 62) / (Math.max(0, rows - 1) * rowSpace + 3.25)
    ) * Number(zoom.value) / 100;

    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);

    function project(x, y, z) {
      const u = x * cy + z * sy;
      const v = z * cy - x * sy;
      const depth = y * sp + v * cp;
      return {
        x: w / 2 + scale * u,
        y: h / 2 - scale * (y * cp - v * sp),
        z: depth,
      };
    }

    const layers = [];
    let previous = [];
    let zMin = Infinity, zMax = -Infinity;

    for (let i = first; i < last; i++) {
      const col = (i - first) % columns;
      const row = Math.floor((i - first) / columns);
      const x = (col - (columns - 1) / 2) * 0.36;
      const midY = ((rows - 1) / 2 - row) * rowSpace;
      const phase = (2 * Math.PI * i) / 10.5;
      const b0 = seq[i];
      const b1 = opposite[b0];
      const inCodon = i >= codonStart && i < codonStart + 3;
      const isSelected = i === selected;

      const p0 = project(x, midY + Math.cos(phase), Math.sin(phase));
      const p1 = project(x, midY - Math.cos(phase), -Math.sin(phase));
      const mid = project(x, midY, 0);
      zMin = Math.min(zMin, p0.z, p1.z);
      zMax = Math.max(zMax, p0.z, p1.z);

      // Backbone ribbons
      if (col) {
        layers.push({ kind: 'bb', a: previous[0], b: p0, c: pal.bb0, width: Math.max(1.2, scale * 0.21), z: (previous[0].z + p0.z) / 2, inCodon });
        layers.push({ kind: 'bb', a: previous[1], b: p1, c: pal.bb1, width: Math.max(1.2, scale * 0.21), z: (previous[1].z + p1.z) / 2, inCodon: false });
      }

      // Base-pair sticks + central H-bond indicator in detail mode
      const hBonds = (b0 === 'G' || b0 === 'C') ? 3 : 2;
      layers.push({ kind: 'rung', a: p0, b: mid, c: pal[b0], width: Math.max(0.8, scale * 0.12), z: (p0.z + mid.z) / 2 - 0.01 });
      layers.push({ kind: 'rung', a: p1, b: mid, c: pal[b1], width: Math.max(0.8, scale * 0.12), z: (p1.z + mid.z) / 2 - 0.01 });
      if (!overview) {
        layers.push({ kind: 'hbond', a: p0, b: p1, count: hBonds, z: mid.z - 0.005, inCodon });
      }

      const rad = Math.max(1.1, scale * (overview ? 0.15 : 0.19));
      layers.push({ kind: 'base', p: p0, base: b0, c: pal[b0], radius: rad, z: p0.z + 0.02, marked: isSelected, inCodon, primary: true });
      layers.push({ kind: 'base', p: p1, base: b1, c: pal[b1], radius: rad, z: p1.z + 0.02, marked: isSelected, inCodon: false, primary: false });

      previous = [p0, p1];
    }

    const zSpan = Math.max(1e-4, zMax - zMin);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    layers.sort((a, b) => a.z - b.z);
    for (const item of layers) {
      const fog = 0.55 + 0.45 * ((item.z - zMin) / zSpan);
      if (item.kind === 'bb') {
        // Shadowed cylinder + bright specular highlight
        ctx.beginPath();
        ctx.moveTo(item.a.x, item.a.y);
        ctx.lineTo(item.b.x, item.b.y);
        ctx.strokeStyle = item.inCodon && !overview ? '#f2c14e' : shadeHex(item.c, fog * 0.85);
        ctx.lineWidth = item.width * 1.15;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(item.a.x, item.a.y);
        ctx.lineTo(item.b.x, item.b.y);
        ctx.strokeStyle = item.inCodon && !overview ? '#fff2b2' : mixWhite(item.c, 0.38 * fog);
        ctx.lineWidth = Math.max(0.7, item.width * 0.34);
        ctx.stroke();
      } else if (item.kind === 'rung') {
        ctx.beginPath();
        ctx.moveTo(item.a.x, item.a.y);
        ctx.lineTo(item.b.x, item.b.y);
        ctx.strokeStyle = shadeHex(item.c, fog * 0.92);
        ctx.lineWidth = item.width;
        ctx.stroke();
      } else if (item.kind === 'hbond') {
        // Subtle glowing hydrogen-bond center dots (2 for A=T, 3 for G≡C)
        const mx = (item.a.x + item.b.x) / 2;
        const my = (item.a.y + item.b.y) / 2;
        const dx = item.b.x - item.a.x;
        const dy = item.b.y - item.a.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        ctx.fillStyle = item.inCodon ? 'rgba(255,232,140,0.92)' : 'rgba(235,248,255,0.62)';
        const spacing = Math.min(4.2, scale * 0.085);
        for (let k = 0; k < item.count; k++) {
          const off = (k - (item.count - 1) / 2) * spacing;
          ctx.beginPath();
          ctx.arc(mx + nx * off, my + ny * off, Math.max(1.2, scale * 0.036), 0, 2 * Math.PI);
          ctx.fill();
        }
      } else if (item.kind === 'base') {
        const { p, radius } = item;
        if (item.inCodon && !overview) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, radius + 3.2, 0, 2 * Math.PI);
          ctx.fillStyle = 'rgba(242,193,78,0.28)';
          ctx.fill();
        }
        const grad = ctx.createRadialGradient(
          p.x - radius * 0.32, p.y - radius * 0.32, radius * 0.1,
          p.x, p.y, radius
        );
        grad.addColorStop(0, mixWhite(item.c, 0.55));
        grad.addColorStop(0.55, shadeHex(item.c, Math.min(1.05, fog * 1.05)));
        grad.addColorStop(1, shadeHex(item.c, fog * 0.55));
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = grad;
        ctx.fill();

        if (item.marked) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2.4;
          ctx.stroke();
        } else if (item.inCodon && !overview) {
          ctx.strokeStyle = '#ffd977';
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        if (!overview && radius >= 6.8) {
          ctx.fillStyle = '#091f24';
          ctx.font = `700 ${Math.round(Math.min(12, radius * 1.15))}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(item.base, p.x, p.y + 0.5);
        }
      }
    }

    // Corner HUD label
    ctx.fillStyle = 'rgba(225,244,239,0.85)';
    ctx.font = '600 12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(`${r.gene} · ${overview ? 'Whole CDS' : '24 bp duplex'} · 5′→3′`, 14, 12);

    get('model-caption').textContent =
      `${r.species} · ${r.gene} · ${seq.length.toLocaleString('en-US')} bp complete coding DNA sequence (${r.group}).`;
    get('model-position').textContent =
      `bp ${selected + 1} · ${seq[selected]}–${opposite[seq[selected]]} · view ${first + 1}–${last}`;
    canvas.setAttribute('aria-label', `${get('model-caption').textContent} ${get('model-position').textContent} Arrow keys rotate the 3D helix.`);

    updateCodonBridge(r, idx, seq, selected);
  }

  function tick() {
    if (!spinning) { rafId = 0; return; }
    yaw += 0.009;
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
    yaw = -0.24;
    pitch = 0.22;
    zoom.value = 105;
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
    reset();
  }

  canvas.onpointerdown = e => {
    canvas.setPointerCapture(e.pointerId);
    drag = [e.clientX, e.clientY];
    if (spinning) setSpin(false);
  };
  canvas.onpointermove = e => {
    if (!drag) return;
    yaw += (e.clientX - drag[0]) * 0.01;
    pitch += (e.clientY - drag[1]) * 0.01;
    drag = [e.clientX, e.clientY];
    render();
  };
  canvas.onlostpointercapture = () => { drag = null; };
  canvas.onkeydown = e => {
    const turn = { ArrowLeft: [-0.1, 0], ArrowRight: [0.1, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key];
    if (turn) { e.preventDefault(); yaw += turn[0]; pitch += turn[1]; render(); }
  };

  get('record').addEventListener('change', changeRecord);
  get('full-mode').onclick = () => mode(true);
  get('detail-mode').onclick = () => mode(false);
  get('reset-camera').onclick = reset;
  const spinBtn = get('dna-spin');
  if (spinBtn) spinBtn.onclick = () => setSpin(!spinning);
  const cbBtn = get('dna-cb');
  if (cbBtn) {
    cbBtn.onclick = () => {
      colorblind = !colorblind;
      cbBtn.setAttribute('aria-pressed', String(colorblind));
      syncLegend();
      render();
    };
  }
  pos.oninput = zoom.oninput = render;
  new ResizeObserver(render).observe(canvas);
  syncLegend();
  changeRecord();
})();
