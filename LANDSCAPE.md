# Related work and practical applications

Selected comparisons reviewed on 24 November 2026. GitHub star counts are rounded snapshots. Scientific relevance and adoption address different questions.

| Project or product | Publicly documented focus | Design decision for this repository |
|---|---|---|
| [DeepChem](https://github.com/deepchem/deepchem), about 7.2k stars | Scientific machine learning across chemistry and biology | Publish an executable benchmark with a defined split and an inspectable baseline. |
| [Chemprop](https://github.com/chemprop/chemprop), about 2.5k stars | Molecular property prediction with message passing | Examine the experimental evidence behind an apparent parameter before considering it a target for molecular prediction. |
| [RDKit](https://github.com/rdkit/rdkit) | Cheminformatics infrastructure | This dataset lacks molecular structures as inputs. The initial analysis uses rate and concentration directly. |
| [PyEnzyme](https://github.com/EnzymeML/PyEnzyme) and [EnzymeML](https://www.nature.com/articles/s41592-022-01763-1) | Exchange enzyme measurements, conditions, models and parameters | Keep units, conditions, observations and model outputs visible together. The CSV interface here is intentionally small. |
| [ICEKAT](https://doi.org/10.1186/s12859-020-3513-y) | Estimate initial rates from continuous traces and fit kinetic models | Start downstream from initial-rate extraction. This case study has published rates and no raw traces to reprocess. |
| [GraphPad Prism](https://www.graphpad.com/guides/prism/latest/curve-fitting/reg_michaelis_menten_enzyme.htm) | Fit initial rates with Michaelis–Menten kinetics | Compare specific shared-parameter hypotheses using unseen concentration levels. |
| [CDD Vault](https://www.collaborativedrug.com/download-curves-data-sheet) | Visualize, analyze and compare assay curves | An assay scientist can inspect the observations that drive a model choice. Dose-response potency and substrate half-saturation have distinct meanings. |
| [TetraScience](https://www.tetrascience.com/platform/data-engineering) | Prepare scientific data for downstream analytics and AI | Keep a traceable row-level output suitable for independent review. |
| [Ailurus Bio](https://ailurus.bio/) | Acquire experimental biological data at scale | A future evaluation could test agreement across independent runs supplied by a lab. This release uses one public reference experiment. |

## Practical pilot

An assay development team with matched conditions could supply a second set of initial-rate measurements, unit definitions and the preparation/run identifiers. The current CLI produces a four-model comparison for a single pair of runs. The next validation milestone is agreement on an independent preparation. Multiple preparations require run-aware splits and an extended schema before pooled interpretation. Product descriptions above document nearby workflows. They establish neither adoption of this project nor an integration.
