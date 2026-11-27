'use strict';

const evidenceRecords = (() => {
  const key = 'assay-evidence-records-v1';
  const noteKey = 'assay-evidence-note-v1';
  const kinds = ['measured', 'simulated'];
  const fields = ['title', 'dataset', 'metric', 'unit', 'method', 'source'];

  const validRun = run => Boolean(
    run && typeof run.id === 'string' && /^[\w.-]{1,100}$/.test(run.id)
    && kinds.includes(run.kind)
    && fields.every(field => typeof run[field] === 'string' && run[field].length <= 500)
    && Number.isFinite(run.value) && Number.isFinite(Date.parse(run.savedAt))
    && run.details && typeof run.details === 'object' && !Array.isArray(run.details)
  );

  function read() {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const runs = JSON.parse(raw);
    if (!Array.isArray(runs) || !runs.every(validRun)) throw Error('Saved records could not be read.');
    return runs;
  }

  function count() {
    try {
      return read().length;
    } catch {
      return 0;
    }
  }

  function replace(runs) {
    if (runs.length > 100 || new Set(runs.map(run => run.id)).size !== runs.length || !runs.every(validRun)) {
      throw Error('Expected up to 100 valid and distinct evidence records.');
    }
    const data = JSON.stringify(runs);
    if (data.length > 1_000_000) throw Error('The workspace is full. Export your records before clearing space.');
    localStorage.setItem(key, data);
  }

  function capture(run) {
    const now = new Date();
    const id = globalThis.crypto?.randomUUID?.() || now.getTime() + '-' + Math.random().toString(36).slice(2);
    const created = { ...run, id, savedAt: now.toISOString() };
    replace([...read(), created]);
    return created;
  }

  function merge(packet) {
    if (
      packet?.schema !== 'assay-evidence/1' || !Array.isArray(packet.runs) || packet.runs.length > 100
      || !packet.runs.every(validRun) || new Set(packet.runs.map(run => run.id)).size !== packet.runs.length
    ) {
      throw Error('Invalid evidence packet.');
    }
    const existing = read();
    const ids = new Set(existing.map(run => run.id));
    const added = packet.runs.filter(run => !ids.has(run.id));
    replace([...existing, ...added]);
    return added.length;
  }

  function remove(id) {
    replace(read().filter(run => run.id !== id));
  }

  function clear() {
    localStorage.removeItem(key);
  }

  function readNote() {
    return localStorage.getItem(noteKey) || '';
  }

  function saveNote(note) {
    const text = typeof note === 'string' ? note.slice(0, 2000) : '';
    if (text) localStorage.setItem(noteKey, text);
    else localStorage.removeItem(noteKey);
  }

  function compare(a, b) {
    if (!a || !b) return null;
    const checks = [
      ['evidence type', a.kind === b.kind],
      ['dataset', a.dataset === b.dataset],
      ['metric', a.metric === b.metric],
      ['unit', a.unit === b.unit],
      ['comparison condition', Boolean(a.details?.comparisonKey && a.details.comparisonKey === b.details?.comparisonKey)],
    ];
    const mismatches = checks.filter(([, ok]) => !ok).map(([name]) => name);
    const comparable = mismatches.length === 0;
    const delta = comparable ? b.value - a.value : null;
    const percentChange = comparable && a.value !== 0 ? ((b.value - a.value) / Math.abs(a.value)) * 100 : null;
    const allDetailKeys = [...new Set([...Object.keys(a.details || {}), ...Object.keys(b.details || {})])]
      .filter(k => k !== 'comparisonKey');
    const detailDiffs = allDetailKeys.map(k => ({
      key: k,
      a: a.details?.[k],
      b: b.details?.[k],
      same: JSON.stringify(a.details?.[k]) === JSON.stringify(b.details?.[k]),
    }));
    return { comparable, mismatches, delta, percentChange, detailDiffs };
  }

  function compatibleIds(target, runs) {
    if (!target || !Array.isArray(runs)) return [];
    return runs
      .filter(other => other.id !== target.id && compare(target, other)?.comparable)
      .map(other => other.id);
  }

  function bindBadge(element, baseLabel = 'Evidence workspace') {
    if (!element) return;
    const update = () => {
      const n = count();
      element.textContent = n ? `${baseLabel} (${n})` : baseLabel;
    };
    update();
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', update);
      window.addEventListener('pageshow', update);
    }
    return update;
  }

  function csvCell(value) {
    const str = String(value ?? '');
    return /[",\n\r]/.test(str) ? '"' + str.replaceAll('"', '""') + '"' : str;
  }

  function toCsv(runs) {
    const header = ['id', 'saved_at', 'kind', 'title', 'dataset', 'method', 'metric', 'value', 'unit', 'source'];
    const rows = runs.map(r => [r.id, r.savedAt, r.kind, r.title, r.dataset, r.method, r.metric, r.value, r.unit, r.source]);
    return [header, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
  }

  function toMarkdown(runs, note = '') {
    const clean = text => String(text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
    const lines = [
      '# Assay Evidence Packet',
      '',
      `Exported: ${new Date().toISOString()}`,
      `Total records: ${runs.length}`,
      '',
    ];
    if (note && note.trim()) {
      lines.push('## Review note', '', note.trim(), '');
    }
    lines.push('## Saved runs', '');
    lines.push('| Type | Title | Dataset | Method | Metric | Value | Unit | Saved |');
    lines.push('| --- | --- | --- | --- | --- | ---: | --- | --- |');
    for (const r of runs) {
      lines.push(`| ${clean(r.kind)} | ${clean(r.title)} | ${clean(r.dataset)} | ${clean(r.method)} | ${clean(r.metric)} | ${r.value} | ${clean(r.unit)} | ${clean(r.savedAt)} |`);
    }
    lines.push('');
    return lines.join('\n');
  }

  const samplePacket = () => ({
    schema: 'assay-evidence/1',
    note: 'Sample comparison from the Puromycin galactosyltransferase assay: holding out 0.56 ppm, allowing condition-specific Vmax plateaus lowers held-out RMSE from 23.4097 to 9.6115 counts/min/min (-58.9%).',
    runs: [
      {
        id: 'sample-puromycin-shared-056',
        savedAt: '2026-11-25T12:00:00.000Z',
        kind: 'measured',
        title: 'Shared Vmax and Km · 0.56 ppm',
        dataset: 'Puromycin · galactosyltransferase initial rates',
        method: 'Leave one concentration out',
        metric: 'Held-out RMSE',
        unit: 'counts/min/min',
        value: 23.4097,
        source: 'https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/Puromycin.html',
        details: {
          comparisonKey: 'puromycin-holdout-0.56',
          concentrationPpm: 0.56,
          model: 'shared',
          pooledRmse: 19.33,
        },
      },
      {
        id: 'sample-puromycin-vmax-056',
        savedAt: '2026-11-25T12:01:00.000Z',
        kind: 'measured',
        title: 'Condition-specific Vmax · 0.56 ppm',
        dataset: 'Puromycin · galactosyltransferase initial rates',
        method: 'Leave one concentration out',
        metric: 'Held-out RMSE',
        unit: 'counts/min/min',
        value: 9.6115,
        source: 'https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/Puromycin.html',
        details: {
          comparisonKey: 'puromycin-holdout-0.56',
          concentrationPpm: 0.56,
          model: 'split_vmax',
          pooledRmse: 11.92,
        },
      },
    ],
  });

  return {
    read,
    count,
    capture,
    merge,
    remove,
    clear,
    readNote,
    saveNote,
    compare,
    compatibleIds,
    bindBadge,
    toCsv,
    toMarkdown,
    samplePacket,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = evidenceRecords;
}
