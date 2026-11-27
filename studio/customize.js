'use strict';

const byId = id => document.getElementById(id);

const PRESETS = [
  { name: 'Botanical Forest', theme: { primary: '#18493c', primaryHover: '#22624f', accent: '#337953', background: '#f5f7f2', surfaceTint: '#edf5ec' } },
  { name: 'Deep Marine', theme: { primary: '#16425b', primaryHover: '#1f5a7a', accent: '#2f7a8a', background: '#f2f6f9', surfaceTint: '#e7f1f6' } },
  { name: 'Warm Terracotta', theme: { primary: '#6e321e', primaryHover: '#8c4228', accent: '#b45a2a', background: '#faf6f1', surfaceTint: '#f5ebe1' } },
  { name: 'Slate Indigo', theme: { primary: '#2d325a', primaryHover: '#3d4478', accent: '#565ea8', background: '#f4f5fa', surfaceTint: '#eaecf7' } },
];

let draft = studioRuntime.get();

function readForm() {
  draft.brandName = byId('brandName').value.trim() || draft.brandName;
  draft.brandMark = byId('brandMark').value.trim() || draft.brandMark;
  draft.heroTitlePrefix = byId('heroTitlePrefix').value.trim() || draft.heroTitlePrefix;
  draft.heroTitleAccent = byId('heroTitleAccent').value.trim() || draft.heroTitleAccent;
  draft.heroIntro = byId('heroIntro').value.trim() || draft.heroIntro;
  draft.repoUrl = byId('repoUrl').value.trim() || draft.repoUrl;
  draft.workspaceBanner = {
    enabled: byId('bannerEnabled').checked,
    emptyText: byId('bannerText').value.trim() || draft.workspaceBanner.emptyText,
  };
  draft.theme = {
    primary: byId('colorPrimary').value,
    primaryHover: byId('colorPrimaryHover').value,
    accent: byId('colorAccent').value,
    background: byId('colorBackground').value,
    surfaceTint: byId('colorSurfaceTint').value,
  };
  draft = studioRuntime.sanitize(draft);
}

function populateForm() {
  byId('brandName').value = draft.brandName;
  byId('brandMark').value = draft.brandMark;
  byId('heroTitlePrefix').value = draft.heroTitlePrefix;
  byId('heroTitleAccent').value = draft.heroTitleAccent;
  byId('heroIntro').value = draft.heroIntro;
  byId('repoUrl').value = draft.repoUrl;
  byId('bannerText').value = draft.workspaceBanner.emptyText;
  byId('bannerEnabled').checked = draft.workspaceBanner.enabled;
  byId('colorPrimary').value = draft.theme.primary;
  byId('colorPrimaryHover').value = draft.theme.primaryHover;
  byId('colorAccent').value = draft.theme.accent;
  byId('colorBackground').value = draft.theme.background;
  byId('colorSurfaceTint').value = draft.theme.surfaceTint;
}

function updateOutput() {
  studioRuntime.applyTheme(draft);
  byId('code-output').textContent = studioRuntime.serialize(draft);
  byId('github-edit-link').href = studioRuntime.githubEditUrl(draft, 'studio/studio-config.js');
  const active = studioRuntime.hasPreview();
  byId('preview-mode-label').textContent = active ? 'Browser preview' : 'Live defaults';
  const badge = byId('preview-badge');
  badge.textContent = active ? 'Browser preview active (only visible to you until published)' : 'Using live site configuration';
  badge.className = 'preview-pill' + (active ? ' active' : '');
}

function renderLabs() {
  const host = byId('lab-list');
  host.replaceChildren();
  draft.labs.forEach((lab, index) => {
    const row = document.createElement('div');
    row.className = 'lab-row';

    const top = document.createElement('div');
    top.className = 'lab-row-top';

    const titleWrap = document.createElement('label');
    titleWrap.textContent = 'Title';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = lab.title;
    titleInput.oninput = () => { lab.title = titleInput.value; updateOutput(); };
    titleWrap.append(titleInput);

    const hrefWrap = document.createElement('label');
    hrefWrap.textContent = 'Page or URL';
    const hrefInput = document.createElement('input');
    hrefInput.type = 'text';
    hrefInput.value = lab.href;
    hrefInput.oninput = () => { lab.href = hrefInput.value; updateOutput(); };
    hrefWrap.append(hrefInput);

    const wsWrap = document.createElement('label');
    const wsCheck = document.createElement('input');
    wsCheck.type = 'checkbox';
    wsCheck.checked = lab.savesToWorkspace;
    wsCheck.onchange = () => { lab.savesToWorkspace = wsCheck.checked; updateOutput(); };
    wsWrap.append(wsCheck, ' Saves to workspace');

    top.append(titleWrap, hrefWrap, wsWrap);

    const descWrap = document.createElement('label');
    descWrap.textContent = 'Description';
    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.value = lab.description;
    descInput.oninput = () => { lab.description = descInput.value; updateOutput(); };
    descWrap.append(descInput);

    const controls = document.createElement('div');
    controls.className = 'lab-row-controls';
    const tag = document.createElement('small');
    tag.textContent = '#' + (index + 1) + ' · id: ' + lab.id;

    const btns = document.createElement('div');
    btns.className = 'lab-row-btns';
    const up = document.createElement('button');
    up.type = 'button'; up.textContent = '↑ Up'; up.disabled = index === 0;
    up.onclick = () => { [draft.labs[index - 1], draft.labs[index]] = [draft.labs[index], draft.labs[index - 1]]; renderLabs(); updateOutput(); };

    const down = document.createElement('button');
    down.type = 'button'; down.textContent = '↓ Down'; down.disabled = index === draft.labs.length - 1;
    down.onclick = () => { [draft.labs[index + 1], draft.labs[index]] = [draft.labs[index], draft.labs[index + 1]]; renderLabs(); updateOutput(); };

    const del = document.createElement('button');
    del.type = 'button'; del.textContent = 'Remove'; del.disabled = draft.labs.length <= 1;
    del.onclick = () => { draft.labs.splice(index, 1); renderLabs(); updateOutput(); };

    btns.append(up, down, del);
    controls.append(tag, btns);
    row.append(top, descWrap, controls);
    host.append(row);
  });
}

function renderPresets() {
  const host = byId('presets');
  for (const preset of PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch-btn';
    const dot1 = document.createElement('span');
    dot1.className = 'dot'; dot1.style.background = preset.theme.primary;
    const dot2 = document.createElement('span');
    dot2.className = 'dot'; dot2.style.background = preset.theme.accent;
    btn.append(dot1, dot2, preset.name);
    btn.onclick = () => {
      draft.theme = { ...preset.theme };
      populateForm();
      updateOutput();
      byId('status').textContent = 'Applied "' + preset.name + '" palette to draft.';
    };
    host.append(btn);
  }
}

for (const id of ['brandName', 'brandMark', 'heroTitlePrefix', 'heroTitleAccent', 'heroIntro', 'repoUrl', 'bannerText', 'bannerEnabled', 'colorPrimary', 'colorPrimaryHover', 'colorAccent', 'colorBackground', 'colorSurfaceTint']) {
  byId(id).addEventListener('input', () => { readForm(); updateOutput(); });
  byId(id).addEventListener('change', () => { readForm(); updateOutput(); });
}

byId('add-lab').onclick = () => {
  const n = draft.labs.length + 1;
  draft.labs.push({ id: 'custom-' + n, title: 'Custom experiment ' + n, href: 'workspace.html', description: 'Describe what this lab measures and tests.', savesToWorkspace: false });
  renderLabs();
  updateOutput();
};

byId('apply-preview').onclick = () => {
  readForm();
  draft = studioRuntime.savePreview(draft);
  populateForm();
  renderLabs();
  updateOutput();
  byId('status').textContent = 'Browser preview saved! Open the home page to inspect your changes live.';
};

byId('reset-preview').onclick = () => {
  draft = studioRuntime.clearPreview();
  populateForm();
  renderLabs();
  updateOutput();
  byId('status').textContent = 'Reset to the live repository defaults.';
};

byId('copy-config').onclick = async () => {
  readForm();
  const text = studioRuntime.serialize(draft);
  try {
    await navigator.clipboard.writeText(text);
    byId('status').textContent = 'Copied studio-config.js to clipboard. Click "Edit studio-config.js on GitHub" to paste and publish!';
  } catch {
    byId('status').textContent = 'Clipboard unavailable here. Use "Download studio-config.js" instead.';
  }
};

function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

byId('download-config').onclick = () => {
  readForm();
  downloadFile('studio-config.js', studioRuntime.serialize(draft), 'application/javascript;charset=utf-8');
  byId('status').textContent = 'Downloaded studio-config.js.';
};

byId('export-json').onclick = () => {
  readForm();
  downloadFile('studio-config.json', JSON.stringify(draft, null, 2), 'application/json');
  byId('status').textContent = 'Exported studio-config.json.';
};

byId('import-json').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    draft = studioRuntime.sanitize(JSON.parse(await file.text()));
    populateForm();
    renderLabs();
    updateOutput();
    byId('status').textContent = 'Imported configuration JSON into draft. Click "Apply live browser preview" to test it.';
  } catch (err) {
    byId('status').textContent = 'Could not import JSON: ' + err.message;
  } finally {
    e.target.value = '';
  }
};

fetch('build-info.json')
  .then(res => (res.ok ? res.json() : null))
  .then(info => {
    if (!info) return;
    byId('build-sha').textContent = (info.commit || 'local').slice(0, 7);
    if (info.builtAt) byId('build-date').textContent = new Date(info.builtAt).toLocaleString();
  })
  .catch(() => {});

renderPresets();
populateForm();
renderLabs();
updateOutput();
