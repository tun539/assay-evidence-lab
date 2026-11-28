'use strict';

/**
 * Pure Deterministic Transcriptomics & Microarray Audit Engine
 * Backs the Gene Expression & Transcriptomics Atlas (Golub et al., 7,129 probes × 38 train / 34 test).
 */
const ExpressionEngine = (() => {
  const STRUCTURE_BRIDGES = [
    { match: /\bTP53\b|P53\b/i, acc: 'P04637', dnaId: 'hsa:7157', gene: 'TP53', foldTitle: 'Tumor suppressor p53 (AlphaFold DB v6)' },
    { match: /\bSOD1\b|SUPEROXIDE DISMUTASE 1\b/i, acc: 'P00441', dnaId: 'hsa:6647', gene: 'SOD1', foldTitle: 'Cu/Zn Superoxide Dismutase (AlphaFold DB v6)' },
    { match: /\bGAPD\b|\bGAPDH\b|HUMGAPDH|GLYCERALDEHYDE-3-PHOSPHATE DEHYDROGENASE/i, acc: 'P00359', dnaId: 'sce:YGR192C', gene: 'GAPDH / TDH3', foldTitle: 'GAPDH Rossmann Fold (AlphaFold DB v6)' },
    { match: /\bATP5|\bATP SYNTHASE|\bATP6/i, acc: 'P00846', dnaId: 'hsa:4508', gene: 'ATP Synthase', foldTitle: 'ATP Synthase Subunit (AlphaFold DB v6)' },
  ];

  const PATHWAY_META = {
    myeloid: { label: 'Myeloid Granule & Innate Effector', labelVi: 'Hạt tủy & Đáp ứng miễn dịch tủy', color: '#0ea5e9' },
    signaling: { label: 'Surface Receptors & Kinase Signaling', labelVi: 'Thụ thể bề mặt & Tín hiệu Kinase', color: '#10b981' },
    transcriptional: { label: 'Transcription & Leukemia Survival', labelVi: 'Phiên mã & Sống còn tế bào tủy', color: '#8b5cf6' },
    metabolic: { label: 'Metabolic Enzymes, Stress & Controls', labelVi: 'Enzyme chuyển hóa, Stress & Đối chứng', color: '#f59e0b' },
  };

  function parseSymbol(acc, desc) {
    const cleanAcc = String(acc || '').trim();
    const cleanDesc = String(desc || '').trim();
    const isControl = /^AFFX-|^hum_alu/i.test(cleanAcc) || /endogenous control|miscellaneous control/i.test(cleanDesc);
    if (isControl) {
      const m = cleanAcc.match(/HUMGAPDH|HSAC07|HUMISGF3A|HUMTFRR|HUMRGE/i);
      return { symbol: m ? m[0].toUpperCase() : cleanAcc.replace(/_at$|_st$/i, ''), isControl: true };
    }
    // Check explicit HGNC-style leading token (e.g. "CD33 CD33 antigen", "CST3 Cystatin C", "HOXA9")
    const tok = cleanDesc.match(/\b([A-Z][A-Z0-9]{1,8})\b/);
    if (cleanDesc.includes('HoxA9')) return { symbol: 'HOXA9', isControl: false };
    if (/Zyxin/i.test(cleanDesc)) return { symbol: 'ZYX', isControl: false };
    if (/Azurocidin/i.test(cleanDesc)) return { symbol: 'AZU1', isControl: false };
    if (/Lysozyme/i.test(cleanDesc)) return { symbol: 'LYZ', isControl: false };
    if (/Interleukin[- ]8|IL8/i.test(cleanDesc)) return { symbol: 'CXCL8 / IL8', isControl: false };
    if (/Thrombospondin/i.test(cleanDesc)) return { symbol: 'THBS1', isControl: false };
    if (/Leukotriene C4 synthase/i.test(cleanDesc)) return { symbol: 'LTC4S', isControl: false };
    if (/Epb72/i.test(cleanDesc)) return { symbol: 'STOM', isControl: false };
    if (/interferon-gamma inducing factor|IGIF/i.test(cleanDesc)) return { symbol: 'IL18', isControl: false };
    if (/phosphotyrosine independent ligand p62/i.test(cleanDesc)) return { symbol: 'SQSTM1 / p62', isControl: false };
    if (/adipsin/i.test(cleanDesc)) return { symbol: 'CFD', isControl: false };
    if (/PEPTIDYL-PROLYL CIS-TRANS ISOMERASE/i.test(cleanDesc)) return { symbol: 'PPIF', isControl: false };
    if (/myeloperoxidase/i.test(cleanDesc)) return { symbol: 'MPO', isControl: false };
    if (/superoxide dismutase 1|\bsod1\b/i.test(cleanDesc)) return { symbol: 'SOD1', isControl: false };
    if (/tumor protein p53|\btp53\b/i.test(cleanDesc)) return { symbol: 'TP53', isControl: false };
    if (/glyceraldehyde-3-phosphate/i.test(cleanDesc)) return { symbol: 'GAPDH', isControl: false };
    if (tok && tok[1] !== 'GB' && tok[1] !== 'DEF' && tok[1] !== 'ORF') {
      return { symbol: tok[1], isControl: false };
    }
    return { symbol: cleanAcc.split('_')[0], isControl: false };
  }

  function classifyPathway(acc, desc) {
    const txt = `${acc} ${desc}`;
    if (/azurocidin|lysozyme|myeloperoxidase|cystatin|cathepsin|complement|adipsin|proteoglycan|leukotriene/i.test(txt)) {
      return 'myeloid';
    }
    if (/CD33|ITGAX|CD11C|LYN|LEPR|interleukin|IL8|IGIF|galectin|LGALS3|Epb72|thrombospondin|zyxin/i.test(txt)) {
      return 'signaling';
    }
    if (/HOXA9|MCL1|TP53|Homeodomain|oncogene|transcription|p62/i.test(txt)) {
      return 'transcriptional';
    }
    return 'metabolic';
  }

  function findStructureBridge(acc, desc) {
    const txt = `${acc} ${desc}`;
    for (const entry of STRUCTURE_BRIDGES) {
      if (entry.match.test(txt)) {
        return { acc: entry.acc, dnaId: entry.dnaId, gene: entry.gene, foldTitle: entry.foldTitle };
      }
    }
    return null;
  }

  function signedLog2Fc(valPos, valNeg) {
    const floor = Math.max(120, -Math.min(valPos, valNeg, 0) + 120);
    return Math.log2((valPos + floor) / (valNeg + floor));
  }

  function computeProbeMetrics(probe, idx, selectedSet) {
    const [acc, desc, trAll, trAml, teAll, teAml] = probe;
    const trainDiff = trAml - trAll;
    const testDiff = teAml - teAll;
    const meanIntensity = 0.25 * (trAll + trAml + teAll + teAml);
    const log2FcTrain = signedLog2Fc(trAml, trAll);
    const log2FcTest = signedLog2Fc(teAml, teAll);
    const { symbol, isControl } = parseSymbol(acc, desc);
    const pathway = classifyPathway(acc, desc);
    const bridge = findStructureBridge(acc, desc);
    const sameDirection = trainDiff !== 0 && testDiff !== 0 && Math.sign(trainDiff) === Math.sign(testDiff);
    const replicationRatio = Math.abs(trainDiff) > 1e-6 ? testDiff / trainDiff : 0;

    return {
      index: idx,
      acc,
      desc,
      symbol,
      isControl,
      isSelected: Boolean(selectedSet && selectedSet.has(idx)),
      pathway,
      bridge,
      trAll,
      trAml,
      teAll,
      teAml,
      trainDiff,
      testDiff,
      meanIntensity,
      log2FcTrain,
      log2FcTest,
      sameDirection,
      replicationRatio,
      direction: testDiff > 0 ? 'AML-up' : testDiff < 0 ? 'ALL-up' : 'flat',
    };
  }

  function computePearson(xs, ys) {
    const n = xs.length;
    if (n < 2) return { r: 0, slope: 1, intercept: 0 };
    let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      const x = xs[i], y = ys[i];
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    }
    const cov = sxy - (sx * sy) / n;
    const varX = sxx - (sx * sx) / n;
    const varY = syy - (sy * sy) / n;
    const r = varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : 0;
    const slope = varX > 0 ? cov / varX : 1;
    return { r, slope, intercept: sy / n - slope * (sx / n) };
  }

  function computeCohortSummary(data) {
    const probes = data.probes || [];
    const selectedSet = new Set(data.selected || []);
    const n = probes.length;
    let panelReplicates = 0;
    let ratioSum = 0;
    let ratioCount = 0;
    const pathwayCounts = { myeloid: 0, signaling: 0, transcriptional: 0, metabolic: 0 };
    const allX = new Array(n), allY = new Array(n);
    const panX = [], panY = [];

    const enriched = new Array(n);
    for (let i = 0; i < n; i++) {
      const m = computeProbeMetrics(probes[i], i, selectedSet);
      enriched[i] = m;
      allX[i] = m.trainDiff;
      allY[i] = m.testDiff;
      if (m.isSelected) {
        panX.push(m.trainDiff);
        panY.push(m.testDiff);
        if (m.sameDirection) panelReplicates++;
        if (Math.abs(m.trainDiff) > 5) {
          ratioSum += m.testDiff / m.trainDiff;
          ratioCount++;
        }
        pathwayCounts[m.pathway]++;
      }
    }

    const genomeReg = computePearson(allX, allY);
    const panelReg = computePearson(panX, panY);

    return {
      enriched,
      nProbes: n,
      nSelected: selectedSet.size,
      pearsonR: genomeReg.r,
      regSlope: genomeReg.slope,
      regIntercept: genomeReg.intercept,
      panelPearsonR: panelReg.r,
      panelReplicates,
      panelConcordance: selectedSet.size ? panelReplicates / selectedSet.size : 0,
      meanReplicationRatio: ratioCount ? ratioSum / ratioCount : 1,
      pathwayCounts,
    };
  }

  function normalizeModelProbs(model) {
    const scores = model.scores || [];
    const minS = Math.min(...scores);
    const maxS = Math.max(...scores);
    if (minS >= 0 && maxS <= 1) {
      return scores.map(s => Math.max(1e-6, Math.min(1 - 1e-6, s)));
    }
    const sorted = [...scores].sort((a, b) => a - b);
    const q25 = sorted[Math.floor(sorted.length * 0.25)];
    const q75 = sorted[Math.floor(sorted.length * 0.75)];
    const scale = Math.max(1, (q75 - q25) * 0.55);
    return scores.map(s => {
      const z = Math.max(-25, Math.min(25, s / scale));
      return 1 / (1 + Math.exp(-z));
    });
  }

  function evaluateAtThreshold(probs, labels, tau) {
    let tp = 0, fp = 0, fn = 0, tn = 0, brierSum = 0;
    for (let i = 0; i < labels.length; i++) {
      const y = labels[i];
      const p = probs[i];
      const pred = p >= tau ? 1 : 0;
      if (y === 1 && pred === 1) tp++;
      else if (y === 0 && pred === 1) fp++;
      else if (y === 1 && pred === 0) fn++;
      else tn++;
      brierSum += (p - y) * (p - y);
    }
    const tpr = tp + fn > 0 ? tp / (tp + fn) : 0;
    const tnr = tn + fp > 0 ? tn / (tn + fp) : 0;
    const ppv = tp + fp > 0 ? tp / (tp + fp) : 1;
    const ba = 0.5 * (tpr + tnr);
    const f1 = tpr + ppv > 0 ? (2 * tpr * ppv) / (tpr + ppv) : 0;
    const acc = labels.length > 0 ? (tp + tn) / labels.length : 0;
    return { tp, fp, fn, tn, tpr, fpr: 1 - tnr, tnr, ppv, ba, f1, acc, brier: brierSum / Math.max(1, labels.length) };
  }

  function computeRocAndPr(scores, labels) {
    const posTotal = labels.filter(y => y === 1).length;
    const negTotal = labels.length - posTotal;
    const pairs = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => b.s - a.s);

    const rocPoints = [{ fpr: 0, tpr: 0 }];
    const prPoints = [{ recall: 0, precision: 1 }];
    let tp = 0, fp = 0;

    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i].y === 1) tp++;
      else fp++;
      // Handle ties by only emitting step after equal scores finish
      if (i + 1 < pairs.length && pairs[i + 1].s === pairs[i].s) continue;
      const tpr = posTotal > 0 ? tp / posTotal : 0;
      const fpr = negTotal > 0 ? fp / negTotal : 0;
      const prec = tp + fp > 0 ? tp / (tp + fp) : 1;
      rocPoints.push({ fpr, tpr });
      prPoints.push({ recall: tpr, precision: prec });
    }
    if (rocPoints[rocPoints.length - 1].fpr < 1 || rocPoints[rocPoints.length - 1].tpr < 1) {
      rocPoints.push({ fpr: 1, tpr: 1 });
    }

    let auc = 0;
    for (let i = 1; i < rocPoints.length; i++) {
      auc += 0.5 * (rocPoints[i].tpr + rocPoints[i - 1].tpr) * (rocPoints[i].fpr - rocPoints[i - 1].fpr);
    }

    let ap = 0;
    for (let i = 1; i < prPoints.length; i++) {
      ap += prPoints[i].precision * (prPoints[i].recall - prPoints[i - 1].recall);
    }

    return { rocPoints, auc, prPoints, ap };
  }

  function computeLeakageComparison(enriched, selectedIndices) {
    const clean = selectedIndices.map(i => enriched[i]).filter(Boolean);
    const leaky = [...enriched]
      .sort((a, b) => Math.abs(b.trainDiff + b.testDiff) - Math.abs(a.trainDiff + a.testDiff))
      .slice(0, selectedIndices.length);

    const avgAbsTest = list => list.reduce((s, p) => s + Math.abs(p.testDiff), 0) / Math.max(1, list.length);
    const avgLog2Test = list => list.reduce((s, p) => s + Math.abs(p.log2FcTest), 0) / Math.max(1, list.length);
    const concord = list => list.filter(p => p.sameDirection).length;

    const cleanAbs = avgAbsTest(clean);
    const leakyAbs = avgAbsTest(leaky);
    return {
      k: clean.length,
      cleanMeanAbsTest: cleanAbs,
      leakyMeanAbsTest: leakyAbs,
      inflationRatio: cleanAbs > 0 ? leakyAbs / cleanAbs : 1,
      cleanMeanLog2: avgLog2Test(clean),
      leakyMeanLog2: avgLog2Test(leaky),
      cleanConcord: concord(clean),
      leakyConcord: concord(leaky),
      overlapCount: leaky.filter(p => p.isSelected).length,
    };
  }

  function scoreCustomSignature(enriched, indices) {
    const picked = [...new Set(indices)].map(i => enriched[i]).filter(Boolean);
    if (!picked.length) {
      return { size: 0, meanTrainDiff: 0, meanTestDiff: 0, meanAbsLog2: 0, concordance: 0, scoreIndex: 0 };
    }
    const meanTrainDiff = picked.reduce((s, p) => s + Math.abs(p.trainDiff), 0) / picked.length;
    const meanTestDiff = picked.reduce((s, p) => s + Math.abs(p.testDiff), 0) / picked.length;
    const meanAbsLog2 = picked.reduce((s, p) => s + Math.abs(p.log2FcTest), 0) / picked.length;
    const conc = picked.filter(p => p.sameDirection).length / picked.length;
    return {
      size: picked.length,
      probes: picked,
      meanTrainDiff,
      meanTestDiff,
      meanAbsLog2,
      concordance: conc,
      scoreIndex: meanAbsLog2 * conc,
    };
  }

  return {
    PATHWAY_META,
    STRUCTURE_BRIDGES,
    parseSymbol,
    classifyPathway,
    findStructureBridge,
    signedLog2Fc,
    computeProbeMetrics,
    computeCohortSummary,
    normalizeModelProbs,
    evaluateAtThreshold,
    computeRocAndPr,
    computeLeakageComparison,
    scoreCustomSignature,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ExpressionEngine;
}
