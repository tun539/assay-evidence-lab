"""Build the static Assay Evidence Studio site and offline ZIP for any static host."""
import argparse
import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT / "studio"
STATIC_EXTENSIONS = {".html", ".css", ".js", ".json", ".csv", ".svg"}


def git_info() -> dict[str, str]:
    def run(args: list[str]) -> str:
        try:
            return subprocess.check_output(args, cwd=ROOT, stderr=subprocess.DEVNULL, text=True).strip()
        except Exception:
            return "unknown"

    return {
        "commit": run(["git", "rev-parse", "HEAD"]),
        "shortCommit": run(["git", "rev-parse", "--short", "HEAD"]),
        "branch": run(["git", "rev-parse", "--abbrev-ref", "HEAD"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "dist", help="Output directory (default: dist)")
    parser.add_argument("--cname", default="", help="Optional custom domain to write to CNAME")
    parser.add_argument("--skip-zip", action="store_true", help="Skip building assay-evidence-studio.zip")
    args = parser.parse_args()

    out = args.out.resolve()
    if out == ROOT or out == STUDIO:
        parser.error("Output directory must not be the repository root or studio directory.")

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    copied = 0
    for file in sorted(STUDIO.rglob("*")):
        if file.is_file() and file.suffix in STATIC_EXTENSIONS:
            target = out / file.relative_to(STUDIO)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(file, target)
            copied += 1

    if not args.skip_zip:
        subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "package_studio.py"), str(out / "assay-evidence-studio.zip")],
            check=True,
        )

    cname_text = args.cname.strip()
    root_cname = ROOT / "CNAME"
    if not cname_text and root_cname.is_file():
        cname_text = root_cname.read_text(encoding="utf-8").strip()
    if cname_text:
        (out / "CNAME").write_text(cname_text + "\n", encoding="utf-8")

    (out / ".nojekyll").write_text("", encoding="utf-8")

    meta = {
        **git_info(),
        "builtAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "files": copied,
        "customDomain": cname_text or None,
    }
    (out / "build-info.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(f"Built {copied} studio files into {out} (commit {meta['shortCommit']})")


if __name__ == "__main__":
    main()
