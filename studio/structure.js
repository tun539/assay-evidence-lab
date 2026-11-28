'use strict';

(() => {
  const el = id => document.getElementById(id);
  const canvas = el('view');
  const mapCanvas = el('map');
  const mapCtx = mapCanvas.getContext('2d');
  const picker = el('protein');

  const AA3 = {
    A:'ALA',R:'ARG',N:'ASN',D:'ASP',C:'CYS',Q:'GLN',E:'GLU',G:'GLY',H:'HIS',I:'ILE',
    L:'LEU',K:'LYS',M:'MET',F:'PHE',P:'PRO',S:'SER',T:'THR',W:'TRP',Y:'TYR',V:'VAL',
  };

  const catalog = [];
  if (experimental['8AW3']) {
    catalog.push({
      id: '8AW3',
      group: 'pdb',
      multi: true,
      badge: 'AlphaFold Server Example · Multi-Entity',
      title: 'Protein–RNA–Ion Complex (PDB 8AW3)',
      species: 'Protein ×2 · tRNA ×1 · Zn²⁺ ×2',
      tag: 'ipTM 0.78 · pTM 0.75',
      defaultColor: 'chain',
    });
  }
  dnaRecords.forEach((rec, i) => {
    const id = foldIds[i];
    const fold = bundledFolds[id];
    catalog.push({
      id,
      group: 'gene',
      multi: false,
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
  catalog.push({
    id: '1UBQ',
    group: 'pdb',
    multi: false,
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
      multi: Boolean((m.ligands && m.ligands.length) || (m.chains && m.chains.length > 1)),
      badge: m.method + (m.resolution ? ' · ' + m.resolution : ''),
      title: m.name + ' (PDB ' + id + ')',
      species: m.subtitle || ('PDB ' + id),
      tag: m.ligands && m.ligands.length ? '+ Ligand' : (m.chains && m.chains.length > 1 ? m.chains.length + ' chains' : m.rows.length + ' res'),
      defaultColor: m.chains && m.chains.length > 1 ? 'chain' : 'spectrum',
    });
  }

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
  let matrixMode = 'pae'; // pae | contact | profile | table
  let audience = typeof StudioPrefs !== 'undefined' ? StudioPrefs.get().audience : 'student';
  let galleryFilter = 'all';
  let galleryQuery = '';
  let orientStep = 0;
  let contacts = [];
  let degrees = [];
  let farthest = [0, 0, 0];
  let hiddenChains = new Set();
  const baseMap = document.createElement('canvas');
  const thumbCache = new Map();

  const viewer = Mol3D.createViewer(canvas, {
    onZoom(z) { el('zoom').value = Math.max(0.5, Math.min(2.8, z)).toFixed(2); },
    onSpinChange(spinning) { el('toggle-spin').setAttribute('aria-pressed', String(spinning)); },
    onHover(res) {
      const tip = el('hover-tip');
      if (!res) { tip.hidden = true; return; }
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

  function syncPrefs(p) {
    if (!p) return;
    audience = p.audience;
    document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.audience === audience)));
    el('toggle-cb').setAttribute('aria-pressed', String(p.colorblind));
    el('toggle-hc').setAttribute('aria-pressed', String(p.highContrast));
    el('toggle-motion').setAttribute('aria-pressed', String(p.reducedMotion));
    viewer.setReducedMotion(p.reducedMotion);
    if (p.reducedMotion) el('toggle-spin').setAttribute('aria-pressed', 'false');
    if (p.colorblind) {
      el('color-mode').value = 'colorblind';
      viewer.setColorMode('colorblind');
    } else if (active && el('color-mode').value === 'colorblind') {
      const def = activeCatalog?.defaultColor || (active.hasPlddt ? 'plddt' : 'chain');
      el('color-mode').value = def;
      viewer.setColorMode(def);
    }
    updateStageBadge();
    if (active) {
      renderEntitiesPanel();
      drawProfile();
      highlightSequenceButtons();
      updateAudienceCopy();
    }
  }

  function resLabel(r) {
    return (active && active.chains.length > 1 ? r.chainId + ':' : '') + r.resName + ' ' + r.resSeq;
  }

  function paeGreenRGB(errAngstrom, maxVal = 30) {
    const t = Math.max(0, Math.min(1, errAngstrom / maxVal));
    if (t < 0.35) {
      const f = t / 0.35;
      return [Math.round(0 + 42 * f), Math.round(77 + 72 * f), Math.round(40 + 50 * f)];
    }
    const f = (t - 0.35) / 0.65;
    return [Math.round(42 + 213 * f), Math.round(149 + 106 * f), Math.round(90 + 165 * f)];
  }

  function getPaeValue(i, j) {
    if (!active) return 0;
    if (active.pae && active.paeSize) {
      const n = active.residues.length;
      const r = Math.min(active.paeSize - 1, Math.floor(i * active.paeSize / n));
      const c = Math.min(active.paeSize - 1, Math.floor(j * active.paeSize / n));
      return active.pae[r * active.paeSize + c];
    }
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

  function renderChainTracks() {
    const topT = el('pae-top-track');
    const leftT = el('pae-left-track');
    if (!topT || !leftT || !active) return;
    topT.replaceChildren();
    leftT.replaceChildren();
    const total = Math.max(1, active.residues.length);
    for (const ch of active.chains) {
      const rgb = Mol3D.CHAIN_PALETTE[ch.index % Mol3D.CHAIN_PALETTE.length];
      const pct = (100 * ch.length / total).toFixed(2) + '%';
      const sTop = document.createElement('span');
      sTop.style.width = pct;
      sTop.style.height = '100%';
      sTop.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      sTop.title = ch.label;
      const sLeft = document.createElement('span');
      sLeft.style.height = pct;
      sLeft.style.width = '100%';
      sLeft.style.background = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      sLeft.title = ch.label;
      topT.append(sTop);
      leftT.append(sLeft);
    }
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
          rgb = paeGreenRGB(getPaeValue(i, j), m.pae ? m.paeMax : 30);
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

    if (el('chain-borders').checked && m.chains.length > 1) {
      rctx.strokeStyle = 'rgba(15, 36, 31, 0.78)';
      rctx.lineWidth = 1.6;
      for (const ch of m.chains.slice(1)) {
        const pos = Math.round(ch.start * dim / n);
        rctx.beginPath();
        rctx.moveTo(pos, 0); rctx.lineTo(pos, dim);
        rctx.moveTo(0, pos); rctx.lineTo(dim, pos);
        rctx.stroke();
      }
    }

    renderChainTracks();
    drawProfile();
    renderA11yTable();
    drawMatrixOverlay();
  }

  function renderA11yTable() {
    const body = el('a11y-summary-rows');
    if (!body || !active) return;
    body.replaceChildren();
    for (const ch of active.chains) {
      const sub = active.residues.slice(ch.start, ch.start + ch.length);
      const pScores = sub.map(r => r.plddt).filter(Number.isFinite);
      const meanP = pScores.length ? (pScores.reduce((a, b) => a + b, 0) / pScores.length).toFixed(1) : 'Experimental';
      const tr = body.insertRow();
      tr.insertCell().textContent = ch.label;
      tr.insertCell().textContent = ch.type.toUpperCase();
      tr.insertCell().textContent = String(ch.length);
      tr.insertCell().textContent = pScores.length ? `pLDDT ${meanP}` : (active.resolution || 'Crystal / Cryo-EM');
    }
    if (active.ligands.length) {
      const tr = body.insertRow();
      tr.insertCell().textContent = 'Ions / Ligands';
      tr.insertCell().textContent = 'HETATM';
      tr.insertCell().textContent = String(active.ligands.length);
      tr.insertCell().textContent = [...new Set(active.ligands.map(l => l.resName))].join(', ');
    }
  }

  function drawProfile() {
    if (!active) return;
    const m = active;
    const n = m.residues.length;
    const width = 540 / Math.max(1, n);
    const cb = el('toggle-cb').getAttribute('aria-pressed') === 'true';
    const svg = el('profile');

    if (m.hasPlddt) {
      const bars = m.residues.map((r, i) => {
        const s = r.plddt ?? 0;
        const rgb = Mol3D.plddtRGB(s, cb);
        const h = (s / 100) * 145;
        return `<rect data-idx="${i}" x="${(10 + i * width).toFixed(2)}" y="${(162 - h).toFixed(2)}" width="${Math.max(1.2, width).toFixed(2)}" height="${h.toFixed(2)}" fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})" style="cursor:pointer"><title>${resLabel(r)}: pLDDT ${s.toFixed(1)}</title></rect>`;
      }).join('');
      const guide90 = 162 - 0.9 * 145;
      const guide70 = 162 - 0.7 * 145;
      const guide50 = 162 - 0.5 * 145;
      svg.innerHTML =
        `<line x1="10" x2="550" y1="${guide90}" y2="${guide90}" stroke="#9db5a7" stroke-dasharray="3 3"/>`
        + `<line x1="10" x2="550" y1="${guide70}" y2="${guide70}" stroke="#9db5a7" stroke-dasharray="3 3"/>`
        + `<line x1="10" x2="550" y1="${guide50}" y2="${guide50}" stroke="#9db5a7" stroke-dasharray="3 3"/>`
        + bars
        + `<text x="12" y="14" font-size="11" fill="#3b5a4e">Per-residue AlphaFold pLDDT (click any bar to focus 3D)</text>`;
      el('profile-caption').textContent = 'Each vertical bar shows AlphaFold residue confidence (pLDDT). Dashed lines mark 90, 70, and 50 thresholds.';
    } else {
      const peak = Math.max(1, ...degrees);
      const bars = degrees.map((deg, i) => {
        const h = (deg / peak) * 142;
        const c = Mol3D.CHAIN_PALETTE[m.residues[i].chainIndex % Mol3D.CHAIN_PALETTE.length];
        return `<rect data-idx="${i}" x="${(10 + i * width).toFixed(2)}" y="${(162 - h).toFixed(2)}" width="${Math.max(1.2, width).toFixed(2)}" height="${h.toFixed(2)}" fill="rgb(${c[0]},${c[1]},${c[2]})" style="cursor:pointer"><title>${resLabel(m.residues[i])}: ${deg} contacts</title></rect>`;
      }).join('');
      svg.innerHTML = bars + `<text x="12" y="14" font-size="11" fill="#3b5a4e">Contact degree per residue (cutoff ${el('cut').value} Å, click bar to select)</text>`;
      el('profile-caption').textContent = 'Experimental structure without predicted pLDDT; showing per-residue 3D contact degree colored by chain.';
    }

    svg.onclick = e => {
      const rect = e.target.closest('[data-idx]');
      if (!rect) return;
      el('a').value = rect.getAttribute('data-idx');
      updateSelection();
      viewer.focusResidue(Number(el('a').value), 1.45);
    };
  }

  function drawMatrixOverlay() {
    if (!active) return;
    const dim = mapCanvas.width;
    const n = active.residues.length;
    const a = Number(el('a').value), b = Number(el('b').value);
    mapCtx.drawImage(baseMap, 0, 0);
    const x = Math.round(b * dim / n);
    const y = Math.round(a * dim / n);
    mapCtx.strokeStyle = 'rgba(213, 79, 32, 0.9)';
    mapCtx.lineWidth = 1.6;
    mapCtx.beginPath();
    mapCtx.moveTo(x, 0); mapCtx.lineTo(x, dim);
    mapCtx.moveTo(0, y); mapCtx.lineTo(dim, y);
    mapCtx.stroke();
    mapCtx.strokeRect(x - 4, y - 4, 8, 8);
  }

  function updateEntityVisibilityControls() {
    viewer.setHiddenChains(hiddenChains);
    el('show-all-chains').hidden = hiddenChains.size === 0;
  }

  function renderEntitiesPanel() {
    const m = active;
    const host = el('entities-list');
    const pillsBar = el('entity-summary-pills');
    host.replaceChildren();
    pillsBar.replaceChildren();
    const cb = el('toggle-cb').getAttribute('aria-pressed') === 'true';

    for (const ch of m.chains) {
      const cRGB = Mol3D.CHAIN_PALETTE[ch.index % Mol3D.CHAIN_PALETTE.length];
      const topPill = document.createElement('button');
      topPill.type = 'button';
      topPill.className = 'af-mini-entity-btn';
      topPill.innerHTML = `<span class="af-mini-entity-dot" style="background:rgb(${cRGB[0]},${cRGB[1]},${cRGB[2]})"></span>${ch.label} (${ch.length})`;
      topPill.onclick = () => {
        hiddenChains.delete(ch.id);
        updateEntityVisibilityControls();
        renderEntitiesPanel();
        viewer.focusChain(ch.id);
      };
      pillsBar.append(topPill);

      const block = document.createElement('div');
      const isHidden = hiddenChains.has(ch.id);
      block.className = 'af-entity-block' + (isHidden ? ' is-hidden-chain' : '');
      const head = document.createElement('div');
      head.className = 'af-entity-head';
      const pill = document.createElement('span');
      pill.className = 'af-entity-pill';
      pill.style.background = `rgb(${cRGB[0]},${cRGB[1]},${cRGB[2]})`;
      pill.textContent = `${ch.type.toUpperCase()} · ${ch.label} (${ch.length})`;

      const actions = document.createElement('div');
      actions.className = 'af-entity-actions';

      const eyeBtn = document.createElement('button');
      eyeBtn.type = 'button';
      eyeBtn.className = 'af-entity-act';
      eyeBtn.setAttribute('aria-pressed', String(!isHidden));
      eyeBtn.textContent = isHidden ? 'Show' : 'Hide';
      eyeBtn.onclick = () => {
        if (hiddenChains.has(ch.id)) hiddenChains.delete(ch.id);
        else hiddenChains.add(ch.id);
        updateEntityVisibilityControls();
        renderEntitiesPanel();
      };

      const isoBtn = document.createElement('button');
      isoBtn.type = 'button';
      isoBtn.className = 'af-entity-act';
      isoBtn.textContent = 'Isolate';
      isoBtn.onclick = () => {
        hiddenChains = new Set(m.chains.filter(c => c.id !== ch.id).map(c => c.id));
        updateEntityVisibilityControls();
        renderEntitiesPanel();
        viewer.focusChain(ch.id);
      };

      const focBtn = document.createElement('button');
      focBtn.type = 'button';
      focBtn.className = 'af-entity-act';
      focBtn.textContent = 'Focus 3D';
      focBtn.onclick = () => {
        hiddenChains.delete(ch.id);
        updateEntityVisibilityControls();
        renderEntitiesPanel();
        viewer.focusChain(ch.id);
      };

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'af-entity-act';
      copyBtn.textContent = 'Copy Seq';
      copyBtn.onclick = () => {
        const seq = m.residues.slice(ch.start, ch.start + ch.length).map(r => r.oneLetter).join('');
        navigator.clipboard?.writeText(`>${m.id}_${ch.id}\n${seq}`);
        if (typeof StudioPrefs !== 'undefined') StudioPrefs.showToast(`Copied ${ch.label} sequence (${seq.length})`);
      };

      actions.append(eyeBtn, isoBtn, focBtn, copyBtn);
      head.append(pill, actions);
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

    if (m.ligands.length) {
      const grouped = new Map();
      for (const lig of m.ligands) {
        const k = lig.resName + ':' + lig.chainId + ':' + lig.resSeq;
        if (!grouped.has(k)) grouped.set(k, { resName: lig.resName, atoms: 0 });
        grouped.get(k).atoms++;
      }
      const counts = new Map();
      for (const g of grouped.values()) counts.set(g.resName, (counts.get(g.resName) || 0) + 1);

      const ligSummary = [...counts.entries()].map(([name, cnt]) => {
        const pretty = name === 'ZN' ? 'Zn²⁺' : name === 'HEM' ? 'Heme (HEM)' : name === 'OXY' ? 'O₂' : name;
        return `${pretty} ×${cnt}`;
      }).join(' · ');

      const topLig = document.createElement('span');
      topLig.className = 'af-mini-entity-btn';
      topLig.innerHTML = `<span class="af-mini-entity-dot" style="background:#5b6196"></span>${ligSummary}`;
      pillsBar.append(topLig);

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
      desc.textContent = ligSummary;
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
    const isVi = typeof StudioPrefs !== 'undefined' && StudioPrefs.get().lang === 'vi';
    if (audience === 'explorer') {
      titleEl.textContent = isVi ? 'Chế độ Khám phá · Mô hình 3D này nói lên điều gì?' : 'Explorer guide · What am I looking at?';
      lessonEl.textContent = isVi
        ? `${m.summary || ''} Các đoạn màu xanh dương đậm (>90) là vùng cấu trúc rất chắc chắn, còn vòng màu vàng/cam là vùng linh động. Kéo chuột để xoay mô hình 3D và bấm vào bất kỳ điểm nào để đo khoảng cách bằng Ångström (1 Å = 0.1 nm).`
        : (m.summary || 'This 3D ribbon traces the folded molecular backbone from start to finish.') + ' Blue sections indicate regions predicted with very high geometric certainty, while yellow or orange loops are flexible tails. Drag to spin and click any residue to measure distances in ångströms.';
    } else if (audience === 'biologist') {
      titleEl.textContent = isVi ? 'Chế độ Nhà sinh học · Túi gắn & Phối trí' : 'Biologist view · Active-site pockets & chains';
      lessonEl.textContent = isVi
        ? `Cấu trúc gồm ${m.chains.length} chuỗi (${m.ligands.length ? 'kèm ion/ligand phối trí' : 'đơn chuỗi'}). Dùng nút Isolate trên từng chuỗi hoặc bật "Active-site pocket sidechains" ở nút ⚙ để soi trực tiếp bộ khung nguyên tử quanh vị trí đang chọn.`
        : `Assembly contains ${m.chains.length} polymer ${m.chains.length === 1 ? 'entity' : 'entities'}${m.ligands.length ? ' with bound ligands/ions' : ''}. Use Isolate/Focus per chain or toggle Active-site pocket sidechains (⚙) to inspect local coordination within 5.6 Å of Residue A.`;
    } else if (audience === 'researcher') {
      titleEl.textContent = isVi ? 'Chế độ Nhà nghiên cứu · Thống kê & Phạm vi độ tin cậy' : 'Researcher diagnostics · Structural & uncertainty scope';
      lessonEl.textContent =
        `Method: ${m.method}. Rg = ${m.rg.toFixed(2)} Å; Max span = ${farthest[2].toFixed(2)} Å. `
        + (m.hasPlddt
          ? `Mean pLDDT = ${m.plddtMean.toFixed(2)} (Very high: ${m.bands[0]}, Confident: ${m.bands[1]}, Low: ${m.bands[2]}, Very low: ${m.bands[3]}). Export AlphaFold 3 mmCIF (.cif), PDB, PAE JSON, or fetch live full-atom coordinates.`
          : 'Experimental coordinates trace crystallographic/cryo-EM positions. Cα/C4′ proximity alone does not establish covalent bonding without atomic refinement.');
    } else {
      titleEl.textContent = isVi ? 'Chế độ Học tập · Thực hành đo lường' : 'Student investigation · Classroom prompt';
      lessonEl.textContent = m.hasPlddt
        ? 'Compare a deep-blue core residue (pLDDT > 90) with a lower-confidence loop. Hover across the PAE matrix to highlight domains in 3D, pick two off-diagonal residues <8 Å apart, and save the pair to your Evidence Workspace.'
        : 'Switch between Cartoon, Tube, All-Atom Ball & Stick, and Molecular Surface. Inspect Protein–RNA or Zn²⁺ contacts in PDB 8AW3, export CSV/CIF, and test how 3D folding brings distant sequence positions together.';
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
    const eng = typeof viewer.getBackend === 'function' && viewer.getBackend() === 'webgl2' ? 'WebGL2' : 'Canvas2D';
    el('stage-badge').textContent = `${eng} · ${repLabel} · ${colLabel}`;
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
    if (m.iptm !== null && m.ptm !== null) {
      addPill('Ranking', (0.8 * m.iptm + 0.2 * m.ptm).toFixed(2));
    }
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
    a.href = url; a.textContent = text; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }

  function presentModel(model, catItem, initialRes) {
    active = model;
    activeCatalog = catItem;
    hiddenChains.clear();

    el('specimen-eyebrow').textContent = catItem?.badge || model.method;
    el('heading').textContent = model.name;
    document.title = model.name + ' · Assay Evidence Studio';
    el('intro').textContent = model.summary || model.subtitle;
    el('load-status').textContent = `${model.residues.length} backbone positions · ${model.chains.length} ${model.chains.length === 1 ? 'entity' : 'entities'}${model.ligands.length ? ' + ions/ligands' : ''}`;
    el('save-status').textContent = '';

    if (catItem && catItem.group === 'gene') {
      const afUrl = 'https://alphafold.ebi.ac.uk/entry/' + model.id;
      const keggUrl = 'https://www.kegg.jp/entry/' + catItem.keggId;
      el('provenance').replaceChildren(
        'AlphaFold DB v6 single-chain prediction (CC BY 4.0) paired with KEGG coding sequence. ',
        refLink(afUrl, model.id + ' · AlphaFold DB'), ' · ', refLink(keggUrl, catItem.keggId + ' · KEGG')
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

    const cbActive = el('toggle-cb').getAttribute('aria-pressed') === 'true';
    const defaultCol = cbActive ? 'colorblind' : (catItem?.defaultColor || (model.hasPlddt ? 'plddt' : (model.chains.length > 1 ? 'chain' : 'spectrum')));
    el('color-mode').value = defaultCol;
    viewer.setColorMode(defaultCol);

    for (const id of ['a', 'b']) {
      const sel = el(id);
      sel.replaceChildren();
      model.residues.forEach((r, idx) => sel.add(new Option(resLabel(r), String(idx))));
    }
    const initA = Number.isInteger(initialRes) && initialRes >= 0 && initialRes < model.residues.length ? initialRes : 0;
    const initB = Math.min(model.residues.length - 1, initA === 0 ? Math.min(16, model.residues.length - 1) : Math.max(0, initA - 12));
    el('a').value = String(initA);
    el('b').value = String(initB);

    const isRealPae = Boolean(model.pae);
    el('matrix-title').textContent = matrixMode === 'pae'
      ? (isRealPae ? 'Expected Position Error (PAE)' : 'Pairwise Distance Matrix (0–30 Å)')
      : (matrixMode === 'contact' ? 'Cα / Backbone Contact Map' : (matrixMode === 'table' ? 'Entity Confidence Summary' : (model.hasPlddt ? 'Per-Residue pLDDT Profile' : 'Residue Contact Degree')));

    renderConfidenceBar();
    computeContacts();
    viewer.setModel(model, { a: initA, b: initB });
    updateStageBadge();
    renderEntitiesPanel();
    buildMatrix();
    updateSelection();
    updateAudienceCopy();
    renderGallery();
  }

  function buildNormalizedModel(catItem) {
    if (catItem.id === '1UBQ') {
      return Mol3D.normalize({
        id: '1UBQ',
        name: 'Human Ubiquitin (PDB 1UBQ)',
        subtitle: 'Experimental 1.8 Å X-ray structure · 76-residue β-grasp fold',
        summary: 'Human ubiquitin chain A resolved at 1.8 Å by X-ray crystallography — a classic fold combining a five-stranded β-sheet packed against an α-helix.',
        source: 'https://www.rcsb.org/structure/1UBQ',
        method: 'X-ray crystallography',
        resolution: '1.8 Å X-ray',
        rows: residues.map(([name, ...xyz], i) => [name, i + 1, ...xyz]),
      });
    }
    if (experimental[catItem.id]) {
      const e = experimental[catItem.id];
      return Mol3D.normalize({
        id: catItem.id, name: e.name, subtitle: e.subtitle, summary: e.summary,
        source: 'https://www.rcsb.org/structure/' + catItem.id, method: e.method,
        resolution: e.resolution, iptm: e.iptm ?? null, ptm: e.ptm ?? null,
        chains: e.chains, ligands: e.ligands, rows: e.rows,
      });
    }
    if (bundledFolds[catItem.id]) {
      const f = bundledFolds[catItem.id];
      const rec = dnaRecords[catItem.dnaIndex];
      return Mol3D.normalize({
        id: catItem.id, name: `${rec.gene} · ${rec.species}`,
        subtitle: f.description || rec.note, summary: rec.note,
        source: f.source, paeSource: f.paeSource,
        method: 'AlphaFold DB v' + (f.version || 6) + ' monomer prediction',
        hasPlddt: true, plddtMean: f.plddtMean, paeSize: f.paeSize, paeMax: f.paeMax,
        pae: f.pae, chain: f.chain || 'A', chainLabel: rec.gene + ' Protein (Chain A)', rows: f.rows,
      });
    }
    return null;
  }

  function loadById(id, initialRes) {
    const catItem = catalog.find(c => c.id === id) || catalog[0];
    picker.value = catItem.id;
    const model = buildNormalizedModel(catItem);
    if (model) presentModel(model, catItem, initialRes);
  }

  function getThumbnailUrl(catItem) {
    if (thumbCache.has(catItem.id)) return thumbCache.get(catItem.id);
    const m = buildNormalizedModel(catItem);
    if (!m) return '';
    const url = Mol3D.renderThumbnail(m, { width: 280, height: 158, colorMode: catItem.defaultColor, theme: 'dark' });
    thumbCache.set(catItem.id, url);
    return url;
  }

  function renderGallery() {
    const grid = el('specimen-gallery');
    grid.replaceChildren();
    const needle = galleryQuery.trim().toLowerCase();
    const items = catalog.filter(c => {
      if (galleryFilter === 'gene' && c.group !== 'gene') return false;
      if (galleryFilter === 'pdb' && c.group !== 'pdb') return false;
      if (galleryFilter === 'multi' && !c.multi) return false;
      if (needle) {
        const hay = `${c.id} ${c.title} ${c.species} ${c.tag} ${c.note || ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    for (const item of items) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'cosmos-card' + (active && active.id === item.id ? ' active' : '');

      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'cosmos-thumb';
      const thumbSrc = getThumbnailUrl(item);
      if (thumbSrc) {
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = '';
        img.loading = 'lazy';
        thumbWrap.append(img);
      }

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
      card.append(thumbWrap, top, title, sp);

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

  // Bidirectional PAE Matrix Hover (highlights 3D regions live!) & Click
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
    const span = Math.max(3, Math.round(active.residues.length * 0.03));
    viewer.setFocusRange([[Math.max(0, i - span), i + span], [Math.max(0, j - span), j + span]]);
  };
  mapCanvas.onmouseleave = () => {
    viewer.setFocusRange(null);
  };
  mapCanvas.onclick = e => {
    if (!active) return;
    const [i, j] = matrixCoords(e);
    el('a').value = String(i);
    el('b').value = String(j);
    viewer.setFocusRange(null);
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
  el('focus-a').onclick = () => viewer.focusResidue(Number(el('a').value), 1.75);
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
  el('toggle-fullscreen').onclick = () => {
    const wrap = el('stage-wrap');
    const on = !wrap.classList.contains('is-fullscreen');
    wrap.classList.toggle('is-fullscreen', on);
    el('toggle-fullscreen').setAttribute('aria-pressed', String(on));
    el('toggle-fullscreen').textContent = on ? 'Collapse' : 'Expand';
    viewer.render();
  };
  ['opt-outline', 'opt-ao', 'opt-pocket', 'opt-ligands', 'opt-labels'].forEach(id => {
    el(id).onchange = () => viewer.setRenderOptions({
      outline: el('opt-outline').checked,
      ao: el('opt-ao').checked,
      showPocket: el('opt-pocket').checked,
      showLigands: el('opt-ligands').checked,
      showLabels: el('opt-labels').checked,
    });
  });

  el('show-all-chains').onclick = () => {
    hiddenChains.clear();
    updateEntityVisibilityControls();
    renderEntitiesPanel();
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

  document.querySelectorAll('[data-matrix]').forEach(btn => {
    btn.onclick = () => {
      matrixMode = btn.dataset.matrix;
      document.querySelectorAll('[data-matrix]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      el('matrix-canvas-box').hidden = matrixMode === 'profile' || matrixMode === 'table';
      el('pae-scale').hidden = matrixMode !== 'pae';
      el('profile-box').hidden = matrixMode !== 'profile';
      el('table-box').hidden = matrixMode !== 'table';
      el('cut-wrap').hidden = matrixMode !== 'contact';
      el('sep-wrap').hidden = matrixMode !== 'contact';
      el('matrix-title').textContent = matrixMode === 'pae'
        ? (active?.pae ? 'Expected Position Error (PAE)' : 'Pairwise Distance Matrix (0–30 Å)')
        : (matrixMode === 'contact' ? 'Cα / Backbone Contact Map' : (matrixMode === 'table' ? 'Entity Confidence Summary' : (active?.hasPlddt ? 'Per-Residue pLDDT Profile' : 'Residue Contact Degree')));
      buildMatrix();
    };
  });

  document.querySelectorAll('[data-audience]').forEach(btn => {
    btn.onclick = () => {
      audience = btn.dataset.audience;
      if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ audience });
      document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.audience === audience)));
      updateAudienceCopy();
    };
  });

  el('toggle-cb').onclick = () => {
    const on = el('toggle-cb').getAttribute('aria-pressed') !== 'true';
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ colorblind: on });
    else syncPrefs({ ...StudioPrefs?.get?.(), colorblind: on, audience });
  };
  el('toggle-hc').onclick = () => {
    const on = el('toggle-hc').getAttribute('aria-pressed') !== 'true';
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ highContrast: on });
  };
  el('toggle-motion').onclick = () => {
    const on = el('toggle-motion').getAttribute('aria-pressed') !== 'true';
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ reducedMotion: on });
  };

  // Local .PDB / .CIF file upload
  el('load-pdb').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 16_000_000) throw Error('Choose a .pdb or .cif file smaller than 16 MB.');
      const text = await file.text();
      const isCif = file.name.toLowerCase().endsWith('.cif') || file.name.toLowerCase().endsWith('.mmcif') || text.includes('_atom_site.');
      const model = isCif ? Mol3D.parseCIF(text, file.name) : Mol3D.parsePDB(text, file.name);
      presentModel(model, { id: model.id, group: 'pdb', badge: isCif ? 'Local mmCIF Upload' : 'Local PDB Upload', defaultColor: model.hasPlddt ? 'plddt' : (model.chains.length > 1 ? 'chain' : 'spectrum') });
    } catch (err) {
      el('load-status').textContent = 'Could not load structure file: ' + err.message;
    } finally {
      e.target.value = '';
    }
  };

  // Optional online full-atom fetch from RCSB PDB / AlphaFold DB
  el('fetch-live').onclick = async () => {
    if (!active) return;
    const isGene = activeCatalog?.group === 'gene';
    const url = isGene
      ? `https://alphafold.ebi.ac.uk/files/AF-${active.id}-F1-model_v4.cif`
      : `https://files.rcsb.org/download/${active.id.slice(0, 4).toUpperCase()}.cif`;
    el('load-status').textContent = `Fetching full-atom mmCIF from ${isGene ? 'AlphaFold DB' : 'RCSB PDB'}...`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw Error(`HTTP ${resp.status}`);
      const cifText = await resp.text();
      const fullModel = Mol3D.parseCIF(cifText, `${active.id}-full-atom.cif`);
      fullModel.pae = active.pae;
      fullModel.paeSize = active.paeSize;
      fullModel.paeMax = active.paeMax;
      fullModel.iptm = active.iptm;
      fullModel.ptm = active.ptm;
      presentModel(fullModel, { ...activeCatalog, badge: `${activeCatalog?.badge || ''} · Live Full-Atom mmCIF` });
      el('load-status').textContent = `Loaded live full-atom mmCIF for ${active.id} (${fullModel.residues.length} residues + sidechains). Switch Representation to All-Atom or toggle Pocket!`;
    } catch (err) {
      el('load-status').textContent = `Offline / network fetch unavailable (${err.message}). Using bundled offline coordinates.`;
    }
  };

  // Gallery filter + search
  document.querySelectorAll('[data-gallery]').forEach(btn => {
    btn.onclick = () => {
      galleryFilter = btn.dataset.gallery;
      document.querySelectorAll('[data-gallery]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      renderGallery();
    };
  });
  el('gallery-search').oninput = e => {
    galleryQuery = e.target.value;
    renderGallery();
  };

  // Unified Download Menu (.CIF, .PDB, PAE JSON, FASTA, PNG, CSV, Workspace)
  function downloadBlob(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  el('download-png').onclick = () => {
    const a = document.createElement('a'); a.href = viewer.toDataURL(); a.download = (active?.id || 'structure') + '-3d.png'; a.click();
    el('download-menu').open = false;
  };
  el('dl-pdb').onclick = () => {
    if (!active) return;
    let serial = 1;
    const lines = [`HEADER    ASSAY EVIDENCE STUDIO                     ${active.id}`];
    for (const r of active.residues) {
      const atomName = r.chainType === 'protein' ? 'CA' : "C4'";
      const res3 = (r.resName || 'UNK').padStart(3, ' ').slice(0, 3);
      const b = Number.isFinite(r.plddt) ? r.plddt : 0;
      lines.push(`ATOM  ${String(serial++).padStart(5)}  ${atomName.padEnd(3)} ${res3} ${r.chainId[0] || 'A'}${String(r.resSeq).padStart(4)}    ${r.xyz[0].toFixed(3).padStart(8)}${r.xyz[1].toFixed(3).padStart(8)}${r.xyz[2].toFixed(3).padStart(8)}  1.00${b.toFixed(2).padStart(6)}           C`);
    }
    for (const l of active.ligands) {
      lines.push(`HETATM${String(serial++).padStart(5)} ${l.atomName.padEnd(4)} ${l.resName.padStart(3)} ${l.chainId[0] || 'A'}${String(l.resSeq).padStart(4)}    ${l.xyz[0].toFixed(3).padStart(8)}${l.xyz[1].toFixed(3).padStart(8)}${l.xyz[2].toFixed(3).padStart(8)}  1.00  0.00          ${l.element.padStart(2)}`);
    }
    lines.push('END');
    downloadBlob(active.id + '.pdb', lines.join('\n') + '\n', 'text/plain');
    el('download-menu').open = false;
  };
  el('dl-cif').onclick = () => {
    if (!active) return;
    let serial = 1;
    const rows = [
      `data_${active.id}`,
      'loop_',
      '_atom_site.group_PDB', '_atom_site.id', '_atom_site.type_symbol', '_atom_site.label_atom_id',
      '_atom_site.label_comp_id', '_atom_site.auth_asym_id', '_atom_site.auth_seq_id',
      '_atom_site.Cartn_x', '_atom_site.Cartn_y', '_atom_site.Cartn_z', '_atom_site.B_iso_or_equiv',
    ];
    for (const r of active.residues) {
      const aname = r.chainType === 'protein' ? 'CA' : "C4'";
      const b = Number.isFinite(r.plddt) ? r.plddt.toFixed(2) : '0.00';
      rows.push(`ATOM ${serial++} C ${aname} ${r.resName} ${r.chainId} ${r.resSeq} ${r.xyz[0].toFixed(3)} ${r.xyz[1].toFixed(3)} ${r.xyz[2].toFixed(3)} ${b}`);
    }
    for (const l of active.ligands) {
      rows.push(`HETATM ${serial++} ${l.element} ${l.atomName} ${l.resName} ${l.chainId} ${l.resSeq} ${l.xyz[0].toFixed(3)} ${l.xyz[1].toFixed(3)} ${l.xyz[2].toFixed(3)} 0.00`);
    }
    downloadBlob(active.id + '.cif', rows.join('\n') + '\n', 'text/plain');
    el('download-menu').open = false;
  };
  el('dl-pae').onclick = () => {
    if (!active) return;
    const payload = { id: active.id, iptm: active.iptm, ptm: active.ptm, plddtMean: active.plddtMean, paeSize: active.paeSize, predicted_aligned_error: active.pae };
    downloadBlob(active.id + '-pae.json', JSON.stringify(payload, null, 2), 'application/json');
    el('download-menu').open = false;
  };
  el('dl-fasta').onclick = () => {
    if (!active) return;
    const fasta = active.chains.map(ch => `>${active.id}_${ch.id} ${ch.label}\n${active.residues.slice(ch.start, ch.start + ch.length).map(r => r.oneLetter).join('')}`).join('\n') + '\n';
    downloadBlob(active.id + '.fasta', fasta, 'text/plain');
    el('download-menu').open = false;
  };

  el('save').onclick = () => {
    if (!active) return;
    const ra = active.residues[Number(el('a').value)], rb = active.residues[Number(el('b').value)];
    const csv = 'structure,source,chain_a,residue_a,chain_b,residue_b,distance_angstrom\n'
      + [active.id, active.source, ra.chainId, `${ra.resName} ${ra.resSeq}`, rb.chainId, `${rb.resName} ${rb.resSeq}`, Mol3D.vDist(ra.xyz, rb.xyz).toFixed(3)].join(',') + '\n';
    downloadBlob(`${active.id}-${ra.resSeq}-${rb.resSeq}.csv`, csv, 'text/csv');
  };
  el('trace').onclick = () => {
    if (!active) return;
    const out = { accession: active.id, source: active.source, columns: ['chain', 'residue', 'position', 'x_angstrom', 'y_angstrom', 'z_angstrom', 'plddt'], rows: active.residues.map(r => [r.chainId, r.resName, r.resSeq, ...r.xyz, r.plddt]) };
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
    try {
      evidenceRecords.capture({
        kind: active.hasPlddt ? 'simulated' : 'measured',
        title: `${active.id} · ${resLabel(ra)} – ${resLabel(rb)}`,
        dataset: active.name,
        method: active.method,
        metric: 'Backbone pair distance',
        value: Number(distance.toFixed(3)),
        unit: 'Å',
        source: active.source,
        details: {
          comparisonKey: `structure-${active.id}-pair-${ra.chainId}${ra.resSeq}-${rb.chainId}${rb.resSeq}`,
          accession: active.id, residueA: resLabel(ra), residueB: resLabel(rb),
          plddtA: ra.plddt, plddtB: rb.plddt, meanPlddt: active.plddtMean,
          paeAngstrom: active.pae ? getPaeValue(aIdx, bIdx) : null,
          radiusOfGyrationAngstrom: Number(active.rg.toFixed(3)), contactCount: contacts.length,
        },
      });
      el('save-status').textContent = `Saved ${active.id} (${resLabel(ra)} – ${resLabel(rb)}: ${distance.toFixed(2)} Å) to the Evidence Workspace.`;
    } catch (err) {
      el('save-status').textContent = 'Could not save measurement. ' + err.message;
    }
  };

  el('share-link').onclick = () => {
    if (typeof StudioPrefs !== 'undefined') {
      StudioPrefs.copyPermalink({ protein: active?.id, res: Number(el('a').value) + 1 });
    }
  };
  el('start-tour').onclick = () => {
    if (typeof StudioPrefs === 'undefined') return;
    const isVi = StudioPrefs.get().lang === 'vi';
    StudioPrefs.startTour([
      {
        selector: '#viewport-card',
        title: isVi ? '1. Khung WebGL2 3D chuẩn Mol*' : '1. Mol*-grade WebGL2 3D Viewport',
        body: isVi
          ? 'Mô hình 8AW3 gồm 2 chuỗi protein, 1 chuỗi tRNA và 2 ion Zn²⁺. Kéo để xoay, bấm ⚙ để bật túi gắn nguyên tử (Pocket Sidechains) hoặc bấm Focus A để bay camera tới vị trí chọn.'
          : 'Inspect multi-entity complexes (2 protein subunits + tRNA + 2 Zn²⁺ in 8AW3). Drag to orbit, open ⚙ for pocket sidechains/AO, or click Focus A.',
      },
      {
        selector: '#confidence-legend',
        title: isVi ? '2. Bảng màu pLDDT AlphaFold' : '2. AlphaFold pLDDT Confidence Scale',
        body: isVi
          ? 'Xanh dương đậm (>90) là vùng lõi chắc chắn; Xanh ngọc (70–90) là khung xương tin cậy; Vàng & Cam (<70) là vùng linh động hoặc vô định hình.'
          : 'Dark blue (>90) denotes high sidechain accuracy, cyan (70–90) confident backbone, and yellow/orange (<70) flexible or disordered regions.',
      },
      {
        selector: '#matrix-card',
        title: isVi ? '3. Ma trận PAE đồng bộ 2 chiều' : '3. Chain-Tracked PAE Heatmap',
        body: isVi
          ? 'Rê chuột trên ô PAE để làm nổi bật cặp miền tương ứng trực tiếp trên mô hình 3D; bấm vào ô để đo khoảng cách thực (Å).'
          : 'Hover across the PAE matrix to highlight matching domains directly in 3D; click any cell to measure exact 3D Ångström distances.',
      },
      {
        selector: '#info-section',
        title: isVi ? '4. Quản lý Thực thể & Chuỗi trình tự' : '4. Entities, Isolation & Sequence Track',
        body: isVi
          ? 'Ẩn/hiện hoặc cô lập riêng từng chuỗi (Protein / tRNA), sao chép FASTA, hoặc bấm vào từng ký tự amino acid/nucleotide để nhảy vị trí.'
          : 'Hide, isolate, or focus individual chains, copy FASTA sequences, or click any residue tile to inspect.',
      },
    ]);
  };

  window.addEventListener('studio-prefs-change', e => syncPrefs(e.detail));

  const params = new URLSearchParams(location.search);
  const reqId = params.get('protein');
  const reqRes = params.has('res') ? Math.max(0, parseInt(params.get('res'), 10) - 1) : null;
  const startId = catalog.some(c => c.id === reqId) ? reqId : '8AW3';
  if (typeof StudioPrefs !== 'undefined') syncPrefs(StudioPrefs.get());
  loadById(startId, Number.isFinite(reqRes) ? reqRes : null);
})();
