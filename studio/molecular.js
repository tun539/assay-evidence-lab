'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const { doses, anchor, actions, bins, q, examples, metrics, policies } = molecularData;
  const families = [
    'Lower plateau · lower Km',
    'Higher plateau · lower Km',
    'Lower plateau · higher Km',
    'Higher plateau · higher Km',
  ];

  let activeTab = 'curves';
  let revealed = false;
  let audience = typeof StudioPrefs !== 'undefined' ? StudioPrefs.get().audience : 'student';
  let colorblind = typeof StudioPrefs !== 'undefined' ? StudioPrefs.get().colorblind : false;

  function pal() {
    return colorblind
      ? { truth: '#0072b2', mm: '#009e73', ridge: '#56b4e9', rf: '#e69f00', mlp: '#cc79a7', fix: '#d55e00' }
      : { truth: '#114f3d', mm: '#0ea5e9', ridge: '#6366f1', rf: '#d97706', mlp: '#e11d48', fix: '#b85627' };
  }

  function table(id, values) {
    const body = byId(id);
    body.replaceChildren();
    for (const row of values) {
      const tr = body.insertRow();
      for (const value of row) tr.insertCell().textContent = value;
    }
  }

  function current() {
    const epIdx = Number(byId('episode').value);
    const example = examples[epIdx];
    const rate = example.rates[anchor];
    const bin = bins.filter(value => rate >= value).length;
    return { epIdx, example, rate, bin, values: q[bin] };
  }

  function updateKpis() {
    const { example, rate, bin, values } = current();
    const bestActionIdx = values.indexOf(Math.max(...values));
    const bestDose = doses[actions[bestActionIdx]];
    const choice = Number(byId('dose').value);
    const chosenDoseIdx = actions[choice];

    byId('kpi-anchor').textContent = `${rate.toFixed(1)} cpm`;
    byId('kpi-anchor-sub').textContent = `Bin ${bin} of ${q.length - 1} · [S₁] = ${doses[anchor]} ppm`;

    byId('kpi-policy').textContent = `${bestDose} ppm`;
    byId('kpi-policy-sub').textContent = `Est. Q* = ${(values[bestActionIdx] * 100).toFixed(1)}% accuracy`;

    if (revealed) {
      const [vmax, km] = example.params;
      const obs2 = example.rates[chosenDoseIdx];
      const true2 = vmax * doses[chosenDoseIdx] / (km + doses[chosenDoseIdx]);
      byId('kpi-second').textContent = `${obs2.toFixed(1)} cpm`;
      byId('kpi-second-sub').textContent = `@ ${doses[chosenDoseIdx]} ppm (noiseless: ${true2.toFixed(1)})`;

      const predFam = example.decoded[choice];
      const match = predFam === example.family;
      byId('kpi-family').textContent = match ? 'Correct ✓' : 'Mismatch';
      byId('kpi-family-sub').textContent = `${families[predFam]} (true: Fam ${example.family + 1})`;
    } else {
      byId('kpi-second').textContent = 'Pending';
      byId('kpi-second-sub').textContent = `Selected [S₂] = ${doses[chosenDoseIdx]} ppm`;
      byId('kpi-family').textContent = 'Pending';
      byId('kpi-family-sub').textContent = 'Click "Reveal second rate"';
    }

    const rf = metrics['Random forest'];
    byId('kpi-best-ml').textContent = `RF · ${rf[0].toFixed(2)}`;
    byId('kpi-best-ml-sub').textContent = `Vmax MAE ${rf[0].toFixed(2)} · Km ${rf[1].toFixed(4)} ppm`;

    byId('kpi-gain').textContent = `+${(molecularData.gain * 100).toFixed(2)} pp`;
    byId('kpi-gain-sub').textContent = `95% CI: ${molecularData.gainInterval.map(v => (v * 100).toFixed(2)).join(' to ')} pp`;
  }

  function renderSaturationSvg() {
    const svg = byId('ml-curves-svg');
    if (!svg) return;
    const { example } = current();
    const choice = Number(byId('dose').value);
    const chosenIdx = actions[choice];
    const p = pal();
    const padL = 62, padR = 24, padT = 32, padB = 46;
    const w = 640, h = 340, pw = w - padL - padR, ph = h - padT - padB;
    const maxY = 260;
    const X = s => padL + (Math.log(s / 0.015) / Math.log(1.3 / 0.015)) * pw;
    const Y = v => padT + ph - (Math.max(-10, Math.min(maxY, v)) / maxY) * ph;

    let out = `<rect width="${w}" height="${h}" fill="#f8fbf8"/>`;
    for (const yv of [0, 50, 100, 150, 200, 250]) {
      out += `<line x1="${padL}" x2="${w - padR}" y1="${Y(yv)}" y2="${Y(yv)}" stroke="#dce7de"/>`;
      out += `<text x="${padL - 8}" y="${Y(yv) + 4}" text-anchor="end" font-size="11" fill="#466257">${yv}</text>`;
    }
    for (const s of doses) {
      out += `<line x1="${X(s)}" x2="${X(s)}" y1="${padT}" y2="${padT + ph}" stroke="#eaf1eb" stroke-dasharray="3 3"/>`;
      out += `<text x="${X(s)}" y="${h - 22}" text-anchor="middle" font-size="11" fill="#466257">${s}</text>`;
    }
    out += `<text x="${padL + pw / 2}" y="${h - 5}" text-anchor="middle" font-size="12" font-weight="600" fill="#183c33">Substrate [S] (ppm, log scale)</text>`;
    out += `<text x="16" y="${padT + ph / 2}" transform="rotate(-90 16 ${padT + ph / 2})" text-anchor="middle" font-size="12" font-weight="600" fill="#183c33">Rate (counts/min/min)</text>`;

    const drawCurve = (vmax, km, stroke, dash, width) => {
      const pts = Array.from({ length: 65 }, (_, k) => {
        const s = 0.018 * Math.pow(1.2 / 0.018, k / 64);
        return `${X(s).toFixed(1)},${Y(vmax * s / (km + s)).toFixed(1)}`;
      }).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${stroke}" stroke-width="${width}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
    };

    if (revealed) {
      out += drawCurve(example.params[0], example.params[1], p.truth, '', 3);
      out += drawCurve(...example.estimates['Michaelis–Menten fit'], p.mm, '5 4', 2);
      out += drawCurve(...example.estimates['Ridge regression'], p.ridge, '3 3', 2);
      out += drawCurve(...example.estimates['Random forest'], p.rf, '8 3', 2.2);
      out += drawCurve(...example.estimates['PyTorch MLP'], p.mlp, '2 3', 2.2);
      // All 6 noisy observations
      doses.forEach((s, i) => {
        const isAnc = i === anchor;
        const isSel = i === chosenIdx;
        out += `<circle cx="${X(s)}" cy="${Y(example.rates[i])}" r="${isAnc || isSel ? 6 : 4}" fill="${isSel ? p.fix : (isAnc ? p.truth : '#64748b')}" stroke="#fff" stroke-width="1.5"><title>${s} ppm: ${example.rates[i].toFixed(1)} cpm</title></circle>`;
      });
    } else {
      // Only show anchor measurement before revealing 2nd dose
      const s = doses[anchor], r = example.rates[anchor];
      out += `<circle cx="${X(s)}" cy="${Y(r)}" r="7" fill="${p.truth}" stroke="#fff" stroke-width="2"><title>Anchor ${s} ppm: ${r.toFixed(1)} cpm</title></circle>`;
      out += `<line x1="${X(doses[chosenIdx])}" x2="${X(doses[chosenIdx])}" y1="${padT}" y2="${padT + ph}" stroke="${p.fix}" stroke-width="2" stroke-dasharray="5 4"/>`;
      out += `<text x="${X(doses[chosenIdx]) - 6}" y="${padT + 16}" text-anchor="end" font-size="11.5" font-weight="700" fill="${p.fix}">Chosen [S₂] = ${doses[chosenIdx]} ppm</text>`;
    }

    // Legend strip
    const items = revealed
      ? [['Truth', p.truth], ['MM Fit', p.mm], ['Ridge', p.ridge], ['RF', p.rf], ['PyTorch', p.mlp]]
      : [['Anchor (0.11 ppm)', p.truth], ['Target [S₂]', p.fix]];
    items.forEach(([lbl, col], idx) => {
      const lx = padL + idx * 108;
      out += `<rect x="${lx}" y="8" width="12" height="4" rx="2" fill="${col}"/><text x="${lx + 16}" y="14" font-size="11" font-weight="600" fill="#183c33">${lbl}</text>`;
    });

    svg.innerHTML = out;
  }

  function renderQHeatmapSvg() {
    const svg = byId('ml-qmap-svg');
    if (!svg) return;
    const { bin } = current();
    const choice = Number(byId('dose').value);
    const padL = 78, padT = 38, w = 640, h = 360;
    const cellW = (w - padL - 20) / actions.length;
    const cellH = (h - padT - 30) / q.length;

    let out = `<rect width="${w}" height="${h}" fill="#f8fbf8"/>`;
    out += `<text x="${padL + (w - padL - 20) / 2}" y="22" text-anchor="middle" font-size="12.5" font-weight="700" fill="#13312a">Q(bin, dose) · Expected Family Classification Accuracy (Click cell to select dose)</text>`;

    actions.forEach((dIdx, c) => {
      const cx = padL + c * cellW + cellW / 2;
      out += `<text x="${cx}" y="${h - 10}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${c === choice ? '#b85627' : '#325046'}">${doses[dIdx]} ppm</text>`;
    });

    q.forEach((row, rIdx) => {
      const y = padT + rIdx * cellH;
      const lbl = rIdx === 0 ? `<${bins[0].toFixed(0)}` : (rIdx === q.length - 1 ? `≥${bins[bins.length - 1].toFixed(0)}` : `${bins[rIdx - 1].toFixed(0)}–${bins[rIdx].toFixed(0)}`);
      out += `<text x="${padL - 8}" y="${y + cellH * 0.7}" text-anchor="end" font-size="10" font-weight="${rIdx === bin ? '700' : '500'}" fill="${rIdx === bin ? '#b85627' : '#4a645a'}">B${rIdx} (${lbl})</text>`;
      const bestC = row.indexOf(Math.max(...row));
      row.forEach((val, c) => {
        const x = padL + c * cellW;
        const norm = Math.max(0, Math.min(1, (val - 0.45) / 0.55));
        const rgb = colorblind
          ? [Math.round(235 - 235 * norm), Math.round(240 - 126 * norm), Math.round(248 - 70 * norm)]
          : [Math.round(238 - 220 * norm), Math.round(247 - 150 * norm), Math.round(239 - 165 * norm)];
        const isCurrent = rIdx === bin && c === choice;
        const isOpt = rIdx === bin && c === bestC;
        out += `<rect data-dose-idx="${c}" x="${x + 1}" y="${y + 1}" width="${cellW - 2}" height="${cellH - 2}" rx="3" fill="rgb(${rgb[0]},${rgb[1]},${rgb[2]})" stroke="${isCurrent ? '#c04416' : (isOpt ? '#0053D6' : 'none')}" stroke-width="${isCurrent || isOpt ? 2 : 0}" style="cursor:pointer"><title>Bin ${rIdx}, ${doses[actions[c]]} ppm: Q = ${val.toFixed(3)}</title></rect>`;
        out += `<text x="${x + cellW / 2}" y="${y + cellH * 0.68}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${norm > 0.55 ? '#fff' : '#13312a'}" style="pointer-events:none">${(val * 100).toFixed(0)}%</text>`;
      });
    });

    svg.innerHTML = out;
    svg.onclick = e => {
      const rect = e.target.closest('[data-dose-idx]');
      if (!rect || byId('dose').disabled) return;
      byId('dose').value = rect.getAttribute('data-dose-idx');
      molecularScene.render();
      updateKpis();
      renderActiveAnalytics();
    };
  }

  function renderMolforgeSvg() {
    const svg = byId('ml-2d-svg');
    if (!svg) return;
    svg.innerHTML = `
      <rect width="580" height="165" fill="#ffffff"/>
      <text x="16" y="22" font-size="11.5" font-weight="700" fill="#17493d">Substrate: D-Glyceraldehyde 3-Phosphate / Sugar-P Analog</text>
      <g stroke="#1f3b34" stroke-width="2.2" fill="none" stroke-linecap="round">
        <polyline points="46,108 78,90 110,108 142,90 174,108"/>
        <line x1="46" y1="108" x2="26" y2="96"/>
        <line x1="76" y1="90" x2="76" y2="62"/>
        <line x1="81" y1="90" x2="81" y2="62"/>
        <line x1="110" y1="108" x2="110" y2="136"/>
        <line x1="174" y1="108" x2="206" y2="90"/>
        <line x1="206" y1="90" x2="236" y2="106"/>
        <line x1="204" y1="88" x2="204" y2="60"/>
        <line x1="209" y1="88" x2="209" y2="60"/>
      </g>
      <g font-family="monospace" font-size="12" font-weight="700">
        <text x="72" y="56" fill="#dc2626">O</text>
        <text x="103" y="150" fill="#dc2626">OH</text>
        <text x="170" y="114" fill="#ea580c">P</text>
        <text x="200" y="54" fill="#dc2626">O</text>
        <text x="238" y="111" fill="#dc2626">O⁻</text>
      </g>
      <path d="M272,92 H334" stroke="#0053d6" stroke-width="2.6"/>
      <polygon points="334,86 346,92 334,98" fill="#0053d6"/>
      <text x="306" y="79" text-anchor="middle" font-size="11" font-weight="700" fill="#0053d6">Cys150 / His177</text>
      <text x="306" y="112" text-anchor="middle" font-size="10.5" fill="#466257">kcat · Michaelis–Menten</text>
      <text x="366" y="22" font-size="11.5" font-weight="700" fill="#6b21a8">Product: Catalyzed Acyl-Phosphate</text>
      <g stroke="#3b1f54" stroke-width="2.2" fill="none" stroke-linecap="round">
        <polyline points="384,108 416,90 448,108 480,90 512,108"/>
        <line x1="416" y1="90" x2="416" y2="62"/>
        <line x1="448" y1="108" x2="448" y2="136"/>
        <line x1="512" y1="108" x2="544" y2="90"/>
      </g>
      <g font-family="monospace" font-size="12" font-weight="700">
        <text x="411" y="56" fill="#7c3aed">O⁻</text>
        <text x="441" y="150" fill="#dc2626">OH</text>
        <text x="508" y="114" fill="#ea580c">P</text>
        <text x="546" y="94" fill="#7c3aed">O⁻</text>
      </g>
    `;
    updateStripesTimeline(molecularScene.getPhase ? molecularScene.getPhase() : 0);
  }

  function updateStripesTimeline(phase) {
    const track = byId('stripes-track');
    const pose = byId('stripes-pose');
    if (!track) return;
    const stages = [
      ['1. Approach', 'Solvent diffusion', phase < 0.36],
      ['2. Dock', 'Cys150 H-bond', phase >= 0.36 && phase < 0.50],
      ['3. Catalysis', 'His177 proton shift', phase >= 0.50 && phase < 0.63],
      ['4. Release', 'Product egress', phase >= 0.63],
    ];
    if (pose) {
      const activeStage = stages.find(s => s[2]) || stages[0];
      pose.textContent = activeStage[0].replace(/^\d\.\s*/, '');
    }
    track.innerHTML = stages.map(([a, b, on]) =>
      `<div class="ml-stripe-cell ${on ? 'is-active' : ''}"><div>${a}</div><div style="opacity:.85">${b}</div></div>`
    ).join('');
  }

  function renderChemlintAudit() {
    const checks = byId('chemlint-checks');
    if (checks) {
      checks.innerHTML = `
        <div class="ml-audit-item"><span><strong>Split Independence:</strong> Regression (${molecularData.train}) · RL (${molecularData.rlTrain}) · Holdout (${molecularData.test})</span><span class="ml-pass-pill">ZERO LEAKAGE</span></div>
        <div class="ml-audit-item"><span><strong>Anchor Calibration:</strong> Fixed low-dose anchor at [S₁] = ${doses[anchor]} ppm across 16 empirical bins</span><span class="ml-pass-pill">VERIFIED</span></div>
        <div class="ml-audit-item"><span><strong>Bootstrap Paired CI:</strong> Learned Policy vs Fixed Dose (+${(molecularData.gain * 100).toFixed(2)} pp)</span><span class="ml-pass-pill">2,000 RESAMPLES</span></div>
      `;
    }
    const svg = byId('ml-bench-svg');
    if (!svg) return;
    const rows = Object.entries(metrics);
    const p = pal();
    const cols = [p.mm, p.ridge, p.rf, p.mlp];
    const maxV = Math.max(...rows.map(([, v]) => v[0])) * 1.15;
    let out = `<rect width="620" height="225" fill="#f8fbf8"/>`;
    out += `<text x="16" y="22" font-size="12.5" font-weight="700" fill="#13312a">Held-Out Vmax MAE (lower is better) across 800 curves</text>`;
    rows.forEach(([name, [vmaxMae, kmMae]], i) => {
      const y = 44 + i * 42;
      const bw = (vmaxMae / maxV) * 320;
      out += `<text x="16" y="${y + 18}" font-size="12" font-weight="600" fill="#183c33">${name}</text>`;
      out += `<rect x="175" y="${y + 3}" width="${bw.toFixed(1)}" height="22" rx="5" fill="${cols[i % cols.length]}"/>`;
      out += `<text x="${(183 + bw).toFixed(1)}" y="${y + 18}" font-size="11.5" font-weight="700" fill="#13312a">${vmaxMae.toFixed(2)} cpm · Km ${kmMae.toFixed(4)}</text>`;
    });
    svg.innerHTML = out;
  }

  function renderActiveAnalytics() {
    if (activeTab === 'curves') renderSaturationSvg();
    else if (activeTab === 'qpolicy') renderQHeatmapSvg();
    else if (activeTab === 'molml') renderMolforgeSvg();
    else renderChemlintAudit();
  }

  function updateAudienceCopy() {
    const title = byId('ml-aud-title');
    const body = byId('ml-aud-body');
    if (!title || !body) return;
    const isVi = typeof StudioPrefs !== 'undefined' && StudioPrefs.get().lang === 'vi';
    if (audience === 'explorer') {
      title.textContent = isVi ? 'Góc nhìn Khám phá · AI chọn thí nghiệm thông minh' : 'Explorer view · How AI picks the best follow-up test';
      body.textContent = isVi
        ? 'Hãy tưởng tượng bạn chỉ được đo thêm đúng 1 lần sau phép đo đầu tiên. Thay vì đoán mò, thuật toán RL học từ 4.800 thí nghiệm mô phỏng để chọn nồng độ giúp phân biệt họ enzyme chính xác nhất, đồng thời mô hình 3D cho thấy tốc độ xúc tác thay đổi trực tiếp.'
        : 'Imagine you only have budget for one follow-up test. Instead of guessing, the RL policy picks the substrate concentration most likely to distinguish fast vs. slow enzyme families, while the 3D pocket shows catalysis speeding up or slowing down.';
    } else if (audience === 'biologist') {
      title.textContent = isVi ? 'Góc nhìn Nhà sinh học · Túi gắn Cys150–His177 & Km' : 'Biologist view · Cys150–His177 catalytic cleft & Km';
      body.textContent = isVi
        ? 'Quan sát túi xúc tác của GAPDH (P00359): ở nồng độ [S] ≫ Km, enzyme gần bão hòa nên tốc độ tiến sát Vmax; ngược lại, chọn [S₂] quá cao trên enzyme Km thấp sẽ làm mất khả năng phân biệt Km.'
        : 'Watch the P00359 catalytic cleft: when [S₂] ≫ Km, the active site saturates near Vmax, collapsing sensitivity to Km differences—explaining why Q*(s, a) shifts intermediate vs high doses depending on anchor rate.';
    } else if (audience === 'researcher') {
      title.textContent = isVi ? 'Góc nhìn Nhà nghiên cứu · Hiệu năng RL vs 6-dose MLP' : 'Researcher view · Two-dose RL decoder vs 6-dose regression';
      body.textContent = `Disjoint splits isolate 2,400 regression fits, 4,800 RL episodes, and 800 held-out curves. Random Forest achieves lowest Vmax/Km MAE (${metrics['Random forest'][0].toFixed(2)} / ${metrics['Random forest'][1].toFixed(4)}) over full 6-dose profiles, whereas the 2-measurement Q-policy attains ${(policies['Learned policy'] * 100).toFixed(2)}% family accuracy (+${(molecularData.gain * 100).toFixed(2)} pp vs best fixed dose).`;
    } else {
      title.textContent = isVi ? 'Góc nhìn Học tập · Thực hành từng bước' : 'Student view · Step-by-step investigation';
      body.textContent = isVi
        ? '1) Quan sát tốc độ đo ở 0.11 ppm; 2) Bấm "Use learned Q-policy" xem AI chọn nồng độ nào; 3) Bấm "Reveal second rate" và chuyển qua lại giữa tab Saturation và Q-Policy để đối chiếu.'
        : '1) Check the anchor rate at 0.11 ppm; 2) Click "Use learned Q-policy" to inspect which second dose maximizes Q-value; 3) Reveal the second rate and compare Nonlinear MM vs PyTorch MLP in the Saturation tab.';
    }
  }

  function reset() {
    revealed = false;
    const { rate, values, epIdx } = current();
    molecularScene.load(null);
    byId('first').textContent = `${doses[anchor]} ppm · observed rate ${rate.toFixed(1)} counts/min/min`;
    byId('result').textContent = '';
    byId('save-status').textContent = '';
    byId('save-evidence').disabled = true;
    byId('mechanism').textContent = 'Select the second concentration to reveal the observed rate and compare it with the simulator’s noiseless Michaelis–Menten rate.';
    byId('measure').disabled = byId('policy').disabled = byId('dose').disabled = false;

    const bestIdx = values.indexOf(Math.max(...values));
    byId('actions').replaceChildren(...values.map((value, i) => {
      const label = document.createElement('label');
      if (i === bestIdx) label.className = 'is-best';
      const bar = document.createElement('progress');
      label.textContent = `${doses[actions[i]]} ppm · Q ${value.toFixed(2)}${i === bestIdx ? ' ★' : ''}`;
      bar.max = 1; bar.value = value;
      bar.setAttribute('aria-label', `Estimated terminal reward at ${doses[actions[i]]} ppm`);
      label.append(bar);
      return label;
    }));

    document.querySelectorAll('[data-preset]').forEach(b => {
      b.classList.toggle('active', Number(b.dataset.preset) === epIdx);
    });
    updateKpis();
    renderActiveAnalytics();
  }

  examples.forEach((_, i) => byId('episode').add(new Option('Assay ' + (i + 1), i)));
  actions.forEach((dose, i) => byId('dose').add(new Option(doses[dose] + ' ppm', i)));

  byId('episode').onchange = reset;
  byId('dose').onchange = () => {
    molecularScene.render();
    updateKpis();
    renderActiveAnalytics();
  };
  byId('policy').onclick = () => {
    const { values } = current();
    byId('dose').value = values.indexOf(Math.max(...values));
    molecularScene.render();
    updateKpis();
    renderActiveAnalytics();
    byId('measure').focus();
  };
  byId('measure').onclick = () => {
    revealed = true;
    const { example } = current();
    const choice = Number(byId('dose').value);
    const dose = actions[choice];
    molecularScene.load({ example, dose, fixed: molecularData.fixedDose });
    const [vmax, km] = example.params;
    const fraction = doses[dose] / (km + doses[dose]);
    byId('result').textContent =
      `${doses[dose]} ppm · observed ${example.rates[dose].toFixed(1)} cpm · predicted ${families[example.decoded[choice]]} · generating ${families[example.family]}`;
    byId('mechanism').textContent =
      `Generating model: Km = ${km.toFixed(3)} ppm, Vmax = ${vmax.toFixed(1)} counts/min/min. At ${doses[dose]} ppm the enzyme operates at ${(100 * fraction).toFixed(1)}% of Vmax (noiseless rate ${(fraction * vmax).toFixed(1)} counts/min/min).`;
    byId('save-evidence').disabled = false;
    byId('measure').disabled = byId('policy').disabled = byId('dose').disabled = true;
    updateKpis();
    renderActiveAnalytics();
  };

  byId('save-evidence').onclick = () => {
    if (!revealed) return;
    const { example } = current();
    const choice = Number(byId('dose').value);
    const dose = actions[choice];
    const [vmax, km] = example.params;
    const episode = Number(byId('episode').value) + 1;
    try {
      evidenceRecords.capture({
        kind: 'simulated',
        title: `Assay ${episode} · ${doses[dose]} ppm`,
        dataset: 'Synthetic Michaelis–Menten task',
        method: 'Two-measurement Gaussian decoder',
        metric: 'Observed second rate',
        unit: 'counts/min/min',
        value: example.rates[dose],
        source: 'https://github.com/tun539/assay-evidence-lab/blob/main/ml/molecular.py',
        details: {
          comparisonKey: `episode-${episode}-dose-${doses[dose]}`,
          episode,
          firstConcentrationPpm: doses[anchor],
          firstRate: example.rates[anchor],
          secondConcentrationPpm: doses[dose],
          predictedFamily: families[example.decoded[choice]],
          generatingFamily: families[example.family],
          generatingParameters: { vmax, km },
          estimatedPolicyReward: current().values[choice],
        },
      });
      byId('save-status').textContent = 'Saved the simulated measurement and family prediction to the Evidence Workspace.';
    } catch (error) {
      byId('save-status').textContent = 'Could not save the run. ' + error.message;
    }
  };

  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.onclick = () => {
      byId('episode').value = btn.dataset.preset;
      reset();
    };
  });
  document.querySelectorAll('[data-ml-tab]').forEach(btn => {
    btn.onclick = () => {
      activeTab = btn.dataset.mlTab;
      document.querySelectorAll('[data-ml-tab]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      ['curves', 'qpolicy', 'molml', 'chemlint'].forEach(t => {
        byId('ml-tab-' + t).hidden = t !== activeTab;
      });
      renderActiveAnalytics();
    };
  });
  document.querySelectorAll('[data-audience]').forEach(btn => {
    btn.onclick = () => {
      audience = btn.dataset.audience;
      if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ audience });
      document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      updateAudienceCopy();
    };
  });

  byId('ml-toggle-cb').onclick = () => {
    colorblind = !colorblind;
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ colorblind });
    byId('ml-toggle-cb').setAttribute('aria-pressed', String(colorblind));
    molecularScene.setColorMode(colorblind ? 'colorblind' : 'plddt');
    renderActiveAnalytics();
  };

  byId('copy-smiles').onclick = () => {
    const s = byId('mol-smiles').textContent;
    navigator.clipboard?.writeText(s);
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.showToast('Copied substrate SMILES: ' + s);
  };

  byId('ml-share').onclick = () => {
    if (typeof StudioPrefs !== 'undefined') {
      StudioPrefs.copyPermalink({ assay: Number(byId('episode').value) + 1, dose: byId('dose').value });
    }
  };
  byId('ml-export-md').onclick = () => {
    const { epIdx, example, rate, values } = current();
    const md = `# Molecular Learning Lab Audit — Assay ${epIdx + 1}\n`
      + `- Anchor (0.11 ppm): ${rate.toFixed(2)} counts/min/min\n`
      + `- Policy Q-values: ${values.map((v, i) => `${doses[actions[i]]} ppm=${v.toFixed(3)}`).join(', ')}\n`
      + `- Generating Family: ${families[example.family]} (Vmax=${example.params[0].toFixed(1)}, Km=${example.params[1].toFixed(3)})\n`
      + `- RL Gain vs Fixed Dose: +${(molecularData.gain * 100).toFixed(2)} pp\n`;
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a'); a.href = url; a.download = `molecular-learning-assay-${epIdx + 1}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  byId('ml-tour').onclick = () => {
    if (typeof StudioPrefs === 'undefined') return;
    const isVi = StudioPrefs.get().lang === 'vi';
    StudioPrefs.startTour([
      { selector: '#controls', title: isVi ? '1. Chọn thí nghiệm & Chính sách Q-Learning' : '1. Active-Learning Dose Selection', body: isVi ? 'Từ tốc độ đầu ở 0.11 ppm, bấm "Use learned Q-policy" để xem thuật toán RL gợi ý nồng độ kế tiếp tối ưu.' : 'Observe the 0.11 ppm anchor rate, click "Use learned Q-policy" to pick the optimal next dose, then reveal the second rate.' },
      { selector: '#ml-3d-card', title: isVi ? '2. Enzyme 3D thực tế & Túi gắn Cys150' : '2. Real WebGL2 3D Enzyme Active-Site Catalysis', body: isVi ? 'Mô hình GAPDH (P00359) xoay bằng GPU với cơ chất gắn trực tiếp vào túi hoạt động Cys150–His177 theo đúng tốc độ Michaelis–Menten.' : 'Watch substrate enter the real P00359 Cys150–His177 pocket, form transition-state contacts, and release product scaled to predicted turnover.' },
      { selector: '#ml-analytics-card', title: isVi ? '3. Đồ thị molML, Q-Policy & ChemLint Audit' : '3. molML Saturation, Q-Heatmap & ChemLint Audit', body: isVi ? 'Chuyển đổi 4 tab để so sánh PyTorch MLP / Random Forest, bản đồ Q-value 17×5, cấu trúc 2D molforge và kiểm chứng không rò rỉ dữ liệu.' : 'Switch tabs to compare all 4 ML estimators, inspect the 17×5 Q-heatmap, view 2D molforge/STRIPES contacts, and verify zero-leakage splits.' },
    ]);
  };

  molecularScene.onPhaseChange(phase => {
    if (activeTab === 'molml') updateStripesTimeline(phase);
  });

  window.addEventListener('studio-prefs-change', e => {
    audience = e.detail.audience;
    colorblind = e.detail.colorblind;
    document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.audience === audience)));
    byId('ml-toggle-cb').setAttribute('aria-pressed', String(colorblind));
    molecularScene.setColorMode(colorblind ? 'colorblind' : 'plddt');
    updateAudienceCopy();
    renderActiveAnalytics();
  });

  table('ml', Object.entries(metrics).map(([name, [vmax, km]]) => [name, vmax.toFixed(2), km.toFixed(4)]));
  table('rl', Object.entries(policies).map(([name, value]) => [name, (value * 100).toFixed(2) + '%']));
  byId('split').textContent =
    `${molecularData.train} training curves · ${molecularData.rlTrain} separate policy-training episodes · ${molecularData.test} held-out curves. `
    + `Learned minus fixed dose accuracy ${(100 * molecularData.gain).toFixed(2)} percentage points (paired 95% bootstrap interval ${molecularData.gainInterval.map(v => (100 * v).toFixed(2)).join(' to ')}).`;

  const reqAssay = Number(new URLSearchParams(location.search).get('assay'));
  if (reqAssay >= 1 && reqAssay <= examples.length) byId('episode').value = String(reqAssay - 1);
  if (typeof StudioPrefs !== 'undefined') {
    const p = StudioPrefs.get();
    document.querySelectorAll('[data-audience]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.audience === p.audience)));
    byId('ml-toggle-cb').setAttribute('aria-pressed', String(p.colorblind));
    if (p.colorblind) molecularScene.setColorMode('colorblind');
  }

  updateAudienceCopy();
  reset();
})();
