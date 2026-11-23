"""Train and evaluate nuclear morphology models on the WDBC benchmark."""
import csv
import json
from pathlib import Path

import numpy as np
from sklearn.datasets import load_breast_cancer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import balanced_accuracy_score, confusion_matrix, roc_auc_score
from sklearn.model_selection import GridSearchCV, StratifiedKFold, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

OUT = Path(__file__).resolve().parent / "results"
SEED = 41


def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def metrics(labels, predictions, scores):
    tn, fp, fn, tp = confusion_matrix(labels, predictions, labels=[0, 1]).ravel().tolist()
    return dict(auc=float(roc_auc_score(labels, scores)),
                balanced_accuracy=float(balanced_accuracy_score(labels, predictions)),
                tn=tn, fp=fp, fn=fn, tp=tp)


def main():
    OUT.mkdir(exist_ok=True)
    data = load_breast_cancer()
    x = data.data
    names = data.feature_names.tolist()
    y = (data.target_names[data.target] == "malignant").astype(int)
    train, test = train_test_split(np.arange(len(y)), test_size=0.2,
                                   stratify=y, random_state=SEED)
    assert np.isfinite(x).all() and len(np.unique(x, axis=0)) == len(y)
    assert set(train).isdisjoint(test)
    size = [i for i, name in enumerate(names)
            if any(word in name.split() for word in ("radius", "perimeter", "area"))]
    groups = {"all": list(range(len(names))), "size_only": size,
              "without_direct_size": [i for i in range(len(names)) if i not in size]}
    cv = StratifiedKFold(5, shuffle=True, random_state=SEED)
    summary = {"train_n": len(train), "test_n": len(test), "seed": SEED,
               "majority_baseline": metrics(y[test], np.zeros_like(y[test]),
                                            np.full(len(test), y[train].mean()))}
    save("split.json", {"train": train.tolist(), "test": test.tolist()})
    rows = [{"row": int(i), "malignant": int(y[i])} for i in test]
    for label, cols in groups.items():
        subset = x[:, cols]
        model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000))
        search = GridSearchCV(model, {"logisticregression__C": [0.01, 0.1, 1, 10]},
                              cv=cv, scoring="roc_auc")
        search.fit(subset[train], y[train])
        probs = search.predict_proba(subset[test])[:, 1]
        predictions = (probs >= 0.5).astype(int)
        summary[label] = dict(metrics(y[test], predictions, probs),
                              cv_auc=float(search.best_score_), C=search.best_params_["logisticregression__C"],
                              features=[names[i] for i in cols])
        for row, prob in zip(rows, probs):
            row[label] = float(prob)
        if label == "all":
            scaler, clf = search.best_estimator_.steps[0][1], search.best_estimator_.steps[1][1]
            save("model.json", dict(features=names, mean=scaler.mean_.tolist(),
                                    scale=scaler.scale_.tolist(), weights=clf.coef_[0].tolist(),
                                    intercept=float(clf.intercept_[0]), positive_class="malignant"))
    save("metrics.json", summary)
    with (OUT / "predictions.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    for name in ("majority_baseline", *groups):
        m = summary[name]
        print(f"{name:20} AUC={m['auc']:.4f} BA={m['balanced_accuracy']:.4f} FP={m['fp']} FN={m['fn']}")


if __name__ == "__main__":
    main()
