'use strict';

(() => {
  const el = id => document.getElementById(id);
  const summary = ExpressionEngine.computeCohortSummary(expression);
  const enriched = summary.enriched;
  const labels = expression.labels;
  const sampleIds = expression.ids;
  const panelProbes = expression.selected.map(i => enriched[i]);

  let activeProbeIdx = expression.selected.find(i => enriched[i].acc === 'M27891_at') ?? expression.selected[0];
  let activeModelIdx = 0;
  let threshold = 0.50;
  let leftTab = 'scatter'; // scatter | ma | heatmap | fold3d
  let rightTab = 'roc'; // roc | waterfall | pathways | leakage
  let pinnedSignature = [];
  let tablePage = 0;
  const pageSize = 12;
  let tableFiltered = [];
  let scatterHitPts = [];
  let hoveredDotIdx = -1;
  let bridgeViewer = null;
  let activePatientHover = -1;

  const MODEL_COLORS_STD = ['#0ea5e9', '#10b981', '#8b5cf6'];
  const MODEL_COLORS_CB = ['#0072B2', '#009E73', '#CC79A7'];

  function isVi() {
    return typeof StudioPrefs !== 'undefined' && StudioPrefs.get().lang === 'vi';
  }
  function isCb() {
    return typeof StudioPrefs !== 'undefined' && StudioPrefs.get().colorblind;
  }
  function audience() {
    return typeof StudioPrefs !== 'undefined' ? StudioPrefs.get().audience : 'student';
  }
  function pal() {
    return isCb()
      ? { aml: '#009E73', all: '#D55E00', sel: '#0072B2', hi: '#E69F00', models: MODEL_COLORS_CB }
      : { aml: '#14b88a', all: '#f97316', sel: '#38bdf8', hi: '#fbbf24', models: MODEL_COLORS_STD };
  }

  // Populate selectors cleanly
  const probeSelect = el('compareProbe');
  panelProbes.forEach(p => {
    probeSelect.add(new Option(`${p.symbol} (${p.acc}) · Δtest ${(p.testDiff >= 0 ? '+' : '') + p.testDiff.toFixed(0)}`, p.index));
  });
  // Allow non-panel probe option slot dynamically when clicked from scatter/table
  function syncProbeSelect(idx) {
    let opt = Array.from(probeSelect.options).find(o => Number(o.value) === idx);
    if (!opt) {
      const p = enriched[idx];
      opt = new Option(`★ ${p.symbol} (${p.acc}) · ${p.desc.slice(0, 46)}`, idx);
      probeSelect.add(opt);
    }
    probeSelect.value = String(idx);
  }

  const modelSelect = el('modelSelect');
  expression.models.forEach((m, i) => {
    modelSelect.add(new Option(`${m.name} (AUROC ${m.auc.toFixed(4)})`, i));
  });

  // Model probabilities & ROC/PR precomputed
  const modelBundles = expression.models.map(m => ({
    raw: m,
    probs: ExpressionEngine.normalizeModelProbs(m),
    curves: ExpressionEngine.computeRocAndPr(m.scores, labels),
  }));

  function ensureBridgeViewer() {
    if (bridgeViewer || typeof Mol3D === 'undefined') return bridgeViewer;
    const cvs = el('bridge-3d-canvas');
    if (!cvs) return null;
    bridgeViewer = Mol3D.createViewer(cvs, {
      theme: 'dark',
      rep: 'cartoon',
      colorMode: isCb() ? 'colorblind' : 'plddt',
      showLabels: false,
      showAxes: true,
    });
    return bridgeViewer;
  }

  function updateKPIs() {
    const p = enriched[activeProbeIdx];
    const mb = modelBundles[activeModelIdx];
    const evalM = ExpressionEngine.evaluateAtThreshold(mb.probs, labels, threshold);

    el('kpi-auc').textContent = mb.raw.auc.toFixed(4);
    el('kpi-auc-sub').textContent = `${mb.raw.name} · AP ${mb.curves.ap.toFixed(3)}`;

    el('kpi-ba').textContent = `${(evalM.ba * 100).toFixed(1)}%`;
    el('kpi-ba-sub').textContent = `TP ${evalM.tp} · FP ${evalM.fp} · FN ${evalM.fn} @ τ=${threshold.toFixed(2)}`;

    el('kpi-pearson').textContent = `r = ${summary.pearsonR.toFixed(3)}`;
    el('kpi-pearson-sub').textContent = `Panel 25 r = ${summary.panelPearsonR.toFixed(3)}`;

    el('kpi-conc').textContent = `${summary.panelReplicates} / ${summary.nSelected}`;
    el('kpi-conc-sub').textContent = `${(summary.panelConcordance * 100).toFixed(0)}% replicate AML/ALL sign`;

    el('kpi-delta').textContent = `${p.testDiff >= 0 ? '+' : ''}${p.testDiff.toFixed(0)}`;
    el('kpi-delta-sub').textContent = `${p.symbol} · log₂FC ${p.log2FcTest.toFixed(2)} (${p.sameDirection ? 'Repeats ✓' : 'Flips'})`;

    const leak = ExpressionEngine.computeLeakageComparison(enriched, expression.selected);
    el('kpi-leak').textContent = isVi() ? 'Sạch rò rỉ ✓' : 'Leak-Free ✓';
    el('kpi-leak-sub').textContent = `Leaky inflation: ×${leak.inflationRatio.toFixed(2)}`;
  }

  function drawScatterOrMa() {
    const cvs = el('expr-canvas');
    const ctx = cvs.getContext('2d');
    const W = cvs.width, H = cvs.height;
    const padL = 62, padR = 22, padT = 26, padB = 46;
    const pw = W - padL - padR, ph = H - padT - padB;
    const c = pal();

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#07171c');
    grad.addColorStop(1, '#0c232b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const isScatter = leftTab === 'scatter';
    const xVals = enriched.map(p => (isScatter ? p.trainDiff : Math.log10(Math.max(10, Math.abs(p.meanIntensity) + 20))));
    const yVals = enriched.map(p => (isScatter ? p.testDiff : p.log2FcTest));

    const xMin = isScatter ? -7500 : 1.3;
    const xMax = isScatter ? 11500 : 4.6;
    const yMin = isScatter ? -7500 : -4.2;
    const yMax = isScatter ? 11500 : 5.5;

    const toX = v => padL + (Math.max(0, Math.min(1, (v - xMin) / (xMax - xMin)))) * pw;
    const toY = v => padT + ph - (Math.max(0, Math.min(1, (v - yMin) / (yMax - yMin)))) * ph;

    // Grid
    ctx.strokeStyle = 'rgba(148,197,188,0.14)';
    ctx.lineWidth = 1;
    const xTicks = isScatter ? [-5000, 0, 5000, 10000] : [1.5, 2.5, 3.5, 4.5];
    const yTicks = isScatter ? [-5000, 0, 5000, 10000] : [-3, 0, 3, 5];

    ctx.font = '11px monospace';
    ctx.fillStyle = '#99bdb5';
    ctx.textAlign = 'center';
    for (const xt of xTicks) {
      const px = toX(xt);
      ctx.beginPath(); ctx.moveTo(px, padT); ctx.lineTo(px, padT + ph); ctx.stroke();
      ctx.fillText(isScatter ? (xt / 1000).toFixed(0) + 'k' : '10^' + xt.toFixed(1), px, H - 24);
    }
    ctx.textAlign = 'right';
    for (const yt of yTicks) {
      const py = toY(yt);
      ctx.beginPath(); ctx.moveTo(padL, py); ctx.lineTo(W - padR, py); ctx.stroke();
      ctx.fillText(isScatter ? (yt / 1000).toFixed(0) + 'k' : yt.toFixed(1), padL - 8, py + 4);
    }

    // Zero axes & regression line on scatter
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.2;
    if (isScatter) {
      const zx = toX(0), zy = toY(0);
      ctx.beginPath(); ctx.moveTo(zx, padT); ctx.lineTo(zx, padT + ph); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(padL, zy); ctx.lineTo(W - padR, zy); ctx.stroke();
      // Diagonal y = x guide
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = 'rgba(101,203,243,0.4)';
      ctx.beginPath();
      ctx.moveTo(toX(-6500), toY(-6500));
      ctx.lineTo(toX(10500), toY(10500));
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const zy = toY(0);
      ctx.beginPath(); ctx.moveTo(padL, zy); ctx.lineTo(W - padR, zy); ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = '#cbe7e0';
    ctx.font = '600 12px Inter,system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      isScatter ? 'Training Cohort Difference Δ = mean(AML) − mean(ALL)' : 'Log10 Mean Microarray Intensity (Amplitude A)',
      padL + pw / 2, H - 6
    );
    ctx.save();
    ctx.translate(16, padT + ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(isScatter ? 'Independent Test Δ (AML − ALL)' : 'Test Cohort Signed log₂FC (AML / ALL)', 0, 0);
    ctx.restore();

    // Background 7,104 probes
    scatterHitPts = [];
    for (let i = 0; i < enriched.length; i++) {
      const p = enriched[i];
      const px = toX(xVals[i]);
      const py = toY(yVals[i]);
      if (!p.isSelected && i !== activeProbeIdx) {
        ctx.fillStyle = p.bridge ? 'rgba(192,132,252,0.55)' : p.isControl ? 'rgba(248,113,113,0.22)' : 'rgba(148,184,180,0.22)';
        ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
      }
      scatterHitPts.push({ i, x: px, y: py });
    }

    // 25 ANOVA panel probes
    for (const p of panelProbes) {
      const px = toX(xVals[p.index]);
      const py = toY(yVals[p.index]);
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = p.testDiff >= 0 ? c.aml : c.all;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.1;
      ctx.stroke();
    }

    // Highlighted active probe & hover
    for (const [idx, color, radius, tag] of [
      [hoveredDotIdx, '#ffffff', 7.5, 'Hover'],
      [activeProbeIdx, c.hi, 8.5, enriched[activeProbeIdx].symbol],
    ]) {
      if (idx < 0 || !scatterHitPts[idx]) continue;
      const pt = scatterHitPts[idx];
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.font = '700 12px Inter,system-ui,sans-serif';
      const lbl = idx === activeProbeIdx ? `${tag} (${enriched[idx].acc})` : enriched[idx].symbol;
      const lx = Math.min(W - 140, Math.max(padL + 6, pt.x + 10));
      const ly = Math.max(padT + 16, Math.min(padT + ph - 10, pt.y - 10));
      ctx.fillStyle = 'rgba(5,16,22,0.9)';
      const wLbl = ctx.measureText(lbl).width + 10;
      ctx.fillRect(lx - 4, ly - 11, wLbl, 17);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(lbl, lx, ly + 1);
    }
  }

  function renderLeftStage() {
    const cvs = el('expr-canvas');
    const hmWrap = el('left-heatmap-view');
    const bWrap = el('left-3d-view');
    const note = el('left-stage-note');

    cvs.hidden = leftTab === 'heatmap' || leftTab === 'fold3d';
    hmWrap.hidden = leftTab !== 'heatmap';
    bWrap.hidden = leftTab !== 'fold3d';
    el('ex-hover-hud').hidden = true;

    if (leftTab === 'scatter' || leftTab === 'ma') {
      drawScatterOrMa();
      note.textContent = leftTab === 'scatter'
        ? (isVi()
          ? `Toàn bộ 7,129 probe trên hai tập Độc lập (r = ${summary.pearsonR.toFixed(3)}). Chấm lớn là 25 gen ANOVA; chấm tím có cầu nối 3D AlphaFold. Nhấp vào bất kỳ chấm nào để kiểm tra.`
          : `All 7,129 Golub probes plotted Train Δ vs Test Δ (r = ${summary.pearsonR.toFixed(3)}). Colored circles mark the 25 ANOVA panel; purple dots link to 3D AlphaFold folds. Click any point to inspect.`)
        : (isVi()
          ? 'Biểu đồ MA (Cường độ trung bình vs log₂FC): phân biệt gen đối chứng cường độ lớn nhưng không đổi (trục 0) khỏi nhóm driver tủy AML tăng vọt.'
          : 'MA-style amplitude vs effect-size view separating high-abundance housekeeping controls near 0 from true differential myeloid drivers.');
    } else if (leftTab === 'heatmap') {
      el('panelMap').replaceChildren();
      evidenceMatrix(
        el('panelMap'),
        'AML minus ALL intensity difference across all 25 training-selected probes (click a row to inspect)',
        ['Gene / Probe', 'Training Δ', 'Test Δ'],
        panelProbes.map(p => [p.trainDiff, p.testDiff]),
        panelProbes.map(p => `${p.symbol} (${p.acc})`),
        true
      );
      el('panelMap').querySelectorAll('tbody tr').forEach((tr, idx) => {
        tr.style.cursor = 'pointer';
        if (panelProbes[idx].index === activeProbeIdx) tr.style.outline = '2px solid #0053D6';
        tr.onclick = () => selectProbe(panelProbes[idx].index);
      });
      note.textContent = isVi
        ? 'Cả 25/25 probe được chọn từ tập huấn luyện giữ nguyên chiều phân biệt ALL–AML trên tập kiểm thử độc lập.'
        : 'Every single one of the 25 training-selected probes replicates its AML-vs-ALL contrast sign in the independent 34-specimen test cohort.';
    } else if (leftTab === 'fold3d') {
      const activeP = enriched[activeProbeIdx];
      const bridge = activeP.bridge || { acc: 'P04637', dnaId: 'hsa:7157', gene: 'TP53 (Benchmark Fold)', foldTitle: 'No direct Golub-3D match — showing benchmark TP53 · P04637', unmatched: true };
      const fold = typeof bundledFolds !== 'undefined' ? bundledFolds[bridge.acc] : null;
      const v = ensureBridgeViewer();
      if (v && fold && typeof Mol3D !== 'undefined') {
        const model = Mol3D.normalize({ id: bridge.acc, name: bridge.gene, rows: fold.rows, hasPlddt: true, pae: fold.pae, paeSize: fold.paeSize, paeMax: fold.paeMax || 31.75 });
        v.setModel(model, {});
        v.setColorMode(isCb() ? 'colorblind' : 'plddt');
      }
      el('bridge-label').textContent = bridge.unmatched
        ? `${activeP.symbol}: no bundled 3D PDB · showing benchmark ${bridge.acc} (select TP53, SOD1, or GAPDH for exact 1:1 bridge)`
        : `Exact Transcript ↔ 3D Link: ${activeP.symbol} (${activeP.acc}) → AlphaFold ${bridge.acc} · pLDDT ${(fold?.plddtMean || 0).toFixed(1)}`;
      el('bridge-studio-link').href = `structure.html?protein=${encodeURIComponent(bridge.acc)}`;
      el('bridge-dna-link').href = `dna.html?gene=${encodeURIComponent(bridge.dnaId)}`;
      note.textContent = isVi
        ? 'Cầu nối mRNA → DNA → Cấu trúc 3D AlphaFold giúp kết hợp dữ liệu biểu hiện microarray với hình dạng gấp cuộn protein thực tế.'
        : 'Bridges mRNA expression signal (Golub microarray) directly to the encoded KEGG coding DNA and AlphaFold DB v6 3D protein architecture.';
    }
  }

  function renderRightStage() {
    const svg = el('right-svg');
    const leakWrap = el('right-leakage-view');
    const wfInfo = el('right-waterfall-info');
    const note = el('right-stage-note');
    const p = pal();

    svg.style.display = rightTab === 'leakage' ? 'none' : 'block';
    leakWrap.hidden = rightTab !== 'leakage';
    wfInfo.hidden = rightTab !== 'waterfall';

    if (rightTab === 'roc') {
      const W = 640, H = 380;
      const padL = 56, padR = 24, padT = 32, padB = 46;
      const midX = 310, gap = 46;
      const plotW = 245, plotH = H - padT - padB;

      let out = `<rect width="${W}" height="${H}" fill="#07181e"/>`;
      // Panel 1: ROC
      const rx0 = padL, py0 = padT;
      out += `<rect x="${rx0}" y="${py0}" width="${plotW}" height="${plotH}" fill="#0c222a" stroke="#244a55"/>`;
      out += `<line x1="${rx0}" y1="${py0 + plotH}" x2="${rx0 + plotW}" y2="${py0}" stroke="#3e6873" stroke-dasharray="4 4"/>`;
      out += `<text x="${rx0 + plotW / 2}" y="20" text-anchor="middle" font-size="12.5" font-weight="700" fill="#e6f7f2">ROC Curves (34 Test Specimens)</text>`;
      out += `<text x="${rx0 + plotW / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#a8cfc6">False Positive Rate (1 − Specificity)</text>`;
      out += `<text x="16" y="${py0 + plotH / 2}" transform="rotate(-90 16 ${py0 + plotH / 2})" text-anchor="middle" font-size="11" fill="#a8cfc6">True Positive Rate</text>`;

      // Panel 2: Precision-Recall
      const px0 = rx0 + plotW + gap;
      out += `<rect x="${px0}" y="${py0}" width="${plotW}" height="${plotH}" fill="#0c222a" stroke="#244a55"/>`;
      out += `<text x="${px0 + plotW / 2}" y="20" text-anchor="middle" font-size="12.5" font-weight="700" fill="#e6f7f2">Precision–Recall Curves</text>`;
      out += `<text x="${px0 + plotW / 2}" y="${H - 12}" text-anchor="middle" font-size="11" fill="#a8cfc6">Recall (AML Sensitivity)</text>`;

      modelBundles.forEach((mb, idx) => {
        const col = p.models[idx % p.models.length];
        const strokeW = idx === activeModelIdx ? 3 : 1.7;
        const op = idx === activeModelIdx ? 1 : 0.65;
        const rocPts = mb.curves.rocPoints.map(pt => `${(rx0 + pt.fpr * plotW).toFixed(1)},${(py0 + (1 - pt.tpr) * plotH).toFixed(1)}`).join(' ');
        out += `<polyline points="${rocPts}" fill="none" stroke="${col}" stroke-width="${strokeW}" stroke-opacity="${op}"/>`;
        const prPts = mb.curves.prPoints.map(pt => `${(px0 + pt.recall * plotW).toFixed(1)},${(py0 + (1 - pt.precision) * plotH).toFixed(1)}`).join(' ');
        out += `<polyline points="${prPts}" fill="none" stroke="${col}" stroke-width="${strokeW}" stroke-opacity="${op}"/>`;
      });

      // Live operating threshold dot on active model
      const activeMb = modelBundles[activeModelIdx];
      const opPt = ExpressionEngine.evaluateAtThreshold(activeMb.probs, labels, threshold);
      const opRx = rx0 + opPt.fpr * plotW;
      const opRy = py0 + (1 - opPt.tpr) * plotH;
      const opPx = px0 + opPt.tpr * plotW;
      const opPy = py0 + (1 - opPt.ppv) * plotH;
      out += `<circle cx="${opRx.toFixed(1)}" cy="${opRy.toFixed(1)}" r="5.5" fill="${p.hi}" stroke="#06151a" stroke-width="2"/>`;
      out += `<circle cx="${opPx.toFixed(1)}" cy="${opPy.toFixed(1)}" r="5.5" fill="${p.hi}" stroke="#06151a" stroke-width="2"/>`;

      // Legend bottom-right inside ROC
      modelBundles.forEach((mb, idx) => {
        const ly = py0 + plotH - 52 + idx * 16;
        out += `<rect x="${rx0 + 96}" y="${ly}" width="10" height="3" fill="${p.models[idx % p.models.length]}"/>`;
        out += `<text x="${rx0 + 111}" y="${ly + 4}" font-size="10.5" fill="#d9efe8">${mb.raw.name.split(' ')[0]} · ${mb.raw.auc.toFixed(3)}</text>`;
      });

      svg.innerHTML = out;
      note.textContent = `Active operating dot τ = ${threshold.toFixed(2)} on ${activeMb.raw.name}: Sensitivity ${(opPt.tpr * 100).toFixed(1)}%, Specificity ${(opPt.tnr * 100).toFixed(1)}%, Precision ${(opPt.ppv * 100).toFixed(1)}%.`;
    } else if (rightTab === 'waterfall') {
      const mb = modelBundles[activeModelIdx];
      const ranked = sampleIds.map((id, i) => ({
        id,
        y: labels[i],
        prob: mb.probs[i],
        rawScore: mb.raw.scores[i],
      })).sort((a, b) => a.prob - b.prob);

      const W = 640, H = 340, padL = 48, padR = 20, padT = 32, padB = 46;
      const pw = W - padL - padR, ph = H - padT - padB;
      const barW = pw / ranked.length;
      const tauY = padT + (1 - threshold) * ph;

      let out = `<rect width="${W}" height="${H}" fill="#07181e"/>`;
      out += `<text x="${padL}" y="20" font-size="12.5" font-weight="700" fill="#e6f7f2">34 Test Specimens Sorted by ${mb.raw.name} AML Risk Score</text>`;
      out += `<line x1="${padL}" y1="${tauY.toFixed(1)}" x2="${W - padR}" y2="${tauY.toFixed(1)}" stroke="${p.hi}" stroke-width="2" stroke-dasharray="5 4"/>`;
      out += `<text x="${W - padR - 4}" y="${tauY - 5}" text-anchor="end" font-size="11" font-weight="700" fill="${p.hi}">Decision threshold τ = ${threshold.toFixed(2)}</text>`;

      ranked.forEach((s, idx) => {
        const bx = padL + idx * barW + 2;
        const bw = Math.max(4, barW - 4);
        const by = padT + (1 - s.prob) * ph;
        const bh = Math.max(2, padT + ph - by);
        const pred = s.prob >= threshold ? 1 : 0;
        const mis = pred !== s.y;
        const fill = s.y === 1 ? p.aml : p.all;
        out += `<rect class="wf-bar" data-idx="${idx}" x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${fill}" opacity="${mis ? '1' : '0.82'}" stroke="${mis ? '#ffffff' : 'none'}" stroke-width="${mis ? '2' : '0'}"/>`;
        if (mis) {
          out += `<text x="${(bx + bw / 2).toFixed(1)}" y="${Math.max(padT + 10, by - 4)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fecaca">!</text>`;
        }
      });
      out += `<text x="${padL}" y="${H - 12}" font-size="11" fill="#f9a870">■ True ALL (n=20)</text>`;
      out += `<text x="${padL + 135}" y="${H - 12}" font-size="11" fill="#6ee7b7">■ True AML (n=14)</text>`;
      out += `<text x="${padL + 275}" y="${H - 12}" font-size="11" fill="#fecaca">! White outline = Misclassified at τ</text>`;
      svg.innerHTML = out;

      svg.querySelectorAll('.wf-bar').forEach(rect => {
        rect.onmouseenter = () => {
          const item = ranked[Number(rect.dataset.idx)];
          const predLbl = item.prob >= threshold ? 'AML' : 'ALL';
          const trueLbl = item.y === 1 ? 'AML' : 'ALL';
          wfInfo.textContent = `Specimen #${item.id}: True = ${trueLbl} · Predicted = ${predLbl} (${predLbl === trueLbl ? 'Correct ✓' : 'MISCLASSIFIED'}) · P(AML) = ${item.prob.toFixed(3)} · Raw score = ${item.rawScore.toFixed(3)}`;
        };
      });
      if (!wfInfo.textContent) {
        const firstMis = ranked.find(s => (s.prob >= threshold ? 1 : 0) !== s.y) || ranked[ranked.length - 1];
        wfInfo.textContent = `Hover any bar to inspect a test patient. Sample #${firstMis.id}: True ${firstMis.y ? 'AML' : 'ALL'}, P(AML)=${firstMis.prob.toFixed(3)}.`;
      }
      note.textContent = 'Identifies exact misclassified patient IDs in the 34-specimen test cohort as you sweep the classification threshold τ.';
    } else if (rightTab === 'pathways') {
      const W = 640, H = 340;
      const keys = Object.keys(ExpressionEngine.PATHWAY_META);
      let out = `<rect width="${W}" height="${H}" fill="#07181e"/>`;
      out += `<text x="26" y="24" font-size="13" font-weight="700" fill="#e6f7f2">Biological Pathway Breakdown Across 25 ANOVA Markers</text>`;

      keys.forEach((k, idx) => {
        const meta = ExpressionEngine.PATHWAY_META[k];
        const probesInPath = panelProbes.filter(pr => pr.pathway === k);
        const avgLog2 = probesInPath.length ? probesInPath.reduce((s, pr) => s + Math.abs(pr.log2FcTest), 0) / probesInPath.length : 0;
        const y = 52 + idx * 66;
        const wBar = Math.min(340, (probesInPath.length / 15) * 340);
        out += `<text x="26" y="${y + 14}" font-size="12.5" font-weight="700" fill="#f0fdfa">${isVi() ? meta.labelVi : meta.label}</text>`;
        out += `<text x="${W - 24}" y="${y + 14}" text-anchor="end" font-size="12" fill="#9fd6c8">${probesInPath.length} genes · mean |log₂FC| ${avgLog2.toFixed(2)}</text>`;
        out += `<rect x="26" y="${y + 22}" width="${W - 52}" height="20" rx="5" fill="#102b33"/>`;
        out += `<rect x="26" y="${y + 22}" width="${Math.max(8, wBar).toFixed(1)}" height="20" rx="5" fill="${meta.color}"/>`;
        const names = probesInPath.slice(0, 5).map(pr => pr.symbol).join(', ') + (probesInPath.length > 5 ? '…' : '');
        out += `<text x="34" y="${y + 36}" font-size="11" font-weight="600" fill="#ffffff">${names || 'None'}</text>`;
      });
      svg.innerHTML = out;
      note.textContent = 'Myeloid granule enzymes (CST3, AZU1, LYZ, CTSD) and surface receptors (CD33, ITGAX, LYN) dominate the reproducible AML signature.';
    } else if (rightTab === 'leakage') {
      const leak = ExpressionEngine.computeLeakageComparison(enriched, expression.selected);
      leakWrap.innerHTML = `
        <div class="ex-leak-box">
          <h3>✓ Clean Protocol (ANOVA k=25 Train Only)</h3>
          <p class="ex-leak-stat">${leak.cleanMeanAbsTest.toFixed(0)} units</p>
          <p style="margin:4px 0;font-size:13px;color:#bde3d8">Mean |Δtest| across 25 biomarkers selected strictly inside the 38 training samples.</p>
          <p style="margin:6px 0 0;font-size:12.5px;color:#8ee5c1">Mean |log₂FC|: <strong>${leak.cleanMeanLog2.toFixed(2)}</strong> · Direction concordant: <strong>${leak.cleanConcord}/${leak.k}</strong></p>
        </div>
        <div class="ex-leak-box warn">
          <h3>⚠ Leaky Selection (Peeking Train + Test)</h3>
          <p class="ex-leak-stat">${leak.leakyMeanAbsTest.toFixed(0)} units (×${leak.inflationRatio.toFixed(2)})</p>
          <p style="margin:4px 0;font-size:13px;color:#fed7aa">Ranking probes with knowledge of test-cohort extremes exaggerates test separation without real generalization.</p>
          <p style="margin:6px 0 0;font-size:12.5px;color:#ffedd5">Mean |log₂FC|: <strong>${leak.leakyMeanLog2.toFixed(2)}</strong> · Shared with clean panel: <strong>${leak.overlapCount}/${leak.k}</strong></p>
        </div>
      `;
      note.textContent = 'Demonstrates why genomics startups must lock probe selection & z-scaling inside the training pipeline (`sklearn.pipeline.make_pipeline`) before touching test data.';
    }
  }

  function compareProbe() {
    const p = enriched[activeProbeIdx];
    const aud = audience();
    const vi = isVi();
    const dirTxt = p.sameDirection
      ? (vi ? 'Nhất quán giữa tập huấn luyện và tập kiểm thử độc lập.' : 'Direction replicates cleanly across independent cohorts.')
      : (vi ? 'Đảo chiều ở tập kiểm thử độc lập (không ổn định).' : 'Reverses direction in the independent test cohort.');

    if (aud === 'explorer') {
      el('probeStory').textContent = vi
        ? `${p.symbol}: Gen này hoạt động mạnh hơn ở nhóm ${p.testDiff >= 0 ? 'AML (tủy)' : 'ALL (lympho)'}. ${dirTxt}`
        : `${p.symbol}: Stronger signal in ${p.testDiff >= 0 ? 'AML (myeloid leukemia)' : 'ALL (lymphoblastic leukemia)'} samples. ${dirTxt}`;
    } else if (aud === 'researcher') {
      el('probeStory').textContent = `${p.acc} (${p.symbol}) · Train Δ=${p.trainDiff.toFixed(1)}, Test Δ=${p.testDiff.toFixed(1)} · Signed log₂FC (Train/Test)=${p.log2FcTrain.toFixed(2)} / ${p.log2FcTest.toFixed(2)} · Ratio Δtest/Δtrain=${p.replicationRatio.toFixed(2)} · Pathway=${ExpressionEngine.PATHWAY_META[p.pathway].label}.`;
    } else {
      el('probeStory').textContent = `${p.desc}. ${dirTxt} Test signed log₂FC = ${p.log2FcTest.toFixed(2)} (${p.isSelected ? 'in 25-probe ANOVA panel' : 'full 7,129 catalog'}).`;
    }

    el('cohortMap').replaceChildren();
    evidenceMatrix(
      el('cohortMap'),
      `${p.symbol} (${p.acc}): AML minus ALL intensity contrast`,
      ['Probe', 'Training Δ', 'Test Δ'],
      [[p.trainDiff, p.testDiff]],
      [p.acc],
      true
    );
  }

  function renderSignatureTray() {
    const chips = el('sig-chips');
    const summaryEl = el('sig-summary');
    const score = ExpressionEngine.scoreCustomSignature(enriched, pinnedSignature);

    chips.replaceChildren(
      ...score.probes.map(p => {
        const span = document.createElement('span');
        span.className = 'ex-sig-chip';
        span.textContent = `${p.symbol} (${p.acc}) `;
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.title = `Remove ${p.symbol}`;
        x.onclick = () => {
          pinnedSignature = pinnedSignature.filter(i => i !== p.index);
          renderSignatureTray();
        };
        span.append(x);
        return span;
      })
    );

    if (!score.size) {
      summaryEl.textContent = 'No genes pinned yet. Click "+ Pin active probe" or load the 5-Gene Myeloid signature to test custom panels.';
    } else {
      summaryEl.textContent =
        `${score.size} gene signature · Mean |Δtest| = ${score.meanTestDiff.toFixed(0)} · Mean |log₂FC| = ${score.meanAbsLog2.toFixed(2)} · ` +
        `Replication concordance = ${(score.concordance * 100).toFixed(0)}% · Separation index = ${score.scoreIndex.toFixed(2)}`;
    }
  }

  function renderProbeTable() {
    const query = el('query').value.trim().toLowerCase();
    const onlyPanel = el('panel').checked;
    const onlyBridge = el('filter-bridge').checked;

    tableFiltered = enriched.filter(p => {
      if (onlyPanel && !p.isSelected) return false;
      if (onlyBridge && !p.bridge) return false;
      if (query && !(`${p.acc} ${p.desc} ${p.symbol}`.toLowerCase()).includes(query)) return false;
      return true;
    });

    const start = tablePage * pageSize;
    const end = Math.min(tableFiltered.length, start + pageSize);
    const tbody = el('probes');
    tbody.replaceChildren();

    for (const p of tableFiltered.slice(start, end)) {
      const tr = tbody.insertRow();
      if (p.index === activeProbeIdx) tr.className = 'ex-row-selected';

      const c0 = tr.insertCell();
      const codeEl = document.createElement('code');
      codeEl.textContent = p.acc;
      const br = document.createElement('br');
      const sym = document.createElement('strong');
      sym.textContent = p.symbol + ' ';
      c0.append(codeEl, br, sym);
      if (p.isSelected) {
        const b = document.createElement('span');
        b.className = 'ex-badge panel';
        b.textContent = 'ANOVA-25';
        c0.append(b);
      }
      if (p.bridge) {
        const b3 = document.createElement('span');
        b3.className = 'ex-badge bridge';
        b3.textContent = `3D:${p.bridge.acc}`;
        c0.append(' ', b3);
      }

      tr.insertCell().textContent = p.desc;
      tr.insertCell().textContent = p.trAll.toFixed(1);
      tr.insertCell().textContent = p.trAml.toFixed(1);
      tr.insertCell().textContent = p.teAll.toFixed(1);
      tr.insertCell().textContent = p.teAml.toFixed(1);

      const cFc = tr.insertCell();
      const fcBadge = document.createElement('span');
      fcBadge.className = `ex-badge ${p.testDiff >= 0 ? 'aml' : 'all'}`;
      fcBadge.textContent = `${p.log2FcTest >= 0 ? '+' : ''}${p.log2FcTest.toFixed(2)}`;
      cFc.append(fcBadge);

      const cAct = tr.insertCell();
      const btnInspect = document.createElement('button');
      btnInspect.type = 'button';
      btnInspect.className = 'ex-chip';
      btnInspect.textContent = 'Inspect';
      btnInspect.onclick = () => selectProbe(p.index);

      const btnPin = document.createElement('button');
      btnPin.type = 'button';
      btnPin.className = 'ex-chip';
      btnPin.textContent = '+ Pin';
      btnPin.onclick = () => {
        if (!pinnedSignature.includes(p.index)) pinnedSignature.push(p.index);
        renderSignatureTray();
      };
      cAct.append(btnInspect, ' ', btnPin);
    }

    el('count').textContent = tableFiltered.length
      ? `${start + 1}–${end} of ${tableFiltered.length} probe sets`
      : 'No matching probes.';
    el('prev').disabled = tablePage <= 0;
    el('next').disabled = end >= tableFiltered.length;
  }

  function renderModelsTable() {
    const tbody = el('models');
    tbody.replaceChildren();
    modelBundles.forEach((mb, idx) => {
      const m = mb.raw;
      const ev = ExpressionEngine.evaluateAtThreshold(mb.probs, labels, threshold);
      const tr = tbody.insertRow();
      if (idx === activeModelIdx) tr.className = 'ex-row-selected';
      tr.insertCell().textContent = m.name;
      tr.insertCell().textContent = m.auc.toFixed(4);
      tr.insertCell().textContent = ev.ba.toFixed(4);
      tr.insertCell().textContent = ev.fp;
      tr.insertCell().textContent = ev.fn;
    });
  }

  function selectProbe(idx) {
    activeProbeIdx = idx;
    syncProbeSelect(idx);
    const activeAcc = enriched[idx].acc;
    document.querySelectorAll('[data-probe-acc]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.probeAcc === activeAcc);
    });
    updateAll();
  }

  function updateAll() {
    updateKPIs();
    compareProbe();
    renderLeftStage();
    renderRightStage();
    renderProbeTable();
    renderModelsTable();
  }

  // Event wiring
  probeSelect.onchange = () => selectProbe(Number(probeSelect.value));
  modelSelect.onchange = () => {
    activeModelIdx = Number(modelSelect.value);
    updateAll();
  };
  el('threshold').oninput = () => {
    threshold = Number(el('threshold').value);
    el('thresholdVal').textContent = threshold.toFixed(2);
    updateAll();
  };

  document.querySelectorAll('[data-probe-acc]').forEach(btn => {
    btn.onclick = () => {
      const idx = enriched.findIndex(p => p.acc === btn.dataset.probeAcc);
      if (idx >= 0) {
        selectProbe(idx);
        if (enriched[idx].bridge) {
          leftTab = 'fold3d';
          document.querySelectorAll('[data-left-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.leftTab === 'fold3d')));
          renderLeftStage();
        }
      }
    };
  });

  document.querySelectorAll('[data-left-tab]').forEach(btn => {
    btn.onclick = () => {
      leftTab = btn.dataset.leftTab;
      document.querySelectorAll('[data-left-tab]').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      renderLeftStage();
    };
  });
  document.querySelectorAll('[data-right-tab]').forEach(btn => {
    btn.onclick = () => {
      rightTab = btn.dataset.rightTab;
      document.querySelectorAll('[data-right-tab]').forEach(b => b.setAttribute('aria-selected', String(b === btn)));
      renderRightStage();
    };
  });

  // Interactive click/hover on 7,129 probe scatter / MA canvas
  const exprCanvas = el('expr-canvas');
  exprCanvas.onmousemove = e => {
    if (!scatterHitPts.length) return;
    const r = exprCanvas.getBoundingClientRect();
    const mx = ((e.clientX - r.left) * exprCanvas.width) / r.width;
    const my = ((e.clientY - r.top) * exprCanvas.height) / r.height;
    let best = -1, bestD = 12;
    for (const pt of scatterHitPts) {
      const d = Math.hypot(pt.x - mx, pt.y - my);
      if (d < bestD) { bestD = d; best = pt.i; }
    }
    if (best !== hoveredDotIdx) {
      hoveredDotIdx = best;
      const hud = el('ex-hover-hud');
      if (best >= 0) {
        const p = enriched[best];
        hud.textContent = `${p.symbol} (${p.acc}) · Train Δ=${p.trainDiff.toFixed(0)} · Test Δ=${p.testDiff.toFixed(0)} · log₂FC=${p.log2FcTest.toFixed(2)}`;
        hud.hidden = false;
      } else {
        hud.hidden = true;
      }
      drawScatterOrMa();
    }
  };
  exprCanvas.onclick = () => {
    if (hoveredDotIdx >= 0) selectProbe(hoveredDotIdx);
  };
  exprCanvas.onmouseleave = () => {
    hoveredDotIdx = -1;
    el('ex-hover-hud').hidden = true;
    drawScatterOrMa();
  };

  // Probe table filters & exports
  el('query').oninput = el('panel').onchange = el('filter-bridge').onchange = () => {
    tablePage = 0;
    renderProbeTable();
  };
  el('prev').onclick = () => { if (tablePage > 0) { tablePage--; renderProbeTable(); } };
  el('next').onclick = () => { tablePage++; renderProbeTable(); };

  function downloadCsv(name, rows) {
    const quote = v => `"${String(v).replaceAll('"', '""')}"`;
    const url = URL.createObjectURL(new Blob([rows.map(r => r.map(quote).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  el('export').onclick = () => {
    downloadCsv('golub-probes.csv', [
      ['probe', 'symbol', 'description', 'train_ALL', 'train_AML', 'test_ALL', 'test_AML', 'test_log2FC'],
      ...tableFiltered.map(p => [p.acc, p.symbol, p.desc, p.trAll, p.trAml, p.teAll, p.teAml, p.log2FcTest.toFixed(3)]),
    ]);
  };

  el('predictions').onclick = () => {
    downloadCsv('golub-predictions.csv', [
      ['sample', 'actual_AML', 'model', 'predicted_AML', 'AML_score'],
      ...expression.models.flatMap(m => sampleIds.map((id, i) => [id, labels[i], m.name, m.pred[i], m.scores[i]])),
    ]);
  };

  el('ex-export-md').onclick = () => {
    const p = enriched[activeProbeIdx];
    const mb = modelBundles[activeModelIdx];
    const ev = ExpressionEngine.evaluateAtThreshold(mb.probs, labels, threshold);
    const md = [
      '# Gene Expression & Transcriptomics Atlas Audit',
      '',
      `- **Dataset:** Golub et al. (1999) ALL/AML Microarray (7,129 probes · 38 train / 34 independent test)`,
      `- **Genome Cross-Cohort Replication r:** ${summary.pearsonR.toFixed(4)} (${summary.panelReplicates}/25 ANOVA panel direction concordant)`,
      `- **Selected Probe:** \`${p.acc}\` (**${p.symbol}**) — Train Δ = ${p.trainDiff.toFixed(2)}, Test Δ = ${p.testDiff.toFixed(2)}, Test log₂FC = ${p.log2FcTest.toFixed(2)}`,
      `- **Active Classifier:** ${mb.raw.name} · AUROC = ${mb.raw.auc.toFixed(4)} · Threshold τ = ${threshold.toFixed(2)} (BA = ${ev.ba.toFixed(4)}, FP = ${ev.fp}, FN = ${ev.fn})`,
      '',
      'Feature selection (`SelectKBest(f_classif, k=25)`) and z-scaling were locked strictly inside the 38 training samples.',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `golub-expression-audit-${p.acc}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Custom Signature pins
  el('pin-active-probe').onclick = () => {
    if (!pinnedSignature.includes(activeProbeIdx)) pinnedSignature.push(activeProbeIdx);
    renderSignatureTray();
  };
  el('sig-load-myeloid').onclick = () => {
    pinnedSignature = ['M27891_at', 'M23197_at', 'M96326_rna1_at', 'M19045_f_at', 'U82759_at']
      .map(acc => enriched.findIndex(p => p.acc === acc))
      .filter(i => i >= 0);
    renderSignatureTray();
  };
  el('sig-clear').onclick = () => {
    pinnedSignature = [];
    renderSignatureTray();
  };

  // Workspace capture buttons
  el('save-evidence').onclick = () => {
    const p = enriched[activeProbeIdx];
    try {
      evidenceRecords.capture({
        kind: 'measured',
        title: `${p.acc} (${p.symbol}) · Golub test contrast`,
        dataset: 'Golub ALL/AML microarray (38 train, 34 test)',
        method: 'Cohort mean intensity difference (AML minus ALL)',
        metric: 'Test-cohort contrast',
        unit: 'intensity units',
        value: Number(p.testDiff.toFixed(2)),
        source: 'https://doi.org/10.1126/science.286.5439.531',
        details: {
          comparisonKey: 'golub-probe-contrast',
          probeId: p.acc,
          symbol: p.symbol,
          description: p.desc,
          trainContrast: Number(p.trainDiff.toFixed(2)),
          testContrast: Number(p.testDiff.toFixed(2)),
          sameDirection: p.sameDirection,
        },
      });
      el('save-status').textContent = `Saved ${p.symbol} (${p.acc}) to Evidence Workspace ✓`;
    } catch (err) {
      el('save-status').textContent = `Could not save probe contrast: ${err.message}`;
    }
  };

  el('save-classifier-evidence').onclick = () => {
    const mb = modelBundles[activeModelIdx];
    const ev = ExpressionEngine.evaluateAtThreshold(mb.probs, labels, threshold);
    try {
      evidenceRecords.capture({
        kind: 'measured',
        title: `${mb.raw.name} · Golub 34-test AUROC`,
        dataset: 'Golub ALL/AML independent test cohort (n=34)',
        method: '25 training-selected ANOVA probes + StandardScaler',
        metric: 'Held-out ROC-AUC',
        unit: 'ROC-AUC',
        value: Number(mb.raw.auc.toFixed(4)),
        source: 'https://doi.org/10.1126/science.286.5439.531',
        details: {
          comparisonKey: 'golub-test-34-auroc',
          model: mb.raw.name,
          threshold: Number(threshold.toFixed(2)),
          balancedAccuracy: Number(ev.ba.toFixed(4)),
          fp: ev.fp,
          fn: ev.fn,
        },
      });
      el('save-status').textContent = `Saved ${mb.raw.name} AUROC (${mb.raw.auc.toFixed(4)}) to Workspace ✓`;
    } catch (err) {
      el('save-status').textContent = `Could not save classifier run: ${err.message}`;
    }
  };

  el('save-sig-evidence').onclick = () => {
    const score = ExpressionEngine.scoreCustomSignature(enriched, pinnedSignature);
    if (!score.size) {
      el('save-status').textContent = 'Pin at least one probe before saving a custom signature.';
      return;
    }
    try {
      evidenceRecords.capture({
        kind: 'measured',
        title: `Custom ${score.size}-gene signature (${score.probes.map(x => x.symbol).slice(0, 3).join('+')})`,
        dataset: 'Golub ALL/AML independent test cohort (n=34)',
        method: 'Composite |log2FC| × replication concordance index',
        metric: 'Signature separation index',
        unit: 'score',
        value: Number(score.scoreIndex.toFixed(3)),
        source: 'https://doi.org/10.1126/science.286.5439.531',
        details: {
          comparisonKey: 'golub-custom-signature',
          genes: score.probes.map(x => `${x.symbol}(${x.acc})`),
          concordance: Number(score.concordance.toFixed(3)),
        },
      });
      el('save-status').textContent = `Saved ${score.size}-gene custom signature to Evidence Workspace ✓`;
    } catch (err) {
      el('save-status').textContent = `Could not save signature: ${err.message}`;
    }
  };

  // Global StudioPrefs sync, Audience, Tour, Share
  document.querySelectorAll('[data-audience]').forEach(btn => {
    btn.onclick = () => { if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ audience: btn.dataset.audience }); };
  });
  el('ex-toggle-cb').onclick = () => {
    const cur = el('ex-toggle-cb').getAttribute('aria-pressed') === 'true';
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.save({ colorblind: !cur });
  };
  el('ex-share').onclick = () => {
    if (typeof StudioPrefs !== 'undefined') StudioPrefs.copyPermalink({ probe: enriched[activeProbeIdx].acc });
  };
  el('ex-tour').onclick = () => {
    if (typeof StudioPrefs === 'undefined') return;
    const vi = isVi();
    StudioPrefs.startTour([
      {
        selector: '#left-stage-frame',
        title: vi ? '1. Tương quan toàn hệ gen 7,129 probe' : '1. 7,129-Probe Replication Cloud & 3D Bridge',
        body: vi
          ? 'Bấm vào bất kỳ điểm nào trên đồ thị phân tán / MA để đối chiếu biểu hiện, hoặc chuyển sang tab 3D Protein Bridge để xem cấu trúc AlphaFold.'
          : 'Click any gene across the 7,129-probe cloud, view the MA differential plot, inspect all 25 markers, or preview linked AlphaFold 3D structures.',
      },
      {
        selector: '.ex-stage-grid',
        title: vi ? '2. Kiểm định ROC/PR & Từng bệnh nhân' : '2. Classifier ROC & 34-Patient Audit',
        body: vi
          ? 'Kéo thanh ngưỡng τ để xem các ca bệnh nhân dự đoán nhầm theo thời gian thực và kiểm tra phần Leakage Audit.'
          : 'Sweep threshold τ across Gaussian NB, Shrinkage LDA & Centroid to inspect misclassified specimens and clean-vs-leaky split integrity.',
      },
      {
        selector: '.ex-sig-tray',
        title: vi ? '3. Xây dựng Chữ ký Gen & Lưu Workspace' : '3. Custom Biomarker Signature & Workspace',
        body: vi
          ? 'Ghim nhiều gen thành một chữ ký đa gen và lưu trực tiếp bằng chứng sang Evidence Workspace.'
          : 'Pin genes into a custom diagnostic panel and capture reproducible comparison packets to Evidence Workspace.',
      },
    ]);
  };

  function syncPrefs(p) {
    if (!p) return;
    const vi = p.lang === 'vi';
    el('ex-title').textContent = vi ? 'Tập bản đồ biểu hiện gen & phiên mã' : 'Gene expression atlas';
    el('ex-subtitle').textContent = vi
      ? 'Khảo sát 7,129 probe microarray trên 38 mẫu huấn luyện & 34 mẫu kiểm thử độc lập (Golub), kiểm định phân loại không rò rỉ dữ liệu, tạo chữ ký đa gen và nối trực tiếp tới cấu trúc 3D AlphaFold.'
      : 'Explore all 7,129 microarray probes across 38 training and 34 independent test leukemia specimens, audit three classifiers without selection leakage, design custom gene signatures, and inspect linked genes in 3D AlphaFold structures.';
    el('save-evidence').textContent = vi ? 'Lưu tương phản probe' : 'Save probe contrast';
    el('save-classifier-evidence').textContent = vi ? 'Lưu kiểm định ROC' : 'Save classifier ROC';
    document.querySelectorAll('[data-audience]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.audience === p.audience)));
    el('ex-toggle-cb').setAttribute('aria-pressed', String(Boolean(p.colorblind)));
    updateAll();
  }

  window.addEventListener('studio-prefs-change', e => syncPrefs(e.detail));

  // Initial state & URL deep link (`?probe=M23197_at`)
  const urlProbe = new URLSearchParams(location.search).get('probe');
  if (urlProbe) {
    const found = enriched.findIndex(p => p.acc === urlProbe || p.symbol === urlProbe);
    if (found >= 0) activeProbeIdx = found;
  }
  pinnedSignature = ['M27891_at', 'M23197_at', 'U82759_at']
    .map(acc => enriched.findIndex(p => p.acc === acc))
    .filter(i => i >= 0);

  syncProbeSelect(activeProbeIdx);
  renderSignatureTray();
  if (typeof StudioPrefs !== 'undefined') syncPrefs(StudioPrefs.get());
  else updateAll();
})();
