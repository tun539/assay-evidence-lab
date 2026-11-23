"""Replay the exported weights without loading a pickled estimator."""
import csv
import json
from pathlib import Path

import numpy as np
from scipy.special import expit
from sklearn.datasets import load_breast_cancer
from sklearn.metrics import roc_auc_score

root = Path(__file__).resolve().parent / "results"
m = json.loads((root / "model.json").read_text())
split = json.loads((root / "split.json").read_text())
with (root / "predictions.csv").open() as f:
    rows = list(csv.DictReader(f))
d = load_breast_cancer()
assert m["features"] == list(d.feature_names)
idx = [int(r["row"]) for r in rows]
assert idx == split["test"]
assert sorted(split["train"] + idx) == list(range(len(d.data)))
truth = [int(r["malignant"]) for r in rows]
assert np.array_equal(truth, d.target_names[d.target[idx]] == "malignant")
probs = expit(((d.data[idx] - m["mean"]) / m["scale"]) @ m["weights"] + m["intercept"])
np.testing.assert_allclose(probs, [float(r["all"]) for r in rows], atol=1e-12, rtol=0)
metrics = json.loads((root / "metrics.json").read_text())["all"]
assert abs(roc_auc_score(truth, probs) - metrics["auc"]) < 1e-12
print(f"Verified labels, split coverage, probabilities and AUC for {len(idx)} holdout rows.")
