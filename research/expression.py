"""Build the Golub expression atlas. Pass the directory containing the three upstream CSVs."""
import argparse
import csv
import json
from pathlib import Path
import numpy as np
from sklearn.discriminant_analysis import LinearDiscriminantAnalysis
from sklearn.feature_selection import SelectKBest, f_classif
from sklearn.naive_bayes import GaussianNB
from sklearn.neighbors import NearestCentroid
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import confusion_matrix, roc_auc_score, balanced_accuracy_score

def matrix(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.reader(handle)
        header = next(reader)
        cols = [i for i, name in enumerate(header) if name.isdigit()]
        rows = [r for r in reader if r]
    return ([int(header[i]) for i in cols], [(r[1],r[0]) for r in rows],
            np.array([[float(r[i]) for i in cols] for r in rows]).T)

def main(folder):
    with (folder/"actual.csv").open() as f:
        labels = {int(r["patient"]):int(r["cancer"]=="AML") for r in csv.DictReader(f)}
    ids, genes, train = matrix(folder/"data_set_ALL_AML_train.csv")
    test_ids, test_genes, test = matrix(folder/"data_set_ALL_AML_independent.csv")
    assert genes == test_genes and len(genes)==7129 and len(ids)==38 and len(test_ids)==34
    assert set(ids).isdisjoint(test_ids) and set(ids+test_ids)==set(labels)
    y, yt = [np.array([labels[i] for i in group]) for group in (ids,test_ids)]
    results=[]
    for name,clf in [('Gaussian naive Bayes',GaussianNB()),('Shrinkage LDA',LinearDiscriminantAnalysis(solver='lsqr',shrinkage='auto')),('Nearest centroid',NearestCentroid())]:
        pipe=make_pipeline(SelectKBest(f_classif,k=25),StandardScaler(),clf).fit(train,y)
        pred=pipe.predict(test)
        score=pipe.decision_function(test) if hasattr(pipe,'decision_function') else pipe.predict_proba(test)[:,1]
        results.append(dict(name=name,auc=roc_auc_score(yt,score),ba=balanced_accuracy_score(yt,pred),cm=confusion_matrix(yt,pred).tolist(),pred=pred.tolist(),scores=score.tolist()))
    means=[a[b==c].mean(axis=0) for a,b in [(train,y),(test,yt)] for c in (0,1)]
    probes=[[acc,desc,*[round(float(m[i]),2) for m in means]] for i,(acc,desc) in enumerate(genes)]
    payload=dict(probes=probes,models=results,ids=test_ids,labels=yt.tolist(),selected=pipe[0].get_support(indices=True).tolist())
    out=Path(__file__).resolve().parents[1]/'studio/expression-data.js'
    out.write_text('const expression = '+json.dumps(payload,separators=(',',':'),allow_nan=False)+';\n')
    for m in results:print(m['name'],m['auc'],m['ba'],m['cm'])

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('folder',type=Path)
    main(parser.parse_args().folder)
