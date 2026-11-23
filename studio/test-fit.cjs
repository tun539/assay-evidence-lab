const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {parseAssay,compareCurves}=require('./fit.js');
const input=fs.readFileSync(path.join(__dirname,'../kinetics/puromycin.csv'),'utf8');
const rows=parseAssay(input);
const fits=compareCurves(rows);
const reference=require('../kinetics/fits.json');
for(const [key,ref] of [['shared','shared'],['separate','split_both']]){
  assert.equal(fits[key].predictions.length,23);
  assert.equal(fits[key].folds.length,6);
  assert.ok(Math.abs(fits[key].pooled-reference[ref].rmse)<0.001);
  fits[key].folds.forEach((fold,i)=>assert.ok(Math.abs(Math.sqrt(fold.mse)-reference[ref].fold_rmse[i])<0.001));
  assert.ok(Math.abs(fits[key].balanced-Math.sqrt(fits[key].folds.reduce((s,f)=>s+f.mse,0)/6))<1e-12);
}
assert.throws(()=>parseAssay(input.replace('0.02,76','0.02,NaN')));
assert.throws(()=>parseAssay('conc,rate,state\n1,3,treated'));
console.log('Two model scores and twelve fold errors match the SciPy reference. Invalid inputs rejected.');
