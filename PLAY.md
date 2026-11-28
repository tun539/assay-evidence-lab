# Play and modify Assay Evidence Studio

## Start the Biology missions

1. Extract the complete ZIP to a folder. Keep the files and folders together.
2. Open `studio/atlas.html` in a desktop browser.
3. Orbit the map with the mouse or arrow keys. Select a station, run its experiment, and return to answer its evidence checkpoint.

The labs use bundled assets and run in the browser. The original references and GitHub links open online. For browser features tied to an HTTP origin, or to keep checkpoint progress on a stable localhost address, run `python scripts/play_studio.py` from the extracted folder. On Windows, use `py scripts/play_studio.py` if Python is installed under the `py` launcher. No packages are needed for this launcher.

## Make it yours

| File | What to change |
| --- | --- |
| `studio/atlas.js` | Mission tasks, station labels, checkpoint questions and evidence feedback |
| `studio/atlas.css` | Atlas palette, layout, controls and mobile styles |
| `studio/studio-nav.js`, `studio/studio-nav.css`, `studio/favicon.svg` | Unified responsive Studio header, Resources dropdown, contextual links, live Evidence Workspace badge, and favicon |
| `studio/index.html` | Studio landing page, Cosmos-curated 3D specimen gallery, audience pathways, and 13-lab grid |
| `studio/structure.html`, `studio/structure.css`, `studio/structure.js`, `studio/mol3d-engine.js` | AlphaFold-style 18-model 3D Molecular Studio, Catmull–Rom cartoon ribbon renderer, PAE matrix, local `.pdb` parser, and accessibility modes |
| `studio/dna.html`, `studio/gene-model.js`, `studio/folds/*.js` | 10-gene 3D DNA double-helix lab, codon-to-protein translation bridge, and bundled AlphaFold DB v6 gene folds |
| `studio/kinetics.html`, `studio/kinetics.css`, `studio/kinetics-analytics.js`, `studio/kinetics-workbench.js` | 6-model Enzyme Kinetics & OOD Benchmark Workbench (including Cooperative Hill & Haldane Substrate Inhibition), 9 diagnostic graph views, 2D SSE confidence contours, and Fisher active-learning curves |
| `studio/molecular.html`, `studio/molecular-scene.js` | Enzyme simulator controls and rendering |
| `ml/MolecularLearning.ipynb` | Reproduce the CPU training and compare supervised and RL approaches |

After editing a page, reload the browser. Checkpoint progress and Evidence Workspace records are stored locally per browser and site address. Browser restrictions can affect progress when opening files directly. Run `node studio/test-fit.cjs`, `node studio/test-evidence-records.cjs`, `node studio/test-studio-config.cjs`, and `node studio/test-studio-pages.cjs` from the repository root to verify solver parity, workspace logic, customizer config, and all 18 Studio HTML pages.

For training, create a Python environment and install `ml/requirements.txt` plus SciPy. Open notebooks from the `ml` directory. Running `python ml/molecular.py` from the project folder regenerates the molecular benchmark data consumed by the UI. The complete GitHub project also includes the primary assay fits, research scripts, tests, and teaching guides. See the in-app methods page for dataset and model provenance.

[Complete project on GitHub](https://github.com/tun539/assay-evidence-lab)

To rebuild the downloadable package from the complete source, run `python scripts/package_studio.py assay-evidence-studio.zip` from the repository root.
