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
const panelProbes=expression.selected.map(i=>expression.probes[i]);
const difference=r=>[r[3]-r[2],r[5]-r[4]];
for(const [i,r] of panelProbes.entries())el('compareProbe').add(new Option(r[0]+' · '+r[1],i));
function compareProbe(){
  const probe=panelProbes[Number(el('compareProbe').value)],delta=difference(probe);
  el('probeStory').textContent=probe[1]+'. '+(delta.includes(0)?'One cohort has equal group means.':Math.sign(delta[0])===Math.sign(delta[1])?'Both cohorts show the same direction.':'The difference reverses direction in the test cohort.');
  el('cohortMap').replaceChildren();
  evidenceMatrix(el('cohortMap'),'Difference in original intensity units',['Probe','Training','Test'],[delta],[probe[0]],true);
}
el('compareProbe').onchange=compareProbe;compareProbe();
el('save-evidence').onclick=()=>{
  const probe=panelProbes[Number(el('compareProbe').value)],delta=difference(probe);
  try{
    evidenceRecords.capture({
      kind:'measured',
      title:probe[0]+' · Golub test contrast',
      dataset:'Golub ALL/AML microarray (38 train, 34 test)',
      method:'Cohort mean intensity difference (AML minus ALL)',
      metric:'Test-cohort contrast',
      unit:'intensity units',
      value:Number(delta[1].toFixed(2)),
      source:'https://doi.org/10.1126/science.286.5439.531',
      details:{
        comparisonKey:'golub-probe-contrast',
        probeId:probe[0],
        description:probe[1],
        trainAllMean:probe[2],
        trainAmlMean:probe[3],
        testAllMean:probe[4],
        testAmlMean:probe[5],
        trainContrast:Number(delta[0].toFixed(2)),
        testContrast:Number(delta[1].toFixed(2)),
        sameDirection:Math.sign(delta[0])===Math.sign(delta[1]),
      },
    });
    el('save-status').textContent='Saved probe '+probe[0]+' to the evidence workspace.';
  }catch(error){
    el('save-status').textContent='Could not save the probe contrast. '+error.message;
  }
};
evidenceMatrix(el('panelMap'),'Shared scale across the full selected panel',['Probe','Training','Test'],panelProbes.map(difference),panelProbes.map(r=>r[0]),true);
