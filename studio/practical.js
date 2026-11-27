'use strict';
const byId = id => document.getElementById(id);
const value = id => byId(id).value.trim();
let record;
function resetResult(){
  record = null;
  byId('result').hidden = true;
  byId('feedback').textContent = '';
}
function example(){
  resetResult();
  byId('csv').value = ['conc,rate,state', ...window.assayResults.rows.map(r => [r.conc,r.rate,r.state].join(','))].join('\n');
  byId('origin').value = 'R datasets / Puromycin · Treloar (1974)';
  byId('xu').value = 'ppm';
  byId('yu').value = 'counts/min/min';
  byId('file').value = '';
}
function showTask(){
  byId('task').textContent = value('track')==='ug'
    ? 'Predict whether the two preparations share a curve. Fit both models, read one fold and use its units to explain a prediction error.'
    : 'Compare observation-weighted and concentration-weighted errors. Independently reproduce one fold from the exported predictions, then propose a replication design that separates treatment from run.';
}
function addTableRow(id,items){
  const row = byId(id).insertRow();
  for(const item of items) row.insertCell().textContent = item;
}
function download(name,content,type){
  const url = URL.createObjectURL(new Blob([content],{type}));
  const link = document.createElement('a');
  link.href=url; link.download=name; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
byId('example').onclick=example;
byId('track').onchange=()=>{resetResult();showTask()};
for(const id of ['csv','origin','xu','yu','hyp']) byId(id).addEventListener('input',resetResult);
byId('file').onchange=async()=>{
  const file=byId('file').files[0];
  if(!file)return;
  resetResult();
  if(file.size>250000){byId('feedback').textContent='Choose a plain CSV smaller than 250 KB.';return}
  try{
    const content=await file.text();
    if(byId('file').files[0]!==file)return;
    byId('csv').value=content;
    byId('origin').value=file.name;
    byId('xu').value='';byId('yu').value='';
  }catch{byId('feedback').textContent='Could not read the selected file.'}
};
byId('run').onclick=()=>{
  resetResult();
  try{
    if(['origin','xu','yu'].some(id=>!value(id)))throw Error('Record a source and both measurement units.');
    const rows=parseAssay(value('csv')), fits=compareCurves(rows);
    record={schema:'assay-practical/1',created:new Date().toISOString(),track:value('track'),
      hypothesis:value('hyp'),source:value('origin'),concentrationUnit:value('xu'),rateUnit:value('yu'),
      method:'Positive Michaelis–Menten nonlinear least squares; leave one concentration out in both states',rows,fits};
    for(const id of ['scores','folds']) byId(id).replaceChildren();
    for(const [key,f] of Object.entries(fits))addTableRow('scores',[key,f.pooled.toFixed(3),f.balanced.toFixed(3)]);
    fits.shared.folds.forEach((f,i)=>addTableRow('folds',[f.conc,f.n,Math.sqrt(f.mse).toFixed(3),Math.sqrt(fits.separate.folds[i].mse).toFixed(3)]));
    byId('params').textContent=Object.entries(fits).flatMap(([model,f])=>Object.entries(f.params).map(([state,p])=>
      model+' / '+state+'   Vmax = '+p.vmax.toPrecision(5)+' '+value('yu')+'   Km = '+p.km.toPrecision(5)+' '+value('xu'))).join('\n');
    byId('info').textContent=rows.length+' observations · '+fits.shared.folds.length+' concentration folds. Smaller RMSE indicates closer predictions. Both columns use '+value('yu')+'.';
    byId('warn').textContent=Object.values(fits).some(f=>f.boundary)?'A fit reached the Km search boundary. Interpret its parameters as weakly constrained.':'Apparent Km is the concentration at half the fitted plateau. The assay alone cannot establish equilibrium binding affinity.';
    byId('rubric').textContent=value('track')==='ug'?'Give both model scores and their units. Explain why all repeats at a concentration were held out together. Identify the experimental unit.':'Average squared residuals within each held concentration, then take the square root of their equally weighted mean. Compare rankings. Discuss endpoint extrapolation, preparation effects and the independent data needed for validation.';
    byId('result').hidden=false;
    byId('feedback').textContent='Fit complete. Review the fold errors and record your interpretation below.';
  }catch(error){byId('feedback').textContent=error.message}
};
byId('save').onclick=()=>{if(record)download('assay-lab-record.json',JSON.stringify({...record,interpretation:value('answer')},null,2),'application/json')};
byId('pred').onclick=()=>{
  if(!record)return;
  const lines=['model,held_concentration,state,observed_rate,predicted_rate'];
  for(const [model,fit] of Object.entries(record.fits))for(const p of fit.predictions)
    lines.push([model,p.conc,p.state,p.rate,p.prediction].join(','));
  download('held-out-predictions.csv',lines.join('\n')+'\n','text/csv');
};
byId('save-evidence').onclick=()=>{
  if(!record)return;
  try{
    const shared=record.fits.shared, separate=record.fits.separate;
    evidenceRecords.capture({
      kind:'measured',
      title:'Practical fit · '+record.source.slice(0,80),
      dataset:record.source,
      method:record.method,
      metric:'Separate-curves pooled RMSE',
      unit:record.rateUnit,
      value:Number(separate.pooled.toFixed(3)),
      source:'studio/practical.html',
      details:{
        comparisonKey:'practical-'+record.source+'-'+record.rateUnit,
        track:record.track,
        observations:record.rows.length,
        concentrationFolds:shared.folds.length,
        concentrationUnit:record.concentrationUnit,
        sharedPooledRmse:Number(shared.pooled.toFixed(3)),
        sharedBalancedRmse:Number(shared.balanced.toFixed(3)),
        separatePooledRmse:Number(separate.pooled.toFixed(3)),
        separateBalancedRmse:Number(separate.balanced.toFixed(3)),
        hypothesis:record.hypothesis||undefined,
        interpretation:value('answer')||undefined,
      },
    });
    byId('save-status').textContent='Saved fitted practical results to the evidence workspace.';
  }catch(error){
    byId('save-status').textContent='Could not save the practical run. '+error.message;
  }
};
example();showTask();
