"""Render observed rates and the held-concentration comparison."""
import csv
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from model import ROOT, predict

with (ROOT / "puromycin.csv").open() as f:
    rows = list(csv.DictReader(f))
fits = json.loads((ROOT / "fits.json").read_text())
fig, (left, right) = plt.subplots(1, 2, figsize=(10, 3.6), layout="constrained")
for state, color, marker in [("untreated", "#214663", "o"), ("treated", "#b34a20", "^")]:
    data = [r for r in rows if r["state"] == state]
    left.scatter([float(r["conc"]) for r in data], [float(r["rate"]) for r in data],
                 c=color, marker=marker, label=state, s=28)
    grid = np.geomspace(0.02, 1.1, 100)
    left.plot(grid, predict(fits["split_vmax"]["params"], grid, state == "treated", "split_vmax"), c=color)
left.set(xscale="log", xlabel="Substrate concentration (ppm, log scale)", ylabel="Initial rate (counts/min/min)", title="Measured rates and fitted curves")
left.legend(frameon=False)
names = list(fits)
bars = right.barh(["Shared", "Separate Vmax", "Separate Km", "Separate both"], [fits[n]["rmse"] for n in names], color=["#9cabaf","#137e75","#9cabaf","#9cabaf"])
right.bar_label(bars,fmt="%.2f",padding=3)
right.set(xlim=(0,23),xlabel="Held-out RMSE (counts/min/min)",title="Predicting an omitted concentration")
right.invert_yaxis()
for ax in (left,right):
    ax.spines[["top","right"]].set_visible(False)
fig.savefig(ROOT / "comparison.png", dpi=130)
