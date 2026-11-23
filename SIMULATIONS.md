# Simulation lab

Open studio/simulation.html in the downloaded repo. Every chart is computed from the selected parameters. Solid and dashed lines distinguish series across color palettes. CSV contains all plotted coordinates. The JSON binds the completed run to its settings, prior prediction and reviewer notes. Changing a control requires another run. Export prior to switching experiments. Both examples use synthetic, dimensionless data.

## Force-law learning and validation

The reference potential is U(x)=x²/2+0.15x⁴. The classroom model estimates the harmonic stiffness on a finite training interval. Simulate both systems from the same amplitude at rest. Inspect agreement of the force curves and phase drift in trajectories. Test how expanding the training interval affects accuracy near the center and at large displacements. The linear model has structural error even with exact training labels.

The exercise draws on [MACE](https://github.com/ACEsuit/mace), a learned interatomic potential project. Two original NumPy error functions were extracted from [this pinned implementation](https://github.com/ACEsuit/mace/blob/1f44a4b3e81c316ae9f03a646f21c66766d1ef01/mace/tools/utils.py). See evidence/vendor/mace/LICENSE. The new Python checker independently refits stiffness with NumPy, re-evaluates force residuals along exported reference positions and checks the browser's error metrics. Run from the repository root:

    python evidence/check_simulation.py simulation-report.json

The browser uses a one-coordinate educational potential, with no pretrained MACE weights.

## Ensemble sampling

[BioEmu](https://github.com/microsoft/bioemu) motivates the question of how ensemble populations differ from individual conformations. This original two-state Markov model illustrates finite sampling and detailed balance. A and B are abstract states. The demo does not infer real protein structures, energies or physical timescales. Predict how raising the energy gap affects equilibrium B. Next change the transition scale with the gap fixed. Compare trajectories from three seeds before drawing conclusions.

## Team exercise (35 minutes)

- Analyst (10 min): specify the variable to change, record a prediction, run the baseline and a perturbation, export each run.
- Reviewer (10 min): reproduce one number from CSV or use the Python checker. Identify one rival explanation and a missing validation.
- Team lead (10 min): write a three-sentence decision for a colleague, giving a numeric result, uncertainty and next check.
- Group (5 min): swap roles and identify evidence that would reverse the decision.

Award one point each for a controlled comparison, accurate chart reading, independent quantitative verification, a specific critique and a defensible decision. Repeating the exercise with changed assumptions tests whether the reasoning transfers.
