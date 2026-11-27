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
      evidenceMatrix(box,'Object counts at each overlap threshold · darker means more objects',['IoU','Matched','Extra','Missed'],run.rows.map(r=>[r.tp,r.fp,r.fn]),run.rows.map(r=>r.threshold));
      const label=add(box,'label','Minimum intersection over union ');
      const select=add(label,'select');
      run.rows.forEach((r,i)=>select.add(new Option(String(r.threshold),String(i))));
      const out=add(box,'output');
      function update(){
        const r=run.rows[Number(select.value)];
        out.textContent='Matched '+r.tp+' · Extra '+r.fp+' · Missed '+r.fn+' · Score '+(r.score===null?'undefined':r.score.toFixed(3));
      }
      select.onchange=update;update();
      const saveBtn=add(box,'button','Save threshold score to workspace');saveBtn.type='button';
      saveBtn.onclick=()=>{
        const r=run.rows[Number(select.value)];
        if(r.score===null){statusLine.textContent='Cannot save an undefined match score.';return;}
        try{
          evidenceRecords.capture({
            kind:'simulated',
            title:'Cellpose audit · IoU '+r.threshold,
            dataset:'Prediction audit · '+report.source,
            method:'Cellpose one-to-one instance matching',
            metric:'Object match score TP/(TP+FP+FN)',
            unit:'score (0–1)',
            value:Number(r.score.toFixed(4)),
            source:'studio/audit.html',
            details:{comparisonKey:'audit-mask-'+report.source, threshold:r.threshold, tp:r.tp, fp:r.fp, fn:r.fn},
          });
          statusLine.textContent='Saved Cellpose IoU '+r.threshold+' score ('+r.score.toFixed(3)+') to the evidence workspace.';
        }catch(error){statusLine.textContent='Could not save audit score. '+error.message;}
      };
    }else if(run.kind==='confidence'){
      if(!Array.isArray(run.scores)||!run.scores.length||!run.scores.every(v=>finite(v)&&v>=0&&v<=100)||!finite(run.mean))throw Error('Invalid pLDDT values.');
      add(box,'h2','Residue confidence');
      add(box,'p','Mean pLDDT '+run.mean.toFixed(2)+' across '+run.scores.length+' positions. Inspect a position to see what the mean conceals.');
      const bands=[0,0,0,0];
      for(const score of run.scores)bands[score<50?0:score<70?1:score<90?2:3]++;
      const chart=add(box,'figure');add(chart,'figcaption','How much of the chain falls in each confidence range?');
      ['Below 50','50 to <70','70 to <90','90 to 100'].forEach((band,i)=>{
        const line=add(chart,'div');add(line,'span',band+' · '+bands[i]+' residues ');
        const meter=add(line,'progress');meter.max=run.scores.length;meter.value=bands[i];meter.setAttribute('aria-label',band+' share of chain');
      });
      const label=add(box,'label','Position (one-based) ');
      const pos=add(label,'input');pos.type='number';pos.min=1;pos.max=run.scores.length;pos.value=1;
      const out=add(box,'output'),bar=add(box,'progress');bar.max=100;
      function update(){const val=run.scores[Number(pos.value)-1];out.textContent=finite(val)?'pLDDT '+val.toFixed(2):'Choose a valid position.';bar.value=val||0}
      pos.oninput=update;update();
      const saveBtn=add(box,'button','Save confidence summary to workspace');saveBtn.type='button';
      saveBtn.onclick=()=>{
        const idx=Math.max(1,Math.min(run.scores.length,Number(pos.value)||1));
        const val=run.scores[idx-1];
        try{
          evidenceRecords.capture({
            kind:'simulated',
            title:'AlphaFold confidence · pos '+idx+' (mean '+run.mean.toFixed(1)+')',
            dataset:'Prediction audit · '+report.source,
            method:'AlphaFold pLDDT head evaluation',
            metric:'Mean pLDDT',
            unit:'pLDDT (0–100)',
            value:Number(run.mean.toFixed(2)),
            source:'studio/audit.html',
            details:{comparisonKey:'audit-plddt-'+report.source, residues:run.scores.length, inspectedPosition:idx, inspectedPlddt:Number(val.toFixed(2)), below50:bands[0], between50And70:bands[1], between70And90:bands[2], above90:bands[3]},
          });
          statusLine.textContent='Saved AlphaFold confidence audit (mean pLDDT '+run.mean.toFixed(2)+') to the evidence workspace.';
        }catch(error){statusLine.textContent='Could not save confidence audit. '+error.message;}
      };
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
