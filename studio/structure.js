'use strict';

(() => {
  const el = id => document.getElementById(id);
  const canvas = el('view');
  const mapCanvas = el('map');
  const mapCtx = mapCanvas.getContext('2d');
  const picker = el('protein');

  // Build unified catalog of all 18 built-in 3D biomolecular models
  const catalog = [];

  // 1. Flagship AlphaFold Server Multi-Entity Reference (PDB 8AW3)
  if (experimental['8AW3']) {
    catalog.push({
      id: '8AW3',
      group: 'pdb',
      badge: 'AlphaFold Server Example · Multi-Entity',
      title: 'Protein–RNA–Ion Complex (PDB 8AW3)',
      species: 'Protein ×2 · tRNA ×1 · Zn²⁺ ×2',
      tag: 'ipTM 0.78 · pTM 0.75',
      defaultColor: 'chain',
    });
  }

  // 2. All 10 KEGG-linked AlphaFold DB v6 Gene Models
  dnaRecords.forEach((rec, i) => {
    const id = foldIds[i];
    const fold = bundledFolds[id];
    catalog.push({
      id,
      group: 'gene',
      dnaIndex: i,
      keggId: rec.id,
      badge: 'AlphaFold DB v6 · Gene Model',
      title: rec.gene + ' (' + id + ')',
      species: rec.species,
      tag: fold && Number.isFinite(fold.plddtMean) ? 'pLDDT ' + fold.plddtMean.toFixed(1) : 'AlphaFold v6',
      note: rec.note,
      defaultColor: 'plddt',
    });
  });

  // 3. Experimental PDB Reference Structures (1UBQ + 6 more in experimental.js)
  catalog.push({
    id: '1UBQ',
    group: 'pdb',
    badge: 'Experimental X-ray · 1.8 Å',
    title: 'Human Ubiquitin (PDB 1UBQ)',
    species: 'Homo sapiens · 76 residues',
    tag: 'β-grasp fold',
    defaultColor: 'spectrum',
  });
  for (const [id, m] of Object.entries(experimental)) {
    if (id === '8AW3') continue;
    catalog.push({
      id,
      group: 'pdb',
      badge: m.method + (m.resolution ? ' · ' + m.resolution : ''),
      title: m.name + ' (PDB ' + id + ')',
      species: m.subtitle || ('PDB ' + id),
      tag: m.ligands && m.ligands.length ? '+ Ligand' : (m.chains && m.chains.length > 1 ? m.chains.length + ' chains' : m.rows.length + ' res'),
      defaultColor: m.chains && m.chains.length > 1 ? 'chain' : 'spectrum',
    });
  }

  // Populate grouped <select id="protein">
  const optFlagship = document.createElement('optgroup');
  optFlagship.label = 'AlphaFold Server Flagship Reference';
  const optGenes = document.createElement('optgroup');
  optGenes.label = '10 Gene-Linked AlphaFold DB v6 Models';
  const optPdb = document.createElement('optgroup');
  optPdb.label = 'Experimental PDB Structures (X-ray)';

  for (const item of catalog) {
    const opt = new Option(item.title + ' — ' + item.tag, item.id);
    if (item.id === '8AW3') optFlagship.append(opt);
    else if (item.group === 'gene') optGenes.append(opt);
    else optPdb.append(opt);
  }
  picker.append(optFlagship, optGenes, optPdb);

  let active = null;
  let activeCatalog = null;
  let matrixMode = 'pae'; // pae | contact | profile
  let audience = 'student'; // explorer | student | researcher
  let galleryFilter = 'all';
  let orientStep = 0;
  let contacts = [];
  let degrees = [];
  let farthest = [0, 0, 0];
  const baseMap = document.createElement('canvas');

  const viewer = Mol3D.createViewer(canvas, {
    onZoom(z) {
      el('zoom').value = Math.max(0.5, Math.min(2.8, z)).toFixed(2);
    },
    onSpinChange(spinning) {
      el('toggle-spin').setAttribute('aria-pressed', String(spinning));
    },
    onHover(res) {
      const tip = el('hover-tip');
      if (!res) {
        tip.hidden = true;
        return;
      }
      const ssName = res.chainType === 'rna' ? 'RNA' : res.chainType === 'dna' ? 'DNA' : (res.ss === 'H' ? 'α-helix' : res.ss === 'E' ? 'β-strand' : 'Loop / coil');
      const conf = res.plddt !== null ? ` · pLDDT ${res.plddt.toFixed(1)} (${Mol3D.plddtBandLabel(res.plddt)})` : '';
      tip.textContent = `${res.resName} ${res.resSeq} · Chain ${res.chainId} · ${ssName}${conf}`;
      tip.hidden = false;
    },
    onPick(res, shiftKey) {
      if (shiftKey) el('b').value = String(res.index);
      else el('a').value = String(res.index);
      updateSelection();
    },
  });

  // Respect system reduced-motion preference on startup
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el('toggle-motion').setAttribute('aria-pressed', 'true');
    viewer.setReducedMotion(true);
  }

  function resLabel(r) {
    return (active && active.chains.length > 1 ? r.chainId + ':' : '') + r.resName + ' ' + r.resSeq;
  }

  function paeGreenRGB(errAngstrom, maxVal = 30) {
    // Authentic AlphaFold Server PAE color ramp: deep emerald #004d28 (0 Å) -> fresh green -> crisp white (30 Å)
    const t = Math.max(0, Math.min(1, errAngstrom / maxVal));
    if (t < 0.35) {
      const f = t / 0.35;
      return [
        Math.round(0 + 42 * f),
        Math.round(77 + 72 * f),
        Math.round(40 + 50 * f),
      ];
    }
    const f = (t - 0.35) / 0.65;
    return [
      Math.round(42 + 213 * f),
      Math.round(149 + 106 * f),
      Math.round(90 + 165 * f),
    ];
  }

  function getPaeValue(i, j) {
    if (!active) return 0;
    if (active.pae && active.paeSize) {
      const n = active.residues.length;
      const r = Math.min(active.paeSize - 1, Math.floor(i * active.paeSize / n));
      const c = Math.min(active.paeSize - 1, Math.floor(j * active.paeSize / n));
      return active.pae[r * active.paeSize + c];
    }
    // For experimental PDB structures without predicted PAE, display true 3D Cα/C4' distance (clamped 0–30 Å)
    return Math.min(30, Mol3D.vDist(active.residues[i].xyz, active.residues[j].xyz));
  }

  function computeContacts() {
    const m = active;
    const n = m.residues.length;
    const cutoff = Number(el('cut').value);
    const minSep = Number(el('sep').value);
    degrees = Array(n).fill(0);
    contacts = [];
    farthest = [0, Math.min(1, n - 1), 0];

    // Fast pairwise pass (sample stride for farthest if huge, full exact for <= 600)
    for (let i = 0; i < n; i++) {
      const ri = m.residues[i];
      for (let j = i + 1; j < n; j++) {
        const rj = m.residues[j];
        const d = Mol3D.vDist(ri.xyz, rj.xyz);
        if (d > farthest[2]) farthest = [i, j, d];
        const sameChain = ri.chainIndex === rj.chainIndex;
        if (d <= cutoff && (!sameChain || Math.abs(rj.resSeq - ri.resSeq) >= minSep)) {
          contacts.push([i, j, d]);
          degrees[i]++;
          degrees[j]++;
        }
      }
    }

    el('geometry').textContent = `${n} residues · Rg ${m.rg.toFixed(2)} Å · Max span ${farthest[2].toFixed(2)} Å`;
    const span = Math.max(1, n - 1);
    const intraContacts = contacts.filter(([i, j]) => m.residues[i].chainIndex === m.residues[j].chainIndex);
    const order = intraContacts.length
      ? intraContacts.reduce((s, [i, j]) => s + Math.abs(j - i), 0) / (intraContacts.length * span)
      : null;
    const interCount = contacts.length - intraContacts.length;
    el('network').textContent =
      `${contacts.length} contacts within ${cutoff} Å`
      + (interCount ? ` (${interCount} inter-chain interface contacts)` : '')
      + ` · Mean degree ${(2 * contacts.length / Math.max(1, n)).toFixed(2)}`
      + (order !== null ? ` · Relative contact order ${order.toFixed(3)}` : '');
  }

  function buildMatrix() {
    if (!active) return;
    const m = active;
    const n = m.residues.length;
    const dim = Math.min(260, Math.max(96, n));
    baseMap.width = baseMap.height = mapCanvas.width = mapCanvas.height = dim;
    const rctx = baseMap.getContext('2d');
    const img = rctx.createImageData(dim, dim);
    const cutoff = Number(el('cut').value);
    const minSep = Number(el('sep').value);
    const isPae = matrixMode === 'pae';

    for (let py = 0; py < dim; py++) {
      const i = Math.min(n - 1, Math.floor(py * n / dim));
      const ri = m.residues[i];
      for (let px = 0; px < dim; px++) {
        const j = Math.min(n - 1, Math.floor(px * n / dim));
        const rj = m.residues[j];
        let rgb;
        if (isPae) {
          const val = getPaeValue(i, j);
          rgb = paeGreenRGB(val, m.pae ? m.paeMax : 30);
        } else {
          const d = Mol3D.vDist(ri.xyz, rj.xyz);
          const sameChain = ri.chainIndex === rj.chainIndex;
          const isContact = d <= cutoff && (!sameChain || Math.abs(rj.resSeq - ri.resSeq) >= minSep);
          rgb = isContact ? [18, 102, 78] : [242, 247, 243];
        }
        const off = (py * dim + px) * 4;
        img.data[off] = rgb[0];
        img.data[off + 1] = rgb[1];
        img.data[off + 2] = rgb[2];
        img.data[off + 3] = 255;
      }
    }
    rctx.putImageData(img, 0, 0);

    // Optional AlphaFold Server chain borders overlay
    if (el('chain-borders').checked && m.chains.length > 1) {
      rctx.strokeStyle = 'rgba(15, 36, 31, 0.72)';
      rctx.lineWidth = 1.5;
      for (const ch of m.chains.slice(1)) {
        const pos = Math.round(ch.start * dim / n);
        rctx.beginPath();
        rctx.moveTo(pos, 0);
        rctx.lineTo(pos, dim);
        rctx.moveTo(0, pos);
        rctx.lineTo(dim, pos);
        rctx.stroke();
      }
    }

    drawProfile();
    drawMatrixOverlay();
  }

  function drawProfile() {
    if (!active) return;
    const m = active;
    const n = m.residues.length;
    const width = 540 / Math.max(1, n);
    const cb = el('toggle-cb').getAttribute('aria-pressed') === 'true';

    if (m.hasPlddt) {
      const bars = m.residues.map((r, i) => {
        const s = r.plddt ?? 0;
        const rgb = Mol3D.plddtRGB(s, cb);
        const h = (s / 100) * 145;
        return `<rect x="${(10 + i * width).toFixed(2)}" y="${(158 - h).toFixed(2)}" width="${Math.max(1, width).toFixed(2)}" height="${h.toFixed(2)}" fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})"><title>${resLabel(r)}: pLDDT ${s.toFixed(1)}</title></rect>`;
      }).join('');
      const guide90 = 158 - 0.9 * 145;
      const guide70 = 158 - 0.7 * 145;
      const guide50 = 158 - 0.5 * 145;
      el('profile').innerHTML =
        `<line x1="10" x2="550" y1="${guide90}" y2="${guide90}" stroke="#9db5a7" stroke-dasharray="3 3"/>`
        + `<line x1="10" x2="550" y1="${guide70}" y2="${guide70}" stroke="#9db5a7" stroke-dasharray="3 3"/>`
        + `<line x1="10" x2="550" y1="${guide50}" y2="${guide50}" stroke="#9db5a7" stroke-dasharray="3 3"/>`
        + bars
        + `<text x="12" y="14" font-size="11" fill="#3b5a4e">Per-residue AlphaFold pLDDT (0–100)</text>`;
      el('profile-caption').textContent = 'Each vertical bar shows AlphaFold residue confidence (pLDDT). Dashed lines mark 90, 70, and 50 thresholds.';
    } else {
      const peak = Math.max(1, ...degrees);
      const bars = degrees.map((deg, i) => {
        const h = (deg / peak) * 142;
        const c = Mol3D.CHAIN_PALETTE[m.residues[i].chainIndex % Mol3D.CHAIN_PALETTE.length];
        return `<rect x="${(10 + i * width).toFixed(2)}" y="${(158 - h).toFixed(2)}" width="${Math.max(1, width).toFixed(2)}" height="${h.toFixed(2)}" fill="rgb(${c[0]},${c[1]},${c[2]})"><title>${resLabel(m.residues[i])}: ${deg} contacts</title></rect>`;
      }).join('');
      el('profile').innerHTML = bars + `<text x="12" y="14" font-size="11" fill="#3b5a4e">Contact degree per residue (cutoff ${el('cut').value} Å, max ${peak})</text>`;
      el('profile-caption').textContent = 'Experimental structure without predicted pLDDT; showing per-residue 3D contact degree colored by chain.';
    }
  }

  function drawMatrixOverlay() {
    if (!active) return;
    const dim = mapCanvas.width;
    const n = active.residues.length;
    const a = Number(el('a').value), b = Number(el('b').value);
    mapCtx.drawImage(baseMap, 0, 0);
    const x = Math.round(b * dim / n);
    const y = Math.round(a * dim / n);
    mapCtx.strokeStyle = 'rgba(213, 79, 32, 0.88)';
    mapCtx.lineWidth = 1.6;
    mapCtx.beginPath();
    mapCtx.moveTo(x, 0); mapCtx.lineTo(x, dim);
    mapCtx.moveTo(0, y); mapCtx.lineTo(dim, y);
    mapCtx.stroke();
    mapCtx.strokeRect(x - 4, y - 4, 8, 8);
  }

  function renderEntitiesPanel() {
    const m = active;
    const host = el('entities-list');
    host.replaceChildren();
    const cb = el('toggle-cb').getAttribute('aria-pressed') === 'true';

    for (const ch of m.chains) {
      const block = document.createElement('div');
      block.className = 'af-entity-block';
      const head = document.createElement('div');
      head.className = 'af-entity-head';
      const pill = document.createElement('span');
      pill.className = 'af-entity-pill';
      const cRGB = Mol3D.CHAIN_PALETTE[ch.index % Mol3D.CHAIN_PALETTE.length];
      pill.style.background = `rgb(${cRGB[0]},${cRGB[1]},${cRGB[2]})`;
      pill.textContent = `${ch.type.toUpperCase()} · ${ch.label}`;
      const countSpan = document.createElement('span');
      countSpan.style.fontSize = '13px';
      countSpan.style.color = 'var(--af-muted)';
      countSpan.textContent = ch.length + (ch.type === 'protein' ? ' residues' : ' nucleotides');
      head.append(pill, countSpan);
      block.append(head);

      const grid = document.createElement('div');
      grid.className = 'af-seq-grid';
      for (let offset = 0; offset < ch.length; offset += 10) {
        const group = document.createElement('div');
        group.className = 'af-seq-group';
        const num = document.createElement('span');
        num.className = 'af-seq-num';
        const endIdx = Math.min(ch.length - 1, offset + 9);
        num.textContent = String(m.residues[ch.start + endIdx].resSeq);
        const chunk = document.createElement('div');
        chunk.className = 'af-seq-chunk';

        for (let k = offset; k <= endIdx; k++) {
          const r = m.residues[ch.start + k];
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'af-res-btn';
          btn.dataset.resIndex = String(r.index);
          btn.textContent = r.oneLetter;
          btn.title = `${resLabel(r)}${r.plddt !== null ? ' · pLDDT ' + r.plddt.toFixed(1) : ''}`;
          if (r.plddt !== null) {
            const rgb = Mol3D.plddtRGB(r.plddt, cb);
            btn.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
            btn.classList.add(r.plddt >= 90 ? 'light-text' : 'dark-text');
          } else {
            btn.style.background = `rgba(${cRGB[0]},${cRGB[1]},${cRGB[2]},0.16)`;
          }
          btn.onclick = e => {
            if (e.shiftKey) el('b').value = String(r.index);
            else el('a').value = String(r.index);
            updateSelection();
          };
          chunk.append(btn);
        }
        group.append(num, chunk);
        grid.append(group);
      }
      block.append(grid);
      host.append(block);
    }

    // List metal ions & bound ligands just like AlphaFold Server's Information table!
    if (m.ligands.length) {
      const grouped = new Map();
      for (const lig of m.ligands) {
        const k = lig.resName + ':' + lig.chainId + ':' + lig.resSeq;
        if (!grouped.has(k)) grouped.set(k, { resName: lig.resName, atoms: 0 });
        grouped.get(k).atoms++;
      }
      const counts = new Map();
      for (const g of grouped.values()) counts.set(g.resName, (counts.get(g.resName) || 0) + 1);

      const block = document.createElement('div');
      block.className = 'af-entity-block';
      const head = document.createElement('div');
      head.className = 'af-entity-head';
      const pill = document.createElement('span');
      pill.className = 'af-entity-pill';
      pill.style.background = '#5b6196';
      pill.textContent = 'IONS & LIGANDS';
      const desc = document.createElement('span');
      desc.style.fontSize = '13.5px';
      desc.style.fontWeight = '600';
      desc.textContent = [...counts.entries()].map(([name, cnt]) => {
        const pretty = name === 'ZN' ? 'Zn²⁺ ion' : name === 'HEM' ? 'Heme porphyrin (HEM)' : name === 'OXY' ? 'Dioxygen (O₂)' : name;
        return `${pretty} ×${cnt}`;
      }).join(' · ');
      head.append(pill, desc);
      block.append(head);
      host.append(block);
    }
  }

  function highlightSequenceButtons() {
    const a = String(el('a').value), b = String(el('b').value);
    el('entities-list').querySelectorAll('.af-res-btn').forEach(btn => {
      btn.classList.toggle('is-a', btn.dataset.resIndex === a);
      btn.classList.toggle('is-b', btn.dataset.resIndex === b);
    });
  }

  function updateAudienceCopy() {
    if (!active) return;
    const m = active;
    const titleEl = el('audience-card-title');
    const lessonEl = el('lesson');
    if (audience === 'explorer') {
      titleEl.textContent = 'Explorer guide · What am I looking at?';
      lessonEl.textContent =
        (m.summary || 'This 3D ribbon traces the folded molecular backbone from start to finish.')
        + ' Blue sections indicate regions AlphaFold predicts with very high geometric certainty, while yellow or orange loops are flexible or disordered tails. Drag to spin the molecule and click any ribbon segment to measure distances in ångströms (1 Å = 0.1 nm).';
    } else if (audience === 'student') {
      titleEl.textContent = 'Student investigation · Classroom prompt';
      lessonEl.textContent = m.hasPlddt
        ? 'Compare a deep-blue core residue (pLDDT > 90) with a lower-confidence tail or loop. Click two off-diagonal residues in the PAE or Contact matrix that are >15 positions apart in sequence yet <8 Å apart in 3D space, then save the pair to your Evidence Workspace.'
        : 'Switch between Cartoon, Backbone Tube, and Spacefill views. Measure an intra-chain contact or an inter-chain interface pair (e.g. Protein–RNA in PDB 8AW3 or strand A–B in B-DNA 1BNA), export the CSV, and explain what the 3D fold adds beyond linear sequence order.';
    } else {
      titleEl.textContent = 'Researcher diagnostics · Structural & uncertainty scope';
      lessonEl.textContent =
        `Method: ${m.method}. Backbone radius of gyration Rg = ${m.rg.toFixed(2)} Å; maximum span = ${farthest[2].toFixed(2)} Å. `
        + (m.hasPlddt
          ? `Global mean pLDDT = ${m.plddtMean.toFixed(2)} (Very high: ${m.bands[0]}, Confident: ${m.bands[1]}, Low: ${m.bands[2]}, Very low: ${m.bands[3]}). PAE values report expected relative alignment error (Å) for single-chain AlphaFold DB v6 predictions; oligomeric interfaces or ligand-induced shifts require experimental or complex-level modeling.`
          : 'Experimental coordinates come from a deposited crystallographic/cryo-EM ensemble. Cα/C4′ proximity alone does not establish covalent bonding or conformational dynamics without atomic refinement data.');
    }
  }

  function updateSelection() {
    if (!active) return;
    const a = Number(el('a').value), b = Number(el('b').value);
    const ra = active.residues[a], rb = active.residues[b];
    if (!ra || !rb) return;
    const d = Mol3D.vDist(ra.xyz, rb.xyz);
    el('reading').textContent = d.toFixed(2) + ' Å';
    const sameChain = ra.chainIndex === rb.chainIndex;
    const paeText = active.pae ? ` · PAE ${getPaeValue(a, b).toFixed(1)} Å` : '';
    el('gap').textContent = sameChain
      ? `Sequence separation: ${Math.abs(ra.resSeq - rb.resSeq)} positions${paeText}`
      : `Inter-chain pair (${ra.chainId} ↔ ${rb.chainId})${paeText}`;

    const neighbors = contacts
      .filter(([i, j]) => i === a || j === a)
      .map(([i, j, dist]) => [i === a ? j : i, dist])
      .sort((x, y) => x[1] - y[1]);
    el('neighbors').replaceChildren(...neighbors.map(([j, dist]) => new Option(`${resLabel(active.residues[j])} · ${dist.toFixed(2)} Å`, String(j))));
    el('inspect').disabled = !neighbors.length;
    if (!neighbors.length) el('neighbors').add(new Option('No contacts within cutoff', ''));

    viewer.setSelection(a, b);
    drawMatrixOverlay();
    highlightSequenceButtons();
  }

  function updateStageBadge() {
    const repLabel = el('rep').selectedOptions[0]?.textContent || 'Cartoon';
    const colLabel = el('color-mode').selectedOptions[0]?.textContent || 'pLDDT';
    el('stage-badge').textContent = `${repLabel} · ${colLabel}`;
  }

  function renderConfidenceBar() {
    const m = active;
    const scoresEl = el('global-scores');
    scoresEl.replaceChildren();
    const addPill = (label, val) => {
      const span = document.createElement('span');
      span.className = 'af-score-pill';
      const strong = document.createElement('strong');
      strong.textContent = label + ' = ' + val;
      span.append(strong);
      scoresEl.append(span);
    };

    if (m.iptm !== null) addPill('ipTM', m.iptm.toFixed(2));
    if (m.ptm !== null) addPill('pTM', m.ptm.toFixed(2));
    if (m.plddtMean !== null) addPill('Mean pLDDT', m.plddtMean.toFixed(1));
    if (m.resolution && m.iptm === null) {
      const span = document.createElement('span');
      span.className = 'af-score-pill';
      span.textContent = m.resolution;
      scoresEl.append(span);
    }

    const meter = el('band-meter');
    if (m.hasPlddt && m.residues.length) {
      meter.hidden = false;
      meter.replaceChildren();
      const total = m.residues.length;
      const classes = ['var(--af-vhigh)', 'var(--af-conf)', 'var(--af-low)', 'var(--af-vlow)'];
      const names = ['Very high (>90)', 'Confident (70–90)', 'Low (50–70)', 'Very low (<50)'];
      m.bands.forEach((cnt, idx) => {
        if (!cnt) return;
        const bar = document.createElement('span');
        bar.style.width = (100 * cnt / total).toFixed(2) + '%';
        bar.style.background = classes[idx];
        bar.title = `${names[idx]}: ${cnt} residues (${(100 * cnt / total).toFixed(1)}%)`;
        meter.append(bar);
      });
    } else {
      meter.hidden = true;
    }
  }

  function refLink(url, text) {
    const a = document.createElement('a');
    a.href = url;
    a.textContent = text;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }

  function presentModel(model, catItem, initialRes) {
    active = model;
    activeCatalog = catItem;

    el('specimen-eyebrow').textContent = catItem?.badge || model.method;
    el('heading').textContent = model.name;
    document.title = model.name + ' · Assay Evidence Studio';
    el('intro').textContent = model.summary || model.subtitle;
    el('load-status').textContent = `${model.residues.length} backbone positions · ${model.chains.length} ${model.chains.length === 1 ? 'entity' : 'entities'}${model.ligands.length ? ' + ions/ligands' : ''}`;
    el('save-status').textContent = '';

    // Provenance & linked DNA button
    if (catItem && catItem.group === 'gene') {
      const afUrl = 'https://alphafold.ebi.ac.uk/entry/' + model.id;
      const keggUrl = 'https://www.kegg.jp/entry/' + catItem.keggId;
      el('provenance').replaceChildren(
        'AlphaFold DB v6 single-chain prediction (CC BY 4.0) paired with KEGG coding sequence. ',
        refLink(afUrl, model.id + ' · AlphaFold DB'),
        ' · ',
        refLink(keggUrl, catItem.keggId + ' · KEGG')
      );
      el('dna-link').href = 'dna.html?protein=' + model.id;
      el('dna-link').textContent = `Inspect ${dnaRecords[catItem.dnaIndex].gene} 3D DNA →`;
    } else if (model.source.startsWith('http')) {
      el('provenance').replaceChildren(
        model.method + '. Coordinates trace experimental backbone positions and bound ligands. ',
        refLink(model.source, 'PDB ' + model.id)
      );
      el('dna-link').href = 'dna.html';
      el('dna-link').textContent = 'Explore 10-Gene 3D DNA Lab →';
    } else {
      el('provenance').textContent = model.source + ' · Parsed locally in your browser.';
      el('dna-link').href = 'dna.html';
      el('dna-link').textContent = 'Explore 10-Gene 3D DNA Lab →';
    }

    // Choose default color scheme cleanly (respecting colorblind mode if enabled)
    const cbActive = el('toggle-cb').getAttribute('aria-pressed') === 'true';
    const defaultCol = cbActive ? 'colorblind' : (catItem?.defaultColor || (model.hasPlddt ? 'plddt' : (model.chains.length > 1 ? 'chain' : 'spectrum')));
    el('color-mode').value = defaultCol;
    viewer.setColorMode(defaultCol);
    updateStageBadge();

    // Populate Residue A / B dropdowns
    for (const id of ['a', 'b']) {
      const sel = el(id);
      sel.replaceChildren();
      model.residues.forEach((r, idx) => sel.add(new Option(resLabel(r), String(idx))));
    }
    const initA = Number.isInteger(initialRes) && initialRes >= 0 && initialRes < model.residues.length ? initialRes : 0;
    const initB = Math.min(model.residues.length - 1, initA === 0 ? Math.min(16, model.residues.length - 1) : Math.max(0, initA - 12));
    el('a').value = String(initA);
    el('b').value = String(initB);

    // Update matrix title & legend text
    const isRealPae = Boolean(model.pae);
    el('matrix-title').textContent = matrixMode === 'pae'
      ? (isRealPae ? 'Expected Position Error (PAE)' : 'Pairwise Distance Matrix (0–30 Å)')
      : (matrixMode === 'contact' ? 'Cα / Backbone Contact Map' : (model.hasPlddt ? 'Per-Residue pLDDT Profile' : 'Residue Contact Degree'));

    renderConfidenceBar();
    computeContacts();
    viewer.setModel(model, { a: initA, b: initB });
    renderEntitiesPanel();
    buildMatrix();
    updateSelection();
    updateAudienceCopy();
    renderGallery();
  }

  function loadById(id, initialRes) {
    const catItem = catalog.find(c => c.id === id) || catalog[0];
    picker.value = catItem.id;
    let model;

    if (catItem.id === '1UBQ') {
      model = Mol3D.normalize({
        id: '1UBQ',
        name: 'Human Ubiquitin (PDB 1UBQ)',
        subtitle: 'Experimental 1.8 Å X-ray structure · 76-residue β-grasp fold',
        summary: 'Human ubiquitin chain A resolved at 1.8 Å by X-ray crystallography — a classic fold combining a five-stranded β-sheet packed against an α-helix.',
        source: 'https://www.rcsb.org/structure/1UBQ',
        method: 'X-ray crystallography',
        resolution: '1.8 Å X-ray',
        rows: residues.map(([name, ...xyz], i) => [name, i + 1, ...xyz]),
      });
    } else if (experimental[catItem.id]) {
      const e = experimental[catItem.id];
      model = Mol3D.normalize({
        id: catItem.id,
        name: e.name,
        subtitle: e.subtitle,
        summary: e.summary,
        source: 'https://www.rcsb.org/structure/' + catItem.id,
        method: e.method,
        resolution: e.resolution,
        iptm: e.iptm ?? null,
        ptm: e.ptm ?? null,
        chains: e.chains,
        ligands: e.ligands,
        rows: e.rows,
      });
    } else if (bundledFolds[catItem.id]) {
      const f = bundledFolds[catItem.id];
      const rec = dnaRecords[catItem.dnaIndex];
      model = Mol3D.normalize({
        id: catItem.id,
        name: `${rec.gene} · ${rec.species}`,
        subtitle: f.description || rec.note,
        summary: rec.note,
        source: f.source,
        paeSource: f.paeSource,
        method: 'AlphaFold DB v' + (f.version || 6) + ' monomer prediction',
        hasPlddt: true,
        plddtMean: f.plddtMean,
        paeSize: f.paeSize,
        paeMax: f.paeMax,
        pae: f.pae,
        chain: f.chain || 'A',
        chainLabel: rec.gene + ' Protein (Chain A)',
        rows: f.rows,
      });
    }
    if (model) presentModel(model, catItem, initialRes);
  }

  function renderGallery() {
    const grid = el('specimen-gallery');
    grid.replaceChildren();
    const items = catalog.filter(c => galleryFilter === 'all' || c.group === galleryFilter);
    for (const item of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cosmos-card' + (active && active.id === item.id ? ' active' : '');
      const top = document.createElement('div');
      top.className = 'cosmos-card-top';
      const kind = document.createElement('span');
      kind.textContent = item.group === 'gene' ? 'Gene · AlphaFold v6' : (item.id === '8AW3' ? 'Flagship Complex' : 'PDB Experimental');
      const tag = document.createElement('span');
      tag.textContent = item.tag;
      top.append(kind, tag);
      const title = document.createElement('strong');
      title.textContent = item.title;
      const sp = document.createElement('span');
      sp.textContent = item.species;
      card.append(top, title, sp);
      card.onclick = () => {
        const url = new URL(location.href);
        url.searchParams.set('protein', item.id);
        history.replaceState(null, '', url);
        loadById(item.id);
        window.scrollTo({ top: 0, behavior: el('toggle-motion').getAttribute('aria-pressed') === 'true' ? 'auto' : 'smooth' });
      };
      grid.append(card);
    }
  }

  // Matrix interactions (hover readout + click to pick pair in 3D!)
  function matrixCoords(event) {
    const rect = mapCanvas.getBoundingClientRect();
    const n = active.residues.length;
    const j = Math.max(0, Math.min(n - 1, Math.floor((event.clientX - rect.left) / rect.width * n)));
    const i = Math.max(0, Math.min(n - 1, Math.floor((event.clientY - rect.top) / rect.height * n)));
    return [i, j];
  }
  mapCanvas.onmousemove = e => {
    if (!active) return;
    const [i, j] = matrixCoords(e);
    const ri = active.residues[i], rj = active.residues[j];
    const d = Mol3D.vDist(ri.xyz, rj.xyz);
    const pae = active.pae ? ` · PAE ${getPaeValue(i, j).toFixed(1)} Å` : '';
    el('matrix-hover').textContent = `Aligned ${resLabel(ri)} × Scored ${resLabel(rj)} · 3D Dist ${d.toFixed(2)} Å${pae}`;
  };
  mapCanvas.onclick = e => {
    if (!active) return;
    const [i, j] = matrixCoords(e);
    el('a').value = String(i);
    el('b').value = String(j);
    updateSelection();
  };

  // Wire controls
  picker.onchange = () => {
    const url = new URL(location.href);
    url.searchParams.set('protein', picker.value);
    history.replaceState(null, '', url);
    loadById(picker.value);
  };
  el('a').onchange = el('b').onchange = updateSelection;
  el('rep').onchange = () => { viewer.setRepresentation(el('rep').value); updateStageBadge(); };
  el('color-mode').onchange = () => { viewer.setColorMode(el('color-mode').value); updateStageBadge(); };
  el('zoom').oninput = () => viewer.setZoom(Number(el('zoom').value));
  el('reset').onclick = () => viewer.resetCamera();
  el('orient-axes').onclick = () => {
    const presets = ['default', 'xy', 'xz', 'yz'];
    orientStep = (orientStep + 1) % presets.length;
    viewer.orientAxes(presets[orientStep]);
  };
  el('toggle-spin').onclick = () => {
    const next = el('toggle-spin').getAttribute('aria-pressed') !== 'true';
    el('toggle-spin').setAttribute('aria-pressed', String(next));
    viewer.setAutoRotate(next);
  };
  el('toggle-theme').onclick = () => {
    const nextDark = el('toggle-theme').getAttribute('aria-pressed') !== 'true';
    el('toggle-theme').setAttribute('aria-pressed', String(nextDark));
    el('toggle-theme').textContent = nextDark ? 'Light stage' : 'Dark stage';
    viewer.setTheme(nextDark ? 'dark' : 'light');
  };
  el('download-png').onclick = () => {
    const a = document.createElement('a');
    a.href = viewer.toDataURL();
    a.download = (active?.id || 'structure') + '-3d.png';
    a.click();
  };
  el('extent').onclick = () => {
    el('a').value = String(farthest[0]);
    el('b').value = String(farthest[1]);
    updateSelection();
  };
  el('inspect').onclick = () => {
    if (el('neighbors').value !== '') {
      el('b').value = el('neighbors').value;
      updateSelection();
    }
  };
  el('chain-borders').onchange = buildMatrix;
  el('cut').onchange = el('sep').onchange = () => { computeContacts(); buildMatrix(); updateSelection(); };

  // Matrix tab switching
  document.querySelectorAll('[data-matrix]').forEach(btn => {
    btn.onclick = () => {
      matrixMode = btn.dataset.matrix;
      document.querySelectorAll('[data-matrix]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      el('matrix-canvas-box').hidden = matrixMode === 'profile';
      el('pae-scale').hidden = matrixMode !== 'pae';
      el('profile-box').hidden = matrixMode !== 'profile';
      el('cut-wrap').hidden = matrixMode !== 'contact';
      el('sep-wrap').hidden = matrixMode !== 'contact';
      el('matrix-title').textContent = matrixMode === 'pae'
        ? (active?.pae ? 'Expected Position Error (PAE)' : 'Pairwise Distance Matrix (0–30 Å)')
        : (matrixMode === 'contact' ? 'Cα / Backbone Contact Map' : (active?.hasPlddt ? 'Per-Residue pLDDT Profile' : 'Residue Contact Degree'));
      buildMatrix();
    };
  });

  // Audience mode buttons
  document.querySelectorAll('[data-audience]').forEach(btn => {
    btn.onclick = () => {
      audience = btn.dataset.audience;
      document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      updateAudienceCopy();
    };
  });

  // Accessibility toggles
  el('toggle-cb').onclick = () => {
    const on = el('toggle-cb').getAttribute('aria-pressed') !== 'true';
    el('toggle-cb').setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('cb-mode', on);
    if (on) {
      el('color-mode').value = 'colorblind';
      viewer.setColorMode('colorblind');
    } else if (active) {
      const def = activeCatalog?.defaultColor || (active.hasPlddt ? 'plddt' : 'chain');
      el('color-mode').value = def;
      viewer.setColorMode(def);
    }
    updateStageBadge();
    if (active) { renderEntitiesPanel(); drawProfile(); highlightSequenceButtons(); }
  };
  el('toggle-hc').onclick = () => {
    const on = el('toggle-hc').getAttribute('aria-pressed') !== 'true';
    el('toggle-hc').setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('hc-mode', on);
  };
  el('toggle-motion').onclick = () => {
    const on = el('toggle-motion').getAttribute('aria-pressed') !== 'true';
    el('toggle-motion').setAttribute('aria-pressed', String(on));
    viewer.setReducedMotion(on);
    if (on) el('toggle-spin').setAttribute('aria-pressed', 'false');
  };

  // Local PDB file upload (just like AlphaFold Server's "Load File(s)")
  el('load-pdb').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 8_000_000) throw Error('Choose a PDB file smaller than 8 MB.');
      const model = Mol3D.parsePDB(await file.text(), file.name);
      presentModel(model, { id: model.id, group: 'pdb', badge: 'Local PDB Upload', defaultColor: model.hasPlddt ? 'plddt' : (model.chains.length > 1 ? 'chain' : 'spectrum') });
    } catch (err) {
      el('load-status').textContent = 'Could not load PDB file: ' + err.message;
    } finally {
      e.target.value = '';
    }
  };

  // Gallery filter buttons
  document.querySelectorAll('[data-gallery]').forEach(btn => {
    btn.onclick = () => {
      galleryFilter = btn.dataset.gallery;
      document.querySelectorAll('[data-gallery]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      renderGallery();
    };
  });

  // Exports + Evidence Workspace Capture (100% compatible with assay-evidence/1!)
  function downloadBlob(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  el('save').onclick = () => {
    if (!active) return;
    const ra = active.residues[Number(el('a').value)], rb = active.residues[Number(el('b').value)];
    const csv = 'structure,source,chain_a,residue_a,chain_b,residue_b,distance_angstrom\n'
      + [active.id, active.source, ra.chainId, `${ra.resName} ${ra.resSeq}`, rb.chainId, `${rb.resName} ${rb.resSeq}`, Mol3D.vDist(ra.xyz, rb.xyz).toFixed(3)].join(',') + '\n';
    downloadBlob(`${active.id}-${ra.resSeq}-${rb.resSeq}.csv`, csv, 'text/csv');
  };
  el('trace').onclick = () => {
    if (!active) return;
    const out = {
      accession: active.id,
      source: active.source,
      columns: ['chain', 'residue', 'position', 'x_angstrom', 'y_angstrom', 'z_angstrom', 'plddt'],
      rows: active.residues.map(r => [r.chainId, r.resName, r.resSeq, ...r.xyz, r.plddt]),
    };
    downloadBlob(active.id + '-coordinates.json', JSON.stringify(out, null, 2), 'application/json');
  };
  el('edges').onclick = () => {
    if (!active) return;
    const lines = ['structure,source,residue_a,residue_b,distance_angstrom,cutoff_angstrom,min_separation'];
    for (const [i, j, d] of contacts) {
      lines.push([active.id, active.source, resLabel(active.residues[i]), resLabel(active.residues[j]), d.toFixed(4), el('cut').value, el('sep').value].join(','));
    }
    downloadBlob(active.id + '-contacts.csv', lines.join('\n') + '\n', 'text/csv');
  };
  el('save-evidence').onclick = () => {
    if (!active) return;
    const aIdx = Number(el('a').value), bIdx = Number(el('b').value);
    const ra = active.residues[aIdx], rb = active.residues[bIdx];
    const distance = Mol3D.vDist(ra.xyz, rb.xyz);
    const isPredicted = Boolean(active.hasPlddt);
    try {
      evidenceRecords.capture({
        kind: isPredicted ? 'simulated' : 'measured',
        title: `${active.id} · ${resLabel(ra)} – ${resLabel(rb)}`,
        dataset: active.name,
        method: active.method,
        metric: 'Backbone pair distance',
        value: Number(distance.toFixed(3)),
        unit: 'Å',
        source: active.source,
        details: {
          comparisonKey: `structure-${active.id}-pair-${ra.chainId}${ra.resSeq}-${rb.chainId}${rb.resSeq}`,
          accession: active.id,
          residueA: resLabel(ra),
          residueB: resLabel(rb),
          plddtA: ra.plddt,
          plddtB: rb.plddt,
          meanPlddt: active.plddtMean,
          paeAngstrom: active.pae ? getPaeValue(aIdx, bIdx) : null,
          radiusOfGyrationAngstrom: Number(active.rg.toFixed(3)),
          contactCount: contacts.length,
        },
      });
      el('save-status').textContent = `Saved ${active.id} (${resLabel(ra)} – ${resLabel(rb)}: ${distance.toFixed(2)} Å) to the Evidence Workspace.`;
    } catch (err) {
      el('save-status').textContent = 'Could not save measurement. ' + err.message;
    }
  };

  // Initialize from URL parameters (?protein=..., ?audience=..., ?res=...)
  const params = new URLSearchParams(location.search);
  const reqAudience = params.get('audience');
  if (['explorer', 'student', 'researcher'].includes(reqAudience)) {
    audience = reqAudience;
    document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.audience === audience)));
  }
  const reqId = params.get('protein');
  const reqRes = params.has('res') ? Math.max(0, parseInt(params.get('res'), 10) - 1) : null;
  const startId = catalog.some(c => c.id === reqId) ? reqId : '8AW3';
  loadById(startId, Number.isFinite(reqRes) ? reqRes : null);
})();
