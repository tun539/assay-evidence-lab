'use strict';

const studioRuntime = (() => {
  const previewKey = 'assay-studio-config-preview-v1';
  const hexColor = /^#[0-9a-fA-F]{6}$/;

  const fallbackConfig = {
    brandName: 'Assay Evidence Studio',
    brandMark: '∿',
    heroTitlePrefix: 'Assay',
    heroTitleAccent: 'Evidence Studio',
    heroIntro: 'Fit enzyme data, audit model predictions and inspect protein structures. Follow each result back to its measurements, assumptions and sources.',
    repoUrl: 'https://github.com/tun539/assay-evidence-lab',
    theme: {
      primary: '#18493c',
      primaryHover: '#22624f',
      accent: '#337953',
      background: '#f5f7f2',
      surfaceTint: '#edf5ec',
    },
    workspaceBanner: {
      enabled: true,
      emptyText: 'Capture runs from any of the 10 quantitative labs, compare compatible results with side-by-side SVG bar charts, and export JSON, Markdown, or CSV packets.',
    },
    labs: [],
  };

  function defaults() {
    const base = globalThis.STUDIO_CONFIG || fallbackConfig;
    return JSON.parse(JSON.stringify(base));
  }

  function sanitizeHref(href) {
    if (typeof href !== 'string') return '';
    const trimmed = href.trim();
    if (!trimmed) return '';
    if (/^(javascript|data|vbscript):/i.test(trimmed)) return '';
    return trimmed.slice(0, 240);
  }

  function sanitize(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;
    const str = (v, fb, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : fb);

    base.brandName = str(raw.brandName, base.brandName, 80);
    base.brandMark = str(raw.brandMark, base.brandMark, 4);
    base.heroTitlePrefix = str(raw.heroTitlePrefix, base.heroTitlePrefix, 40);
    base.heroTitleAccent = str(raw.heroTitleAccent, base.heroTitleAccent, 60);
    base.heroIntro = str(raw.heroIntro, base.heroIntro, 400);
    if (typeof raw.repoUrl === 'string' && /^https?:\/\//.test(raw.repoUrl.trim())) {
      base.repoUrl = raw.repoUrl.trim().slice(0, 300);
    }

    if (raw.theme && typeof raw.theme === 'object') {
      for (const k of Object.keys(base.theme)) {
        if (typeof raw.theme[k] === 'string' && hexColor.test(raw.theme[k].trim())) {
          base.theme[k] = raw.theme[k].trim().toLowerCase();
        }
      }
    }

    if (raw.workspaceBanner && typeof raw.workspaceBanner === 'object') {
      base.workspaceBanner.enabled = raw.workspaceBanner.enabled !== false;
      base.workspaceBanner.emptyText = str(raw.workspaceBanner.emptyText, base.workspaceBanner.emptyText, 300);
    }

    if (Array.isArray(raw.labs) && raw.labs.length > 0 && raw.labs.length <= 30) {
      const validLabs = raw.labs
        .map((item, idx) => {
          if (!item || typeof item !== 'object') return null;
          const href = sanitizeHref(item.href);
          if (typeof item.title !== 'string' || !item.title.trim() || !href) return null;
          return {
            id: str(item.id, 'lab-' + (idx + 1), 40).replace(/[^\w-]/g, '') || ('lab-' + (idx + 1)),
            title: str(item.title, 'Lab', 80),
            href,
            description: typeof item.description === 'string' ? item.description.trim().slice(0, 240) : '',
            savesToWorkspace: Boolean(item.savesToWorkspace),
          };
        })
        .filter(Boolean);
      if (validLabs.length) base.labs = validLabs;
    }

    return base;
  }

  function hasPreview() {
    try {
      return Boolean(globalThis.localStorage?.getItem(previewKey));
    } catch {
      return false;
    }
  }

  function get() {
    try {
      const stored = globalThis.localStorage?.getItem(previewKey);
      if (stored) return sanitize(JSON.parse(stored));
    } catch {}
    return defaults();
  }

  function savePreview(candidate) {
    const clean = sanitize(candidate);
    globalThis.localStorage?.setItem(previewKey, JSON.stringify(clean));
    return clean;
  }

  function clearPreview() {
    globalThis.localStorage?.removeItem(previewKey);
    return defaults();
  }

  function applyTheme(cfg = get(), root = globalThis.document?.documentElement) {
    if (!root?.style || !cfg?.theme) return;
    root.style.setProperty('--studio-primary', cfg.theme.primary);
    root.style.setProperty('--studio-primary-hover', cfg.theme.primaryHover);
    root.style.setProperty('--studio-accent', cfg.theme.accent);
    root.style.setProperty('--studio-bg', cfg.theme.background);
    root.style.setProperty('--studio-surface-tint', cfg.theme.surfaceTint);
  }

  function serialize(candidate) {
    const clean = sanitize(candidate);
    return [
      "'use strict';",
      '',
      '/**',
      ' * Assay Evidence Studio — Editable Product Configuration',
      ' *',
      ' * Edit this file from anywhere (GitHub web editor, phone, VS Code, or CLI)',
      ' * and commit to `main` to deploy automatically.',
      ' *',
      ' * Prefer a visual editor? Open `customize.html` in the live app, preview',
      ' * your edits in real time, then copy/paste the generated file here.',
      ' */',
      `globalThis.STUDIO_CONFIG = ${JSON.stringify(clean, null, 2)};`,
      '',
      "if (typeof module !== 'undefined' && module.exports) {",
      '  module.exports = globalThis.STUDIO_CONFIG;',
      '}',
      '',
    ].join('\n');
  }

  function githubEditUrl(cfg = get(), filePath = 'studio/studio-config.js') {
    const base = (cfg.repoUrl || fallbackConfig.repoUrl).replace(/\/+$/, '');
    return `${base}/edit/main/${filePath}`;
  }

  return {
    defaults,
    sanitize,
    get,
    hasPreview,
    savePreview,
    clearPreview,
    applyTheme,
    serialize,
    githubEditUrl,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = studioRuntime;
}
