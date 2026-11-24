"""Recompute benchmark scores from the public predictions without fitting models."""
import json
from pathlib import Path

import numpy as np
from sklearn.datasets import load_breast_cancer

root = Path(__file__).resolve().parents[1]
text = (root / "studio/research-data.js").read_text()
report = json.loads(text.removeprefix("const benchmark = ").strip().removesuffix(";"))
rows = np.asarray(report["rows"])
ids, y, folds = rows[:, :3].T
p = rows[:, 3:]
assert np.array_equal(ids, np.arange(569))
assert np.array_equal(y, (load_breast_cancer().target == 0))
assert set(folds) == set(range(1, 6))
assert np.isfinite(p).all() and np.all((p >= 0) & (p <= 1))
for f, train_prior in enumerate(report["prevalence"], 1):
    assert abs(y[folds != f].mean() - train_prior) < 1e-12
    np.testing.assert_allclose(p[folds == f, 0], train_prior)
errors = (p - y[:, None]) ** 2
rng = np.random.default_rng(report["seed"])
draws = []
for label in (0, 1):
    index = np.flatnonzero(y == label)
    draws.append(rng.choice(index, (report["bootstrap_replicates"], len(index))))
samples = np.concatenate(draws, axis=1)
for i, model in enumerate(report["models"]):
    np.testing.assert_allclose(errors[:, i].mean(), model["brier"], atol=1e-12)
    delta = errors[:, i] - errors[:, 1]
    np.testing.assert_allclose(delta.mean(), model["delta_brier"], atol=1e-12)
    np.testing.assert_allclose(np.quantile(delta[samples].mean(axis=1), [.025, .975]), model["interval"], atol=1e-12)
    aucs = []
    for f in range(1, 6):
        positives = p[(y == 1) & (folds == f), i]
        negatives = p[(y == 0) & (folds == f), i]
        gap = positives[:, None] - negatives
        aucs.append(np.mean((gap > 0) + .5 * (gap == 0)))
    np.testing.assert_allclose(aucs, model["fold_auc"], atol=1e-12)
    np.testing.assert_allclose(np.mean(aucs), model["mean_auc"], atol=1e-12)
print("Replayed 569 predictions per model, all fold AUROCs, Brier scores and intervals.")
