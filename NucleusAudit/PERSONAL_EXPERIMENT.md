# Candidate experiment | Does boundary concavity add information?
Reserve 45–60 minutes. Write your prediction before looking at new results. Keep the reference outputs intact by working in a copy.

1. State what concavity and concave-point summaries capture about a nuclear boundary. Predict what will happen when all six of those columns are excluded. Explain why correlated measurements might mask their contribution.
2. Use only the 455 training rows listed in results/split.json. Keep C=1 fixed. Compare all 30 features against your reduced set on the same five stratified folds, fitting each scaler on that fold's training portion. Avoid calling the original train.py to select features using held-out results. The 114-row holdout has already been inspected.
3. Save the code change, the exact command and a CSV of the two validation AUCs and their paired difference per fold. Verify the six excluded column names manually and check one fold for overlap. Report the mean paired difference and its range as descriptive summaries.
4. Write 150–200 words explaining your result, one competing interpretation, and what additional evidence would change your conclusion. Record any agent prompt and output you used and a check that you performed independently. Save your first hypothesis even if the results surprise you.
5. Interview defense: Why did you keep C and the folds fixed? If a different regularization value improved the reduced model, what question would that answer? Which conclusion would still require specimens from a different laboratory?

## Decision record (complete after your run)
Date / author:
My initial prediction and reasoning:
Files and lines I changed:
Agent assistance and how I checked it:
Results and independent check:
My decision and its limits:

After completing the experiment, use this conditional resume bullet as a drafting aid:
“Tested the contribution of six nuclear-boundary descriptors to a cytology classifier using paired cross-validation on 455 training specimens. Observed [measured change] in ROC-AUC and verified [specific independent check].”
