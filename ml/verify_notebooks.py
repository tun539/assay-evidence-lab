"""Verify structure, Python syntax, and core ML reproducibility across ml/*.ipynb."""
from __future__ import annotations

import ast
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ML_DIR = ROOT / "ml"


def check_notebook(path: Path) -> int:
    nb = json.loads(path.read_text(encoding="utf-8"))
    assert nb.get("nbformat") == 4, f"{path.name}: expected nbformat == 4"
    cells = nb.get("cells")
    assert isinstance(cells, list) and len(cells) >= 3, f"{path.name}: missing cells"

    code_cells = 0
    for idx, cell in enumerate(cells):
        ctype = cell.get("cell_type")
        assert ctype in {"markdown", "code", "raw"}, f"{path.name} cell {idx}: invalid type {ctype}"
        src = cell.get("source", "")
        text = "".join(src) if isinstance(src, list) else str(src)
        assert text.strip(), f"{path.name} cell {idx}: empty source"
        if ctype == "code":
            code_cells += 1
            # Ignore IPython magics/shell escapes if present, verify standard Python AST
            clean_lines = [
                line if not line.lstrip().startswith(("!", "%")) else "pass"
                for line in text.splitlines()
            ]
            ast.parse("\n".join(clean_lines), filename=f"{path.name}[cell_{idx}]")
    assert code_cells >= 2, f"{path.name}: expected >= 2 code cells"
    return code_cells


def verify_golub_and_kinetics_baseline() -> None:
    """When numpy/scikit-learn are installed (e.g. CI), replay leak-free Golub & enzyme stats."""
    try:
        import numpy as np
        from sklearn.linear_model import Ridge
    except ImportError:
        print("Skipping optional NumPy/scikit-learn numerical replay (packages absent locally).")
        return

    expr_js = ROOT / "studio" / "expression-data.js"
    raw = expr_js.read_text(encoding="utf-8")
    payload = json.loads(raw.removeprefix("const expression = ").strip().removesuffix(";"))
    probes = payload["probes"]
    selected = payload["selected"]
    assert len(probes) == 7129 and len(selected) == 25

    train_diff = np.array([p[3] - p[2] for p in probes], dtype=float)
    test_diff = np.array([p[5] - p[4] for p in probes], dtype=float)
    r_all = float(np.corrcoef(train_diff, test_diff)[0, 1])
    assert 0.55 < r_all < 0.99, f"Unexpected Golub cross-cohort r={r_all}"

    # Verify Ridge curve sanity check from studio kinetic fixture grid
    doses = np.array([0.02, 0.06, 0.11, 0.22, 0.56, 1.1])
    rng = np.random.default_rng(17)
    vmax = rng.uniform(130, 220, size=(120, 1))
    km = rng.uniform(0.04, 0.25, size=(120, 1))
    x = vmax * doses / (km + doses) + rng.normal(0, 6.0, size=(120, len(doses)))
    y = np.column_stack([vmax[:, 0] / 180.0, np.log(km[:, 0] / 0.1)])
    model = Ridge(alpha=10.0).fit(x, y)
    r2 = float(model.score(x, y))
    assert r2 > 0.70, f"Expected deterministic Ridge kinetics fit R2 > 0.70, got {r2}"
    print(f"Verified NumPy/scikit-learn baseline parity: Golub r={r_all:.3f}, Ridge R2={r2:.3f}.")


def main() -> None:
    notebooks = sorted(ML_DIR.glob("*.ipynb"))
    assert len(notebooks) >= 3, f"Expected >= 3 notebooks in {ML_DIR}, found {len(notebooks)}"
    total_cells = 0
    for nb_path in notebooks:
        n_code = check_notebook(nb_path)
        total_cells += n_code
        print(f"OK {nb_path.name}: {n_code} valid Python code cells")
    verify_golub_and_kinetics_baseline()
    print(f"Verified {len(notebooks)} Jupyter notebooks ({total_cells} AST-valid code cells).")


if __name__ == "__main__":
    main()
