# Ranking and probability error in a cytology benchmark

Does a nonlinear classifier improve probability error relative to standardized logistic regression on the Wisconsin Diagnostic Breast Cancer dataset? The benchmark uses 569 specimens, 30 published features and a common set of five stratified outer folds. It compares four trained families and an outer-training class-prior baseline. The [interactive benchmark](https://assay-evidence-studio.kh-ng-gian-l-5063.chatgpt.site/research) includes probability reliability, a threshold sandbox and a CSV of out-of-fold predictions.

## Reproduction

From the repository root, in a Python 3.12 environment:

```sh
python -m pip install -r requirements.txt
python research/benchmark.py
python research/verify.py
python -m http.server 8000 --directory studio
```

Open http://localhost:8000/research.html. The benchmark writes the exact predictions used by the web page. The verification script independently recomputes fold AUROC by counting positive–negative pairs with half credit for ties. It also recalculates probability errors, paired differences and intervals from the exported predictions.

## Experimental design

Four inner folds select hyperparameters by AUROC separately for each model and outer fold. Scaling fits inside each training pipeline. The SVM uses its built-in probability estimation within the fit. Every specimen contributes one prediction per model. AUROC is computed separately in each outer fold and averaged to avoid cross-fold rankings of separately fitted predictors. The pooled Brier score is the mean of squared probability errors. The paired percentile interval uses 1,000 stratified specimen resamples of fixed out-of-fold predictions. It is conditional on those fits.

| Model | Mean fold AUROC | Pooled Brier | Δ Brier vs. logistic (95% interval) |
|---|---:|---:|---:|
| Class-prior baseline | 0.5000 | 0.2338 | +0.2084 [0.1999, 0.2161] |
| Logistic regression | 0.9934 | 0.0254 | Reference |
| k-nearest neighbors | 0.9921 | 0.0306 | +0.0052 [−0.0011, 0.0112] |
| RBF SVM | 0.9958 | 0.0198 | −0.0056 [−0.0108, −0.0006] |
| Random forest | 0.9895 | 0.0348 | +0.0094 [0.0030, 0.0151] |

## Interpretation and defense

The RBF SVM gives the lowest observed Brier score under this protocol. Brier reflects several properties of a probability forecast. Use the reliability plot and bin counts to discuss where predicted and observed positive rates agree.

- Which model would you retain as a baseline if the next study has a different positive-class prevalence?
- Recompute the results for three predetermined outer seeds. Record score ranges and rank changes. The conditional bootstrap interval above covers sampling of fixed predictions. Repeated fitting probes a different source of variation.
- Compare AUROC-based hyperparameter selection against Brier-based selection with the same outer folds. State the direction of your expected change before starting.
- Define one independent validation cohort and specify how a threshold would be chosen without inspecting that cohort. The older repository holdout reused specimens from this dataset and cannot serve as external validation.

Patient-group identifiers are unavailable through the packaged feature matrix. The results support an internal benchmark comparison. These probabilities and thresholds are for research and teaching. [Wolberg, Mangasarian, Street and Street, Wisconsin Diagnostic Breast Cancer, UCI](https://doi.org/10.24432/C5DW2B)
