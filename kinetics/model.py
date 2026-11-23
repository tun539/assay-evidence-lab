"""Compare shared and condition-specific apparent Michaelis-Menten parameters."""
from pathlib import Path
import argparse
import csv
import json
import numpy as np
from scipy.optimize import least_squares

ROOT = Path(__file__).resolve().parent
MODELS = ("shared", "split_vmax", "split_km", "split_both")


def predict(params, x, treated, model):
    vmax, km = params[:2]
    if model in ("split_vmax", "split_both"):
        vmax = np.where(treated, params[2], vmax)
    if model in ("split_km", "split_both"):
        km = np.where(treated, params[-1], km)
    return vmax * x / (km + x)


def fit(x, y, treated, model):
    start = [y.max(), np.median(x)]
    if model in ("split_vmax", "split_both"):
        start.append(y.max())
    if model in ("split_km", "split_both"):
        start.append(np.median(x))
    result = least_squares(lambda p: predict(p, x, treated, model) - y, start,
                           bounds=(1e-12, np.inf))
    if not result.success:
        raise RuntimeError(result.message)
    return result.x


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=ROOT / "puromycin.csv")
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    output = args.out or (ROOT if args.csv == ROOT / "puromycin.csv" else None)
    if output is None:
        parser.error("Provide --out when analyzing a new dataset")
    with args.csv.open() as f:
        rows = list(csv.DictReader(f))
    x = np.array([float(r["conc"]) for r in rows])
    y = np.array([float(r["rate"]) for r in rows])
    treated = np.array([r["state"] == "treated" for r in rows])
    if {r["state"] for r in rows} != {"treated", "untreated"}:
        parser.error("Expected exactly two states: treated and untreated")
    if not (np.isfinite(x).all() and (x > 0).all() and np.isfinite(y).all() and (y > 0).all()):
        parser.error("Concentrations and initial rates must be finite and positive")
    if len(np.unique(x)) < 3 or set(x[treated]) != set(x[~treated]):
        parser.error("Provide at least three shared concentration levels in both states")
    output.mkdir(parents=True, exist_ok=True)
    scores = {}
    records = []
    for model in MODELS:
        out = np.empty_like(y)
        folds = []
        for conc in np.unique(x):
            test = x == conc
            p = fit(x[~test], y[~test], treated[~test], model)
            out[test] = predict(p, x[test], treated[test], model)
            folds.append(float(np.sqrt(np.mean((out[test] - y[test])**2))))
        scores[model] = dict(rmse=float(np.sqrt(np.mean((out - y)**2))),
                             fold_rmse=folds, params=fit(x, y, treated, model).tolist())
        for row, estimate in zip(rows, out):
            records.append({**row, "model": model, "held_out_rate": float(estimate)})
    with (output / "predictions.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=records[0].keys())
        writer.writeheader()
        writer.writerows(records)
    (output / "fits.json").write_text(json.dumps(scores, indent=2) + "\n")
    print(json.dumps(scores, indent=2))


if __name__ == "__main__":
    main()
