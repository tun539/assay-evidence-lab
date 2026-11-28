'use strict';

/**
 * Global Studio Preferences, Bilingual EN/VI Dictionary, Multi-Audience Persona Sync,
 * Interactive Scientific Glossary, Accessibility Controls, Permalinks, and Guided Tours.
 */
const StudioPrefs = (() => {
  const PREFS_KEY = 'assay-studio-prefs-v1';

  const DEFAULT_PREFS = {
    lang: 'en',
    audience: 'student', // explorer | student | biologist | researcher
    colorblind: false,
    highContrast: false,
    reducedMotion: false,
    largeText: false,
  };

  const GLOSSARY = [
    {
      id: 'plddt',
      term: 'pLDDT',
      tag: 'AlphaFold 0–100',
      en: {
        plain: 'A 0–100 confidence score showing how sure AlphaFold is about each residue’s local 3D shape. Dark blue (>90) is rigid and reliable; orange (<50) is flexible or disordered.',
        tech: 'Predicted Local Distance Difference Test (lDDT-Cα). Evaluates local stereochemical agreement; <50 strongly correlates with intrinsic disorder (IDR).',
      },
      vi: {
        plain: 'Thang điểm 0–100 cho biết AlphaFold tự tin đến đâu ở từng vị trí amino acid. Xanh đậm (>90) là rất chính xác; cam (<50) thường là vùng linh động hoặc vô định hình.',
        tech: 'Predicted Local Distance Difference Test (lDDT-Cα). Đánh giá sai lệch khoảng cách cục bộ từng residue; vùng <50 tương quan chặt với vùng mất trật tự nội tại (IDR).',
      },
    },
    {
      id: 'pae',
      term: 'PAE (Expected Position Error)',
      tag: 'Ångströms',
      en: {
        plain: 'A 2D map showing how accurately two parts of a protein or complex are positioned relative to each other. Deep green squares mean domains lock together reliably.',
        tech: 'Predicted Aligned Error in Ångströms when aligning on residue x and scoring residue y. Off-diagonal dark green blocks indicate confident domain-domain or inter-chain packing.',
      },
      vi: {
        plain: 'Bản đồ nhiệt 2D cho biết hai miền hoặc hai chuỗi có đặt đúng vị trí tương đối với nhau không. Ô xanh lục đậm nghĩa là chúng gắn kết chắc chắn.',
        tech: 'Sai số vị trí kỳ vọng (Å) khi căn chỉnh trên residue x và đo sai lệch tại residue y. Khối xanh lục đậm ngoài đường chéo biểu thị tương tác miền/chuỗi đáng tin cậy.',
      },
    },
    {
      id: 'ptm_iptm',
      term: 'pTM & ipTM',
      tag: '0.00 – 1.00',
      en: {
        plain: 'Overall fold quality (pTM) and interface quality between chains like protein + RNA (ipTM). Scores above 0.75 mean the complex docks reliably.',
        tech: 'Predicted Template Modeling score (pTM) estimates global topology; interface pTM (ipTM) weights inter-chain residue pairs to audit multi-entity assemblies.',
      },
      vi: {
        plain: 'Điểm đánh giá hình dạng tổng thể (pTM) và độ khớp tại bề mặt tiếp xúc giữa các chuỗi như Protein–RNA (ipTM). Trên 0.75 là cấu trúc phức hợp rất đáng tin.',
        tech: 'pTM ước lượng độ chính xác tô-pô toàn cục; ipTM đánh giá riêng cặp residue liên chuỗi để kiểm chứng phức hợp đa phân tử.',
      },
    },
    {
      id: 'mm',
      term: 'Michaelis–Menten (Vmax & Km)',
      tag: 'Enzyme Kinetics',
      en: {
        plain: 'Vmax is an enzyme’s top speed when flooded with substrate; Km is the substrate concentration needed to reach half that speed (lower Km = tighter binding).',
        tech: 'Hyperbolic initial-rate law v = Vmax·[S]/(Km + [S]). Km is an apparent half-saturation constant governed by binding and catalytic turnover.',
      },
      vi: {
        plain: 'Vmax là tốc độ tối đa khi enzyme bão hòa cơ chất; Km là nồng độ cơ chất để đạt 50% Vmax (Km càng nhỏ enzyme bám cơ chất càng chặt).',
        tech: 'Định luật tốc độ ban đầu v = Vmax·[S]/(Km + [S]). Km là hằng số bán bão hòa biểu kiến phụ thuộc cả ái lực gắn và bước xúc tác.',
      },
    },
    {
      id: 'qpolicy',
      term: 'Active-Learning Q-Policy',
      tag: 'RL · molML',
      en: {
        plain: 'Instead of testing every concentration blindly, the AI observes one low-dose rate and picks the single next dose most likely to identify the enzyme family.',
        tech: 'Tabular epsilon-greedy Q-learning over discretized anchor-rate bins selecting the second concentration maximizing Gaussian-decoder family accuracy.',
      },
      vi: {
        plain: 'Thay vì đo dàn trải mọi nồng độ, AI nhìn kết quả đo đầu tiên rồi chọn đúng 1 nồng độ kế tiếp giúp phân biệt họ enzyme chính xác nhất.',
        tech: 'Học tăng cường Q-learning trên các bin tốc độ neo để chọn liều đo thứ 2 tối đa hóa độ chính xác phân loại họ động học qua bộ giải mã Gaussian.',
      },
    },
    {
      id: 'ood',
      term: 'In-Domain vs OOD Extrapolation',
      tag: 'ML Audit',
      en: {
        plain: 'In-domain tests interpolate inside measured conditions; Out-of-Distribution (OOD) tests push into unseen extremes where naive models often fail.',
        tech: 'Evaluates generalization beyond the training distribution (e.g., endpoint concentrations or high-displacement anharmonic force regimes) to expose brittle fits.',
      },
      vi: {
        plain: 'Kiểm thử nội suy nằm trong vùng đã đo; Ngoại suy ngoài phân phối (OOD) thử thách mô hình ở vùng biên chưa từng thấy—nơi mô hình yếu dễ sụp đổ.',
        tech: 'Đánh giá khả năng tổng quát hóa ngoài miền huấn luyện (liều biên cực trị hoặc thế năng phi điều hòa) nhằm phát hiện rò rỉ hoặc quá khớp.',
      },
    },
    {
      id: 'stripes',
      term: 'Pocket Contacts & SMILES (molML)',
      tag: 'Cheminformatics',
      en: {
        plain: 'SMILES writes a molecule as compact text; interaction fingerprints track which H-bonds and hydrophobic contacts hold the substrate inside the enzyme pocket.',
        tech: 'Inspired by molML (molforge, STRIPES, ChemLint): pairs canonical 2D SMILES descriptors with 3D residue-ligand contact dynamics and leakage-free splits.',
      },
      vi: {
        plain: 'SMILES mã hóa cấu trúc phân tử thành chuỗi ký tự; dấu vân tay tương tác ghi lại các liên kết hydro và kỵ nước giữ cơ chất trong túi xúc tác enzyme.',
        tech: 'Lấy cảm hứng từ hệ sinh thái molML (molforge, STRIPES, ChemLint): kết hợp đặc trưng 2D SMILES với động lực học túi gắn 3D và kiểm định chia tập sạch.',
      },
    },
  ];

  const UI_I18N = {
    en: {
      atlas: '3D atlas',
      labs: 'Labs',
      workspace: 'Evidence workspace',
      resources: 'Resources',
      prefsBtn: 'Audience & A11y',
      glossaryBtn: 'Glossary & Keys',
      prefsTitle: 'Audience & Accessibility Settings',
      glossaryTitle: 'Scientific Glossary & 3D Keyboard Guide',
      searchGlossary: 'Search terms (e.g. pLDDT, PAE, Km, OOD)...',
      personaHeading: 'Choose your perspective',
      a11yHeading: 'Visual & Motor Accessibility',
      shortcutsHeading: '3D Viewport Keyboard Controls',
      tourNext: 'Next →',
      tourPrev: '← Back',
      tourDone: 'Finish tour',
      tourSkip: 'Close',
      copiedLink: 'Shareable link copied to clipboard!',
      personas: {
        explorer: ['Explorer', 'Plain-language analogies & guided visual discovery'],
        student: ['Student', 'Interactive checkpoints linking DNA, 3D folds & ML'],
        biologist: ['Biologist', 'Active-site pockets, pLDDT, ligands & .pdb/.cif upload'],
        researcher: ['Researcher', 'PAE/OOD diagnostics, calibration & JSON/CSV packets'],
      },
      toggles: {
        colorblind: ['Okabe–Ito Colorblind-Safe Palette', 'Applies perceptual colorblind-safe ramps across 3D, matrices, and SVG charts'],
        highContrast: ['High-Contrast Surfaces', 'Crisp black borders and maximum text contrast (WCAG AAA)'],
        reducedMotion: ['Reduced Motion', 'Disables auto-orbit spin and smooth camera transitions'],
        largeText: ['Readable / Dyslexia-Friendly Typography', 'Increases line spacing and base font size across labs'],
      },
    },
    vi: {
      atlas: 'Bản đồ 3D',
      labs: 'Phòng Lab',
      workspace: 'Kho bằng chứng',
      resources: 'Danh mục Lab',
      prefsBtn: 'Đối tượng & Tiếp cận',
      glossaryBtn: 'Thuật ngữ & Phím tắt',
      prefsTitle: 'Tùy chỉnh Đối tượng & Khả năng tiếp cận',
      glossaryTitle: 'Từ điển Khoa học & Phím tắt 3D',
      searchGlossary: 'Tìm thuật ngữ (ví dụ: pLDDT, PAE, Km, OOD)...',
      personaHeading: 'Chọn vai trò & chiều sâu nội dung',
      a11yHeading: 'Hỗ trợ Thị giác & Thao tác',
      shortcutsHeading: 'Điều khiển 3D bằng Bàn phím',
      tourNext: 'Tiếp →',
      tourPrev: '← Trước',
      tourDone: 'Hoàn tất',
      tourSkip: 'Đóng',
      copiedLink: 'Đã sao chép liên kết chia sẻ!',
      personas: {
        explorer: ['Khám phá', 'Giải thích trực quan, không cần nền tảng chuyên sâu'],
        student: ['Học sinh / SV', 'Bài tập liên kết DNA, cấu trúc 3D và mô hình ML'],
        biologist: ['Nhà sinh học', 'Túi gắn hoạt động, pLDDT, ligand & tải file .pdb/.cif'],
        researcher: ['Nhà nghiên cứu', 'Chẩn đoán PAE/OOD, hiệu chuẩn & xuất JSON/CSV chuẩn'],
      },
      toggles: {
        colorblind: ['Bảng màu thân thiện mù màu (Okabe–Ito)', 'Đồng bộ trên mô hình 3D, ma trận PAE và mọi biểu đồ SVG'],
        highContrast: ['Độ tương phản cao', 'Tăng viền đậm và độ tương phản chữ tối đa (WCAG AAA)'],
        reducedMotion: ['Giảm chuyển động', 'Tắt tự xoay 3D và hiệu ứng chuyển cảnh mượt'],
        largeText: ['Cỡ chữ lớn & dễ đọc', 'Tăng khoảng cách dòng và cỡ chữ toàn trang'],
      },
    },
  };

  function readPrefs() {
    const prefs = { ...DEFAULT_PREFS };
    try {
      const raw = globalThis.localStorage?.getItem(PREFS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.lang === 'en' || parsed.lang === 'vi') prefs.lang = parsed.lang;
          if (['explorer', 'student', 'biologist', 'researcher'].includes(parsed.audience)) {
            prefs.audience = parsed.audience;
          }
          prefs.colorblind = Boolean(parsed.colorblind);
          prefs.highContrast = Boolean(parsed.highContrast);
          prefs.reducedMotion = Boolean(parsed.reducedMotion);
          prefs.largeText = Boolean(parsed.largeText);
        }
      } else if (globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        prefs.reducedMotion = true;
      }
      const urlAud = new URLSearchParams(globalThis.location?.search || '').get('audience');
      if (['explorer', 'student', 'biologist', 'researcher'].includes(urlAud)) {
        prefs.audience = urlAud;
      }
      const urlLang = new URLSearchParams(globalThis.location?.search || '').get('lang');
      if (urlLang === 'en' || urlLang === 'vi') prefs.lang = urlLang;
    } catch {}
    return prefs;
  }

  let current = readPrefs();

  function applyDom(p = current) {
    if (typeof document === 'undefined' || !document.body) return;
    document.documentElement.lang = p.lang;
    document.body.classList.toggle('cb-mode', p.colorblind);
    document.body.classList.toggle('hc-mode', p.highContrast);
    document.body.classList.toggle('rm-mode', p.reducedMotion);
    document.body.classList.toggle('lg-text', p.largeText);
    document.body.dataset.audience = p.audience;
    document.body.dataset.lang = p.lang;
  }

  function save(partial) {
    current = { ...current, ...partial };
    try {
      globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(current));
    } catch {}
    applyDom(current);
    if (typeof globalThis.dispatchEvent === 'function' && typeof CustomEvent === 'function') {
      globalThis.dispatchEvent(new CustomEvent('studio-prefs-change', { detail: { ...current } }));
    }
    return { ...current };
  }

  function t() {
    return UI_I18N[current.lang] || UI_I18N.en;
  }

  function showToast(msg) {
    if (typeof document === 'undefined') return;
    let toast = document.getElementById('sp-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'sp-toast';
      toast.className = 'sp-toast';
      toast.setAttribute('role', 'status');
      toast.hidden = true;
      document.body.append(toast);
    }
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  function copyPermalink(extraParams = {}) {
    if (typeof location === 'undefined') return '';
    const url = new URL(location.href);
    url.searchParams.set('audience', current.audience);
    url.searchParams.set('lang', current.lang);
    for (const [k, v] of Object.entries(extraParams)) {
      if (v === null || v === undefined || v === '') url.searchParams.delete(k);
      else url.searchParams.set(k, String(v));
    }
    const str = url.toString();
    try {
      history.replaceState(null, '', url);
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(str);
    } catch {}
    showToast(t().copiedLink);
    return str;
  }

  function ensureModalRoot() {
    if (typeof document === 'undefined') return null;
    let back = document.getElementById('sp-modal-backdrop');
    if (!back) {
      back = document.createElement('div');
      back.id = 'sp-modal-backdrop';
      back.className = 'sp-popover-backdrop';
      back.hidden = true;
      back.innerHTML = '<div class="sp-modal" role="dialog" aria-modal="true" aria-labelledby="sp-modal-title"><div class="sp-modal-head"><h2 id="sp-modal-title"></h2><button type="button" class="sp-close-btn" id="sp-modal-close" aria-label="Close">✕</button></div><div id="sp-modal-body"></div></div>';
      document.body.append(back);
      back.onclick = e => { if (e.target === back) closeModal(); };
      back.querySelector('#sp-modal-close').onclick = closeModal;
      document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !back.hidden) closeModal();
      });
    }
    return back;
  }

  function closeModal() {
    const back = document.getElementById('sp-modal-backdrop');
    if (back) back.hidden = true;
  }

  function openPrefsModal() {
    const back = ensureModalRoot();
    if (!back) return;
    const tr = t();
    back.querySelector('#sp-modal-title').textContent = tr.prefsTitle;
    const body = back.querySelector('#sp-modal-body');

    const personaCards = Object.entries(tr.personas).map(([id, [label, desc]]) => {
      const pressed = current.audience === id;
      return `<button type="button" class="sp-persona-card" data-sp-persona="${id}" aria-pressed="${pressed}"><strong>${label}</strong><span>${desc}</span></button>`;
    }).join('');

    const toggleRows = Object.entries(tr.toggles).map(([key, [label, desc]]) => {
      const checked = Boolean(current[key]);
      return `<div class="sp-toggle-row"><div><strong>${label}</strong><small>${desc}</small></div><button type="button" class="sp-tool-btn" data-sp-toggle="${key}" aria-pressed="${checked}">${checked ? 'ON' : 'OFF'}</button></div>`;
    }).join('');

    body.innerHTML = `
      <p style="margin:0 0 8px;font-weight:700;font-size:13px">${tr.personaHeading}</p>
      <div class="sp-persona-grid">${personaCards}</div>
      <p style="margin:0 0 8px;font-weight:700;font-size:13px">${tr.a11yHeading}</p>
      <div class="sp-toggle-list">${toggleRows}</div>
    `;

    body.querySelectorAll('[data-sp-persona]').forEach(btn => {
      btn.onclick = () => {
        save({ audience: btn.dataset.spPersona });
        openPrefsModal();
      };
    });
    body.querySelectorAll('[data-sp-toggle]').forEach(btn => {
      btn.onclick = () => {
        const k = btn.dataset.spToggle;
        save({ [k]: !current[k] });
        openPrefsModal();
      };
    });
    back.hidden = false;
  }

  function openGlossaryModal(focusTermId) {
    const back = ensureModalRoot();
    if (!back) return;
    const tr = t();
    const lang = current.lang;
    const isTech = current.audience === 'researcher' || current.audience === 'biologist';
    back.querySelector('#sp-modal-title').textContent = tr.glossaryTitle;
    const body = back.querySelector('#sp-modal-body');

    body.innerHTML = `
      <input type="search" id="sp-glossary-q" class="sp-glossary-search" placeholder="${tr.searchGlossary}" value="${focusTermId || ''}">
      <div id="sp-glossary-items" class="sp-glossary-list"></div>
      <p style="margin:14px 0 6px;font-weight:700;font-size:13px">${tr.shortcutsHeading}</p>
      <div class="sp-shortcut-grid">
        <div class="sp-shortcut-item"><span>Orbit 3D molecule</span><kbd>← ↑ ↓ →</kbd></div>
        <div class="sp-shortcut-item"><span>Zoom in / out</span><kbd>+ / −</kbd></div>
        <div class="sp-shortcut-item"><span>Reset camera</span><kbd>R</kbd></div>
        <div class="sp-shortcut-item"><span>Toggle auto-spin</span><kbd>Space</kbd></div>
        <div class="sp-shortcut-item"><span>Open glossary &amp; keys</span><kbd>?</kbd></div>
        <div class="sp-shortcut-item"><span>Pick Residue B in 3D</span><kbd>Shift + Click</kbd></div>
      </div>
    `;

    const listEl = body.querySelector('#sp-glossary-items');
    const qInput = body.querySelector('#sp-glossary-q');
    const renderTerms = q => {
      const needle = (q || '').trim().toLowerCase();
      const matched = GLOSSARY.filter(g => {
        if (!needle) return true;
        const copy = g[lang] || g.en;
        return g.id.includes(needle) || g.term.toLowerCase().includes(needle) || copy.plain.toLowerCase().includes(needle) || copy.tech.toLowerCase().includes(needle);
      });
      listEl.innerHTML = matched.map(g => {
        const copy = g[lang] || g.en;
        return `<article class="sp-term-card"><header><strong>${g.term}</strong><code>${g.tag}</code></header><p>${isTech ? copy.tech : copy.plain}</p></article>`;
      }).join('') || '<p style="margin:0;color:var(--sp-muted)">No matching term found.</p>';
    };
    renderTerms(focusTermId || '');
    qInput.oninput = () => renderTerms(qInput.value);
    back.hidden = false;
  }

  let tourState = null;

  function endTour() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.sp-tour-highlight').forEach(el => el.classList.remove('sp-tour-highlight'));
    const box = document.getElementById('sp-tour-banner');
    if (box) box.hidden = true;
    tourState = null;
  }

  function renderTourStep() {
    if (!tourState || typeof document === 'undefined') return;
    document.querySelectorAll('.sp-tour-highlight').forEach(el => el.classList.remove('sp-tour-highlight'));
    const step = tourState.steps[tourState.idx];
    const target = step.selector ? document.querySelector(step.selector) : null;
    if (target) {
      target.classList.add('sp-tour-highlight');
      target.scrollIntoView({ behavior: current.reducedMotion ? 'auto' : 'smooth', block: 'center' });
    }
    let box = document.getElementById('sp-tour-banner');
    if (!box) {
      box = document.createElement('aside');
      box.id = 'sp-tour-banner';
      box.className = 'sp-tour-banner';
      box.setAttribute('aria-live', 'polite');
      document.body.append(box);
    }
    const tr = t();
    const isLast = tourState.idx >= tourState.steps.length - 1;
    box.innerHTML = `
      <p class="sp-tour-step">Step ${tourState.idx + 1} / ${tourState.steps.length}</p>
      <h3>${step.title}</h3>
      <p>${step.body}</p>
      <div class="sp-tour-actions">
        <button type="button" id="sp-tour-skip">${tr.tourSkip}</button>
        <div style="display:flex;gap:6px">
          ${tourState.idx > 0 ? `<button type="button" id="sp-tour-prev">${tr.tourPrev}</button>` : ''}
          <button type="button" id="sp-tour-next" class="primary">${isLast ? tr.tourDone : tr.tourNext}</button>
        </div>
      </div>
    `;
    box.hidden = false;
    box.querySelector('#sp-tour-skip').onclick = endTour;
    const prev = box.querySelector('#sp-tour-prev');
    if (prev) prev.onclick = () => { tourState.idx--; renderTourStep(); };
    box.querySelector('#sp-tour-next').onclick = () => {
      if (isLast) endTour();
      else { tourState.idx++; renderTourStep(); }
    };
  }

  function startTour(steps) {
    if (!Array.isArray(steps) || !steps.length) return;
    tourState = { steps, idx: 0 };
    renderTourStep();
  }

  function mountHeaderTools(container) {
    if (!container || typeof document === 'undefined') return;
    const tr = t();
    let wrap = container.querySelector('.sp-header-tools');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'sp-header-tools';
      container.append(wrap);
    }
    wrap.innerHTML = `
      <div class="sp-lang-pill" role="group" aria-label="Language">
        <button type="button" data-sp-lang="en" aria-pressed="${current.lang === 'en'}">EN</button>
        <button type="button" data-sp-lang="vi" aria-pressed="${current.lang === 'vi'}">VI</button>
      </div>
      <button type="button" class="sp-tool-btn" id="sp-open-prefs" title="Audience & Accessibility">${tr.prefsBtn}</button>
      <button type="button" class="sp-tool-btn" id="sp-open-glossary" title="Glossary & Keyboard Shortcuts (?)">?</button>
    `;
    wrap.querySelectorAll('[data-sp-lang]').forEach(btn => {
      btn.onclick = () => {
        save({ lang: btn.dataset.spLang });
        mountHeaderTools(container);
      };
    });
    wrap.querySelector('#sp-open-prefs').onclick = openPrefsModal;
    wrap.querySelector('#sp-open-glossary').onclick = () => openGlossaryModal('');
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => applyDom(current));
    } else {
      applyDom(current);
    }
    document.addEventListener('keydown', e => {
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (e.key === '?' && !['input', 'textarea', 'select'].includes(tag)) {
        e.preventDefault();
        openGlossaryModal('');
      }
    });
  }

  return {
    get: () => ({ ...current }),
    save,
    t,
    pick: (enText, viText) => (current.lang === 'vi' ? viText : enText),
    applyDom,
    mountHeaderTools,
    openPrefsModal,
    openGlossaryModal,
    startTour,
    endTour,
    copyPermalink,
    showToast,
    GLOSSARY,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StudioPrefs;
}
