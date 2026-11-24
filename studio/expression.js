'use strict';
const el=id=>document.getElementById(id);
const selected=new Set(expression.selected);
let page=0, filtered=[];
const pageSize=12;
function row(body,values){
  const tr=body.insertRow();
  for(const value of values) tr.insertCell().textContent=value;
}
function show(){
  const start=page*pageSize, end=Math.min(filtered.length,start+pageSize);
  el('probes').replaceChildren();
  filtered.slice(start,end).forEach(r=>row(el('probes'),r));
  el('count').textContent=filtered.length ? (start+1)+'–'+end+' of '+filtered.length+' probe sets' : 'No matching probes.';
  el('prev').disabled=!page;
  el('next').disabled=end>=filtered.length;
}
function search(){
  const query=el('query').value.trim().toLowerCase();
  filtered=expression.probes.filter(([id,desc],i)=>(!el('panel').checked||selected.has(i))&&(id+' '+desc).toLowerCase().includes(query));
  page=0;show();
}
function download(name,rows){
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  const url=URL.createObjectURL(new Blob([rows.map(r=>r.map(quote).join(',')).join('\n')],{type:'text/csv'}));
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
el('query').oninput=el('panel').onchange=search;
el('prev').onclick=()=>{page--;show();};
el('next').onclick=()=>{page++;show();};
el('export').onclick=()=>download('golub-probes.csv',[['probe','description','train_ALL','train_AML','test_ALL','test_AML'],...filtered]);
for(const m of expression.models)row(el('models'),[m.name,m.auc.toFixed(4),m.ba.toFixed(4),m.cm[0][1],m.cm[1][0]]);
el('predictions').onclick=()=>download('golub-predictions.csv',[['sample','actual_AML','model','predicted_AML','AML_score'],...expression.models.flatMap(m=>expression.ids.map((id,i)=>[id,expression.labels[i],m.name,m.pred[i],m.scores[i]]))]);
search();
