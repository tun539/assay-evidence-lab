# Measuring agreement and confidence

This module combines two upstream numerical implementations with an original offline evaluation workflow. It scores existing predictions. Model inference, images and weights are separate inputs. The teaching fixture is synthetic and distinct from the 569-specimen NucleusAudit dataset.

| Source component | Included implementation | Our integration |
|---|---|---|
| [Cellpose metrics at a54cb48](https://github.com/MouseLand/cellpose/blob/a54cb48849b7e225a81e8e43dcb042d42427f543/cellpose/metrics.py) | Sparse label overlap, pairwise intersection over union and thresholded one-to-one object matching | Normalize sparse object IDs, handle empty annotations, evaluate three thresholds and export the matching counts. |
| [AlphaFold confidence at c77e5d2](https://github.com/google-deepmind/alphafold/blob/c77e5d2a8961d1a353632c462914ff0a32a950f6/alphafold/common/confidence.py) | Stable softmax and expected per-residue pLDDT from binned logits | Validate input shape, report every residue alongside the mean and visualize heterogeneity. |

Each vendor directory retains the corresponding upstream license and copyright. Its metrics.py contains selected original function bodies with a reduced import list. The repository MIT license covers original project code. Upstream files retain their respective licenses.

## Run from the repository root

Install the root requirements.txt, then run:

    python evidence/audit.py --out report.json demo
    python evidence/audit.py --out microscopy.json masks truth.npy predicted.npy
    python evidence/audit.py --out structure.json confidence logits.npy
    python -m unittest discover -s evidence

For masks, provide two aligned 2-D integer arrays, zero for background and a distinct positive label per object. Labels may differ between images. For confidence, provide an array shaped residues × confidence bins, before softmax. Already-computed pLDDT or PDB B factors cannot substitute for logits. Open studio/audit.html and select the JSON report. All computations and file reads can run offline.

## Practical

Predict how shifting one 6 × 6 object by one pixel changes matching. Its intersection has 30 pixels and union has 42. Compare IoU 0.5 and 0.75, recording which counts change. The reported score is TP/(TP+FP+FN). Both masks empty yields an undefined score. Then inspect the confidence example: identify the least confident position, and explain why the mean hides it. For a graduate assignment, repeat either audit on independently sourced labels or logits and record the acquisition/preprocessing steps. Segmentation agreement requires reference annotations. Model confidence describes a prediction and cannot establish experimental accuracy or enzyme activity.
