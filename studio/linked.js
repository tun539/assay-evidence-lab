'use strict';
const element = id => document.getElementById(id);
const fold = element('fold'), map = element('map'), sequence = element('sequence');
const letters = Object.fromEntries('ALA:A ARG:R ASN:N ASP:D CYS:C GLN:Q GLU:E GLY:G HIS:H ILE:I LEU:L LYS:K MET:M PHE:F PRO:P SER:S THR:T TRP:W TYR:Y VAL:V'.split(' ').map(s => s.split(':')));
let rows, points, pair, texture, screen, yaw = 0.4, pitch = 0.3, drag;
const distance = (a, b) => Math.hypot(a[2] - b[2], a[3] - b[3], a[4] - b[4]);
const label = r => r[0] + ' ' + r[1];

function plddtColor(score) {
  if (typeof score !== 'number') return '#45b89a';
  if (score >= 90) return '#0053D6';
  if (score >= 70) return '#65CBF3';
  if (score >= 50) return '#FFDB13';
  return '#FF7D45';
}

foldIds.forEach((id, i) => element('protein').add(new Option(dnaRecords[i].gene + ' · ' + dnaRecords[i].species + ' (' + id + ')', id)));

const reqProtein = new URLSearchParams(location.search).get('protein');
if (reqProtein && foldIds.includes(reqProtein)) {
  element('protein').value = reqProtein;
}

function changeProtein() {
  const id = element('protein').value;
  const model = bundledFolds[id];
  rows = model.rows;
  element('source').href = model.source;
  const studioLink = element('open-studio');
  if (studioLink) studioLink.href = 'structure.html?protein=' + encodeURIComponent(id);
  const center = [2, 3, 4].map(k => rows.reduce((s, r) => s + r[k], 0) / rows.length);
  const xyz = rows.map(r => center.map((c, k) => r[k + 2] - c));
  const extent = Math.max(...xyz.map(p => Math.hypot(...p))) || 1;
  points = xyz.map(p => p.map(v => v * 222 / extent));
  texture = document.createElement('canvas');
  texture.width = texture.height = rows.length;
  const ctx = texture.getContext('2d'), pixels = ctx.createImageData(rows.length, rows.length);
  pair = [0, 0];
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows.length; x++) {
      const contact = distance(rows[x], rows[y]) <= 8;
      pixels.data.set(contact ? [25, 114, 88, 255] : [234, 242, 236, 255], 4 * (y * rows.length + x));
      if (contact && y - x > pair[1] - pair[0]) pair = [x, y];
    }
  }
  ctx.putImageData(pixels, 0, 0);
  sequence.replaceChildren();
  rows.forEach((r, i) => {
    const b = document.createElement('button');
    b.textContent = letters[r[0]] || 'X';
    const pl = typeof r[5] === 'number' ? ' · pLDDT ' + r[5].toFixed(1) : '';
    b.title = label(r) + pl;
    b.setAttribute('aria-label', label(r) + pl);
    b.style.borderBottom = '3px solid ' + plddtColor(r[5]);
    b.onclick = () => pick(i);
    sequence.append(b);
  });
  element('slot').value = '0';
  refresh();
}

function pick(i) {
  const slot = Number(element('slot').value);
  pair[slot] = i;
  element('slot').value = String(1 - slot);
  refresh();
}

function drawFold() {
  const ctx = fold.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, 520);
  bg.addColorStop(0, '#0c2329');
  bg.addColorStop(1, '#14333b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 520, 520);
  screen = points.map(([x, y, z]) => {
    const u = x * Math.cos(yaw) + z * Math.sin(yaw);
    const v = z * Math.cos(yaw) - x * Math.sin(yaw);
    return [260 + u, 260 - y * Math.cos(pitch) + v * Math.sin(pitch), y * Math.sin(pitch) + v * Math.cos(pitch)];
  });
  function line(a, b, color, width) {
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  const order = screen.map((_, i) => i).slice(1).sort((i, j) => (screen[i][2] + screen[i - 1][2]) - (screen[j][2] + screen[j - 1][2]));
  for (const i of order) {
    const depth = (screen[i][2] + 240) / 480;
    const width = 2.6 + Math.max(0, Math.min(1, depth)) * 3.0;
    const col = plddtColor(rows[i][5]);
    line(screen[i - 1], screen[i], 'rgba(5,16,22,0.55)', width + 1.8);
    line(screen[i - 1], screen[i], col, width);
  }
  ctx.setLineDash([6, 4]);
  line(screen[pair[0]], screen[pair[1]], '#ffffff', 2.2);
  ctx.setLineDash([]);
  pair.forEach((i, k) => {
    const [x, y] = screen[i];
    ctx.fillStyle = k ? '#c2a8ff' : '#ffc364';
    ctx.beginPath();
    ctx.arc(x, y, k ? 6.5 : 8.5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = '#0c2329';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px Inter,sans-serif';
    ctx.fillText(k ? 'B' : 'A', x + 10, y + (k ? 16 : -7));
  });
}

function refresh() {
  const [a, b] = pair, n = rows.length, d = distance(rows[a], rows[b]);
  Array.from(sequence.children).forEach((button, i) => {
    button.className = i === a ? 'a' : i === b ? 'b' : '';
    button.setAttribute('aria-pressed', String(i === a || i === b));
  });
  const plA = typeof rows[a][5] === 'number' ? ' (pLDDT ' + rows[a][5].toFixed(1) + ')' : '';
  const plB = typeof rows[b][5] === 'number' ? ' (pLDDT ' + rows[b][5].toFixed(1) + ')' : '';
  element('measurement').textContent =
    'A · ' + label(rows[a]) + plA + '   /   B · ' + label(rows[b]) + plB +
    '   ·   ' + d.toFixed(2) + ' Å   ·   ' + Math.abs(rows[a][1] - rows[b][1]) +
    ' positions apart   ·   ' + (d <= 8 ? 'within' : 'outside') + ' 8 Å';
  const ctx = map.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(texture, 0, 0, 520, 520);
  const x = (a + 0.5) * 520 / n, y = (b + 0.5) * 520 / n;
  ctx.strokeStyle = '#783660';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x, 0); ctx.lineTo(x, 520);
  ctx.moveTo(0, y); ctx.lineTo(520, y);
  ctx.stroke();
  drawFold();
}

function xy(e, canvas) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) * 520 / r.width, (e.clientY - r.top) * 520 / r.height];
}
map.onclick = e => {
  pair = xy(e, map).map(v => Math.min(rows.length - 1, Math.max(0, Math.floor(v * rows.length / 520))));
  refresh();
};
fold.onpointerdown = e => { fold.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, moved: 0 }; };
fold.onpointermove = e => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.hypot(dx, dy);
  yaw += dx * 0.012; pitch += dy * 0.012;
  drag.x = e.clientX; drag.y = e.clientY;
  drawFold();
};
fold.onpointerup = e => {
  if (drag && drag.moved < 4) {
    const [x, y] = xy(e, fold);
    let best = 14, index = -1;
    screen.forEach(([u, v], i) => {
      const d = Math.hypot(x - u, y - v);
      if (d < best) { best = d; index = i; }
    });
    if (index >= 0) pick(index);
  }
  drag = null;
};
fold.onpointercancel = () => { drag = null; };
fold.onkeydown = e => {
  const delta = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, 0.12], ArrowDown: [0, -0.12] }[e.key];
  if (delta) { e.preventDefault(); yaw += delta[0]; pitch += delta[1]; drawFold(); }
};
element('protein').onchange = changeProtein;
changeProtein();
