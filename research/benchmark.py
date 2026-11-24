"""Reproduce the WDBC comparison and export shared out-of-fold predictions."""
import json
from pathlib import Path

import numpy as np
import sklearn
from sklearn.datasets import load_breast_cancer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC

ROOT = Path(__file__).resolve().parents[1]
SEED = 41
REPLICATES = 1000


def main():
    data = load_breast_cancer()
    x = data.data
    y = (data.target == 0).astype(int)
    outer = StratifiedKFold(5, shuffle=True, random_state=SEED)
    models = [
        ("prior", "Class-prior baseline", DummyClassifier(), {}),
        ("logistic", "Logistic regression", make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000)),
         {"logisticregression__C": [.01, .1, 1, 10]}),
        ("knn", "k-nearest neighbors", make_pipeline(StandardScaler(), KNeighborsClassifier()),
         {"kneighborsclassifier__n_neighbors": [5, 11, 21], "kneighborsclassifier__weights": ["uniform", "distance"]}),
        ("svm", "RBF support vector machine", make_pipeline(StandardScaler(), SVC(probability=True, random_state=SEED)),
         {"svc__C": [.1, 1, 10], "svc__gamma": ["scale", .01, .1]}),
        ("forest", "Random forest", RandomForestClassifier(n_estimators=160, random_state=SEED),
         {"max_depth": [3, 6, None], "min_samples_leaf": [1, 4]}),
    ]
    predictions = np.full((len(y), len(models)), np.nan)
    folds = np.full(len(y), -1)
    params = [[] for _ in models]
    prevalence = []
    for fold, (train, test) in enumerate(outer.split(x, y), 1):
        assert not set(train).intersection(test) and np.all(folds[test] == -1)
        folds[test] = fold
        prevalence.append(float(y[train].mean()))
        inner = StratifiedKFold(4, shuffle=True, random_state=SEED + fold)
        for j, (_, _, model, grid) in enumerate(models):
            search = GridSearchCV(model, grid, cv=inner, scoring="roc_auc", error_score="raise")
            search.fit(x[train], y[train])
            predictions[test, j] = search.predict_proba(x[test])[:, 1]
            params[j].append(search.best_params_)
    assert np.isfinite(predictions).all() and ((predictions >= 0) & (predictions <= 1)).all()
    rng = np.random.default_rng(SEED)
    # Shared, class-stratified resamples preserve the pairing of model outputs.
    groups = [np.flatnonzero(y == k) for k in (0, 1)]
    bootstrap = np.concatenate([rng.choice(g, (REPLICATES, len(g))) for g in groups], axis=1)
    results = []
    for j, (key, name, _, _) in enumerate(models):
        p = predictions[:, j]
        fold_scores = [roc_auc_score(y[folds == f], p[folds == f]) for f in range(1, 6)]
        delta = (p-y)**2 - (predictions[:, 1]-y)**2
        interval = np.quantile(delta[bootstrap].mean(axis=1), [.025, .975])
        results.append(dict(key=key, name=name, fold_auc=fold_scores, mean_auc=float(np.mean(fold_scores)),
                            brier=float(brier_score_loss(y, p)), delta_brier=float(delta.mean()),
                            interval=interval.tolist(), params=params[j]))
    # Keep row-level predictions in the public data bundle for independent replay.
    rows = [[i, int(y[i]), int(folds[i]), *predictions[i].tolist()] for i in range(len(y))]
    payload = dict(seed=SEED, bootstrap_replicates=REPLICATES, sklearn=sklearn.__version__,
                   prevalence=prevalence, models=results, rows=rows)
    (ROOT / "studio" / "research-data.js").write_text(
        "const benchmark = " + json.dumps(payload, separators=(",", ":"), allow_nan=False) + ";\n",
        encoding="utf-8")
    for m in results:
        print(f"{m['name']:28} AUC {m['mean_auc']:.4f}  Brier {m['brier']:.4f}  ΔBrier {m['delta_brier']:+.4f}")


if __name__ == "__main__":
    main()
