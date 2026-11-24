'use strict';
const proteins=[...new Set(surveyRows.map(r=>r.id))];
const counts=[4,8,24,48];
const errors=surveyRows.map(r=>r.error);
const low=Math.min(...errors), high=Math.max(...errors);
const gene=id=>surveyRows.find(r=>r.id===id).gene;
for(const id of proteins)get('hold').add(new Option(gene(id),id));
function renderSurvey(){
  const span=Number(get('surveySpan').value);
  const rows=surveyRows.filter(r=>r.span===span);
  const heat=get('heat');
  heat.innerHTML='<caption>Density RMSE by projection count · '+span+'°</caption><tr><th>Gene</th>'+counts.map(n=>'<th scope="col">'+n+' views</th>').join('')+'</tr>';
  for(const id of proteins){
    const tr=heat.insertRow();
    tr.innerHTML='<th scope="row">'+gene(id)+'</th>';
    for(const r of rows.filter(row=>row.id===id)){
      const b=document.createElement('button');
      const t=(r.error-low)/(high-low);
      const light=94-66*t;
      b.style.background='hsl(161 34% '+light+'%)';
      b.style.color=light<51?'white':'#102e29';
      b.textContent=r.error.toFixed(4);
      b.setAttribute('aria-label',gene(id)+', '+r.angles+' views, RMSE '+b.textContent+'. Open experiment');
      b.onclick=()=>{
        get('specimen').value=id;get('angles').value=r.angles;get('limited').checked=span===90;
        get('steps').value=20;choose();get('specimen').focus();get('specimen').scrollIntoView({block:'center'});
      };
      tr.insertCell().append(b);
    }
  }
  const delta=id=>rows.find(r=>r.id===id&&r.angles===4).error-rows.find(r=>r.id===id&&r.angles===48).error;
  const best=proteins.reduce((a,b)=>delta(a)>delta(b)?a:b);
  get('finding').textContent='Across these five slices, '+gene(best)+' shows the largest absolute error reduction from 4 to 48 views at '+span+'° ('+delta(best).toFixed(4)+' RMSE units).';
  clearEvaluation();
}
function clearEvaluation(){get('evaluation').textContent='Ready to train for the selected conditions.';}
function evaluateSurvey(){
  const held=get('hold').value, span=Number(get('surveySpan').value);
  const training=surveyRows.filter(r=>r.id!==held&&r.span===span);
  const test=surveyRows.filter(r=>r.id===held&&r.span===span);
  let total=0;
  const cells=test.map(target=>{
    const candidates=training.filter(r=>r.angles===target.angles);
    const closest=candidates.reduce((a,b)=>Math.abs(a.mean-target.mean)<Math.abs(b.mean-target.mean)?a:b);
    const prediction=get('learner').value==='neighbor'?closest.error:candidates.reduce((s,r)=>s+r.error,0)/candidates.length;
    total+=Math.abs(prediction-target.error);
    return '<tr><td>'+target.angles+'</td><td>'+prediction.toFixed(4)+'</td><td>'+target.error.toFixed(4)+'</td></tr>';
  });
  get('evaluation').innerHTML='<p>Trained on 16 runs. Mean absolute prediction error across the four '+gene(held)+' runs: <strong>'+(total/test.length).toFixed(4)+'</strong>.</p><table><tr><th>Views</th><th>Predicted RMSE</th><th>Simulated RMSE</th></tr>'+cells.join('')+'</table>';
}
get('train').onclick=evaluateSurvey;
get('hold').onchange=get('learner').onchange=clearEvaluation;
get('surveySpan').onchange=renderSurvey;
get('surveyExport').onclick=()=>{
  const csv=['accession,gene,span_degrees,angles,mean_reference_density,density_rmse,z,passes',...surveyRows.map(r=>[r.id,r.gene,r.span,r.angles,r.mean,r.error,0,20].join(','))].join('\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const link=document.createElement('a');link.href=url;link.download='protein-scan-survey.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
renderSurvey();
