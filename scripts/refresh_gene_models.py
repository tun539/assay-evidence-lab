"""Refresh the five offline C-alpha traces from AlphaFold DB (CC BY 4.0)."""
import json
import pathlib
import urllib.request

ACCESSIONS = ("P00846", "P0A7J3", "P00359", "Q31BY4", "O23290")
OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "studio" / "folds"


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "AssayEvidenceLab/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode()


def main():
    OUTPUT.mkdir(exist_ok=True)
    for accession in ACCESSIONS:
        entries = json.loads(fetch("https://alphafold.ebi.ac.uk/api/prediction/" + accession))
        entry = next(e for e in entries if e["uniprotAccession"] == accession and e.get("pdbUrl") and e["uniprotStart"] == 1)
        rows = []
        for line in fetch(entry["pdbUrl"]).splitlines():
            if line.startswith("ATOM  ") and line[12:16].strip() == "CA" and line[21] == "A":
                rows.append([line[17:20], int(line[22:26]), *[float(line[k:k+8]) for k in (30, 38, 46)], float(line[60:66])])
        if [r[1] for r in rows] != list(range(1, len(entry["uniprotSequence"]) + 1)):
            raise ValueError(f"Incomplete residue coverage: {accession}")
        model = {"accession": accession, "source": entry["pdbUrl"], "chain": "A", "rows": rows}
        (OUTPUT / (accession + ".json")).write_text(json.dumps(model, separators=(",", ":")) + "\n")
        print(accession, len(rows), "residues")


if __name__ == "__main__":
    main()
