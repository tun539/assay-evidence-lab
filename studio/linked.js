'use strict';

(() => {
  const el = id => document.getElementById(id);
  const foldCanvas = el('fold');
  const mapCanvas = el('map');
  const sequenceEl = el('sequence');

  const LETTERS = Object.fromEntries(
    'ALA:A ARG:R ASN:N ASP:D CYS:C GLN:Q GLU:E GLY:G HIS:H ILE:I LEU:L LYS:K MET:M PHE:F PRO:P SER:S THR:T TRP:W TYR:Y VAL:V'
      .split(' ')
      .map(s => s.split(':'))
  );

  let rows = [];
  let model3d = null;
  let activeId = foldIds[0];
  let activeModel = null;
  let dnaIndex = 0;
  let pair = [0, 0];
  let bestLongRange = [0, 0];
  let bestTight = [0, 0];
  let bestFar = [0, 0];
  let matrixMode = 'contact'; // 'contact' | 'pae'
  let mapTexture = document.createElement('canvas');

  const distance = (a, b) => Math.hypot(a[2] - b[2], a[3] - b[3], a[4] - b[4]);
  const label = r => `${r[0]} ${r[1]}`;

  function plddtHex(score, cb) {
    if (typeof score !== 'number') return '#45b89a';
    if (cb) {
      if (score >= 90) return '#0072B2';
      if (score >= 70) return '#56B4E9';
      if (score >= 50) return '#E69F00';
      return '#D55E00';
    }
    if (score >= 90) return '#0053D6';
    if (score >= 70) return '#65CBF3';
    if (score >= 50) return '#FFDB13';
    return '#FF7D45';
  }

  const viewer = Mol3D.createViewer(foldCanvas, {
    theme: 'dark',
    rep: 'cartoon',
    colorMode: 'plddt',
    showLabels: true,
    showAxes: true,
    onSpinChange(spinning) {
      el('toggle-spin').setAttribute('aria-pressed', String(spinning));
    },
    onHover(res) {
      const tip = el('hover-tip');
      if (!res) { tip.hidden = true; return; }
      const ssTxt = res.ss === 'H' ? 'α-helix' : res.ss === 'E' ? 'β-strand' : 'Loop / coil';
      const plTxt = res.plddt !== null ? ` · pLDDT ${res.plddt.toFixed(1)}` : '';
      tip.textContent = `${res.resName} ${res.resSeq} · ${ssTxt}${plTxt}`;
      tip.hidden = false;
    },
    onPick(res, shiftKey) {
      if (shiftKey) {
        pair[1] = res.index;
      } else {
        pick(res.index);
        return;
      }
      refresh();
    },
  });

  foldIds.forEach((id, i) => {
    el('protein').add(new Option(`${dnaRecords[i].gene} · ${dnaRecords[i].species} (${id})`, id));
  });

  const params = new URLSearchParams(location.search);
  const reqProtein = params.get('protein');
  if (reqProtein && foldIds.includes(reqProtein)) {
    el('protein').value = reqProtein;
  }

  function buildMatrixTexture() {
    const n = rows.length;
    if (matrixMode === 'pae' && activeModel && Array.isArray(activeModel.pae) && activeModel.paeSize) {
      const sz = activeModel.paeSize;
      mapTexture.width = mapTexture.height = sz;
      const ctx = mapTexture.getContext('2d');
      const img = ctx.createImageData(sz, sz);
      const maxPae = activeModel.paeMax || 31.75;
      for (let i = 0; i < sz * sz; i++) {
        const v = Math.max(0, Math.min(1, activeModel.pae[i] / maxPae));
        const r = Math.round(4 + v * 241);
        const g = Math.round(92 + v * 158);
        const b = Math.round(52 + v * 188);
        img.data.set([r, g, b, 255], i * 4);
      }
      ctx.putImageData(img, 0, 0);
      return;
    }

    mapTexture.width = mapTexture.height = n;
    const ctx = mapTexture.getContext('2d');
    const pixels = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const d = distance(rows[x], rows[y]);
        const contact = d <= 8;
        const veryTight = d <= 5.5;
        pixels.data.set(
          veryTight ? [12, 84, 64, 255] : contact ? [34, 134, 102, 255] : [235, 243, 237, 255],
          4 * (y * n + x)
        );
      }
    }
    ctx.putImageData(pixels, 0, 0);
  }

  function renderMatrix() {
    const n = rows.length;
    const [a, b] = pair;
    const w = mapCanvas.width;
    const h = mapCanvas.height;
    const ctx = mapCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = matrixMode === 'pae';
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(mapTexture, 0, 0, w, h);

    const x = ((a + 0.5) * w) / n;
    const y = ((b + 0.5) * h) / n;
    ctx.strokeStyle = matrixMode === 'pae' ? '#d97706' : '#8b295b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, h);
    ctx.moveTo(0, y); ctx.lineTo(w, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffc364';
    ctx.fill();
    ctx.strokeStyle = '#14201c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function updateCopyAndExplain() {
    const p = typeof StudioPrefs !== 'undefined' ? StudioPrefs.get() : { lang: 'en', audience: 'student', colorblind: false };
    const isVi = p.lang === 'vi';
    const [a, b] = pair;
    const d = distance(rows[a], rows[b]);
    const span = Math.abs(rows[a][1] - rows[b][1]);
    const rec = dnaRecords[dnaIndex];

    el('lk-title').textContent = isVi ? 'Khám phá liên kết Chuỗi ↔ 3D' : 'Linked protein explorer';
    el('lk-sub').textContent = isVi
      ? 'Những amino acid nào nằm xa nhau trên chuỗi 1D nhưng lại chạm nhau trong không gian gấp cuộn 3D? Bấm vào chuỗi, ma trận tiếp xúc 8 Å / PAE hoặc mô hình WebGL2 để đối chiếu tức thì.'
      : 'Which amino acids lie far apart along the chain yet meet inside the folded 3D structure? Click residues, 8 Å contact tiles, 48×48 PAE blocks, or shaded 3D ribbons in sync.';
    el('lk-save-record').textContent = isVi ? 'Lưu cặp đo vào Workspace' : 'Save pair to Workspace';
    el('matrix-title').textContent = matrixMode === 'pae'
      ? (isVi ? 'Ma trận AlphaFold PAE (48×48)' : 'AlphaFold PAE matrix (48×48)')
      : (isVi ? 'Bản đồ tiếp xúc Cα (ngưỡng 8 Å)' : 'Contact map (8 Å Cα)');

    const aud = p.audience;
    if (aud === 'explorer') {
      el('lk-explain').textContent = isVi
        ? `Mẹo: Dù cách nhau ${span} mắt xích trên chuỗi ${rec.gene}, hai điểm A và B chỉ cách ${d.toFixed(1)} Å trong không gian 3D — giống như hai đầu sợi dây được gấp lại gần nhau.`
        : `Analogy: Although separated by ${span} links along ${rec.gene}, residues A and B sit ${d.toFixed(1)} Å apart in 3D — like two distant beads on a string brought together by folding.`;
    } else if (aud === 'researcher') {
      el('lk-explain').textContent = `${activeId} (${rec.id}) · Mean pLDDT ${activeModel.plddtMean?.toFixed(1) || '—'} · Sep |i−j|=${span} · Cα–Cα d=${d.toFixed(2)} Å (${d <= 8 ? 'tertiary contact' : 'non-contact'}).`;
    } else {
      el('lk-explain').textContent = isVi
        ? `${rec.gene} (${rec.species}): Độ tin cậy pLDDT trung bình ${(activeModel.plddtMean || 0).toFixed(1)} · Khoảng cách 3D ${d <= 8 ? 'nằm trong' : 'ngoài'} ngưỡng tiếp xúc 8 Å.`
        : `${rec.gene} (${rec.species}): Mean pLDDT ${(activeModel.plddtMean || 0).toFixed(1)} · pair falls ${d <= 8 ? 'within' : 'outside'} the 8 Å Cα–Cα proximity threshold.`;
    }
  }

  function refresh() {
    if (!rows.length) return;
    const [a, b] = pair;
    const d = distance(rows[a], rows[b]);
    const cb = el('color-mode').value === 'colorblind';

    Array.from(sequenceEl.children).forEach((button, i) => {
      button.className = i === a ? 'a' : i === b ? 'b' : '';
      button.setAttribute('aria-pressed', String(i === a || i === b));
      button.style.borderBottom = `3px solid ${plddtHex(rows[i][5], cb)}`;
    });

    const plA = typeof rows[a][5] === 'number' ? ` (pLDDT ${rows[a][5].toFixed(1)})` : '';
    const plB = typeof rows[b][5] === 'number' ? ` (pLDDT ${rows[b][5].toFixed(1)})` : '';
    el('measurement').textContent =
      `A · ${label(rows[a])}${plA}   /   B · ${label(rows[b])}${plB}   ·   ${d.toFixed(2)} Å   ·   ` +
      `${Math.abs(rows[a][1] - rows[b][1])} positions apart   ·   ${d <= 8 ? 'within' : 'outside'} 8 Å`;

    viewer.setSelection(a, b);
    renderMatrix();
    updateCopyAndExplain();
  }

  function pick(i) {
    const slot = Number(el('slot').value);
    pair[slot] = i;
    el('slot').value = String(1 - slot);
    refresh();
  }

  function changeProtein() {
    activeId = el('protein').value;
    dnaIndex = foldIds.indexOf(activeId);
    activeModel = bundledFolds[activeId];
    rows = activeModel.rows;

    el('source').href = activeModel.source;
    el('open-studio').href = `structure.html?protein=${encodeURIComponent(activeId)}`;
    el('open-dna').href = `dna.html?gene=${encodeURIComponent(dnaRecords[dnaIndex].id)}`;

    bestLongRange = [0, Math.min(16, rows.length - 1)];
    bestTight = [0, Math.min(10, rows.length - 1)];
    bestFar = [0, rows.length - 1];
    let maxSpan = -1;
    let minTightDist = Infinity;
    let maxDist = -1;

    for (let y = 0; y < rows.length; y++) {
      for (let x = 0; x < y; x++) {
        const d = distance(rows[x], rows[y]);
        const span = y - x;
        if (d <= 8 && span > maxSpan) {
          maxSpan = span;
          bestLongRange = [x, y];
        }
        if (span >= 18 && d < minTightDist) {
          minTightDist = d;
          bestTight = [x, y];
        }
        if (d > maxDist) {
          maxDist = d;
          bestFar = [x, y];
        }
      }
    }

    pair = [...bestLongRange];
    model3d = Mol3D.normalize({
      id: activeId,
      name: dnaRecords[dnaIndex].gene,
      rows,
      hasPlddt: true,
      pae: activeModel.pae,
      paeSize: activeModel.paeSize,
      paeMax: activeModel.paeMax || 31.75,
    });

    buildMatrixTexture();

    sequenceEl.replaceChildren();
    rows.forEach((r, i) => {
      const b = document.createElement('button');
      b.textContent = LETTERS[r[0]] || 'X';
      const pl = typeof r[5] === 'number' ? ` · pLDDT ${r[5].toFixed(1)}` : '';
      b.title = `${label(r)}${pl}`;
      b.setAttribute('aria-label', `${label(r)}${pl}`);
      b.onclick = () => pick(i);
      sequenceEl.append(b);
    });

    el('slot').value = '0';
    viewer.setModel(model3d, { a: pair[0], b: pair[1] });
    el('hud-backend').textContent = viewer.getBackend() === 'webgl2' ? 'WebGL2 3D' : '2D Fallback';
    el('hud-fold').textContent = `${dnaRecords[dnaIndex].gene} · ${rows.length} aa · pLDDT ${(activeModel.plddtMean || 0).toFixed(1)}`;
    refresh();
  }

  function xy(e, canvas) {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height];
  }

  mapCanvas.onclick = e => {
    const [x, y] = xy(e, mapCanvas);
    const a = Math.min(rows.length - 1, Math.max(0, Math.floor((x * rows.length) / mapCanvas.width)));
    const b = Math.min(rows.length - 1, Math.max(0, Math.floor((y * rows.length) / mapCanvas.height)));
    pair = [a, b];
    refresh();
  };

  el('protein').onchange = changeProtein;
  el('rep').onchange = () => viewer.setRepresentation(el('rep').value);
  el('color-mode').onchange = () => {
    const mode = el('color-mode').value;
    viewer.setColorMode(mode);
    if (typeof StudioPrefs !== 'undefined') {
      StudioPrefs.save({ colorblind: mode === 'colorblind' });
    }
    refresh();
  };

  el('toggle-spin').onclick = () => {
    const next = !viewer.state.autoRotate;
    viewer.setAutoRotate(next);
    el('toggle-spin').setAttribute('aria-pressed', String(next));
  };

  el('reset-cam').onclick = () => viewer.resetCamera();
  el('focus-pair').onclick = () => viewer.focusResidue(pair[0], 1.65);

  el('tab-contact').onclick = () => {
    matrixMode = 'contact';
    el('tab-contact').setAttribute('aria-selected', 'true');
    el('tab-pae').setAttribute('aria-selected', 'false');
    buildMatrixTexture();
    refresh();
  };
  el('tab-pae').onclick = () => {
    matrixMode = 'pae';
    el('tab-pae').setAttribute('aria-selected', 'true');
    el('tab-contact').setAttribute('aria-selected', 'false');
    buildMatrixTexture();
    refresh();
  };

  el('pick-longest').onclick = () => { pair = [...bestLongRange]; refresh(); };
  el('pick-tightest').onclick = () => { pair = [...bestTight]; refresh(); };
  el('pick-far').onclick = () => { pair = [...bestFar]; refresh(); };
  el('swap-ab').onclick = () => { pair = [pair[1], pair[0]]; refresh(); };

  document.querySelectorAll('[data-audience]').forEach(btn => {
    btn.onclick = () => {
      if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ audience: btn.dataset.audience });
    };
  });
  el('lk-toggle-cb').onclick = () => {
    const cur = el('lk-toggle-cb').getAttribute('aria-pressed') === 'true';
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ colorblind: !cur });
  };

  el('lk-save-record').onclick = () => {
    if (typeof evidenceRecords === 'undefined') return;
    const [a, b] = pair;
    const d = Number(distance(rows[a], rows[b]).toFixed(2));
    const rec = dnaRecords[dnaIndex];
    evidenceRecords.capture({
      kind: 'model',
      title: `${rec.gene} (${activeId}) · ${label(rows[a])} ↔ ${label(rows[b])}`,
      dataset: `AlphaFold DB v6 · ${activeId} (${rec.species})`,
      method: 'Euclidean Cα–Cα residue separation',
      metric: 'Cα distance',
      value: d,
      unit: 'Å',
      source: activeModel.source,
      details: {
        comparisonKey: `linked-${activeId}`,
        gene: rec.gene,
        residueA: label(rows[a]),
        residueB: label(rows[b]),
        sequenceSpan: Math.abs(rows[a][1] - rows[b][1]),
        within8A: d <= 8,
      },
    });
    el('lk-save-status').textContent = 'Pair saved to Evidence Workspace ✓';
  };

  el('lk-share').onclick = () => {
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.copyPermalink({ protein: activeId });
  };

  el('lk-tour').onclick = () => {
    if (typeof StudioPrefs === 'undefined') return;
    const vi = StudioPrefs.get().lang === 'vi';
    StudioPrefs.startTour([
      {
        selector: '#sequence',
        title: vi ? '1. Dải trình tự & pLDDT 1D' : '1. 1D Sequence & Confidence Strip',
        body: vi
          ? 'Mỗi chữ cái mang thanh màu AlphaFold pLDDT. Bấm chọn để gán nhãn A (vàng) và B (tím) trong không gian 3D.'
          : 'Every residue shows its AlphaFold pLDDT color bar. Click letters to assign A (amber) and B (violet).',
      },
      {
        selector: '.lk-viewport',
        title: vi ? '2. Mô hình Ruy-băng 3D WebGL2' : '2. Shaded WebGL2 3D Ribbons',
        body: vi
          ? 'Quan sát khoảng cách Å giữa A và B ngay trên cấu trúc xoắn α / phiến β 3D chân thực.'
          : 'Inspect real-time Cα–Cα distances and badges directly on smooth α-helix and β-strand ribbons.',
      },
      {
        selector: '.lk-map-wrap',
        title: vi ? '3. Ma trận 8 Å & PAE 48×48' : '3. Contact Map & 48×48 PAE',
        body: vi
          ? 'Chuyển đổi giữa bản đồ tiếp xúc 8 Å và ma trận PAE AlphaFold để kiểm định tương tác giữa các miền.'
          : 'Toggle between the 8 Å geometric contact map and real AlphaFold 48×48 PAE uncertainty blocks.',
      },
    ]);
  };

  function syncPrefs(p) {
    if (!p) return;
    document.querySelectorAll('[data-audience]').forEach(btn => {
      btn.setAttribute('aria-pressed', String(btn.dataset.audience === p.audience));
    });
    el('lk-toggle-cb').setAttribute('aria-pressed', String(Boolean(p.colorblind)));
    viewer.setReducedMotion(Boolean(p.reducedMotion));
    if (p.colorblind && el('color-mode').value !== 'colorblind') {
      el('color-mode').value = 'colorblind';
      viewer.setColorMode('colorblind');
    } else if (!p.colorblind && el('color-mode').value === 'colorblind') {
      el('color-mode').value = 'plddt';
      viewer.setColorMode('plddt');
    }
    if (rows.length) refresh();
  }

  window.addEventListener('studio-prefs-change', e => syncPrefs(e.detail));

  changeProtein();
  if (typeof StudioPrefs !== 'undefined') syncPrefs(StudioPrefs.get());
})();
