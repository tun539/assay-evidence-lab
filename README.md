# Assay Evidence Studio

![Assay Evidence Studio · Biology, machine learning, and interactive experiments](docs/assets/assay-evidence-banner.svg)

**A playable biology lab for exploring molecular structures, comparing models, and tracing predictions back to evidence.** Orbit the 3D atlas, run an experiment, and test your reasoning at one of nine research stations.

[![Open Assay Evidence Studio](https://img.shields.io/badge/OPEN-LIVE%20STUDIO-17483c?style=for-the-badge)](https://tun539.github.io/assay-evidence-lab/)
[![Play the 3D atlas](https://img.shields.io/badge/PLAY-3D%20ATLAS-176953?style=for-the-badge)](https://tun539.github.io/assay-evidence-lab/atlas.html)
[![Download the offline app](https://img.shields.io/badge/DOWNLOAD-OFFLINE%20APP-b86c2f?style=for-the-badge)](https://tun539.github.io/assay-evidence-lab/assay-evidence-studio.zip)
[![Download full source](https://img.shields.io/badge/GET-FULL%20SOURCE-334c56?style=for-the-badge)](https://github.com/tun539/assay-evidence-lab/archive/refs/heads/main.zip)

[Evidence workspace](https://tun539.github.io/assay-evidence-lab/workspace.html) · [Customize & deploy](https://tun539.github.io/assay-evidence-lab/customize.html) · [Deploy anywhere guide](DEPLOY.md) · [Local play guide](PLAY.md) · [Methods and data sources](https://tun539.github.io/assay-evidence-lab/methods.html) · [MIT license](LICENSE)

## Tools used

[![Python](https://img.shields.io/badge/Python-356da0?style=flat-square&logo=python&logoColor=white)](ml/molecular.py)
[![Pandas](https://img.shields.io/badge/Pandas-59417d?style=flat-square&logo=pandas&logoColor=white)](ml/MultilingualTraining.ipynb)
[![NumPy](https://img.shields.io/badge/NumPy-386280?style=flat-square&logo=numpy&logoColor=white)](ml/molecular.py)
[![SciPy](https://img.shields.io/badge/SciPy-32658b?style=flat-square&logo=scipy&logoColor=white)](kinetics/model.py)
[![scikit-learn](https://img.shields.io/badge/scikit--learn-965529?style=flat-square&logo=scikitlearn&logoColor=white)](research/benchmark.py)
[![PyTorch](https://img.shields.io/badge/PyTorch-b04437?style=flat-square&logo=pytorch&logoColor=white)](ml/MolecularLearning.ipynb)
[![TensorFlow](https://img.shields.io/badge/TensorFlow-9b510e?style=flat-square&logo=tensorflow&logoColor=white)](ml/MultilingualTraining.ipynb)
[![Jupyter](https://img.shields.io/badge/Jupyter-9b510e?style=flat-square&logo=jupyter&logoColor=white)](ml/MolecularLearning.ipynb)
[![JavaScript + Canvas](https://img.shields.io/badge/JavaScript%20%2B%20Canvas-266454?style=flat-square&logo=javascript&logoColor=white)](studio/molecular-scene.js)
[![Cellpose](https://img.shields.io/badge/Cellpose-32658b?style=flat-square)](evidence/README.md)
[![AlphaFold DB](https://img.shields.io/badge/AlphaFold%20DB-266454?style=flat-square)](studio/folds)
[![Lovable](https://img.shields.io/badge/Lovable-6c4380?style=flat-square)](https://lovable.dev/projects/a7c9db51-fe59-46af-bd6a-52c1b9d893ce)

| Area | What the tools do here |
| --- | --- |
| Scientific computing | **NumPy** generates synthetic assays and computes metrics. **Pandas** prepares training data in the notebooks. **SciPy** fits Michaelis–Menten curves. |
| Model training | **scikit-learn** supplies classical baselines. **PyTorch** trains the molecular estimator. **TensorFlow**, PyTorch, and NumPy implement the same bilingual classifier in the companion notebook. The assay simulator implements tabular Q-learning for selecting a second measurement. |
| Structure and prediction audits | The **Cellpose** metric routines score segmentation overlap. **AlphaFold DB** supplies predicted structures for the 3D explorer. The audit also includes upstream routines for residue confidence. |
| App and design | **HTML, CSS, JavaScript, and Canvas** power the offline labs and 3D playback. **Lovable** was used for a separate mission-control UI prototype. |

## Evidence workspace

[Open the workspace](https://tun539.github.io/assay-evidence-lab/workspace.html). Capture runs from all ten quantitative labs — Kinetics workbench, Molecular learning lab, Enzyme practical, Research benchmark, Gene expression atlas, Protein 3D structure viewer, Tomography, Molecular transport in 3D, Simulation lab, and Prediction audit. Filter by evidence type or dataset, search and sort saved runs, jump straight to matching peers with **Compare with match**, inspect side-by-side SVG bar charts and parameter diffs (with **Swap A ↔ B**), persist review notes in the browser, and export JSON packets, Markdown reports (download or copy to clipboard), or CSV summary tables. Run `node studio/test-evidence-records.cjs` to verify record validation, comparison, and export logic.

## Explore the studio

| Research area | Open a lab | What to try |
| --- | --- | --- |
| Molecular structure | [Protein 3D](https://tun539.github.io/assay-evidence-lab/structure.html) · [Linked residue explorer](https://tun539.github.io/assay-evidence-lab/linked.html) | Rotate a chain and measure a Cα distance from the contact map. |
| Imaging and transport | [Tomography](https://tun539.github.io/assay-evidence-lab/tomography.html) · [Transport in 3D](https://tun539.github.io/assay-evidence-lab/transport.html) | Reconstruct a protein-derived slice or compare moving tracers with theory. |
| Enzyme kinetics | [Kinetics workbench](https://tun539.github.io/assay-evidence-lab/kinetics.html) · [Molecular Learning Lab](https://tun539.github.io/assay-evidence-lab/molecular.html) | Hold out a concentration in the measured assay, then test a learned measurement policy on simulated assays. |
| Genomics | [Expression atlas](https://tun539.github.io/assay-evidence-lab/expression.html) · [DNA strand lab](https://tun539.github.io/assay-evidence-lab/dna.html) | Compare microarray cohorts, inspect complementary strands, or assemble two reads. |
| Model evaluation | [Prediction audit](https://tun539.github.io/assay-evidence-lab/audit.html) · [Research benchmark](https://tun539.github.io/assay-evidence-lab/research.html) · [Simulation lab](https://tun539.github.io/assay-evidence-lab/simulation.html) | Inspect object matches, change decision thresholds, or test a learned force law outside its training interval. |

## Edit anywhere, deploy everywhere

1. **Visual browser customizer (zero install):** Open [Customize & deploy](https://tun539.github.io/assay-evidence-lab/customize.html) to edit branding, theme colors, and lab cards visually, preview live in your browser, then copy the generated [`studio/studio-config.js`](studio/studio-config.js) straight into GitHub's web editor.
2. **Edit directly from phone or browser:** Edit [`studio/studio-config.js`](https://github.com/tun539/assay-evidence-lab/edit/main/studio/studio-config.js), `studio/atlas.js`, or any lab page on GitHub and commit to `main`—GitHub Actions runs all tests and deploys automatically in ~40 seconds.
3. **Run locally or deploy to your own host:** Run `python3 scripts/play_studio.py` locally, or build a portable `dist/` folder with `python3 scripts/build_site.py --out dist`. Ready-made configs are included for **GitHub Pages**, **Vercel** (`vercel.json`), **Netlify** (`netlify.toml`), and **Cloudflare Pages**—see [DEPLOY.md](DEPLOY.md) for custom domain (`CNAME`) and multi-host instructions.
4. **Offline app:** [Download and extract the offline app](https://tun539.github.io/assay-evidence-lab/assay-evidence-studio.zip) and open `studio/atlas.html` in any browser. See [PLAY.md](PLAY.md) for platform notes.

## Featured experiment

**Does a treatment change the plateau of an enzyme response, its half-saturation concentration, or both?** Explore 23 measured rates from a galactosyltransferase assay and compare four explanations using concentration-level holdouts.

![Measured galactosyltransferase reaction rates in two conditions and prediction error for four kinetic models](kinetics/comparison.png)

[Open the enzyme practical](https://tun539.github.io/assay-evidence-lab/practical.html) · [Inspect measured rates](kinetics/puromycin.csv) · [Review held-out predictions](kinetics/predictions.csv)

## DNA sequence and strand practical

Open `studio/dna.html` online or offline. Five linked reference records supply 60-base coding excerpts. Slide a 12-base window, rotate an idealized duplex, export FASTA and practice antiparallel pairing or assembly of two simulated reads.

## Folded gene products

Open [the protein structure lab](https://tun539.github.io/assay-evidence-lab/structure.html?protein=P00846) and select a gene product or the experimental ubiquitin reference. Each predicted trace includes one alpha carbon per residue. Rotate the trace, select contacts and export a distance or the coordinates. The DNA lab links directly to the selected product. All five traces are bundled for offline use.

Coordinates are derived from [AlphaFold Protein Structure Database](https://alphafold.ebi.ac.uk/) predictions under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Each export records the versioned source PDB URL. Run `python scripts/refresh_gene_models.py` to extract fresh chain-A traces. Distances in predicted monomers describe model geometry.

## Structural biology in 3D

Open `studio/structure.html` locally to inspect the 76-residue alpha-carbon trace of [ubiquitin (PDB 1UBQ)](https://www.rcsb.org/structure/1UBQ). Rotate the structure, select a pair on the contact map and export its measured distance for peer review. The viewer works offline.

## Simulation lab

[Two interactive experiments](studio/simulation.html) cover force-law learning and ensemble sampling. Change model assumptions, inspect trajectories and export reproducible plots as CSV or a team review as JSON. The [teaching guide](SIMULATIONS.md) includes role-based exercises and an independent MACE-metric checker.

## Classroom and research practical

[Download the classroom files](https://github.com/tun539/assay-evidence-lab/archive/refs/heads/main.zip), extract the ZIP and open `studio/practical.html`. Choose the undergraduate or graduate track, fit the published example or a local CSV, inspect held-concentration errors, and export your lab record and predictions. The [instructor guide](TEACHING.md) includes learning goals, submission requirements, a reference result and marking criteria. Run `node studio/test-fit.cjs` to check the browser fits against the SciPy benchmark.

## Cellpose and AlphaFold integration

The [prediction audit](studio/audit.html) uses numerical routines vendored from the two upstream repositories. Score your own label maps or model confidence logits with the [offline evaluator](evidence/README.md), then inspect its JSON in the studio. Teaching fixtures are synthetic. Original source credits and licenses accompany both modules.

## Interactive studio

Open the [studio folder](studio), download the repository and open `studio/index.html` in any modern browser. The app runs offline. Switch between an evidence diagram and quantitative figures for four kinetic hypotheses and four classifier configurations. Try “compare enzyme plateaus” or “show cytology errors”, then export the current canvas as SVG. The search matches supported topics locally. Model training and fitting run in Python.

Rebuild the embedded data with `python studio/build.py` after regenerating either benchmark. See the [contributor guide](CONTRIBUTING.md) for scientific review criteria. The MIT license applies to the original software. Third-party datasets retain their upstream terms and attribution.

## What the assay supports

Holding out one substrate concentration at a time, a model with separate apparent maximum rates reduced pooled prediction error from **19.33 to 11.92 counts/min/min**. Giving each condition its own half-saturation parameter as well reduced the error to **11.62**. We retain the three-parameter model as a descriptive reference. It captures most of the improvement with one additional parameter. The fourth parameter remains plausible.

| Parameters allowed to differ | Held-concentration RMSE | Interpretation |
|---|---:|---|
| Neither | 19.33 | A common saturation curve misses the separation at high concentration. |
| Apparent maximum rate | 11.92 | Fitted plateaus are 166.60 untreated and 208.63 treated, with shared half-saturation at 0.0580 ppm. |
| Apparent half-saturation | 16.50 | A horizontal shift alone describes the high-concentration observations less well. |
| Both | 11.62 | Lowest pooled error in this comparison. The gain over separate plateaus is 0.30 counts/min/min. |

### What would change the decision?

Each condition comes from a single experiment. Treatment and run therefore vary together. Independent preparations per condition would allow a test of whether the apparent plateau difference persists across runs. Concentrations around the apparent half-saturation region would help resolve the smaller difference between the two leading models. The observations contain neither an equilibrium binding measurement nor an active enzyme concentration. Inferring a dissociation constant or molecular turnover number would require additional evidence.

## Reproduce or use your own assay

Tested with Python 3.12. From the repository root in an activated virtual environment:

```sh
python -m pip install -r requirements.txt
python kinetics/model.py
python kinetics/figure.py
python -m unittest discover -s kinetics
python NucleusAudit/train.py
python NucleusAudit/verify.py
```

To review a second assay, use the example CSV schema with columns `conc,rate,state`. Provide positive finite substrate concentrations and initial rates, both states labeled `treated` and `untreated`, and at least three common concentration levels. Keep units consistent and record them with the input. The figure script is specific to the published example.

```sh
python kinetics/model.py --csv my_assay.csv --out my_results
```

The fit uses positive parameters, equal observation weights and nonlinear least squares on the original rate scale. Each of six folds omits **all** observations at one concentration in both conditions. Endpoint folds evaluate limited extrapolation. Interior folds evaluate interpolation. Model selection and reporting use the same folds, so the comparison is exploratory. File-level predictions allow independent recalculation of the pooled RMSE. Parameter order in the export is untreated Vmax and Km, then the treated Vmax and/or Km when allowed to differ. Fold errors follow increasing concentration.

[Input measurements](kinetics/puromycin.csv) · [Fitted parameters and fold errors](kinetics/fits.json) · [Held-out predictions](kinetics/predictions.csv) · [Related work and applications](LANDSCAPE.md)

## Research benchmark · model comparison and probability error

[Open the interactive benchmark](https://tun539.github.io/assay-evidence-lab/research.html) to compare logistic regression, k-nearest neighbors, RBF SVM and random forest on shared outer folds. Explore reliability, threshold behavior and paired Brier differences. The [research report](research/README.md) includes commands to reproduce and independently verify the results.

## Second case study · NucleusAudit

A separate supervised learning benchmark tests how removing direct nuclear-size descriptors affects prediction on 114 held-out cytology specimens. The 30-feature classifier reached ROC-AUC 0.9901 and missed two positive specimens. Exported weights can be replayed independently. [Read the model report and error analysis](NucleusAudit/README.md).

## Data and contribution record

The enzyme measurements originate from M. A. Treloar's 1974 thesis on galactosyltransferase in Golgi membranes, included in R's Puromycin dataset and distributed as CSV by Rdatasets. Source units are ppm and counts/min/min. Row numbers preserve the source order. [R dataset documentation](https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/Puromycin.html) · [CSV source](https://github.com/vincentarelbundock/Rdatasets/blob/master/csv/datasets/Puromycin.csv)

The reference implementation and interpretation were prepared with AI assistance. To add a personal technical contribution, record a prediction before reanalysis, implement one sensitivity check, commit the resulting fold-level table, and explain whether the change alters the decision. One concrete question is whether averaging squared errors equally across concentrations changes the model ranking when the final concentration has fewer observations.

## Gene expression atlas

[Open the atlas](https://tun539.github.io/assay-evidence-lab/expression.html). Search 7,129 microarray probe sets, compare cohort means, export the training-selected panel and inspect specimen-level predictions. To reproduce, download `actual.csv`, `data_set_ALL_AML_train.csv` and `data_set_ALL_AML_independent.csv` from the [data mirror](https://github.com/varshith-alladi/Leukemia-Cancer-Classification), install the root requirements, then run `python research/expression.py /path/to/csv-directory`. Hyperparameters and the 25-probe panel size are fixed. The small historical test cohort limits precision and transportability.
