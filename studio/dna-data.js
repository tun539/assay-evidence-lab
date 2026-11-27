// First 60 nucleotides of the oriented NT sequence in each linked KEGG record.
const dnaRecords = [
  {
    "id": "hsa:4508",
    "species": "Homo sapiens",
    "gene": "MT-ATP6",
    "group": "Human mitochondrial DNA",
    "note": "Encodes ATP synthase subunit a, an all-\u03b1 transmembrane channel coupling proton flux to cellular ATP synthesis.",
    "seq": "ATGAACGAAAATCTGTTCGCTTCATTCATTGCCCCCACAATCCTAGGCCTACCCGCCGCA"
  },
  {
    "id": "eco:b3985",
    "species": "Escherichia coli K-12 MG1655",
    "gene": "rplJ",
    "group": "Bacterial chromosome",
    "note": "Encodes 50S ribosomal stalk protein L10, combining a folded anchor domain with a flexible recruitment arm.",
    "seq": "ATGGCTTTAAATCTTCAAGACAAACAAGCGATTGTTGCTGAAGTCAGCGAAGTAGCCAAA"
  },
  {
    "id": "sce:YGR192C",
    "species": "Saccharomyces cerevisiae",
    "gene": "TDH3",
    "group": "Budding yeast",
    "note": "Encodes GAPDH, a high-confidence Rossmann-fold glycolytic enzyme bridging sugar breakdown and fermentation.",
    "seq": "ATGGTTAGAGTTGCTATTAACGGTTTCGGTAGAATCGGTAGATTGGTCATGAGAATTGCT"
  },
  {
    "id": "pmi:PMT9312_0550",
    "species": "Prochlorococcus marinus MIT 9312",
    "gene": "rbcL",
    "group": "Marine cyanobacterium",
    "note": "Encodes the RuBisCO large subunit TIM \u03b1/\u03b2-barrel responsible for global marine photosynthetic carbon fixation.",
    "seq": "ATGAGTAAGAAGTATGATGCAGGGGTAAAGGAGTACAGAGATACCTACTGGACTCCTGAA"
  },
  {
    "id": "ath:AT4G14320",
    "species": "Arabidopsis thaliana",
    "gene": "AT4G14320",
    "group": "Flowering plant",
    "note": "Encodes a zinc-binding ribosomal protein (eL40 family) pairing an ordered core with a zinc-coordinating motif.",
    "seq": "ATGGTGAACATTCCGAAAACTAAGAACACTTACTGCAAGAACAAGGAGTGCAAGAAGCAT"
  },
  {
    "id": "hsa:7157",
    "species": "Homo sapiens",
    "gene": "TP53",
    "group": "Human nuclear genome",
    "note": "Encodes tumor suppressor p53: a benchmark AlphaFold contrast between a well-folded DNA-binding core and disordered N/C tails.",
    "seq": "ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTGAGTCAGGAAACATTTTCA"
  },
  {
    "id": "hsa:3043",
    "species": "Homo sapiens",
    "gene": "HBB",
    "group": "Human nuclear genome",
    "note": "Encodes hemoglobin subunit beta, a classic eight-helix all-\u03b1 globin fold carrying oxygen in red blood cells.",
    "seq": "ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAAC"
  },
  {
    "id": "hsa:3630",
    "species": "Homo sapiens",
    "gene": "INS",
    "group": "Human nuclear genome",
    "note": "Encodes preproinsulin, highlighting how flexible signal and C-peptide segments flank the structured hormone fold.",
    "seq": "ATGGCCCTGTGGATGCGCCTCCTGCCCCTGCTGGCGCTGCTGGCCCTCTGGGGACCTGAC"
  },
  {
    "id": "eco:b2699",
    "species": "Escherichia coli K-12 MG1655",
    "gene": "recA",
    "group": "Bacterial chromosome",
    "note": "Encodes RecA recombinase, an \u03b1/\u03b2 ATPase that forms helical nucleoprotein filaments for DNA strand exchange and repair.",
    "seq": "ATGGCTATCGACGAAAACAAACAGAAAGCGTTGGCGGCAGCACTGGGCCAGATTGAGAAA"
  },
  {
    "id": "hsa:6647",
    "species": "Homo sapiens",
    "gene": "SOD1",
    "group": "Human nuclear genome",
    "note": "Encodes Cu/Zn superoxide dismutase, an iconic all-\u03b2 Greek-key barrel protecting cells from superoxide radicals.",
    "seq": "ATGGCGACGAAGGCCGTGTGCGTGCTGAAGGGCGACGGCCCAGTGCAGGGCATCATCAAT"
  }
];
