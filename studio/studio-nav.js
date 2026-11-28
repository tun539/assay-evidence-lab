'use strict';

(() => {
  const STORAGE_KEY = 'assay-evidence-records-v1';
  const REPO_URL = 'https://github.com/tun539/assay-evidence-lab';

  function getSavedCount() {
    try {
      if (typeof evidenceRecords !== 'undefined' && typeof evidenceRecords.count === 'function') {
        return evidenceRecords.count();
      }
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.length : 0;
    } catch {
      return 0;
    }
  }

  function currentPageName() {
    const file = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    return file || 'index.html';
  }

  function createLink(href, text, options = {}) {
    const a = document.createElement('a');
    a.href = href;
    if (options.className) a.className = options.className;
    if (options.current) a.setAttribute('aria-current', 'page');
    if (options.external) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
    a.append(text);
    return a;
  }

  function buildHeader(header) {
    const page = (header.dataset.page || currentPageName()).toLowerCase();
    const labsHref = page === 'index.html' ? '#labs-title' : 'index.html#labs-title';

    header.replaceChildren();

    const brand = document.createElement('a');
    brand.className = 'studio-brand';
    brand.href = 'index.html';
    if (page === 'index.html') brand.setAttribute('aria-current', 'page');
    const mark = document.createElement('span');
    mark.className = 'studio-brand-mark';
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = '∿';
    const name = document.createElement('span');
    name.textContent = 'Assay Evidence Studio';
    brand.append(mark, name);

    const nav = document.createElement('nav');
    nav.className = 'site-nav';
    nav.setAttribute('aria-label', 'Main navigation');
    nav.append(
      createLink('atlas.html', '3D atlas', { current: page === 'atlas.html' }),
      createLink(labsHref, 'Labs'),
    );

    const workspaceLink = createLink('workspace.html', 'Evidence workspace', {
      className: 'workspace-link',
      current: page === 'workspace.html',
    });
    const badge = document.createElement('span');
    badge.className = 'workspace-badge';
    badge.dataset.evidenceCount = '';
    badge.hidden = true;
    badge.setAttribute('aria-label', 'saved evidence records');
    workspaceLink.append(badge);
    nav.append(workspaceLink);

    const menu = document.createElement('details');
    menu.className = 'studio-menu';
    const summary = document.createElement('summary');
    summary.textContent = 'Resources';
    const panel = document.createElement('nav');
    panel.className = 'studio-menu-panel';
    panel.setAttribute('aria-label', 'Resources');

    const resources = [
      ['structure.html', '3D molecular studio (18 models)'],
      ['dna.html', '3D gene & DNA lab (10 genes)'],
      ['kinetics.html', 'Kinetics & OOD workbench (6 models)'],
      ['simulation.html', 'Simulation & ML force-field lab'],
      ['molecular.html', 'Molecular learning lab'],
      ['linked.html', 'Linked protein explorer'],
      ['customize.html', 'Customize & deploy', true],
      ['methods.html', 'Methods and sources'],
      [REPO_URL, 'GitHub repository', false, true],
    ];
    for (const [href, label, divider, external] of resources) {
      panel.append(createLink(href, label, {
        className: divider ? 'menu-divider' : '',
        current: !external && page === href,
        external,
      }));
    }
    menu.append(summary, panel);
    header.append(brand, nav, menu);

    document.addEventListener('click', event => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        summary.focus();
      }
    });

    const contextLinks = [];
    if (header.dataset.mission) {
      contextLinks.push(['atlas.html#' + header.dataset.mission, '← Research mission']);
    }
    if (header.dataset.methods) {
      contextLinks.push(['methods.html#' + header.dataset.methods, 'Methods & sources']);
    }
    if (header.dataset.relatedHref && header.dataset.relatedLabel) {
      contextLinks.push([header.dataset.relatedHref, header.dataset.relatedLabel]);
    }
    if (contextLinks.length && !document.querySelector('.studio-context-bar')) {
      const bar = document.createElement('nav');
      bar.className = 'studio-context-bar';
      bar.setAttribute('aria-label', 'Lab context');
      contextLinks.forEach(([href, label]) => {
        const isExternal = href.startsWith('http://') || href.startsWith('https://');
        bar.append(createLink(href, label, { external: isExternal }));
      });
      header.insertAdjacentElement('afterend', bar);
    }
  }

  function syncBadges() {
    const count = getSavedCount();
    document.querySelectorAll('[data-evidence-count]').forEach(badge => {
      badge.textContent = String(count);
      badge.hidden = count === 0;
      badge.title = count + (count === 1 ? ' saved evidence record' : ' saved evidence records');
    });
  }

  function init() {
    const header = document.querySelector('header.studio-header');
    if (header) buildHeader(header);
    syncBadges();
  }

  window.addEventListener('assay-evidence-change', syncBadges);
  window.addEventListener('storage', event => {
    if (!event.key || event.key === STORAGE_KEY) syncBadges();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
