"""Generate the static workbench from the shared SciPy fitting implementation."""
import csv
import json
from pathlib import Path

import numpy as np

from model import MODELS, fit, predict

STUDIO = Path(__file__).resolve().parents[1] / "studio"


def main() -> None:
    with (STUDIO / "puromycin.csv").open(newline="") as source:
        rows = list(csv.DictReader(source))
    x = np.array([float(row["conc"]) for row in rows])
    y = np.array([float(row["rate"]) for row in rows])
    treated = np.array([row["state"] == "treated" for row in rows])
    folds = []
    for level in np.unique(x):
        held = x == level
        models = {}
        for model in MODELS:
            params = fit(x[~held], y[~held], treated[~held], model)
            estimates = predict(params, x, treated, model)
            models[model] = params.tolist()
            assert np.isfinite(estimates).all() and (estimates > 0).all()
        folds.append({"level": level, "models": models})
    data = {"rows": rows, "folds": folds}
    (STUDIO / "kinetics-data.js").write_text(
        "const kineticsData = " + json.dumps(data, allow_nan=False) + ";\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
