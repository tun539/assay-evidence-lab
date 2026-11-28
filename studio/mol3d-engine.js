'use strict';

/**
 * High-DPI 3D Molecular Visualization Engine (WebGL2 Mol*-grade mesh + Canvas2D fallback).
 * Supports AlphaFold cartoon ribbons, sculpted β-strand arrowheads, nucleic acid base blocks,
 * reconstructed peptide pockets, metal ion & ligand coordination, .PDB & .CIF mmCIF parsing,
 * chain isolation, smooth camera focusing, and Cosmos 3D specimen thumbnails.
 */
const Mol3D = (() => {
  let _modelRev = 0;

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
  function vNorm(a) { const l = vLen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function vDist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }

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

  function reconstructBackboneAtoms(chResidues, center) {
    for (let i = 0; i < chResidues.length; i++) {
      const r = chResidues[i];
      if (r.atoms && r.atoms.length) {
        r.atoms = r.atoms.map(a => ({ ...a, pos: vSub(a.xyz, center) }));
        continue;
      }
      if (r.chainType !== 'protein' || chResidues.length < 3) continue;
      const prev = chResidues[Math.max(0, i - 1)].pos;
      const next = chResidues[Math.min(chResidues.length - 1, i + 1)].pos;
      const tang = vNorm(vSub(next, prev));
      const bisect = vSub(vAdd(prev, next), vScale(r.pos, 2));
      const sideDir = vLen(bisect) > 1e-3 ? vNorm(vScale(bisect, -1)) : vNorm(vCross(tang, [0, 1, 0]));
      const ortho = vNorm(vCross(tang, sideDir));
      const list = [
        { el: 'N', pos: vAdd(r.pos, vAdd(vScale(tang, -1.18), vScale(ortho, 0.45))) },
        { el: 'C', pos: vAdd(r.pos, vAdd(vScale(tang, 1.24), vScale(ortho, -0.40))) },
        { el: 'O', pos: vAdd(r.pos, vAdd(vScale(tang, 1.45), vScale(ortho, -1.55))) },
      ];
      if (r.resName !== 'GLY') {
        list.push({ el: 'C', pos: vAdd(r.pos, vAdd(vScale(sideDir, 1.48), vScale(ortho, 0.35))) });
      }
      r.atoms = list;
    }
  }

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
        const rawAtoms = ch.atomMap && ch.atomMap[localIdx] ? ch.atomMap[localIdx] : null;
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
          atoms: rawAtoms,
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

    for (const r of residues) {
      r.pos = vSub(r.xyz, center);
      if (r.baseTip) r.tipPos = vSub(r.baseTip, center);
    }
    for (const ch of chains) {
      reconstructBackboneAtoms(residues.slice(ch.start, ch.start + ch.length), center);
    }
    for (const l of ligands) {
      l.pos = vSub(l.xyz, center);
    }

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

    const plddtScores = residues.map(r => r.plddt).filter(Number.isFinite);
    const plddtMean = plddtScores.length
      ? plddtScores.reduce((a, b) => a + b, 0) / plddtScores.length
      : (Number.isFinite(spec.plddtMean) ? spec.plddtMean : null);
    const bands = [0, 0, 0, 0];
    for (const s of plddtScores) {
      if (s >= 90) bands[0]++;
      else if (s >= 70) bands[1]++;
      else if (s >= 50) bands[2]++;
      else bands[3]++;
    }

    const resCenter = [0, 1, 2].map(k => residues.reduce((s, r) => s + r.xyz[k], 0) / (residues.length || 1));
    const rg = Math.sqrt(residues.reduce((s, r) => s + vDist(r.xyz, resCenter) ** 2, 0) / (residues.length || 1));

    return {
      _rev: ++_modelRev,
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

  function finalizeParsedChains(chainMap, ligands, hasPlddtLike, title, sourceLabel) {
    const nucleic = new Set(['A', 'U', 'G', 'C', 'DA', 'DT', 'DG', 'DC']);
    const chains = [];
    for (const [ch, resMap] of chainMap.entries()) {
      const items = [...resMap.values()].sort((a, b) => a.resSeq - b.resSeq);
      const isNuc = items.some(it => nucleic.has(it.res));
      const rows = [];
      const atomMap = [];
      for (const it of items) {
        if (isNuc) {
          const anchor = it.atoms["C4'"] || it.atoms['P'];
          if (!anchor) continue;
          const tip = it.atoms['C4'] || it.atoms['C6'] || it.atoms['N1'] || it.atoms['N9'];
          rows.push(tip
            ? [it.res, it.resSeq, anchor[0], anchor[1], anchor[2], anchor[3], tip[0], tip[1], tip[2]]
            : [it.res, it.resSeq, anchor[0], anchor[1], anchor[2], anchor[3]]);
          atomMap.push(null);
        } else if (it.atoms['CA']) {
          const a = it.atoms['CA'];
          rows.push([it.res, it.resSeq, a[0], a[1], a[2], a[3]]);
          const extra = [];
          for (const [aname, aval] of Object.entries(it.atoms)) {
            if (aname === 'CA' || aname.startsWith('H')) continue;
            const el = aname[0] === 'S' ? 'S' : aname[0] === 'O' ? 'O' : aname[0] === 'N' ? 'N' : aname[0] === 'P' ? 'P' : 'C';
            extra.push({ name: aname, el, xyz: [aval[0], aval[1], aval[2]] });
          }
          atomMap.push(extra.length ? extra : null);
        }
      }
      if (rows.length) {
        const type = isNuc ? (rows.some(r => r[0].startsWith('D')) ? 'dna' : 'rna') : 'protein';
        chains.push({
          id: ch,
          type,
          label: (type === 'protein' ? 'Protein' : type.toUpperCase()) + ' Chain ' + ch,
          rows,
          atomMap,
        });
      }
    }
    if (!chains.length) throw Error('No backbone CA or nucleotide C4\'/P coordinates were found.');
    const cleanName = title.replace(/\.[^.]+$/, '');
    return normalize({
      id: cleanName.slice(0, 32),
      name: cleanName,
      subtitle: `${sourceLabel} · ${chains.length} ${chains.length === 1 ? 'chain' : 'chains'}`,
      summary: 'Parsed client-side in your browser with full backbone & sidechain pocket geometry.',
      source: sourceLabel + ': ' + title,
      method: hasPlddtLike ? 'AlphaFold / B-factor pLDDT coordinates' : 'Atomic coordinate model',
      hasPlddt: hasPlddtLike,
      chains,
      ligands,
    });
  }

  function parsePDB(text, filename = 'Uploaded.pdb') {
    const chainMap = new Map();
    const ligands = [];
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
        if ([x, y, z, resSeq].every(Number.isFinite) && ligands.length < 360) {
          ligands.push([res, ch, resSeq, atom, elem, x, y, z]);
        }
      }
    }

    const hasPlddtLike = text.toUpperCase().includes('ALPHAFOLD') || (bMax <= 100 && bMin >= 0 && bMax > 50);
    return finalizeParsedChains(chainMap, ligands, hasPlddtLike, filename, 'PDB');
  }

  function parseCIF(text, filename = 'Model.cif') {
    const lines = text.split(/\r?\n/);
    const cols = [];
    const chainMap = new Map();
    const ligands = [];
    let inLoop = false;
    let inAtomSite = false;
    let bMax = 0, bMin = 999;

    function tokenizeCif(line) {
      const out = [];
      const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
      let m;
      while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
      return out;
    }

    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li].trim();
      if (!raw || raw.startsWith('#')) continue;
      if (raw === 'loop_') {
        inLoop = true;
        inAtomSite = false;
        cols.length = 0;
        continue;
      }
      if (inLoop && raw.startsWith('_atom_site.')) {
        inAtomSite = true;
        cols.push(raw.slice('_atom_site.'.length).trim());
        continue;
      }
      if (inAtomSite && raw.startsWith('_')) {
        inAtomSite = false;
        inLoop = false;
        continue;
      }
      if (inAtomSite) {
        if (raw === 'loop_' || raw.startsWith('data_')) {
          inAtomSite = false;
          inLoop = raw === 'loop_';
          cols.length = 0;
          continue;
        }
        const tok = tokenizeCif(raw);
        if (tok.length < cols.length) continue;
        const getCol = name => {
          const idx = cols.indexOf(name);
          return idx >= 0 ? tok[idx] : '.';
        };
        const grp = getCol('group_PDB');
        const alt = getCol('label_alt_id');
        if (alt !== '.' && alt !== '?' && alt !== 'A') continue;
        const atom = getCol('label_atom_id').replace(/"/g, '');
        const res = getCol('label_comp_id');
        const ch = getCol('auth_asym_id') !== '.' && getCol('auth_asym_id') !== '?' ? getCol('auth_asym_id') : getCol('label_asym_id');
        const seqRaw = getCol('auth_seq_id') !== '.' && getCol('auth_seq_id') !== '?' ? getCol('auth_seq_id') : getCol('label_seq_id');
        const resSeq = parseInt(seqRaw, 10) || 1;
        const x = parseFloat(getCol('Cartn_x'));
        const y = parseFloat(getCol('Cartn_y'));
        const z = parseFloat(getCol('Cartn_z'));
        const bfac = parseFloat(getCol('B_iso_or_equiv'));
        if (![x, y, z].every(Number.isFinite)) continue;
        if (Number.isFinite(bfac)) { bMax = Math.max(bMax, bfac); bMin = Math.min(bMin, bfac); }

        if (grp === 'ATOM') {
          if (!chainMap.has(ch)) chainMap.set(ch, new Map());
          const resMap = chainMap.get(ch);
          const key = resSeq + ':' + res;
          if (!resMap.has(key)) resMap.set(key, { res, resSeq, atoms: {} });
          const slot = resMap.get(key).atoms;
          if (!slot[atom]) slot[atom] = [x, y, z, Number.isFinite(bfac) ? bfac : null];
        } else if (grp === 'HETATM' && res !== 'HOH' && res !== 'WAT' && ligands.length < 360) {
          const elem = (getCol('type_symbol') !== '.' ? getCol('type_symbol') : atom[0] || 'C').toUpperCase();
          ligands.push([res, ch, resSeq, atom, elem, x, y, z]);
        }
      }
    }

    const upper = text.slice(0, 6000).toUpperCase();
    const hasPlddtLike = upper.includes('ALPHAFOLD') || upper.includes('MA_QA_METRIC') || (bMax <= 100 && bMin >= 0 && bMax > 50);
    return finalizeParsedChains(chainMap, ligands, hasPlddtLike, filename, 'mmCIF');
  }

  function rgbStr(c, alpha = 1) {
    return alpha >= 0.999 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha.toFixed(3)})`;
  }

  function shadeRGB(base, ndotl, spec, fog, bgRGB) {
    const factor = 0.30 + 0.72 * Math.max(0, ndotl) + 0.14 * Math.pow(1 - Math.abs(ndotl), 2);
    const sAdd = 255 * 0.42 * spec;
    return [0, 1, 2].map(k => {
      const lit = Math.min(255, base[k] * factor + sAdd);
      return Math.round(lit * (1 - fog) + bgRGB[k] * fog);
    });
  }

  function makeHelpers(state) {
    return {
      ELEMENT_COLORS,
      BASE_COLORS,
      residueColor(r) {
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
      },
    };
  }

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
      rep: options.rep || 'cartoon',
      colorMode: options.colorMode || 'plddt',
      theme: options.theme || 'light',
      selectedA: 0,
      selectedB: 16,
      hoveredIndex: -1,
      autoRotate: false,
      reducedMotion: false,
      showLabels: options.showLabels !== false,
      showAxes: options.showAxes !== false,
      showPocket: options.showPocket !== false,
      showLigands: options.showLigands !== false,
      outline: true,
      ao: true,
      hiddenChains: new Set(),
      focusRange: null,
      spinRaf: 0,
      tweenRaf: 0,
      lastFrame: 0,
      hitTargets: [],
      drag: null,
      backend: 'webgl2',
    };

    const helpers = makeHelpers(state);

    function rotateVec(p) {
      const cy = Math.cos(state.yaw), sy = Math.sin(state.yaw);
      const cp = Math.cos(state.pitch), sp = Math.sin(state.pitch);
      const cr = Math.cos(state.roll), sr = Math.sin(state.roll);
      const x1 = p[0] * cy + p[2] * sy;
      const z1 = -p[0] * sy + p[2] * cy;
      const y2 = p[1] * cp - z1 * sp;
      const z2 = p[1] * sp + z1 * cp;
      return [x1 * cr - y2 * sr, x1 * sr + y2 * cr, z2];
    }

    function drawCanvas2DFallback(m, w, h, projectWorld, bgRGB) {
      const drawList = [];
      const rep = state.rep;
      const projRes = m.residues.map(r => projectWorld(r.pos));
      for (const ch of m.chains) {
        if (state.hiddenChains.has(ch.id)) continue;
        for (let k = 0; k < ch.length - 1; k++) {
          const i0 = ch.start + k, i1 = i0 + 1;
          const r0 = m.residues[i0], r1 = m.residues[i1];
          if (vDist(r0.xyz, r1.xyz) > 8.8) continue;
          const p0 = projRes[i0], p1 = projRes[i1];
          drawList.push({
            kind: 'tube',
            z: (p0.z + p1.z) * 0.5,
            p0, p1,
            width: Math.max(2.2, (rep === 'surface' ? 1.8 : 0.65) * p0.scale),
            rgb: helpers.residueColor(r0),
            fog: p0.fog,
          });
        }
      }
      for (const lig of m.ligands || []) {
        if (state.hiddenChains.has(lig.chainId)) continue;
        const p = projectWorld(lig.pos);
        const isMetal = ['ZN', 'MG', 'CA', 'FE'].includes(lig.element);
        drawList.push({
          kind: 'sphere', z: p.z + 0.2, x: p.x, y: p.y,
          radius: Math.max(4, (isMetal ? 1.5 : 0.6) * p.scale),
          rgb: ELEMENT_COLORS[lig.element] || [130, 140, 150],
          fog: p.fog,
          gloss: 0.7,
        });
      }
      drawList.sort((a, b) => a.z - b.z);
      ctx.lineCap = 'round';
      for (const item of drawList) {
        if (item.kind === 'tube') {
          const midLit = shadeRGB(item.rgb, 0.6, 0.1, item.fog, bgRGB);
          ctx.beginPath();
          ctx.moveTo(item.p0.x, item.p0.y);
          ctx.lineTo(item.p1.x, item.p1.y);
          ctx.strokeStyle = rgbStr(midLit);
          ctx.lineWidth = item.width;
          ctx.stroke();
        } else if (item.kind === 'sphere') {
          ctx.beginPath();
          ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
          ctx.fillStyle = rgbStr(shadeRGB(item.rgb, 0.85, 0.5, item.fog, bgRGB));
          ctx.fill();
        }
      }
    }

    function render() {
      const m = state.model;
      if (!m || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(240, rect.width || canvas.width || 680);
      const h = Math.max(200, rect.height || canvas.height || 520);
      const dpr = Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 2);
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
        bgGrad.addColorStop(1, '#ecf2ee');
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
        const fog = Math.max(0, Math.min(0.30, (m.radius - rv[2]) / (2.7 * m.radius) * 0.25));
        return {
          x: cx + rv[0] * baseScale * persp,
          y: cy - rv[1] * baseScale * persp,
          z: rv[2],
          scale: baseScale * persp,
          fog,
        };
      }

      const projRes = m.residues.map(r => projectWorld(r.pos));
      state.hitTargets = projRes
        .map((p, i) => ({ i, x: p.x, y: p.y, z: p.z, r: Math.max(7, 2.2 * p.scale), visible: !state.hiddenChains.has(m.residues[i].chainId) }))
        .filter(t => t.visible);

      const usedWebGL = typeof Mol3DWebGL !== 'undefined' && Mol3DWebGL.renderToTarget(ctx, w, h, dpr, m, state, helpers);
      state.backend = usedWebGL ? 'webgl2' : 'canvas2d';
      if (!usedWebGL) {
        drawCanvas2DFallback(m, w, h, projectWorld, bgRGB);
      }

      if (state.showLigands) {
        for (const link of m.ionLinks || []) {
          const lig = m.ligands[link.ligIndex];
          const res = m.residues[link.resIndex];
          if (state.hiddenChains.has(lig.chainId) || state.hiddenChains.has(res.chainId)) continue;
          const pl = projectWorld(lig.pos);
          const pr = projRes[link.resIndex];
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(pl.x, pl.y);
          ctx.lineTo(pr.x, pr.y);
          ctx.strokeStyle = isDark ? '#9ecbff' : '#3d5a8a';
          ctx.lineWidth = 1.6;
          ctx.stroke();
          ctx.restore();
        }
        if (state.showLabels) {
          for (const lig of m.ligands || []) {
            if (state.hiddenChains.has(lig.chainId)) continue;
            if (!['ZN', 'MG', 'CA', 'FE'].includes(lig.element)) continue;
            const p = projectWorld(lig.pos);
            ctx.font = '700 12px "Inter",system-ui,sans-serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = isDark ? '#ffffff' : '#172830';
            ctx.fillText(lig.element === 'ZN' ? 'Zn²⁺' : lig.element, p.x, p.y - Math.max(8, 1.55 * p.scale) - 4);
          }
        }
      }

      const aIdx = Math.max(0, Math.min(m.residues.length - 1, state.selectedA));
      const bIdx = Math.max(0, Math.min(m.residues.length - 1, state.selectedB));
      const pA = projRes[aIdx], pB = projRes[bIdx];
      if (pA && pB && !state.hiddenChains.has(m.residues[aIdx].chainId) && !state.hiddenChains.has(m.residues[bIdx].chainId)) {
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
          if (ctx.roundRect) ctx.roundRect(mx - tw / 2 - 7, my - 11, tw + 14, 22, 11);
          else ctx.rect(mx - tw / 2 - 7, my - 11, tw + 14, 22);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = isDark ? '#fff5d1' : '#8b2d0d';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badge, mx, my);
        }

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
            const rawLx = p.x < other.x ? (p.x - lw - 16) : (p.x + 14);
            const lx = Math.min(w - lw - 12, Math.max(10, rawLx));
            const rawLy = p.y < other.y ? (p.y - 14) : (p.y + 14);
            const ly = Math.max(44, Math.min(h - 16, rawLy));
            ctx.fillStyle = isDark ? 'rgba(10,20,26,0.9)' : 'rgba(255,255,255,0.94)';
            ctx.strokeStyle = ringColor;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(lx - 5, ly - 10, lw + 10, 20, 6);
            else ctx.rect(lx - 5, ly - 10, lw + 10, 20);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = isDark ? '#f1f7f5' : '#142c26';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(lbl, lx, ly);
          }
        }
      }

      if (state.hoveredIndex >= 0 && projRes[state.hoveredIndex]) {
        const hp = projRes[state.hoveredIndex];
        ctx.beginPath();
        ctx.arc(hp.x, hp.y, 8, 0, Math.PI * 2);
        ctx.strokeStyle = isDark ? '#ffffff' : '#17483d';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

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
          ctx.fillText(ax.name, ox + (ax.x - ox) * 1.32, oy + (ax.y - oy) * 1.32);
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

    function tweenTo(target) {
      if (state.tweenRaf) cancelAnimationFrame(state.tweenRaf);
      if (state.reducedMotion) {
        Object.assign(state, target);
        render();
        return;
      }
      const start = { yaw: state.yaw, pitch: state.pitch, zoom: state.zoom, panX: state.panX, panY: state.panY };
      const t0 = performance.now();
      const dur = 360;
      const step = now => {
        const f = Math.min(1, (now - t0) / dur);
        const ease = 1 - Math.pow(1 - f, 3);
        for (const k of Object.keys(target)) {
          state[k] = start[k] + (target[k] - start[k]) * ease;
        }
        if (options.onZoom && target.zoom !== undefined) options.onZoom(state.zoom);
        render();
        if (f < 1) state.tweenRaf = requestAnimationFrame(step);
        else state.tweenRaf = 0;
      };
      state.tweenRaf = requestAnimationFrame(step);
    }

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
        state._meshKey = null;
        if (!opts.keepCamera) {
          state.hiddenChains = new Set();
          state.focusRange = null;
          state.yaw = -0.45;
          state.pitch = 0.28;
          state.roll = 0;
          state.zoom = 1.0;
          state.panX = 0;
          state.panY = 0;
        }
        render();
      },
      setSelection(a, b) { state.selectedA = a; state.selectedB = b; render(); },
      setRepresentation(rep) { state.rep = rep; render(); },
      setColorMode(mode) { state.colorMode = mode; render(); },
      setTheme(theme) { state.theme = theme; render(); },
      setZoom(z) { state.zoom = Math.max(0.45, Math.min(3.5, z)); render(); },
      setHiddenChains(set) { state.hiddenChains = new Set(set); render(); },
      setFocusRange(range) { state.focusRange = range; render(); },
      setRenderOptions(opts = {}) {
        if ('outline' in opts) state.outline = Boolean(opts.outline);
        if ('ao' in opts) state.ao = Boolean(opts.ao);
        if ('showPocket' in opts) state.showPocket = Boolean(opts.showPocket);
        if ('showLigands' in opts) state.showLigands = Boolean(opts.showLigands);
        if ('showLabels' in opts) state.showLabels = Boolean(opts.showLabels);
        if ('showAxes' in opts) state.showAxes = Boolean(opts.showAxes);
        render();
      },
      focusResidue(resIndex, targetZoom = 1.75) {
        if (!state.model || !state.model.residues[resIndex]) return;
        const pos = state.model.residues[resIndex].pos;
        const yaw = Math.atan2(-pos[0], pos[2] || 0.01);
        tweenTo({ yaw, pitch: 0.2, zoom: targetZoom, panX: 0, panY: 0 });
      },
      focusChain(chainId) {
        if (!state.model) return;
        const ch = state.model.chains.find(c => c.id === chainId);
        if (!ch) return;
        state.hiddenChains.delete(chainId);
        const mid = ch.start + Math.floor(ch.length / 2);
        api.focusResidue(mid, 1.38);
      },
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
        if (preset === 'xy') tweenTo({ yaw: 0, pitch: 0, panX: 0, panY: 0 });
        else if (preset === 'xz') tweenTo({ yaw: 0, pitch: Math.PI / 2, panX: 0, panY: 0 });
        else if (preset === 'yz') tweenTo({ yaw: Math.PI / 2, pitch: 0, panX: 0, panY: 0 });
        else tweenTo({ yaw: -0.45, pitch: 0.28, panX: 0, panY: 0 });
      },
      resetCamera() {
        tweenTo({ yaw: -0.45, pitch: 0.28, zoom: 1.0, panX: 0, panY: 0 });
        if (options.onZoom) options.onZoom(1.0);
      },
      toDataURL() {
        render();
        return canvas.toDataURL('image/png');
      },
      getBackend: () => state.backend,
      render,
    };
    return api;
  }

  function renderThumbnail(model, opts = {}) {
    if (typeof document === 'undefined' || !model) return '';
    const w = opts.width || 240, h = opts.height || 140;
    const cvs = document.createElement('canvas');
    cvs.width = w;
    cvs.height = h;
    const ctx = cvs.getContext('2d');
    const st = {
      model,
      yaw: opts.yaw ?? -0.42,
      pitch: opts.pitch ?? 0.26,
      roll: 0,
      zoom: opts.zoom ?? 1.15,
      panX: 0,
      panY: 0,
      rep: opts.rep || 'cartoon',
      colorMode: opts.colorMode || (model.hasPlddt ? 'plddt' : (model.chains.length > 1 ? 'chain' : 'spectrum')),
      theme: opts.theme || 'dark',
      selectedA: 0,
      selectedB: 0,
      outline: true,
      ao: true,
      showPocket: false,
      showLigands: true,
      hiddenChains: new Set(),
      focusRange: null,
    };
    const isDark = st.theme === 'dark';
    const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, 8, w * 0.5, h * 0.5, w * 0.72);
    if (isDark) {
      bgGrad.addColorStop(0, '#14303a');
      bgGrad.addColorStop(1, '#0a1820');
    } else {
      bgGrad.addColorStop(0, '#ffffff');
      bgGrad.addColorStop(1, '#e8f0ec');
    }
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);
    const helpers = makeHelpers(st);
    const ok = typeof Mol3DWebGL !== 'undefined' && Mol3DWebGL.renderToTarget(ctx, w, h, 1, model, st, helpers);
    if (!ok) return '';
    return cvs.toDataURL('image/png');
  }

  return {
    normalize,
    parsePDB,
    parseCIF,
    createViewer,
    renderThumbnail,
    plddtRGB,
    plddtBandLabel,
    vDist,
    CHAIN_PALETTE,
  };
})();
