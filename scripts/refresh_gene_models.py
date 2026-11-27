"""Refresh all ten offline C-alpha traces, pLDDT scores, and PAE maps from AlphaFold DB (CC BY 4.0)."""
import json
import pathlib
import urllib.request

ACCESSIONS = (
    "P00846",  # Homo sapiens MT-ATP6
    "P0A7J3",  # E. coli rplJ
    "P00359",  # S. cerevisiae TDH3
    "Q31BY4",  # P. marinus rbcL
    "O23290",  # A. thaliana AT4G14320
    "P04637",  # Homo sapiens TP53
    "P68871",  # Homo sapiens HBB
    "P01308",  # Homo sapiens INS
    "P0A7G6",  # E. coli recA
    "P00441",  # Homo sapiens SOD1
)
OUTPUT = pathlib.Path(__file__).resolve().parents[1] / "studio" / "folds"
PAE_GRID = 48


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "AssayEvidenceStudio/2.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode()


def downsample_pae(matrix, size=PAE_GRID):
    n = len(matrix)
    grid = min(size, n)
    out = []
    for r in range(grid):
        r0 = int(r * n / grid)
        r1 = max(r0 + 1, int((r + 1) * n / grid))
        for c in range(grid):
            c0 = int(c * n / grid)
            c1 = max(c0 + 1, int((c + 1) * n / grid))
            total = 0.0
            count = 0
            for i in range(r0, r1):
                row = matrix[i]
                for j in range(c0, c1):
                    total += row[j]
                    count += 1
            out.append(round(total / count, 1))
    return grid, out


def main():
    OUTPUT.mkdir(exist_ok=True)
    for accession in ACCESSIONS:
        entries = json.loads(fetch("https://alphafold.ebi.ac.uk/api/prediction/" + accession))
        entry = next(e for e in entries if e["uniprotAccession"] == accession and e.get("pdbUrl") and e["uniprotStart"] == 1)
        rows = []
        for line in fetch(entry["pdbUrl"]).splitlines():
            if line.startswith("ATOM  ") and line[12:16].strip() == "CA" and line[21] == "A":
                plddt = round(float(line[60:66]), 2)
                rows.append([
                    line[17:20].strip(),
                    int(line[22:26]),
                    round(float(line[30:38]), 3),
                    round(float(line[38:46]), 3),
                    round(float(line[46:54]), 3),
                    plddt,
                ])
        if [r[1] for r in rows] != list(range(1, len(entry["uniprotSequence"]) + 1)):
            raise ValueError(f"Incomplete residue coverage: {accession}")

        pae_size, pae_flat, pae_max = 0, [], 31.75
        if entry.get("paeDocUrl"):
            pae_doc = json.loads(fetch(entry["paeDocUrl"]))
            block = pae_doc[0] if isinstance(pae_doc, list) else pae_doc
            pae_max = round(float(block.get("max_predicted_aligned_error", 31.75)), 2)
            pae_size, pae_flat = downsample_pae(block["predicted_aligned_error"], PAE_GRID)

        model = {
            "accession": accession,
            "gene": entry.get("gene", ""),
            "organism": entry.get("organismScientificName", ""),
            "description": entry.get("uniprotDescription", ""),
            "version": entry.get("latestVersion", 6),
            "source": entry["pdbUrl"],
            "paeSource": entry.get("paeDocUrl", ""),
            "chain": "A",
            "plddtMean": round(float(entry.get("globalMetricValue", sum(r[5] for r in rows) / len(rows))), 2),
            "paeSize": pae_size,
            "paeMax": pae_max,
            "pae": pae_flat,
            "columns": ["residue", "position", "x_angstrom", "y_angstrom", "z_angstrom", "plddt"],
            "rows": rows,
        }
        (OUTPUT / (accession + ".js")).write_text(
            f'bundledFolds["{accession}"]=' + json.dumps(model, separators=(",", ":")) + ";\n"
        )
        print(f"{accession} ({model['gene']}): {len(rows)} residues, pLDDT={model['plddtMean']}, PAE={pae_size}x{pae_size}")


if __name__ == "__main__":
    main()
