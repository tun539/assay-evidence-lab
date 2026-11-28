'use strict';

(() => {
  const stations = [
    {
      id: 'structure',
      cat: 'structural',
      meta: '18 3D Models · WebGL2',
      name: '3D Molecular & Gene Structure Studio',
      nameVi: 'Xưởng cấu trúc phân tử & gen 3D',
      short: '3D Studio',
      task: 'Inspect PDB 8AW3 (Protein–RNA–2×Zn²⁺) or one of ten AlphaFold DB v6 gene folds, switch PAE/pLDDT tracks, fetch RCSB/AFDB mmCIF files, and measure Cα distances.',
      taskVi: 'Khảo sát phức hợp PDB 8AW3 hoặc 10 nếp gấp AlphaFold DB v6, đối chiếu bản đồ PAE/pLDDT và đo khoảng cách Cα.',
      question: 'What does a short distance between alpha carbons establish?',
      options: ['Geometric proximity in the displayed coordinates', 'An experimentally confirmed chemical bond'],
      correct: 0,
      reason: 'Chemical bonding requires atom-level electron density and chemistry context beyond an alpha-carbon distance.',
    },
    {
      id: 'molecular',
      cat: 'ml',
      meta: 'RL Q-Policy · molML',
      name: 'Molecular Learning Lab (TDH3 · P00359)',
      nameVi: 'Phòng thí nghiệm học máy phân tử (3D)',
      short: 'Molecular AI',
      task: 'Run the active-learning Q-policy across 18 held-out kinetics episodes, inspect molforge SMILES & ChemLint audits, and watch substrate dock into the Cys150–His177 GAPDH pocket in dual 3D.',
      taskVi: 'Chạy chính sách Q-learning chọn liều tối ưu, kiểm định molforge/ChemLint và quan sát cơ chất gắn vào túi xúc tác 3D.',
      question: 'Why does the RL Q-policy request a specific second substrate concentration after one anchor measurement?',
      options: ['To resolve ambiguity between high-Km and low-Km enzyme families in one step', 'To force every enzyme sample toward the same saturating plateau'],
      correct: 0,
      reason: 'Maximizing information at the second dose disambiguates kinetic families using just two experimental measurements.',
    },
    {
      id: 'dna',
      cat: 'structural',
      meta: '10 KEGG Genes · 3D',
      name: '3D Gene & DNA Lab (10 genes)',
      nameVi: 'Phòng Gen & DNA 3D (10 gen KEGG)',
      short: '3D DNA',
      task: 'Explore ten KEGG coding genes in shaded 3D double-helix geometry, jump from any codon directly to its folded AlphaFold amino acid, and assemble two reads.',
      taskVi: 'Khám phá 10 gen KEGG ở cấu trúc xoắn kép 3D, nhảy từ bộ ba codon sang vị trí gấp cuộn AlphaFold và ghép đoạn đọc.',
      question: 'How do you write the complementary strand in the same 5′ to 3′ direction?',
      options: ['Complement each base and preserve the order', 'Complement each base and reverse the order'],
      correct: 1,
      reason: 'The two strands are antiparallel, so expressing both in 5′→3′ order requires complementing and reversing.',
    },
    {
      id: 'kinetics',
      cat: 'ml',
      meta: '6 Rate Laws · OOD',
      name: 'Kinetics & OOD benchmark workbench',
      nameVi: 'Động học enzyme & Ngoại suy OOD',
      short: 'Kinetics OOD',
      href: 'kinetics.html',
      task: 'Compare Michaelis–Menten, Hill cooperativity, and Haldane substrate inhibition across 9 diagnostic graphs and inspect OOD extrapolation.',
      taskVi: 'So sánh 6 mô hình động học trên 9 đồ thị chẩn đoán và kiểm thử ngoại suy ngoài phân phối (OOD).',
      question: 'Which split protects the concentration holdout?',
      options: ['Remove every measurement at that concentration in both conditions', 'Remove one replicate and keep its same-concentration neighbors'],
      correct: 0,
      reason: 'Holding out an entire concentration tests extrapolation without same-level leakage.',
    },
    {
      id: 'simulation',
      cat: 'physics',
      meta: 'MACE / BioEmu · 3D',
      name: 'Simulation & ML Force-Field Workbench',
      nameVi: 'Mô phỏng động lực học & ML Force Field',
      short: 'Simulation',
      task: 'Fit a MACE or RBF-GP force field on a narrow interval, push initial displacement into the OOD regime for symplectic drift, and compare Langevin MD vs BioEmu ensembles.',
      taskVi: 'Huấn luyện trường lực MACE/GP, kiểm tra độ trôi symplectic vùng OOD và đối chiếu tập hợp BioEmu.',
      question: 'Which result tests extrapolation?',
      options: ['Error along a trajectory outside the fitted displacement interval', 'Error evaluated only on the fitted points'],
      correct: 0,
      reason: 'Out-of-range trajectories test whether the learned force law holds beyond training support.',
    },
    {
      id: 'tomography',
      cat: 'physics',
      meta: 'Cryo-ET · 6 Solvers',
      name: 'Inside the specimen · Cryo-ET & Tomography',
      nameVi: 'Tái tạo Cryo-ET & Nón khuyết',
      short: 'Tomography',
      task: 'Compare 4 vs 48 tilts across SIRT, FBP, and CS-TV, restrict the tilt range to inspect the 2D k-space Missing Wedge, and check FRC 0.143 resolution.',
      taskVi: 'So sánh 4 với 48 góc nghiêng trên SIRT/FBP/CS-TV, khảo sát vùng Missing Wedge và độ phân giải FRC.',
      question: 'What does the reconstruction RMSE compare?',
      options: ['The reconstructed slice and its simulated reference', 'AlphaFold predictions and an experimental microscope image'],
      correct: 0,
      reason: 'RMSE evaluates solver accuracy against the known ground-truth density volume.',
    },
    {
      id: 'transport',
      cat: 'physics',
      meta: '3D SPT · 8 Regimes',
      name: '3D Molecular Transport & SPT Workbench',
      nameVi: 'Khuếch tán dị thường 3D & SPT',
      short: '3D Transport',
      task: 'Compare Viscoelastic Chromatin (fBm) vs. Transient Traps (CTRW), inspect EA-MSD vs TA-MSD ergodicity breaking, and audit Michalet–Berglund CVE.',
      taskVi: 'Đối chiếu khuếch tán fBm và CTRW, phá vỡ tính ergodic EA/TA-MSD và nhiễu định vị 50 nm.',
      question: 'Which comparison tests the transport model?',
      options: ['Whether the tracers share a color', 'Whether measured ensemble & held-out trajectory statistics match the physical model'],
      correct: 1,
      reason: 'Ensemble/time-averaged MSDs, VACF, and held-out NLL discriminate competing physical diffusion regimes.',
    },
    {
      id: 'audit',
      cat: 'ml',
      meta: 'Cellpose & AlphaFold',
      name: 'Cellpose & AlphaFold Prediction Audit',
      nameVi: 'Kiểm định Cellpose & Hiệu chuẩn AlphaFold',
      short: 'Prediction Audit',
      task: 'Audit Cellpose-cyto3 vs Semantic U-Net across touching organoids, raise IoU τ to 0.75, and inspect TP53 vs SOD1 softmax logits, ECE, and 48×48 PAE pTM.',
      taskVi: 'Đo IoU/PQ phân đoạn tế bào và kiểm tra hiệu chuẩn ECE, logit softmax cùng pTM AlphaFold.',
      question: 'Which number measures segmentation agreement?',
      options: ['Mean residue pLDDT', 'The object match score at the selected overlap threshold'],
      correct: 1,
      reason: 'pLDDT evaluates per-residue local folding confidence, whereas Hungarian IoU / PQ evaluates instance masks.',
    },
    {
      id: 'expression',
      cat: 'ml',
      meta: '7,129 Probes · Cohorts',
      name: 'Gene expression atlas',
      nameVi: 'Tập bản đồ biểu hiện gen microarray',
      short: 'Expression',
      task: 'Choose a training-selected probe and compare the AML–ALL intensity contrast across the independent Golub validation cohort.',
      taskVi: 'Chọn probe từ tập huấn luyện và kiểm chứng tương phản AML–ALL trên tập độc lập.',
      question: 'What keeps test labels from shaping probe selection?',
      options: ['Selecting probes using only the training cohort', 'Selecting probes that rank highly across both cohorts'],
      correct: 0,
      reason: 'Training-only feature selection eliminates test-set data leakage.',
    },
    {
      id: 'research',
      cat: 'ml',
      meta: '569 Specimens · ROC',
      name: 'Research benchmark',
      nameVi: 'Đánh giá ngưỡng & ROC-AUC',
      short: 'Benchmark',
      task: 'Compare two classifiers and slide the decision threshold while observing precision, recall, and false negatives shift in real time.',
      taskVi: 'So sánh hai mô hình phân loại và dịch chuyển ngưỡng quyết định để theo dõi biến động lỗi.',
      question: 'What changes when a threshold moves but prediction scores stay fixed?',
      options: ['Ranking and AUROC', 'Confusion counts at that threshold'],
      correct: 1,
      reason: 'Score ranking (AUROC) stays constant while confusion matrix counts move with the threshold.',
    },
    {
      id: 'language',
      cat: 'structural',
      meta: 'EN / VI · Token→3D',
      name: 'Language and physics lab',
      nameVi: 'Phòng thí nghiệm Ngôn ngữ & Vật lý 3D',
      short: 'Language → 3D',
      task: 'Trace how bilingual English and Vietnamese spatial instructions map through learned token attention weights directly into a 3D scene transformation.',
      taskVi: 'Theo dõi cách câu lệnh song ngữ Anh–Việt ánh xạ qua trọng số chú ý vào biến đổi vật thể 3D.',
      question: 'What demonstrates cross-lingual grounding in this benchmark?',
      options: ['Consistent 3D target transformations produced by matched English and Vietnamese commands', 'Using identical English spelling inside Vietnamese sentences'],
      correct: 0,
      reason: 'Equivalent transformations under both languages reflect aligned semantic-spatial weights.',
    },
  ];

  // Keep backwards compatibility if hash targets `#practical`
  const hashId = location.hash.slice(1);
  if (hashId === 'practical') {
    const kIdx = stations.findIndex(s => s.id === 'kinetics');
    if (kIdx >= 0) location.hash = '#kinetics';
  }

  const get = id => document.getElementById(id);
  const cvs = get('atlas-map');
  const ctx = cvs.getContext('2d');
  const progressKey = 'assay-studio-missions-v1';

  let completed = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(progressKey) || '[]');
    completed = new Set(raw.map(id => (id === 'practical' ? 'kinetics' : id)).filter(id => stations.some(s => s.id === id)));
  } catch {}

  let active = Math.max(0, stations.findIndex(s => s.id === location.hash.slice(1)));
  let activeFilter = 'all';
  let yaw = 0.34, pitch = 0.42, drag = null, spinId = 0, lastTime = 0, hits = [], hoverIdx = -1;

  const CAT_COLORS = {
    structural: '#65CBF3',
    ml: '#a8e5c8',
    physics: '#efc182',
  };

  function renderMap() {
    const W = cvs.width, H = cvs.height;
    const bg = ctx.createRadialGradient(W * 0.5, H * 0.48, 22, W * 0.5, H * 0.5, W * 0.65);
    bg.addColorStop(0, '#183f47');
    bg.addColorStop(0.55, '#0d2630');
    bg.addColorStop(1, '#06151d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    function project(x, y, z) {
      const u = x * Math.cos(yaw) - z * Math.sin(yaw);
      const d = x * Math.sin(yaw) + z * Math.cos(yaw);
      const v = y * Math.cos(pitch) - d * Math.sin(pitch);
      const depth = y * Math.sin(pitch) + d * Math.cos(pitch);
      const scale = 650 / (650 - depth);
      return { x: W * 0.5 + u * scale, y: H * 0.49 - v * scale, depth, scale };
    }

    function line(a, b, color, width = 1) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.stroke();
    }

    // Perspective floor grid
    for (let i = -240; i <= 240; i += 48) {
      line(project(i, -118, -240), project(i, -118, 240), 'rgba(72,124,126,0.28)', 1);
      line(project(-240, -118, i), project(240, -118, i), 'rgba(72,124,126,0.28)', 1);
    }

    const core = project(0, 0, 0);
    const nodes = stations.map((st, i) => {
      const a = (i * 2 * Math.PI) / stations.length;
      const rad = i % 2 === 0 ? 228 : 196;
      const x = rad * Math.sin(a);
      const z = rad * Math.cos(a);
      const y = ((i % 3) - 1) * 74;
      const matchesFilter = activeFilter === 'all' || st.cat === activeFilter;
      return { i, st, matchesFilter, ...project(x, y, z), ground: project(x, -118, z) };
    }).sort((a, b) => a.depth - b.depth);

    for (const n of nodes) {
      const alpha = n.matchesFilter ? 1 : 0.25;
      line(n, n.ground, `rgba(92,140,142,${0.4 * alpha})`, 1);
      const linkCol = n.i === active ? '#8ee5c1' : `rgba(101,203,243,${0.28 * alpha})`;
      line(core, n, linkCol, n.i === active ? 2.6 : 1);
    }

    // Core glowing hub
    const coreGlow = ctx.createRadialGradient(core.x, core.y, 4, core.x, core.y, 38);
    coreGlow.addColorStop(0, '#96f2cc');
    coreGlow.addColorStop(0.55, '#1d585a');
    coreGlow.addColorStop(1, 'rgba(29,88,90,0)');
    ctx.fillStyle = coreGlow;
    ctx.beginPath();
    ctx.arc(core.x, core.y, 38, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(core.x, core.y, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#1b4e52';
    ctx.fill();
    ctx.strokeStyle = '#65CBF3';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.font = 'bold 11px Inter,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eefcf7';
    ctx.fillText('STUDIO', core.x, core.y + 4);

    hits = [];
    for (const n of nodes) {
      const r = (n.i === active ? 20 : 16) * n.scale;
      const col = CAT_COLORS[n.st.cat] || '#91dbcb';
      ctx.save();
      ctx.globalAlpha = n.matchesFilter ? 1 : 0.28;

      if (completed.has(n.st.id) || n.i === active || n.i === hoverIdx) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = n.i === active ? '#ffe29a' : completed.has(n.st.id) ? '#6de3b5' : '#ffffff';
        ctx.lineWidth = n.i === active ? 2.4 : 1.6;
        ctx.stroke();
      }

      const sphere = ctx.createRadialGradient(n.x - r * 0.32, n.y - r * 0.34, 1, n.x, n.y, r);
      sphere.addColorStop(0, '#ffffff');
      sphere.addColorStop(0.38, col);
      sphere.addColorStop(1, '#1f444d');
      ctx.fillStyle = sphere;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `${n.i === active ? '700' : '600'} 13.5px Inter,system-ui,sans-serif`;
      const lbl = n.st.short + (completed.has(n.st.id) ? ' ✓' : '');
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = n.i === active ? 'rgba(18,58,64,0.94)' : 'rgba(8,24,32,0.88)';
      ctx.fillRect(n.x - tw / 2 - 6, n.y + r + 4, tw + 12, 20);
      ctx.fillStyle = n.i === active ? '#a5f5d4' : '#edf8f3';
      ctx.fillText(lbl, n.x, n.y + r + 18);
      ctx.restore();

      hits.push({ ...n, r: Math.max(r, 22) });
    }
  }

  function updateLanguageAndBrief() {
    const p = typeof StudioPrefs !== 'undefined' ? StudioPrefs.get() : { lang: 'en' };
    const isVi = p.lang === 'vi';
    get('atlas-heading').textContent = isVi ? 'Nhiệm vụ nghiên cứu 3D' : 'Research missions';
    get('atlas-lead').textContent = isVi
      ? 'Điều hướng chòm sao 11 phòng thí nghiệm Assay Evidence Studio. Lọc theo chuyên ngành, lưu bằng chứng vào Workspace và kiểm chứng lập luận tại từng trạm.'
      : 'Navigate the 3D Assay Evidence Studio constellation. Filter by discipline, inspect primary models, save evidence packets into your browser workspace, and verify scientific reasoning at all eleven stations.';

    const s = stations[active];
    get('station-cat').textContent = s.cat.toUpperCase();
    get('station-meta').textContent = s.meta;
    get('station-title').textContent = isVi && s.nameVi ? s.nameVi : s.name;
    get('objective').textContent = isVi && s.taskVi ? s.taskVi : s.task;
    get('launch').href = s.href || `${s.id}.html`;
    get('launch').textContent = isVi ? 'Mở phòng thí nghiệm →' : 'Open experiment →';
  }

  function select(index) {
    active = index;
    const s = stations[index];
    history.replaceState(null, '', `#${s.id}`);
    updateLanguageAndBrief();
    get('question').textContent = s.question;
    get('choices').replaceChildren(
      ...s.options.map((option, i) => {
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'response';
        radio.value = i;
        radio.required = true;
        label.append(radio, option);
        return label;
      })
    );
    get('answer').textContent = '';
    updateProgress();
    renderMap();
  }

  function updateProgress() {
    const meter = get('progress-meter');
    meter.max = stations.length;
    meter.value = completed.size;
    get('progress').textContent = `${completed.size} of ${stations.length} checkpoints completed`;
    const resetBtn = get('reset-progress');
    if (resetBtn) resetBtn.disabled = completed.size === 0;

    const summary = get('workspace-summary');
    if (summary && typeof evidenceRecords !== 'undefined') {
      const saved = evidenceRecords.count();
      summary.textContent = saved
        ? `${saved} evidence ${saved === 1 ? 'record' : 'records'} saved in this browser workspace.`
        : 'Tip: capture runs from any mission lab to build a reviewable Evidence Workspace packet.';
    }

    Array.from(get('stations').children).forEach((b, i) => {
      const st = stations[i];
      b.textContent = st.short + (completed.has(st.id) ? ' ✓' : '');
      b.setAttribute('aria-pressed', String(active === i));
      b.classList.toggle('dimmed', activeFilter !== 'all' && st.cat !== activeFilter);
    });
  }

  const resetBtn = get('reset-progress');
  if (resetBtn) {
    resetBtn.onclick = () => {
      if (!confirm('Reset all completed mission checkpoints in this browser?')) return;
      completed.clear();
      try { localStorage.removeItem(progressKey); } catch {}
      get('answer').textContent = 'Checkpoint progress reset.';
      updateProgress();
      renderMap();
    };
  }

  window.addEventListener('assay-evidence-change', updateProgress);
  window.addEventListener('storage', updateProgress);
  window.addEventListener('studio-prefs-change', () => updateLanguageAndBrief());

  get('challenge').onsubmit = e => {
    e.preventDefault();
    const selected = get('choices').querySelector('input:checked');
    if (!selected) return;
    const s = stations[active];
    const correct = Number(selected.value) === s.correct;
    get('answer').textContent = `${correct ? 'Correct ✓ — ' : 'Try again — '}${s.reason}`;
    if (correct) {
      completed.add(s.id);
      try { localStorage.setItem(progressKey, JSON.stringify([...completed])); } catch {}
      updateProgress();
      renderMap();
    }
  };

  for (const [i, s] of stations.entries()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.short;
    b.onclick = () => select(i);
    get('stations').append(b);
  }

  document.querySelectorAll('.atlas-filter').forEach(btn => {
    btn.onclick = () => {
      activeFilter = btn.dataset.cat;
      document.querySelectorAll('.atlas-filter').forEach(x => {
        const isSel = x === btn;
        x.classList.toggle('active', isSel);
        x.setAttribute('aria-pressed', String(isSel));
      });
      if (activeFilter !== 'all' && stations[active].cat !== activeFilter) {
        const nextIdx = stations.findIndex(s => s.cat === activeFilter);
        if (nextIdx >= 0) select(nextIdx);
        else { updateProgress(); renderMap(); }
      } else {
        updateProgress();
        renderMap();
      }
    };
  });

  function animate(now) {
    yaw += Math.min(40, now - lastTime) * 0.00032;
    lastTime = now;
    renderMap();
    spinId = requestAnimationFrame(animate);
  }

  get('spin').onclick = () => {
    if (spinId) { cancelAnimationFrame(spinId); spinId = 0; }
    else { lastTime = performance.now(); spinId = requestAnimationFrame(animate); }
    get('spin').setAttribute('aria-pressed', String(Boolean(spinId)));
  };

  get('home-view').onclick = () => { yaw = 0.34; pitch = 0.42; renderMap(); };

  cvs.onpointerdown = e => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    cvs.setPointerCapture(e.pointerId);
  };
  cvs.onpointermove = e => {
    const r = cvs.getBoundingClientRect();
    const mx = ((e.clientX - r.left) * cvs.width) / r.width;
    const my = ((e.clientY - r.top) * cvs.height) / r.height;
    if (drag) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag = { x: e.clientX, y: e.clientY, moved: drag.moved + Math.hypot(dx, dy) };
      yaw += dx * 0.009;
      pitch = Math.max(-1.25, Math.min(1.25, pitch + dy * 0.009));
      renderMap();
      return;
    }
    const hit = hits.slice().reverse().find(n => Math.hypot(n.x - mx, n.y - my) < n.r);
    const nextHover = hit ? hit.i : -1;
    const tip = get('map-hover');
    if (nextHover !== hoverIdx) {
      hoverIdx = nextHover;
      cvs.style.cursor = hoverIdx >= 0 ? 'pointer' : 'grab';
      if (hoverIdx >= 0) {
        tip.textContent = `${stations[hoverIdx].name} · ${stations[hoverIdx].meta}`;
        tip.hidden = false;
      } else {
        tip.hidden = true;
      }
      renderMap();
    }
  };
  cvs.onpointerup = e => {
    if (drag && drag.moved < 6) {
      const r = cvs.getBoundingClientRect();
      const x = ((e.clientX - r.left) * cvs.width) / r.width;
      const y = ((e.clientY - r.top) * cvs.height) / r.height;
      const hit = hits.slice().reverse().find(n => Math.hypot(n.x - x, n.y - y) < n.r);
      if (hit) select(hit.i);
    }
    drag = null;
  };
  cvs.onlostpointercapture = () => { drag = null; };
  cvs.onkeydown = e => {
    const moves = { ArrowLeft: [-0.15, 0], ArrowRight: [0.15, 0], ArrowUp: [0, 0.15], ArrowDown: [0, -0.15] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    yaw += m[0];
    pitch = Math.max(-1.25, Math.min(1.25, pitch + m[1]));
    renderMap();
  };

  get('atlas-share').onclick = () => {
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.copyPermalink({});
  };

  get('atlas-tour').onclick = () => {
    if (typeof StudioPrefs === 'undefined') return;
    const vi = StudioPrefs.get().lang === 'vi';
    StudioPrefs.startTour([
      {
        selector: '.atlas-filter-bar',
        title: vi ? '1. Lọc theo lĩnh vực' : '1. Filter by Scientific Track',
        body: vi
          ? 'Lọc nhanh giữa Structural/DNA, molML/AI và Vật lý/Cryo-ET.'
          : 'Focus the 3D constellation on Structural Biology, molML/AI Audits, or Physics & Imaging.',
      },
      {
        selector: '.map-panel',
        title: vi ? '2. Chòm sao tương tác 3D' : '2. Interactive 3D Constellation',
        body: vi
          ? 'Kéo để xoay chòm sao hoặc nhấp vào quả cầu sáng để chọn trạm thí nghiệm.'
          : 'Orbit the constellation or click any luminous sphere to load its experiment briefing.',
      },
      {
        selector: '.mission',
        title: vi ? '3. Trạm kiểm chứng tri thức' : '3. Evidence Checkpoint',
        body: vi
          ? 'Mở thí nghiệm tương ứng, thu thập dữ liệu vào Workspace và hoàn thành câu hỏi kiểm chứng.'
          : 'Launch the workbench, capture evidence runs, and complete all eleven reasoning checkpoints.',
      },
    ]);
  };

  const modelMetrics = molecularData.metrics;
  for (const [title, summary] of [
    ['Classical ML', `Random forest · Vmax MAE ${modelMetrics['Random forest'][0].toFixed(2)} counts/min/min · Km ${modelMetrics['Random forest'][1].toFixed(4)} ppm`],
    ['Deep learning', `PyTorch MLP · Vmax MAE ${modelMetrics['PyTorch MLP'][0].toFixed(2)} counts/min/min · Km ${modelMetrics['PyTorch MLP'][1].toFixed(4)} ppm`],
    ['Reinforcement learning', `Learned second-dose Q-policy · ${(100 * molecularData.policies['Learned policy']).toFixed(2)}% family accuracy (+${(100 * molecularData.gain).toFixed(2)} pp)`],
  ]) {
    const tile = document.createElement('article');
    const h = document.createElement('h3');
    const p = document.createElement('p');
    h.textContent = title;
    p.textContent = summary;
    tile.append(h, p);
    get('tracks').append(tile);
  }

  if (location.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    const download = get('download-studio');
    download.href = 'https://github.com/tun539/assay-evidence-lab/archive/refs/heads/main.zip';
    download.removeAttribute('download');
    download.textContent = 'Get source ZIP on GitHub';
  }

  select(active);
})();
