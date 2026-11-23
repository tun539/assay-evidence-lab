# Teaching with Assay Evidence Lab

Download the repository ZIP, extract it and open studio/practical.html in a current desktop browser. The practical, input measurements, fitter and exports work offline. The source links need internet access. A class can use the same downloaded release on every machine. No account, API key or Python installation is needed for the browser practical.

## Undergraduate practical · 30 minutes

Students should already be familiar with reaction rate and substrate concentration. The goal is to interpret apparent Vmax and Km and evaluate a prediction on observations excluded from fitting.

1. Spend five minutes writing a prediction about shared versus preparation-specific curves before fitting.
2. Fit the published example. In ten minutes, identify the full-data Vmax and Km for each preparation and explain their units. At a substrate concentration of Km the model predicts half Vmax.
3. Open the concentration folds and choose one interior concentration. Export the CSV, calculate observed minus predicted rate for one row and explain its sign. Contrast an interior fold with an endpoint fold.
4. Submit the JSON record and a conclusion that quotes one held-out error and names one limitation.

## Graduate practical · 60 minutes

Use paired conditions at common substrate concentrations. Data must be initial rates on a consistent scale. Inspect whether the saturation model is a reasonable descriptive family for the assay before interpreting its parameters. Extra columns are ignored by this teaching fitter. Restrict input to a single pair of runs; validate across preparations separately when multiple runs exist.

1. Record a hypothesis, source, units and proposed independent experimental unit.
2. Compare two global parameters against two parameters per preparation. Hold out one complete concentration in both conditions. Compare pooled RMSE against the square root of the equally weighted mean of fold MSEs. Determine whether model order changes.
3. Recalculate both scores from exported row predictions. Identify the fold with the largest error, its sample count and whether it requires extrapolation.
4. Use the repository Python CLI to compare the two intermediate hypotheses that split only Vmax or Km. Attach fits.json and discuss the predictive benefit of the fourth parameter.
5. Write a short methods and limitations paragraph. Address the effect of run confounding, conditional model selection and independent replication. Submit the JSON, predictions and calculation.

## Instructor key and marking

On the bundled measurements the shared model gives pooled RMSE 19.33 and separate parameters give 11.62 counts/min/min. There are six folds and 23 observations, including three rows at the highest concentration. Each condition was observed in a single run. This comparison evaluates generalization across measured concentration levels within these preparations. It leaves generalization across laboratories or biological preparations unresolved.

Award two points each for a testable prior hypothesis, correct units and parameter interpretation, an independently reproduced calculation, a defensible comparison tied to a specific fold, and a limitation with a suitable proposed measurement. Recalculation should match the recorded scores within rounding. Accept a different preferred model when the evidence and loss function are explicit.

## Design references

The supplied project survey spans protein models, scientific agents, materials simulations and commercial platforms. Three practices transferred directly to this assay:

- Cellpose motivates a path from an accessible interface to inspectable local scientific outputs. [Project](https://github.com/MouseLand/cellpose)
- GraphCast's published modeling workflow motivates making the evaluation protocol explicit. The assay uses concentration folds suited to its own experimental design. [Project](https://github.com/google-deepmind/graphcast)
- LiveDesign illustrates keeping experimental evidence and analysis together. Here the downloadable record pairs original observations, parameter estimates, validation predictions and interpretation. [Platform](https://www.schrodinger.com/platform/products/livedesign/)

These are workflow references. The browser runs its own numerical fitter and requires no external model service.
