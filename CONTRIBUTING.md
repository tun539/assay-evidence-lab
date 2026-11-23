# Contributing a scientific case

Open an issue describing the measurement, unit, experimental question and source. For new data, document reuse terms and identify the unit of independent replication. For a model change, include a baseline, the exact split and one observation that challenges your interpretation.

Reproduce the existing checks from the repository root after installing requirements.txt:

    python -m unittest discover -s kinetics
    python NucleusAudit/verify.py
    python studio/build.py

For display changes, open studio/index.html, switch between both cases, inspect a quantitative figure and export its SVG. Commit the generated results.js alongside changes to the underlying results. Describe any AI assistance and the independent check you performed.
