'use strict';
const get = id => document.getElementById(id);
const format = number => number.toFixed(4);
const cell = (row, value) => row.insertCell().textContent = value;
const select = get('model');
for (const m of benchmark.models) {
  select.add(new Option(m.name, m.key));
  const row = get('models').insertRow();
  cell(row, m.name);
  cell(row, format(m.mean_auc));
  cell(row, format(m.brier));
  cell(row, m.key === 'logistic' ? 'Reference' : format(m.delta_brier) + ' [' + m.interval.map(format).join(', ') + ']');
}
select.value = 'logistic';
const axis = '<path d="M48 18 V200 H330" fill="none" stroke="#496b5b"/>';
const label = (x,y,value) => '<text x="'+x+'" y="'+y+'" font-size="12" fill="#274d3e">'+value+'</text>';
const modelIndex = () => select.selectedIndex;
function outcomes(){
  const threshold = Number(get('threshold').value);
  const counts = [0,0,0,0];
  for(const [,y,,...p] of benchmark.rows) counts[2*y+Number(p[modelIndex()]>=threshold)]++;
  const [tn,fp,fn,tp]=counts;
  for(const [id,n] of Object.entries({tn,fp,fn,tp})) get(id).textContent=n;
  get('cutoff').value=threshold.toFixed(2);
  get('rates').textContent='Sensitivity '+(100*tp/(tp+fn)).toFixed(1)+'% · Specificity '+(100*tn/(tn+fp)).toFixed(1)+'%';
}
function render(){
  const model=benchmark.models[modelIndex()];
  const bins=Array.from({length:10},()=>({n:0,sum:0,positive:0}));
  for(const [,y,,...p] of benchmark.rows){
    const score=p[modelIndex()], b=bins[Math.min(9,Math.floor(score*10))];
    b.n++; b.sum+=score; b.positive+=y;
  }
  const body=get('bins');
  body.replaceChildren();
  let plot=axis+'<path d="M48 200 L330 18" stroke="#6b887b" stroke-dasharray="5 4"/>';
  for(const b of bins){
    if(!b.n) continue;
    const mean=b.sum/b.n, observed=b.positive/b.n;
    const row=body.insertRow();
    [format(mean),format(observed),b.n].forEach(value=>cell(row,value));
    const x=48+282*mean, y=200-182*observed;
    plot+='<circle cx="'+x+'" cy="'+y+'" r="4" fill="#16775d"/>'+label(x+6,y-5,b.n);
  }
  get('reliability').innerHTML=plot+label(30,20,'1')+label(30,204,'0')+label(327,218,'1')+label(122,237,'Mean predicted probability');
  get('folds').innerHTML=axis+label(30,20,'1')+label(30,204,'0')+model.fold_auc.map((auc,i)=>{
    const x=63+54*i, y=200-182*auc;
    return '<rect x="'+x+'" y="'+y+'" width="28" height="'+(200-y)+'" fill="#347a60"/>'+label(x-2,y-5,auc.toFixed(3))+label(x+9,218,i+1);
  }).join('')+label(150,237,'Outer fold');
  const settings=get('settings');
  settings.replaceChildren(...model.params.map(params=>{
    const item=document.createElement('li');
    item.textContent=Object.entries(params).map(([key,value])=>key.split('__').at(-1)+' = '+value).join(', ') || 'Class prior estimated from the training fold';
    return item;
  }));
  outcomes();
}
select.onchange=render;
get('threshold').oninput=outcomes;
get('download').onclick=()=>{
  const lines=[['row','malignant','outer_fold',...benchmark.models.map(m=>m.key)],...benchmark.rows];
  const url=URL.createObjectURL(new Blob([lines.map(r=>r.join(',')).join('\n')+'\n'],{type:'text/csv'}));
  const a=document.createElement('a');
  a.href=url;a.download='wdbc-out-of-fold-predictions.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
get('save-evidence').onclick=()=>{
  const model=benchmark.models[modelIndex()];
  const threshold=Number(get('threshold').value);
  const counts=[0,0,0,0];
  for(const [,y,,...p] of benchmark.rows) counts[2*y+Number(p[modelIndex()]>=threshold)]++;
  const [tn,fp,fn,tp]=counts;
  try{
    evidenceRecords.capture({
      kind:'measured',
      title:model.name+' · WDBC nested CV',
      dataset:'UCI Wisconsin Diagnostic Breast Cancer (569 specimens)',
      method:'5×4 nested cross-validation',
      metric:'Pooled Brier score',
      unit:'squared probability error',
      value:Number(model.brier.toFixed(4)),
      source:'https://archive.ics.uci.edu/dataset/17/breast%2Bcancer%2Bwisconsin%2Bdiagnostic',
      details:{
        comparisonKey:'wdbc-569-nested-cv',
        model:model.name,
        meanFoldAuroc:Number(model.mean_auc.toFixed(4)),
        deltaBrierVsLogistic:model.key==='logistic'?0:Number(model.delta_brier.toFixed(4)),
        threshold:Number(threshold.toFixed(2)),
        sensitivity:Number((tp/(tp+fn)).toFixed(4)),
        specificity:Number((tn/(tn+fp)).toFixed(4)),
        confusion:{tn,fp,fn,tp},
      },
    });
    get('save-status').textContent='Saved '+model.name+' (Brier '+model.brier.toFixed(4)+') to the evidence workspace.';
  }catch(error){
    get('save-status').textContent='Could not save the benchmark run. '+error.message;
  }
};
render();
