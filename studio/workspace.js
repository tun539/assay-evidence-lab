'use strict';

const get = id => document.getElementById(id);
const selected = new Set();
const add = (parent, tag, content) => {
 const element=document.createElement(tag);
 if(content!==undefined)element.textContent=content;
 parent.append(element);
 return element;
};
const format = value => new Intl.NumberFormat('en',{maximumFractionDigits:3,minimumFractionDigits:0}).format(value);
let runs=[];

function compare() {
 const [a,b]=[...selected].map(id=>runs.find(run=>run.id===id));
 const target=get('compare');
 if(!a||!b){target.textContent='Select two records to compare.';return;}
 const comparable=a.kind===b.kind && a.dataset===b.dataset && a.metric===b.metric && a.unit===b.unit
   && a.details.comparisonKey && a.details.comparisonKey===b.details.comparisonKey;
 target.textContent=comparable
   ? b.title+' minus '+a.title+' · '+format(b.value-a.value)+' '+a.unit
   : 'These runs differ in dataset, evidence type, metric, or comparison conditions. Inspect their details side by side.';
}
function render() {
 try{runs=evidenceRecords.read();}
 catch(error){get('status').textContent=error.message;return;}
 const list=get('records');
 list.replaceChildren();
 get('count').textContent=runs.length ? runs.length+' records · select two to compare' : 'No runs saved yet.';
 for(const run of runs.slice().reverse()){
   const card=add(list,'article');
   add(card,'div',run.kind==='measured'?'Measured assay':'Simulated assay').className='kind';
   add(card,'h3',run.title);
   add(card,'div',format(run.value)+' '+run.unit).className='metric';
   add(card,'p',run.metric+' · '+run.method);
   add(card,'p',run.dataset+' · '+new Date(run.savedAt).toLocaleString());
   const label=add(card,'label');
   const box=add(label,'input');box.type='checkbox';box.checked=selected.has(run.id);
   label.append(' Compare this run');
   box.onchange=()=>{
     if(box.checked && selected.size===2){box.checked=false;get('status').textContent='Clear one selection before choosing another.';return;}
     if(box.checked)selected.add(run.id);else selected.delete(run.id);
     get('status').textContent='';
     compare();
   };
   const detail=add(card,'details');add(detail,'summary','Inspect settings and observations');
   add(detail,'p',run.source);
   add(detail,'pre',JSON.stringify(run.details,null,2));
   const remove=add(card,'button','Remove record');
   remove.onclick=()=>{
     if(!confirm('Remove this record from this browser?'))return;
     try{evidenceRecords.remove(run.id);selected.delete(run.id);render();}
     catch(error){get('status').textContent=error.message;}
   };
 }
 get('export').disabled=!runs.length;
 compare();
}
get('export').onclick=()=>{
 const packet={schema:'assay-evidence/1',exportedAt:new Date().toISOString(),note:get('note').value,runs:evidenceRecords.read()};
 const url=URL.createObjectURL(new Blob([JSON.stringify(packet,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='assay-evidence-packet.json';link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
};
get('import').onchange=async e=>{
 const file=e.target.files[0];
 if(!file)return;
 try{
   if(file.size>1_100_000)throw Error('Choose an evidence packet smaller than 1.1 MB.');
   const packet=JSON.parse(await file.text()), added=evidenceRecords.merge(packet);
   if(!get('note').value && typeof packet.note==='string')get('note').value=packet.note.slice(0,2000);
   render();
   get('status').textContent=added+' records imported. Existing records were kept.';
 }catch(error){get('status').textContent=error.message;}
 finally{e.target.value='';}
};
window.addEventListener('storage',()=>{selected.clear();render();});
render();
