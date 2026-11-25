# Assay Evidence Studio

![Assay Evidence Studio · Biology, machine learning, and interactive experiments](docs/assets/assay-evidence-banner.svg)

**A playable biology lab for exploring molecular structures, comparing models, and tracing predictions back to evidence.** Orbit the 3D atlas, run an experiment, and test your reasoning at one of nine research stations.

[![Play the 3D atlas](https://img.shields.io/badge/PLAY-3D%20ATLAS-176953?style=for-the-badge)](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/atlas)
[![Download the offline app](https://img.shields.io/badge/DOWNLOAD-OFFLINE%20APP-b86c2f?style=for-the-badge)](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/assay-evidence-studio.zip)
[![Download full source](https://img.shields.io/badge/GET-FULL%20SOURCE-334c56?style=for-the-badge)](https://github.com/tun539/assay-evidence-lab/archive/refs/heads/main.zip)

[Local play and editing guide](PLAY.md) · [Methods and data sources](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/methods) · [Contributing](CONTRIBUTING.md) · [MIT license](LICENSE)

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

[Open the workspace](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/workspace). Save a measured kinetics fold or a simulated molecular assay, compare compatible records, and export a JSON packet for independent review. Records are stored in the current browser.

## Explore the studio

| Research area | Open a lab | What to try |
| --- | --- | --- |
| Molecular structure | [Protein 3D](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/structure) · [Linked residue explorer](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/linked) | Rotate a chain and measure a Cα distance from the contact map. |
| Imaging and transport | [Tomography](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/tomography) · [Transport in 3D](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/transport) | Reconstruct a protein-derived slice or compare moving tracers with theory. |
| Enzyme kinetics | [Kinetics workbench](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/kinetics) · [Molecular Learning Lab](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/molecular) | Hold out a concentration in the measured assay, then test a learned measurement policy on simulated assays. |
| Genomics | [Expression atlas](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/expression) · [DNA strand lab](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/dna) | Compare microarray cohorts, inspect complementary strands, or assemble two reads. |
| Model evaluation | [Prediction audit](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/audit) · [Research benchmark](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/research) · [Simulation lab](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/simulation) | Inspect object matches, change decision thresholds, or test a learned force law outside its training interval. |

## Play, edit, and remix

1. [Download and extract the offline app](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/assay-evidence-studio.zip). Open `studio/atlas.html` in a browser to start the missions.
2. Edit `studio/atlas.js` to change missions, `studio/atlas.css` to style the map, or individual pages in `studio/` to customize a lab.
3. For a local HTTP server, run `python scripts/play_studio.py`. See [PLAY.md](PLAY.md) for platform notes and packaging instructions.

Fork the repository to share your own version. Start with the [executed molecular training notebook](ml/MolecularLearning.ipynb) to reproduce the random forest, neural network, and RL comparison.

## Featured experiment

**Does a treatment change the plateau of an enzyme response, its half-saturation concentration, or both?** Explore 23 measured rates from a galactosyltransferase assay and compare four explanations using concentration-level holdouts.

![Measured galactosyltransferase reaction rates in two conditions and prediction error for four kinetic models](kinetics/comparison.png)

[Open the enzyme practical](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/practical) · [Inspect measured rates](kinetics/puromycin.csv) · [Review held-out predictions](kinetics/predictions.csv)

## DNA sequence and strand practical

Open `studio/dna.html` online or offline. Five linked reference records supply 60-base coding excerpts. Slide a 12-base window, rotate an idealized duplex, export FASTA and practice antiparallel pairing or assembly of two simulated reads.

## Folded gene products

Open [the protein structure lab](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/structure.html?protein=P00846) and select a gene product or the experimental ubiquitin reference. Each predicted trace includes one alpha carbon per residue. Rotate the trace, select contacts and export a distance or the coordinates. The DNA lab links directly to the selected product. All five traces are bundled for offline use.

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

[Open the interactive benchmark](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/research) to compare logistic regression, k-nearest neighbors, RBF SVM and random forest on shared outer folds. Explore reliability, threshold behavior and paired Brier differences. The [research report](research/README.md) includes commands to reproduce and independently verify the results.

## Second case study · NucleusAudit

A separate supervised learning benchmark tests how removing direct nuclear-size descriptors affects prediction on 114 held-out cytology specimens. The 30-feature classifier reached ROC-AUC 0.9901 and missed two positive specimens. Exported weights can be replayed independently. [Read the model report and error analysis](NucleusAudit/README.md).

## Data and contribution record

The enzyme measurements originate from M. A. Treloar's 1974 thesis on galactosyltransferase in Golgi membranes, included in R's Puromycin dataset and distributed as CSV by Rdatasets. Source units are ppm and counts/min/min. Row numbers preserve the source order. [R dataset documentation](https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/Puromycin.html) · [CSV source](https://github.com/vincentarelbundock/Rdatasets/blob/master/csv/datasets/Puromycin.csv)

The reference implementation and interpretation were prepared with AI assistance. To add a personal technical contribution, record a prediction before reanalysis, implement one sensitivity check, commit the resulting fold-level table, and explain whether the change alters the decision. One concrete question is whether averaging squared errors equally across concentrations changes the model ranking when the final concentration has fewer observations.

## Gene expression atlas

[Open the atlas](https://assay-evidence.kh-ng-gian-l-5063.chatgpt.site/expression). Search 7,129 microarray probe sets, compare cohort means, export the training-selected panel and inspect specimen-level predictions. To reproduce, download `actual.csv`, `data_set_ALL_AML_train.csv` and `data_set_ALL_AML_independent.csv` from the [data mirror](https://github.com/varshith-alladi/Leukemia-Cancer-Classification), install the root requirements, then run `python research/expression.py /path/to/csv-directory`. Hyperparameters and the 25-probe panel size are fixed. The small historical test cohort limits precision and transportability.
