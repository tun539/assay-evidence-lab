'use strict';

const get = id => document.getElementById(id);
const svgNs = 'http://www.w3.org/2000/svg';
const selected = [];
const add = (parent, tag, content) => {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  parent.append(element);
  return element;
};
const svgEl = (parent, tag, attrs, text) => {
  const node = document.createElementNS(svgNs, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = text;
  parent.append(node);
  return node;
};
const format = value => new Intl.NumberFormat('en', { maximumFractionDigits: 4, minimumFractionDigits: 0 }).format(value);
const formatDetail = value => {
  if (value === undefined) return '—';
  if (typeof value === 'number') return format(value);
  if (Array.isArray(value)) {
    if (value.length && typeof value[0] === 'object' && value[0] !== null) {
      return value.length + ' items (inspect card details)';
    }
    const joined = value.map(v => typeof v === 'number' ? format(v) : String(v)).join(', ');
    return joined.length > 110 ? joined.slice(0, 109) + '…' : joined;
  }
  if (typeof value === 'object' && value !== null) {
    const json = JSON.stringify(value);
    return json.length > 110 ? json.slice(0, 109) + '…' : json;
  }
  return String(value);
};
const truncate = (text, max = 32) => text.length > max ? text.slice(0, max - 1) + '…' : text;

let runs = [];
let activeFilter = 'all';

function downloadFile(filename, content, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateSummary() {
  const measured = runs.filter(r => r.kind === 'measured').length;
  const simulated = runs.length - measured;
  const datasets = [...new Set(runs.map(r => r.dataset))].sort();
  get('stat-total').textContent = String(runs.length);
  get('stat-measured').textContent = String(measured);
  get('stat-simulated').textContent = String(simulated);
  get('stat-datasets').textContent = String(datasets.length);

  const select = get('dataset-filter');
  const previous = select.value;
  select.replaceChildren(new Option('All datasets', ''));
  for (const ds of datasets) select.add(new Option(ds, ds));
  select.value = datasets.includes(previous) ? previous : '';
}

function renderCompareChart(container, a, b) {
  const svg = svgEl(container, 'svg', {
    class: 'compare-chart',
    viewBox: '0 0 720 120',
    role: 'img',
    'aria-label': `Comparison bar chart: ${a.title} (${format(a.value)} ${a.unit}) vs ${b.title} (${format(b.value)} ${b.unit})`,
  });
  const minVal = Math.min(0, a.value, b.value);
  const maxVal = Math.max(0, a.value, b.value);
  const span = Math.max(1e-9, maxVal - minVal);
  const left = 225;
  const right = 530;
  const width = right - left;
  const zeroX = left + ((0 - minVal) / span) * width;

  svgEl(svg, 'line', { x1: zeroX, x2: zeroX, y1: 14, y2: 106, stroke: '#8ea69a', 'stroke-width': 1.5 });

  const bars = [
    { label: 'A · ' + truncate(a.title, 25), value: a.value, y: 22, color: '#2b6b59' },
    { label: 'B · ' + truncate(b.title, 25), value: b.value, y: 66, color: '#b4692c' },
  ];
  for (const bar of bars) {
    const valX = left + ((bar.value - minVal) / span) * width;
    const x = Math.min(zeroX, valX);
    const w = Math.max(3, Math.abs(valX - zeroX));
    svgEl(svg, 'text', { x: left - 12, y: bar.y + 18, 'text-anchor': 'end', fill: '#183c35', 'font-size': 12.5, 'font-weight': 600 }, bar.label);
    svgEl(svg, 'rect', { x, y: bar.y, width: w, height: 26, rx: 5, fill: bar.color });
    svgEl(svg, 'text', { x: right + 12, y: bar.y + 18, fill: '#183c35', 'font-size': 12.5, 'font-weight': 650 }, format(bar.value) + ' ' + truncate(a.unit, 18));
  }
}

function compare() {
  const [a, b] = selected.map(id => runs.find(run => run.id === id));
  const summaryEl = get('compare');
  const wrap = get('compare-table-wrap');
  wrap.replaceChildren();
  if (!a || !b) {
    summaryEl.textContent = 'Select two records above to compare them side by side.';
    wrap.hidden = true;
    return;
  }

  const result = evidenceRecords.compare(a, b);
  summaryEl.textContent = '';

  const head = add(wrap, 'div');
  head.className = 'compare-head';
  const badge = add(head, 'span', result.comparable ? 'Compatible comparison' : 'Cross-condition inspection');
  badge.className = 'compare-badge ' + (result.comparable ? 'ok' : 'warn');
  const swapBtn = add(head, 'button', 'Swap A ↔ B');
  swapBtn.type = 'button';
  swapBtn.onclick = () => {
    selected.reverse();
    compare();
  };

  if (result.comparable) {
    const sign = result.delta > 0 ? '+' : '';
    const pct = result.percentChange === null ? '' : ' (' + (result.percentChange > 0 ? '+' : '') + result.percentChange.toFixed(1) + '%)';
    const deltaEl = add(wrap, 'div', b.title + ' minus ' + a.title + ' · ' + sign + format(result.delta) + ' ' + a.unit + pct);
    deltaEl.className = 'compare-delta';
    renderCompareChart(wrap, a, b);
  } else {
    add(wrap, 'p', 'These runs differ in ' + result.mismatches.join(', ') + '. Inspect their attributes and settings side by side below.');
  }

  const table = add(wrap, 'table');
  table.className = 'compare-table';
  const thead = add(table, 'thead');
  const headRow = add(thead, 'tr');
  add(headRow, 'th', 'Field');
  add(headRow, 'th', 'Run A · ' + a.title);
  add(headRow, 'th', 'Run B · ' + b.title);

  const tbody = add(table, 'tbody');
  const baseRows = [
    ['Evidence type', a.kind, b.kind, a.kind === b.kind],
    ['Dataset', a.dataset, b.dataset, a.dataset === b.dataset],
    ['Method', a.method, b.method, a.method === b.method],
    ['Metric', a.metric, b.metric, a.metric === b.metric],
    ['Value', format(a.value) + ' ' + a.unit, format(b.value) + ' ' + b.unit, a.value === b.value && a.unit === b.unit],
  ];
  for (const [label, va, vb, same] of baseRows) {
    const tr = add(tbody, 'tr');
    if (!same) tr.className = 'diff-row';
    add(tr, 'th', label);
    add(tr, 'td', va);
    add(tr, 'td', vb);
  }
  for (const d of result.detailDiffs) {
    const tr = add(tbody, 'tr');
    if (!d.same) tr.className = 'diff-row';
    add(tr, 'th', 'detail.' + d.key);
    add(tr, 'td', formatDetail(d.a));
    add(tr, 'td', formatDetail(d.b));
  }
  wrap.hidden = false;
}

function visibleRuns() {
  const query = get('search').value.trim().toLowerCase();
  const dataset = get('dataset-filter').value;
  const sortMode = get('sort').value;
  let list = runs.filter(run => {
    if (activeFilter !== 'all' && run.kind !== activeFilter) return false;
    if (dataset && run.dataset !== dataset) return false;
    if (!query) return true;
    const hay = [run.title, run.dataset, run.method, run.metric, run.unit].join(' ').toLowerCase();
    return hay.includes(query);
  });
  if (sortMode === 'value-asc') list = list.slice().sort((a, b) => a.value - b.value);
  else if (sortMode === 'value-desc') list = list.slice().sort((a, b) => b.value - a.value);
  else list = list.slice().reverse();
  return list;
}

function render() {
  try {
    runs = evidenceRecords.read();
  } catch (error) {
    get('status').textContent = error.message;
    return;
  }

  for (let i = selected.length - 1; i >= 0; i--) {
    if (!runs.some(run => run.id === selected[i])) selected.splice(i, 1);
  }

  updateSummary();
  const list = get('records');
  list.replaceChildren();
  const shown = visibleRuns();

  if (!runs.length) {
    get('count').textContent = 'No runs saved yet.';
    const empty = add(list, 'div', 'Save a run from any of the ten labs above, import an evidence packet, or click "Load sample comparison" to explore side-by-side review.');
    empty.className = 'empty-state';
  } else if (!shown.length) {
    get('count').textContent = '0 of ' + runs.length + ' records match the current filter.';
    const empty = add(list, 'div', 'No saved runs match this filter. Clear the search box or switch back to "All".');
    empty.className = 'empty-state';
  } else {
    get('count').textContent = shown.length === runs.length
      ? runs.length + ' records · select two to compare'
      : 'Showing ' + shown.length + ' of ' + runs.length + ' records · select two to compare';
  }

  for (const run of shown) {
    const card = add(list, 'article');
    if (selected.includes(run.id)) card.classList.add('is-selected');

    const badge = add(card, 'div', run.kind === 'measured' ? 'Measured assay' : 'Simulated assay');
    badge.className = 'kind ' + run.kind;
    add(card, 'h3', run.title);
    add(card, 'div', format(run.value) + ' ' + run.unit).className = 'metric';
    add(card, 'p', run.metric + ' · ' + run.method).className = 'meta';
    add(card, 'p', run.dataset + ' · ' + new Date(run.savedAt).toLocaleString()).className = 'meta';

    const detail = add(card, 'details');
    add(detail, 'summary', 'Inspect settings and observations');
    add(detail, 'p', run.source).className = 'meta';
    add(detail, 'pre', JSON.stringify(run.details, null, 2));

    const footer = add(card, 'div');
    footer.className = 'card-footer';

    const label = add(footer, 'label');
    const box = add(label, 'input');
    box.type = 'checkbox';
    box.checked = selected.includes(run.id);
    label.append('Compare');
    box.onchange = () => {
      if (box.checked && selected.length === 2) {
        box.checked = false;
        get('status').textContent = 'Clear one selection before choosing another.';
        return;
      }
      if (box.checked) selected.push(run.id);
      else {
        const idx = selected.indexOf(run.id);
        if (idx >= 0) selected.splice(idx, 1);
      }
      card.classList.toggle('is-selected', box.checked);
      get('status').textContent = '';
      compare();
    };

    const actions = add(footer, 'div');
    actions.className = 'mini-actions';

    const peers = evidenceRecords.compatibleIds(run, runs);
    if (peers.length) {
      const matchBtn = add(actions, 'button', 'Compare with match (' + peers.length + ')');
      matchBtn.type = 'button';
      matchBtn.className = 'match-btn';
      matchBtn.onclick = () => {
        selected.splice(0, selected.length, run.id, peers.at(-1));
        render();
        get('compare-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    }

    const remove = add(actions, 'button', 'Remove');
    remove.type = 'button';
    remove.onclick = () => {
      if (!confirm('Remove "' + run.title + '" from this browser?')) return;
      try {
        evidenceRecords.remove(run.id);
        const idx = selected.indexOf(run.id);
        if (idx >= 0) selected.splice(idx, 1);
        render();
        get('status').textContent = 'Removed "' + run.title + '".';
      } catch (error) {
        get('status').textContent = error.message;
      }
    };
  }

  const hasRuns = runs.length > 0;
  get('export').disabled = !hasRuns;
  get('export-md').disabled = !hasRuns;
  get('copy-md').disabled = !hasRuns;
  get('export-csv').disabled = !hasRuns;
  get('clear-all').disabled = !hasRuns;
  compare();
}

for (const button of document.querySelectorAll('[data-filter]')) {
  button.onclick = () => {
    activeFilter = button.dataset.filter;
    for (const other of document.querySelectorAll('[data-filter]')) {
      other.setAttribute('aria-pressed', String(other === button));
    }
    render();
  };
}
get('dataset-filter').onchange = render;
get('search').oninput = render;
get('sort').onchange = render;

get('note').value = evidenceRecords.readNote();
get('note').addEventListener('input', () => {
  try {
    evidenceRecords.saveNote(get('note').value);
  } catch (error) {
    get('status').textContent = error.message;
  }
});

get('load-sample').onclick = () => {
  try {
    const packet = evidenceRecords.samplePacket();
    const added = evidenceRecords.merge(packet);
    if (!get('note').value && packet.note) {
      get('note').value = packet.note;
      evidenceRecords.saveNote(packet.note);
    }
    selected.splice(0, selected.length, ...packet.runs.map(run => run.id));
    render();
    get('status').textContent = added
      ? 'Loaded ' + added + ' sample kinetics records and selected them for comparison.'
      : 'Sample kinetics records are already in your workspace and selected for comparison.';
  } catch (error) {
    get('status').textContent = error.message;
  }
};

get('export').onclick = () => {
  const packet = {
    schema: 'assay-evidence/1',
    exportedAt: new Date().toISOString(),
    note: get('note').value,
    runs: evidenceRecords.read(),
  };
  downloadFile('assay-evidence-packet.json', JSON.stringify(packet, null, 2), 'application/json');
  get('status').textContent = 'Exported JSON evidence packet (' + packet.runs.length + ' runs).';
};

get('export-md').onclick = () => {
  const current = evidenceRecords.read();
  downloadFile('assay-evidence-report.md', evidenceRecords.toMarkdown(current, get('note').value), 'text/markdown;charset=utf-8');
  get('status').textContent = 'Exported Markdown review report (' + current.length + ' runs).';
};

get('copy-md').onclick = async () => {
  const current = evidenceRecords.read();
  const report = evidenceRecords.toMarkdown(current, get('note').value);
  try {
    await navigator.clipboard.writeText(report);
    get('status').textContent = 'Copied Markdown report (' + current.length + ' runs) to clipboard.';
  } catch {
    get('status').textContent = 'Clipboard unavailable in this browser context. Use Export Markdown report instead.';
  }
};

get('export-csv').onclick = () => {
  const current = evidenceRecords.read();
  downloadFile('assay-evidence-summary.csv', evidenceRecords.toCsv(current), 'text/csv;charset=utf-8');
  get('status').textContent = 'Exported CSV summary table (' + current.length + ' runs).';
};

get('import').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    if (file.size > 1_100_000) throw Error('Choose an evidence packet smaller than 1.1 MB.');
    const packet = JSON.parse(await file.text());
    const added = evidenceRecords.merge(packet);
    if (!get('note').value && typeof packet.note === 'string') {
      get('note').value = packet.note.slice(0, 2000);
      evidenceRecords.saveNote(get('note').value);
    }
    render();
    get('status').textContent = added + ' records imported. Existing records were kept.';
  } catch (error) {
    get('status').textContent = error.message;
  } finally {
    e.target.value = '';
  }
};

get('clear-all').onclick = () => {
  if (!runs.length || !confirm('Remove all ' + runs.length + ' saved records from this browser?')) return;
  evidenceRecords.clear();
  selected.splice(0, selected.length);
  render();
  get('status').textContent = 'Workspace cleared.';
};

window.addEventListener('storage', () => {
  selected.splice(0, selected.length);
  get('note').value = evidenceRecords.readNote();
  render();
});

render();
