# NucleusAudit
**How much of the class separation in a cytology benchmark survives when direct measurements of nuclear size are removed?**

This reproducible biology ML project trains a supervised classifier on measurements of cell nuclei from digitized fine-needle aspirates. Each row describes a specimen. The input is 30 numeric summaries, and the target is the dataset's benign or malignant label. The model operates on the published measurements; it does not learn image segmentation.

## Reproduce the experiment
Tested with Python 3.12. Create a virtual environment, activate it, then run these commands from this directory. The dataset ships in scikit-learn.
```sh
python -m pip install -r requirements.txt
python train.py
python verify.py
```
Training regenerates the files in results/. To check the shipped model before retraining, run verify.py first. Results include a portable coefficient export, row-level probabilities, split membership, feature names, selected regularization values and metrics. Row numbers refer to the zero-based scikit-learn dataset order.

## Experimental design
A stratified 455/114 split with seed 41 is shared by all experiments. Training fits a scaler and L2 logistic regression within each fold of five-fold stratified cross-validation. For each feature set the highest mean validation ROC-AUC chooses C from 0.01, 0.1, 1 and 10. Refit uses all training rows. The held-out scores are summarized below. The fixed threshold is 0.5 and malignant is the positive class. The majority baseline always predicts benign.

Radius, perimeter and area give nine direct size columns when their mean, standard error and worst summaries are counted. The remaining 21 columns include texture and boundary descriptors such as concavity. Correlated descriptors can retain size information. Removing explicit size columns tests a representation choice; it cannot isolate a biological mechanism. Logistic regression makes training and independent replay of the feature scaling, coefficients and intercept easy to inspect.

| Model | Features | Best C | CV AUC | Held-out AUC | Balanced accuracy | False positives | False negatives |
|---|---:|---:|---:|---:|---:|---:|---:|
| Majority | 0 | — | — | .5000 | .5000 | 0 | 42 |
| Direct size only | 9 | 10 | .9868 | .9841 | .9127 | 4 | 5 |
| Without direct size | 21 | 1 | .9873 | .9851 | .9405 | 0 | 5 |
| Full | 30 | 1 | .9969 | .9901 | .9762 | 0 | 2 |

## Reviewer's decision
Retain the full model as the internal reference. With the direct size columns removed, the model still ranked specimens well on this split. That observation does not establish that nuclear size is biologically irrelevant. The small AUC gap between the two reduced models is insufficient to rank the corresponding biological processes. The specimens come from one benchmark, patient grouping could not be checked with the packaged identifiers, and performance at a new laboratory is unknown. The experiment evaluates agreement with historical dataset labels.

Two of 42 positive cases fell below the full model's threshold. Row 215 scored 0.49973 and row 297 scored 0.00205. One sits near the decision boundary while the other is confidently misclassified. Lowering the threshold to rescue a specimen observed here would use the evaluation set for tuning. These outputs identify cases for investigation; they do not explain the biological cause of either error. Predicted scores have not been validated as clinical risks.

## Data provenance
Wolberg, Street and Mangasarian, *Breast Cancer Wisconsin (Diagnostic)*. UCI Machine Learning Repository, DOI [10.24432/C5DW2B](https://doi.org/10.24432/C5DW2B). Loaded through sklearn.datasets.load_breast_cancer. Input features are supplied by the original investigators. Label mapping is checked against the loader's class names. No raw images are bundled.

## Candidate contribution
The initial implementation, experimental design, training run and reference interpretation were prepared with AI assistance. A reviewer can verify the reference run immediately. See PERSONAL_EXPERIMENT.md to add an attributable candidate experiment.
