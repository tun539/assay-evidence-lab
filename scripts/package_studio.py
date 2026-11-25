"""Package a static Studio directory and its editable training examples."""
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
EXTRAS = (
    "PLAY.md", "LICENSE", "scripts/play_studio.py",
    "ml/requirements.txt", "ml/MolecularLearning.ipynb", "ml/molecular.py",
    "ml/MultilingualTraining.ipynb", "ml/train.py",
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="Path to the new ZIP")
    parser.add_argument("--site-dir", type=Path, default=ROOT / "studio")
    args = parser.parse_args()
    site = args.site_dir.resolve()
    output = args.output.resolve()
    if not (site / "atlas.html").is_file():
        parser.error("site directory must contain atlas.html")
    archive_root = Path("AssayEvidenceStudio")
    with ZipFile(output, "w", ZIP_DEFLATED) as bundle:
        for file in sorted(site.rglob("*")):
            if file.is_file() and file.suffix in {".html", ".css", ".js", ".json", ".csv"}:
                bundle.write(file, archive_root / "studio" / file.relative_to(site))
        for name in EXTRAS:
            bundle.write(ROOT / name, archive_root / name)
    with ZipFile(output) as bundle:
        if damaged := bundle.testzip():
            raise IOError(f"Could not verify {damaged}")
        print(f"{len(bundle.namelist())} files packaged at {output}")


if __name__ == "__main__":
    main()
