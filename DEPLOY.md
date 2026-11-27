# Edit Anywhere, Deploy Everywhere

Assay Evidence Studio is a 100% static, vendor-independent web product. You can edit it from a phone, any browser, a local IDE, or an AI coding assistant, and deploy it automatically to GitHub Pages or any static hosting provider.

---

## 1. Visual editing from any browser (zero install)

1. Open **[Customize & deploy](https://tun539.github.io/assay-evidence-lab/customize.html)** on the live site.
2. Change the brand name, hero title/copy, theme color palette, or lab cards (add, reorder, edit, or link your own pages).
3. Click **Apply live browser preview** and inspect the home page to verify your edits immediately.
4. Click **Copy `studio-config.js`** → **Edit `studio-config.js` on GitHub ↗** → paste → commit to `main`.
5. GitHub Actions automatically verifies all Node.js and Python tests, rebuilds `assay-evidence-studio.zip`, and publishes your update live in ~40 seconds.

---

## 2. Quick text/code edits directly on GitHub (phone or desktop)

You can edit any file directly in your browser without cloning the repository:

- **Product branding, theme & lab cards:** [`studio/studio-config.js`](https://github.com/tun539/assay-evidence-lab/edit/main/studio/studio-config.js)
- **3D Atlas missions:** [`studio/atlas.js`](https://github.com/tun539/assay-evidence-lab/edit/main/studio/atlas.js)
- **Evidence Workspace:** [`studio/workspace.html`](https://github.com/tun539/assay-evidence-lab/edit/main/studio/workspace.html) · [`studio/workspace.js`](https://github.com/tun539/assay-evidence-lab/edit/main/studio/workspace.js)

Every commit to `main` triggers [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) and updates the live production site automatically.

---

## 3. Local development (VS Code, Cursor, Antigravity, CLI)

```sh
# Preview locally
python3 scripts/play_studio.py

# Run browser-module unit tests
node studio/test-fit.cjs
node studio/test-evidence-records.cjs
node studio/test-studio-config.cjs

# Build the complete production site + offline ZIP into dist/
python3 scripts/build_site.py --out dist

# Deploy by pushing to main
git push origin main
```

---

## 4. Deploy to your own host or custom domain

Because [`scripts/build_site.py`](scripts/build_site.py) produces a self-contained static `dist/` folder, you are never locked into any single platform:

| Host | Setup | Build command | Publish directory |
| --- | --- | --- | --- |
| **GitHub Pages (Active)** | Already enabled via [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) | `python3 scripts/build_site.py --out _site` | `_site` |
| **Vercel** | Preconfigured via [`vercel.json`](vercel.json) — import the repo in Vercel | `python3 scripts/build_site.py --out dist` | `dist` |
| **Netlify** | Preconfigured via [`netlify.toml`](netlify.toml) — connect the repo in Netlify | `python3 scripts/build_site.py --out dist` | `dist` |
| **Cloudflare Pages** | Connect the repo in Cloudflare Pages | `python3 scripts/build_site.py --out dist` | `dist` |
| **Any VPS / S3 / Nginx** | Run `python3 scripts/build_site.py --out dist` and upload `dist/` | `python3 scripts/build_site.py --out dist` | `dist` |

### Attach your own custom domain on GitHub Pages
1. Create a file named `CNAME` at the repository root containing your domain (e.g., `lab.yourdomain.com`).
2. Commit it to `main` — `scripts/build_site.py` automatically copies `CNAME` into the deployed build.
3. Point your DNS (`CNAME` record for a subdomain → `tun539.github.io`, or `A` records for an apex domain) and enable **Enforce HTTPS** in GitHub repo Settings → Pages.

### Verify which build is currently live
Every deployment publishes a lightweight `/build-info.json` manifest (e.g. `https://tun539.github.io/assay-evidence-lab/build-info.json`) containing the deployed git commit SHA, timestamp, and file count.
