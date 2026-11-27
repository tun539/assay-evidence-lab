"""Refresh the 10 KEGG coding sequences and expanded experimental/multi-entity PDB models."""
import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
STUDIO = ROOT / "studio"

GENE_META = [
    ("hsa:4508", "P00846", "Homo sapiens", "MT-ATP6", "Human mitochondrial DNA",
     "Encodes ATP synthase subunit a, an all-α transmembrane channel coupling proton flux to cellular ATP synthesis."),
    ("eco:b3985", "P0A7J3", "Escherichia coli K-12 MG1655", "rplJ", "Bacterial chromosome",
     "Encodes 50S ribosomal stalk protein L10, combining a folded anchor domain with a flexible recruitment arm."),
    ("sce:YGR192C", "P00359", "Saccharomyces cerevisiae", "TDH3", "Budding yeast",
     "Encodes GAPDH, a high-confidence Rossmann-fold glycolytic enzyme bridging sugar breakdown and fermentation."),
    ("pmi:PMT9312_0550", "Q31BY4", "Prochlorococcus marinus MIT 9312", "rbcL", "Marine cyanobacterium",
     "Encodes the RuBisCO large subunit TIM α/β-barrel responsible for global marine photosynthetic carbon fixation."),
    ("ath:AT4G14320", "O23290", "Arabidopsis thaliana", "AT4G14320", "Flowering plant",
     "Encodes a zinc-binding ribosomal protein (eL40 family) pairing an ordered core with a zinc-coordinating motif."),
    ("hsa:7157", "P04637", "Homo sapiens", "TP53", "Human nuclear genome",
     "Encodes tumor suppressor p53: a benchmark AlphaFold contrast between a well-folded DNA-binding core and disordered N/C tails."),
    ("hsa:3043", "P68871", "Homo sapiens", "HBB", "Human nuclear genome",
     "Encodes hemoglobin subunit beta, a classic eight-helix all-α globin fold carrying oxygen in red blood cells."),
    ("hsa:3630", "P01308", "Homo sapiens", "INS", "Human nuclear genome",
     "Encodes preproinsulin, highlighting how flexible signal and C-peptide segments flank the structured hormone fold."),
    ("eco:b2699", "P0A7G6", "Escherichia coli K-12 MG1655", "recA", "Bacterial chromosome",
     "Encodes RecA recombinase, an α/β ATPase that forms helical nucleoprotein filaments for DNA strand exchange and repair."),
    ("hsa:6647", "P00441", "Homo sapiens", "SOD1", "Human nuclear genome",
     "Encodes Cu/Zn superoxide dismutase, an iconic all-β Greek-key barrel protecting cells from superoxide radicals."),
]

NUCLEIC_RES = {"A", "U", "G", "C", "DA", "DT", "DG", "DC"}
BASE_TIP_ATOMS = ("N1", "N9", "C4", "C2", "C6")


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "AssayEvidenceStudio/2.0"})
    with urllib.request.urlopen(req, timeout=45) as r:
        return r.read().decode()


def fetch_kegg_nt(kegg_id):
    raw = fetch(f"https://rest.kegg.jp/get/{kegg_id}/ntseq")
    return "".join(line.strip() for line in raw.splitlines() if not line.startswith(">")).upper()


def parse_pdb_chains(raw, keep_chains=None, keep_ligands=()):
    chains_atoms = {}
    ligands = []
    for line in raw.splitlines():
        if line.startswith("ATOM  "):
            alt = line[16]
            if alt not in (" ", "A"):
                continue
            ch = line[21]
            if keep_chains is not None and ch not in keep_chains:
                continue
            atom = line[12:16].strip()
            res = line[17:20].strip()
            resseq = int(line[22:26])
            icode = line[26].strip()
            if icode:
                continue
            x, y, z = round(float(line[30:38]), 3), round(float(line[38:46]), 3), round(float(line[46:54]), 3)
            bfac = round(float(line[60:66]), 2)
            key = (ch, resseq, res)
            slot = chains_atoms.setdefault(ch, {}).setdefault(key, {})
            if atom not in slot:
                slot[atom] = (x, y, z, bfac)
        elif line.startswith("HETATM") and keep_ligands:
            res = line[17:20].strip()
            if res not in keep_ligands:
                continue
            alt = line[16]
            if alt not in (" ", "A"):
                continue
            ch = line[21]
            if keep_chains is not None and ch not in keep_chains:
                continue
            atom = line[12:16].strip()
            elem = (line[76:78].strip() or atom[0]).upper()
            resseq = int(line[22:26])
            x, y, z = round(float(line[30:38]), 3), round(float(line[38:46]), 3), round(float(line[46:54]), 3)
            ligands.append([res, ch, resseq, atom, elem, x, y, z])

    chains_out = []
    order = keep_chains if keep_chains is not None else sorted(chains_atoms.keys())
    for ch in order:
        res_map = chains_atoms.get(ch, {})
        items = sorted(res_map.items(), key=lambda kv: kv[0][1])
        is_nuc = any(k[2] in NUCLEIC_RES for k, _ in items)
        rows = []
        for (_, resseq, res), atoms in items:
            if is_nuc:
                anchor = atoms.get("C4'") or atoms.get("P")
                if not anchor:
                    continue
                tip = None
                for candidate in ("C4", "C6", "N1", "N9", "C2"):
                    if candidate in atoms:
                        tip = atoms[candidate]
                        break
                if tip:
                    rows.append([res, resseq, anchor[0], anchor[1], anchor[2], anchor[3], tip[0], tip[1], tip[2]])
                else:
                    rows.append([res, resseq, anchor[0], anchor[1], anchor[2], anchor[3]])
            else:
                if "CA" not in atoms:
                    continue
                a = atoms["CA"]
                rows.append([res, resseq, a[0], a[1], a[2], a[3]])
        if rows:
            kind = ("dna" if any(r[0].startswith("D") for r in rows) else "rna") if is_nuc else "protein"
            chains_out.append({"id": ch, "type": kind, "rows": rows})
    return chains_out, ligands


def main():
    # 1. Refresh all 10 KEGG sequences + dna-data.js + fold-catalog.js
    dna_records = []
    coding_dna = {}
    fold_ids = []
    for kegg, acc, species, gene, group, note in GENE_META:
        seq = fetch_kegg_nt(kegg)
        if len(seq) < 60:
            raise ValueError(f"Short sequence for {kegg}: {len(seq)}")
        coding_dna[kegg] = seq
        fold_ids.append(acc)
        dna_records.append({
            "id": kegg,
            "species": species,
            "gene": gene,
            "group": group,
            "note": note,
            "seq": seq[:60],
        })
        print(f"KEGG {kegg} ({gene}): {len(seq)} bp")

    (STUDIO / "dna-data.js").write_text(
        "// First 60 nucleotides of the oriented NT sequence in each linked KEGG record.\n"
        "const dnaRecords = " + json.dumps(dna_records, indent=2) + ";\n"
    )
    (STUDIO / "gene-sequences.js").write_text(
        "// Complete oriented NT sequences from the 10 KEGG records linked in dna-data.js.\n"
        "const codingDNA = " + json.dumps(coding_dna, indent=2) + ";\n"
    )
    (STUDIO / "fold-catalog.js").write_text(
        "// UniProt accessions from the 10 KEGG records, in dnaRecords order.\n"
        "const foldIds = " + json.dumps(fold_ids) + ";\n"
        "const bundledFolds = {};\n"
    )

    # 2. Refresh experimental & multi-entity PDB models (including flagship 8AW3!)
    pdb_specs = [
        ("8AW3", {
            "name": "Protein–RNA–Ion Complex (PDB 8AW3)",
            "subtitle": "AlphaFold Server Flagship Example · Two proteins + tRNA + 2× Zn²⁺",
            "method": "Cryo-EM / AlphaFold Server benchmark complex",
            "resolution": "3.1 Å (PDB 8AW3) · AlphaFold Server ipTM = 0.78, pTM = 0.75",
            "iptm": 0.78,
            "ptm": 0.75,
            "keep_chains": ["2", "3", "1"],
            "keep_ligands": ("ZN",),
            "chain_labels": {"2": "Protein subunit 1", "3": "Protein subunit 2", "1": "tRNA strand"},
            "summary": "Multi-entity macromolecular complex featured on AlphaFold Server, uniting two protein chains, a 73-nucleotide folded tRNA backbone, and two structural Zn²⁺ ions.",
        }),
        ("1GFL", {
            "name": "Green Fluorescent Protein (GFP)",
            "subtitle": "Aequorea victoria · 11-strand β-barrel light emitter",
            "method": "X-ray crystallography",
            "resolution": "1.9 Å",
            "keep_chains": ["A"],
            "keep_ligands": (),
            "chain_labels": {"A": "GFP Chain A"},
            "summary": "Classic 11-stranded β-barrel enclosing an internal α-helix that forms the fluorescent chromophore.",
        }),
        ("1MBO", {
            "name": "Oxymyoglobin + Heme & O₂",
            "subtitle": "Physeter catodon · All-α globin bound to Heme porphyrin and dioxygen",
            "method": "X-ray crystallography",
            "resolution": "1.6 Å",
            "keep_chains": ["A"],
            "keep_ligands": ("HEM", "OXY"),
            "chain_labels": {"A": "Myoglobin Chain A"},
            "summary": "Eight-helix globin fold cradling an iron-containing heme group and bound molecular oxygen (O₂) inside a hydrophobic pocket.",
        }),
        ("1BNA", {
            "name": "B-DNA Double Helix (Dickerson–Drew)",
            "subtitle": "Synthetic 12-bp dodecamer · Experimental B-form DNA duplex",
            "method": "X-ray crystallography",
            "resolution": "1.9 Å",
            "keep_chains": ["A", "B"],
            "keep_ligands": (),
            "chain_labels": {"A": "DNA Strand A (5′→3′)", "B": "DNA Strand B (5′→3′)"},
            "summary": "Landmark first single-crystal X-ray structure of a complete right-handed B-DNA turn showing major/minor grooves and Watson–Crick pairing.",
        }),
        ("1GCN", {
            "name": "Glucagon",
            "subtitle": "Sus scrofa · 29-residue α-helical peptide hormone",
            "method": "X-ray crystallography",
            "resolution": "3.0 Å",
            "keep_chains": ["A"],
            "keep_ligands": (),
            "chain_labels": {"A": "Glucagon Chain A"},
            "summary": "Compact 29-residue peptide hormone adopting a continuous α-helical conformation in the crystal.",
        }),
        ("1CRN", {
            "name": "Crambin",
            "subtitle": "Crambe hispanica · Ultrahigh-resolution disulfide-rich seed protein",
            "method": "X-ray crystallography",
            "resolution": "1.5 Å",
            "keep_chains": ["A"],
            "keep_ligands": (),
            "chain_labels": {"A": "Crambin Chain A"},
            "summary": "Small 46-residue amphipathic plant protein stabilized by three disulfide bonds, widely used as a structural benchmark.",
        }),
        ("2RBG", {
            "name": "ST0493",
            "subtitle": "Sulfurisphaera tokodaii · Thermophilic archaeal α/β domain",
            "method": "X-ray crystallography",
            "resolution": "1.7 Å",
            "keep_chains": ["A"],
            "keep_ligands": (),
            "chain_labels": {"A": "ST0493 Chain A"},
            "summary": "Compact α/β protein from a hyperthermophilic archaeon, highlighting dense hydrophobic core contacts.",
        }),
    ]

    experimental = {}
    for pdb_id, meta in pdb_specs:
        raw = fetch(f"https://files.rcsb.org/view/{pdb_id}.pdb")
        chains, ligands = parse_pdb_chains(raw, meta["keep_chains"], meta["keep_ligands"])
        for ch in chains:
            ch["label"] = meta["chain_labels"].get(ch["id"], f"Chain {ch['id']}")
        flat_rows = [row[:5] for ch in chains for row in ch["rows"]]
        entry = {
            "name": meta["name"],
            "subtitle": meta["subtitle"],
            "method": meta["method"],
            "resolution": meta["resolution"],
            "summary": meta["summary"],
            "chains": chains,
            "ligands": ligands,
            "rows": flat_rows,
        }
        if "iptm" in meta:
            entry["iptm"] = meta["iptm"]
            entry["ptm"] = meta["ptm"]
        experimental[pdb_id] = entry
        print(f"PDB {pdb_id}: {len(chains)} chains, {len(flat_rows)} residues, {len(ligands)} ligand/ion atoms")

    (STUDIO / "experimental.js").write_text(
        "const experimental = " + json.dumps(experimental, separators=(",", ":")) + ";\n"
    )


if __name__ == "__main__":
    main()
