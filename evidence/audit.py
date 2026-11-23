"""Evaluate paired label maps or AlphaFold confidence logits, offline."""
import argparse
import json
from pathlib import Path
import numpy as np
from vendor.cellpose.metrics import _intersection_over_union, _true_positive
from vendor.alphafold.metrics import compute_plddt

ROOT = Path(__file__).resolve().parent
VERSIONS = {"cellpose": "a54cb48849b7e225a81e8e43dcb042d42427f543",
            "alphafold": "c77e5d2a8961d1a353632c462914ff0a32a950f6"}


def labels(a):
    if a.ndim != 2 or not a.size or a.dtype.kind not in "ui" or a.min() < 0:
        raise ValueError("Provide a nonempty 2-D nonnegative integer label image")
    ids = np.unique(a[a > 0])
    if len(ids) > 2000:
        raise ValueError("This classroom evaluator supports up to 2,000 objects per image")
    return np.where(a == 0, 0, np.searchsorted(ids, a) + 1), len(ids)


def masks(truth, predicted):
    if truth.shape != predicted.shape:
        raise ValueError("Mask shapes must match")
    truth, n = labels(truth)
    predicted, m = labels(predicted)
    with np.errstate(invalid="ignore"):
        iou = _intersection_over_union(truth, predicted)[1:, 1:] if n and m else None
    rows = []
    for threshold in (0.5, 0.75, 0.9):
        tp = int(_true_positive(iou, threshold)) if iou is not None else 0
        denom = n + m - tp
        rows.append(dict(threshold=threshold, tp=tp, fp=m-tp, fn=n-tp,
                         score=tp/denom if denom else None))
    return dict(kind="mask", reference_objects=n, predicted_objects=m, rows=rows)


def confidence(logits):
    if logits.ndim != 2 or not logits.shape[0] or logits.shape[1]<2 or not np.isfinite(logits).all():
        raise ValueError("Expected finite logits with shape [residues, bins], at least two bins")
    values = compute_plddt(logits.astype(float))
    return dict(kind="confidence", scores=values.tolist(), mean=float(values.mean()))


def demo():
    truth = np.zeros((12,22),dtype=int)
    truth[2:8,1:7]=1
    truth[2:8,10:16]=2
    shifted = truth.copy()
    shifted[shifted==2]=0
    shifted[2:8,11:17]=2
    logits=np.array([[0,0,0,0],[0,0,0,5],[5,0,0,0],[0,0,5,0]])
    return [masks(truth,shifted),confidence(logits)]


if __name__ == "__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest="mode",required=True)
    sub.add_parser("demo")
    p=sub.add_parser("masks")
    p.add_argument("truth",type=Path)
    p.add_argument("predicted",type=Path)
    sub.add_parser("confidence").add_argument("logits",type=Path)
    parser.add_argument("--out",type=Path,required=True)
    args=parser.parse_args()
    if args.mode=="demo":
        runs=demo()
        source="Synthetic classroom fixtures"
    elif args.mode=="masks":
        runs=[masks(np.load(args.truth,allow_pickle=False),np.load(args.predicted,allow_pickle=False))]
        source=f"{args.truth.name}, {args.predicted.name}"
    else:
        runs=[confidence(np.load(args.logits,allow_pickle=False))]
        source=args.logits.name
    report=dict(schema="evidence-audit/1",source=source,upstream=VERSIONS,runs=runs)
    args.out.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
