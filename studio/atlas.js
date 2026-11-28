'use strict';

const stations = [
 {id:'tomography', name:'Inside the specimen', short:'Tomography', task:'Hold the protein and iteration count fixed. Compare 4 and 48 projections, then restrict the scan to 90°.', question:'What does the reconstruction RMSE compare?', options:['The reconstructed slice and its simulated reference','AlphaFold predictions and an experimental microscope image'], correct:0, reason:'The reference density is generated from a model. The error quantifies reconstruction under the simulated scan.'},
 {id:'transport', name:'Molecular transport in 3D', short:'Transport', task:'Run a transport preset and compare moving tracers with its theoretical diagnostic. Change one parameter at a time.', question:'Which comparison tests the transport model?', options:['Whether the tracers share a color','Whether a measured ensemble statistic follows the theoretical prediction'],correct:1,reason:'Use the reported statistic, its units, and the model assumptions to interpret the trajectory.'},
 {id:'expression', name:'Gene expression atlas', short:'Expression', task:'Choose a training-selected probe and compare the AML–ALL intensity contrast in the two cohorts.', question:'What keeps test labels from shaping probe selection?', options:['Selecting probes using only the training cohort','Selecting probes that rank highly across both cohorts'],correct:0,reason:'Training-only selection protects the held-out comparison from feature-selection leakage.'},
 {id:'research', name:'Research benchmark', short:'Benchmark', task:'Compare two classifiers and move the decision threshold. Watch how their classification errors change.', question:'What changes when a threshold moves but prediction scores stay fixed?', options:['Ranking and AUROC','Confusion counts at that threshold'],correct:1,reason:'Thresholds change calls made from the same ranked scores.'},
 {id:'practical', name:'Enzyme kinetics practical', short:'Kinetics', task:'Compare the shared curve and separate plateaus. Export held-out predictions and identify one concentration where the models differ.', question:'Which split protects the concentration holdout?', options:['Remove every measurement at that concentration in both conditions','Remove one replicate and keep its same-concentration neighbors'],correct:0,reason:'Holding out the whole concentration tests prediction without measurements at that level.'},
 {id:'audit', name:'Cellpose and AlphaFold audit', short:'Prediction audit', task:'Open the teaching report. Raise the overlap threshold and compare the object matches with the residue confidence distribution.', question:'Which number measures segmentation agreement?', options:['Mean residue pLDDT','The object match score at the selected overlap threshold'],correct:1,reason:'The two scores refer to different tasks. pLDDT describes predicted local structure confidence.'},
 {id:'structure', name:'3D Molecular & Gene Structure Studio', short:'3D Studio', task:'Inspect PDB 8AW3 (Protein–RNA–2×Zn²⁺) or one of ten AlphaFold DB v6 gene folds, check PAE/pLDDT confidence, and measure a Cα distance.', question:'What does a short distance between alpha carbons establish?', options:['Geometric proximity in the displayed coordinates','An experimentally confirmed chemical bond'],correct:0,reason:'Chemical bonding requires atom-level evidence and context beyond an alpha-carbon distance.'},
 {id:'dna', name:'3D Gene & DNA Lab (10 genes)', short:'3D DNA', task:'Explore ten KEGG coding genes in shaded 3D double-helix geometry, jump from a codon to its folded protein residue, and assemble two reads.', question:'How do you write the complementary strand in the same 5′ to 3′ direction?', options:['Complement each base and preserve the order','Complement each base and reverse the order'],correct:1,reason:'The two strands are antiparallel. Reverse the order to express both in the same reading direction.'},
 {id:'simulation', name:'Simulation & ML Force-Field Workbench', short:'Simulation', task:'Fit a MACE or RBF-GP force field on a narrow interval, push starting displacement into the OOD regime to inspect symplectic drift, or compare Langevin MD vs BioEmu ensembles on Track B.', question:'Which result tests extrapolation?', options:['Error along a trajectory outside the fitted displacement interval','Error evaluated only on the fitted points'],correct:0,reason:'An out-of-range trajectory tests whether the learned force law remains useful beyond training.'},
];
const get = id => document.getElementById(id);
const cvs = get('atlas-map'), ctx = cvs.getContext('2d');
const progressKey = 'assay-studio-missions-v1';
let completed = new Set();
try {completed = new Set(JSON.parse(localStorage.getItem(progressKey)||'[]').filter(id=>stations.some(s=>s.id===id)));} catch {}
let active = Math.max(0,stations.findIndex(s=>s.id===location.hash.slice(1)));
let yaw=.28, pitch=.46, drag=null, spinId=0, lastTime=0, hits=[];
const palette=['#91dbcb','#efc182','#b2a9ec'];

function renderMap(){
 const background=ctx.createRadialGradient(415,268,20,415,268,510);
 background.addColorStop(0,'#20494e');background.addColorStop(1,'#071d28');
 ctx.fillStyle=background;ctx.fillRect(0,0,820,550);
 function project(x,y,z){
   const u=x*Math.cos(yaw)-z*Math.sin(yaw), d=x*Math.sin(yaw)+z*Math.cos(yaw);
   const v=y*Math.cos(pitch)-d*Math.sin(pitch), depth=y*Math.sin(pitch)+d*Math.cos(pitch);
   const scale=610/(610-depth);
   return {x:410+u*scale,y:270-v*scale,depth,scale};
 }
 function line(a,b,color,width=1){
   ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.lineWidth=width;ctx.strokeStyle=color;ctx.stroke();
 }
 for(let i=-225;i<=225;i+=45){
   line(project(i,-108,-225),project(i,-108,225),'#34565a');
   line(project(-225,-108,i),project(225,-108,i),'#34565a');
 }
 const core=project(0,0,0);
 const nodes=stations.map((_,i)=>{
   const a=i*2*Math.PI/9, x=212*Math.sin(a),z=212*Math.cos(a),y=(i%3-1)*71;
   return {i,...project(x,y,z),ground:project(x,-108,z)};
 }).sort((a,b)=>a.depth-b.depth);
 nodes.forEach(n=>{line(n,n.ground,'#476b6d');line(core,n,n.i===active?'#a5e6cc':'#42696d',n.i===active?2.5:1);});
 ctx.beginPath();ctx.arc(core.x,core.y,24,0,Math.PI*2);ctx.fillStyle='#285658';ctx.fill();
 ctx.font='bold 11px system-ui';ctx.textAlign='center';ctx.fillStyle='#c6e8dd';ctx.fillText('STUDIO',core.x,core.y+4);
 hits=[];
 for(const n of nodes){
   const r=17*n.scale, color=palette[n.i%3];
   const light=ctx.createRadialGradient(n.x-r*.3,n.y-r*.35,1,n.x,n.y,r);
   light.addColorStop(0,'#effcf3');light.addColorStop(.43,color);light.addColorStop(1,'#365961');
   ctx.fillStyle=light;ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);ctx.fill();
   if(n.i===active){ctx.strokeStyle='#f4deb1';ctx.lineWidth=2;ctx.beginPath();ctx.arc(n.x,n.y,r+5,0,Math.PI*2);ctx.stroke();}
   ctx.font=(n.i===active?'bold ':'')+'15px system-ui';
   const label=stations[n.i].short, w=ctx.measureText(label).width;
   ctx.fillStyle='#0a2330';ctx.fillRect(n.x-w/2-5,n.y+r+3,w+10,21);
   ctx.fillStyle='#eef9f3';ctx.fillText(label,n.x,n.y+r+18);
   hits.push({...n,r:Math.max(r,21)});
 }
}
function select(index){
 active=index;
 const s=stations[index];
 history.replaceState(null,'','#'+s.id);
 get('station-title').textContent=s.name;
 get('objective').textContent=s.task;
 get('launch').href=s.id+'.html';
 get('question').textContent=s.question;
 get('choices').replaceChildren(...s.options.map((option,i)=>{
   const label=document.createElement('label'),radio=document.createElement('input');
   radio.type='radio';radio.name='response';radio.value=i;radio.required=true;
   label.append(radio,option);return label;
 }));
 get('answer').textContent='';
 updateProgress();
 renderMap();
}
function updateProgress(){
 get('progress-meter').value=completed.size;
 get('progress').textContent=completed.size+' of '+stations.length+' checkpoints completed';
 const resetBtn=get('reset-progress');
 if(resetBtn) resetBtn.disabled=completed.size===0;
 const summary=get('workspace-summary');
 if(summary && typeof evidenceRecords!=='undefined'){
   const saved=evidenceRecords.count();
   summary.textContent=saved
     ? saved+' evidence '+(saved===1?'record':'records')+' saved in this browser workspace.'
     : 'Tip: save results from any mission lab to build a reviewable Evidence Workspace packet.';
 }
 Array.from(get('stations').children).forEach((b,i)=>{
   b.textContent=stations[i].short+(completed.has(stations[i].id)?' ✓':'');
   b.setAttribute('aria-pressed',String(active===i));
 });
}
const resetBtn=get('reset-progress');
if(resetBtn){
 resetBtn.onclick=()=>{
   if(!confirm('Reset all completed mission checkpoints in this browser?'))return;
   completed.clear();
   try{localStorage.removeItem(progressKey);}catch{}
   get('answer').textContent='Checkpoint progress reset.';
   updateProgress();
 };
}
window.addEventListener('assay-evidence-change', updateProgress);
window.addEventListener('storage', updateProgress);
get('challenge').onsubmit=e=>{
 e.preventDefault();
 const selected=get('choices').querySelector('input:checked');
 if(!selected)return;
 const s=stations[active], correct=Number(selected.value)===s.correct;
 get('answer').textContent=(correct?'Correct. ':'Try again. ')+s.reason;
 if(correct){
   completed.add(s.id);
   try {localStorage.setItem(progressKey,JSON.stringify([...completed]));}catch{}
   updateProgress();
 }
};
for(const [i,s] of stations.entries()){
 const b=document.createElement('button');b.type='button';b.textContent=s.short;b.onclick=()=>select(i);get('stations').append(b);
}
function animate(now){
 yaw+=Math.min(40,now-lastTime)*.00035;lastTime=now;renderMap();spinId=requestAnimationFrame(animate);
}
get('spin').onclick=()=>{
 if(spinId){cancelAnimationFrame(spinId);spinId=0;}
 else {lastTime=performance.now();spinId=requestAnimationFrame(animate);}
 get('spin').setAttribute('aria-pressed',String(Boolean(spinId)));
};
get('home-view').onclick=()=>{yaw=.28;pitch=.46;renderMap();};
cvs.onpointerdown=e=>{drag={x:e.clientX,y:e.clientY,moved:0};cvs.setPointerCapture(e.pointerId);};
cvs.onpointermove=e=>{
 if(!drag)return;
 const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
 drag={x:e.clientX,y:e.clientY,moved:drag.moved+Math.hypot(dx,dy)};
 yaw+=dx*.009;pitch=Math.max(-1.25,Math.min(1.25,pitch+dy*.009));renderMap();
};
cvs.onpointerup=e=>{
 if(drag&&drag.moved<6){
   const r=cvs.getBoundingClientRect();
   const x=(e.clientX-r.left)*820/r.width,y=(e.clientY-r.top)*550/r.height;
   const hit=hits.slice().reverse().find(n=>Math.hypot(n.x-x,n.y-y)<n.r);
   if(hit)select(hit.i);
 }
 drag=null;
};
cvs.onlostpointercapture=()=>{drag=null;};
cvs.onkeydown=e=>{
 const moves={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,.15],ArrowDown:[0,-.15]};
 const m=moves[e.key];if(!m)return;e.preventDefault();yaw+=m[0];pitch=Math.max(-1.25,Math.min(1.25,pitch+m[1]));renderMap();
};
const modelMetrics=molecularData.metrics;
for(const [title,summary] of [
 ['Classical ML','Random forest · Vmax MAE '+modelMetrics['Random forest'][0].toFixed(2)+' counts/min/min'],
 ['Deep learning','PyTorch MLP · Vmax MAE '+modelMetrics['PyTorch MLP'][0].toFixed(2)+' counts/min/min'],
 ['Reinforcement learning','Learned second-dose policy · '+(100*molecularData.policies['Learned policy']).toFixed(2)+'% family accuracy'],
]){
 const tile=document.createElement('article'),h=document.createElement('h3'),p=document.createElement('p');
 h.textContent=title;p.textContent=summary;tile.append(h,p);get('tracks').append(tile);
}
if (location.protocol==='file:' || ['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
 const download=get('download-studio');
 download.href='https://github.com/tun539/assay-evidence-lab/archive/refs/heads/main.zip';
 download.removeAttribute('download');
 download.textContent='Get the complete source ZIP';
}
select(active);
