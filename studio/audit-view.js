const panels=document.querySelector('#panels');
const statusLine=document.querySelector('#status');
function add(parent,tag,message){
  const el=document.createElement(tag);
  if(message!==undefined)el.textContent=message;
  parent.append(el);return el;
}
const finite=n=>typeof n==='number'&&Number.isFinite(n);
function show(report){
  panels.replaceChildren();
  if(report.schema!=='evidence-audit/1'||!Array.isArray(report.runs)||!report.runs.length||report.runs.length>2)
    throw Error('Expected an evidence-audit/1 report.');
  for(const run of report.runs){
    const box=add(panels,'article');
    if(run.kind==='mask'){
      if(!Array.isArray(run.rows)||!run.rows.length||!run.rows.every(r=>[r.threshold,r.tp,r.fp,r.fn].every(finite)&&(r.score===null||finite(r.score))))throw Error('Invalid mask scores.');
      add(box,'h2','Segmentation agreement');
      add(box,'p','Change the required overlap and inspect how many objects still match the annotation.');
      const label=add(box,'label','Minimum intersection over union ');
      const select=add(label,'select');
      run.rows.forEach((r,i)=>select.add(new Option(String(r.threshold),String(i))));
      const out=add(box,'output');
      function update(){
        const r=run.rows[Number(select.value)];
        out.textContent='Matched '+r.tp+' · Extra '+r.fp+' · Missed '+r.fn+' · Score '+(r.score===null?'undefined':r.score.toFixed(3));
      }
      select.onchange=update;update();
    }else if(run.kind==='confidence'){
      if(!Array.isArray(run.scores)||!run.scores.length||!run.scores.every(v=>finite(v)&&v>=0&&v<=100)||!finite(run.mean))throw Error('Invalid pLDDT values.');
      add(box,'h2','Residue confidence');
      add(box,'p','Mean pLDDT '+run.mean.toFixed(2)+' across '+run.scores.length+' positions. Inspect a position to see what the mean conceals.');
      const label=add(box,'label','Position (one-based) ');
      const pos=add(label,'input');pos.type='number';pos.min=1;pos.max=run.scores.length;pos.value=1;
      const out=add(box,'output'),bar=add(box,'progress');bar.max=100;
      function update(){const val=run.scores[Number(pos.value)-1];out.textContent=finite(val)?'pLDDT '+val.toFixed(2):'Choose a valid position.';bar.value=val||0}
      pos.oninput=update;update();
    }else throw Error('Unrecognized analysis.');
  }
  statusLine.textContent='Data source: '+report.source;
}
document.querySelector('#input').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{if(f.size>5000000)throw Error('Use a report smaller than 5 MB.');show(JSON.parse(await f.text()))}
  catch(err){panels.replaceChildren();statusLine.textContent=err.message}
};
document.querySelector('#demo').onclick=()=>{document.querySelector('#input').value='';show(window.auditExample)};
show(window.auditExample);
