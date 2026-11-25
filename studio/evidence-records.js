'use strict';

const evidenceRecords = (() => {
 const key = 'assay-evidence-records-v1';
 const kinds = ['measured', 'simulated'];
 const fields = ['title', 'dataset', 'metric', 'unit', 'method', 'source'];
 const validRun = run => run && typeof run.id==='string' && /^[\w.-]{1,100}$/.test(run.id)
   && kinds.includes(run.kind) && fields.every(field => typeof run[field]==='string' && run[field].length<=500)
   && Number.isFinite(run.value) && Number.isFinite(Date.parse(run.savedAt))
   && run.details && typeof run.details==='object' && !Array.isArray(run.details);

 function read() {
   const raw = localStorage.getItem(key);
   if (!raw) return [];
   const runs = JSON.parse(raw);
   if (!Array.isArray(runs) || !runs.every(validRun)) throw Error('Saved records could not be read.');
   return runs;
 }
 function replace(runs) {
   if (runs.length>100 || new Set(runs.map(run=>run.id)).size!==runs.length || !runs.every(validRun)) {
     throw Error('Expected up to 100 valid and distinct evidence records.');
   }
   const data=JSON.stringify(runs);
   if(data.length>1_000_000) throw Error('The workspace is full. Export your records before clearing space.');
   localStorage.setItem(key,data);
 }
 function capture(run) {
   const now=new Date();
   const id=globalThis.crypto?.randomUUID?.() || now.getTime()+'-'+Math.random().toString(36).slice(2);
   replace([...read(),{...run,id,savedAt:now.toISOString()}]);
 }
 function merge(packet) {
   if(packet?.schema!=='assay-evidence/1' || !Array.isArray(packet.runs) || packet.runs.length>100
     || !packet.runs.every(validRun) || new Set(packet.runs.map(run=>run.id)).size!==packet.runs.length) throw Error('Invalid evidence packet.');
   const existing=read(), ids=new Set(existing.map(run=>run.id));
   const added=packet.runs.filter(run=>!ids.has(run.id));
   replace([...existing,...added]);
   return added.length;
 }
 return {read,capture,merge,remove(id){replace(read().filter(run=>run.id!==id));}};
})();
