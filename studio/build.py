"""Embed versioned assay results for a portable, offline web application."""
from pathlib import Path
import csv
import json

here = Path(__file__).resolve().parent
repo = here.parent
with (repo / 'kinetics/puromycin.csv').open() as f:
    rows = list(csv.DictReader(f))
data = dict(rows=rows, fits=json.loads((repo/'kinetics/fits.json').read_text()),
            cytology=json.loads((repo/'NucleusAudit/results/metrics.json').read_text()))
(here/'results.js').write_text('window.assayResults = ' + json.dumps(data) + ';\n')
