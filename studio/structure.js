'use strict';
const el = id => document.getElementById(id);
const scene = el('view');
const map = el('map');
const ctx = map.getContext('2d');
let size, coord, center, rows, active;
const original = Object.fromEntries(['heading','intro','legend','lesson','provenance'].map(id=>[id,el(id).innerHTML]));
const picker = el('protein');
picker.add(new Option('Human ubiquitin · experimental reference','1UBQ'));
dnaRecords.forEach((record,i)=>picker.add(new Option(record.species+' · '+record.gene,foldIds[i])));
for(const [id,m] of Object.entries(experimental)) picker.add(new Option(m.name+' · PDB '+id,id));
let scaleFactor = 9;


const dist = (i,j) => Math.hypot(...coord[i].map((v,k) => v-coord[j][k]));
const label = i => rows[i][0]+' '+rows[i][1];
let yaw = -0.4, pitch = 0.3;

const pair = () => [Number(el('a').value),Number(el('b').value)];
function draw(){
  const [a,b] = pair();
  const scale = scaleFactor*Number(el('zoom').value);
  const points = coord.map(p => {
    const [x,y,z] = p.map((v,k) => v-center[k]);
    const depth = z*Math.cos(yaw)-x*Math.sin(yaw);
    return {x:280+scale*(x*Math.cos(yaw)+z*Math.sin(yaw)),y:220-scale*(y*Math.cos(pitch)-depth*Math.sin(pitch)),z:y*Math.sin(pitch)+depth*Math.cos(pitch)};
  });
  const parts = [];
  points.forEach((p,i) => {
    const color = 'rgb('+[0,1,2].map(k=>Math.round([80,202,197][k]+([250,198,91][k]-[80,202,197][k])*i/(size-1))).join(',')+')';
    const q = points[i-1];
    if(q && rows[i][1]===rows[i-1][1]+1) parts.push([(p.z+q.z)/2,'<line x1="'+q.x+'" y1="'+q.y+'" x2="'+p.x+'" y2="'+p.y+'" stroke="'+color+'" stroke-width="4"/>']);
    parts.push([p.z,'<circle cx="'+p.x+'" cy="'+p.y+'" r="4.6" fill="'+color+'"/>']);
  });
  const line = '<line x1="'+points[a].x+'" y1="'+points[a].y+'" x2="'+points[b].x+'" y2="'+points[b].y+'" stroke="white" stroke-dasharray="5 4"/>';
  const marks = [...new Set([a,b])].map(i=>'<circle cx="'+points[i].x+'" cy="'+points[i].y+'" r="8" stroke="white" stroke-width="2" fill="none"/><text x="'+(points[i].x+10)+'" y="'+(points[i].y-8)+'" fill="white" stroke="#112d32" stroke-width="3" paint-order="stroke" font-size="14">'+label(i)+'</text>');
  scene.innerHTML = parts.sort((p,q)=>p[0]-q[0]).map(p=>p[1]).join('')+line+marks.join('');
}
function update(){
  const [a,b] = pair();
  el('reading').textContent = dist(a,b).toFixed(2)+' Å';
  el('gap').textContent = 'Sequence separation: '+Math.abs(rows[a][1]-rows[b][1])+' positions.';
  const neighbors=contacts.filter(([i,j])=>i===a||j===a).map(([i,j,d])=>[i===a?j:i,d]).sort((x,y)=>x[1]-y[1]);
  el('neighbors').replaceChildren(...neighbors.map(([j,d])=>new Option(label(j)+' · '+d.toFixed(2)+' Å',j)));
  el('inspect').disabled=!neighbors.length;
  if(!neighbors.length)el('neighbors').add(new Option('No qualifying contacts',''));
  ctx.drawImage(base,0,0);
  ctx.strokeStyle='#d54f20';ctx.lineWidth=2;ctx.strokeRect(3*a-2,3*b-2,7,7);
  draw();
}
const base = document.createElement('canvas');
let degrees=[], contacts=[], farthest, rg;
function buildMap(){
base.width=base.height=map.width=map.height=3*size;
const raster=base.getContext('2d');
const cutoff=Number(el('cut').value), separation=Number(el('sep').value);
degrees=Array(size).fill(0);contacts=[];farthest=[0,0,0];
raster.fillStyle='#e7efe7';raster.fillRect(0,0,base.width,base.height);
raster.fillStyle='#216960';
for(let i=0;i<size;i++){
  if(!separation)raster.fillRect(3*i,3*i,3,3);
  for(let j=i+1;j<size;j++){
    const d=dist(i,j);
    if(d>farthest[2])farthest=[i,j,d];
    if(d>cutoff || rows[j][1]-rows[i][1]<separation)continue;
    contacts.push([i,j,d]);degrees[i]++;degrees[j]++;
    raster.fillRect(3*i,3*j,3,3);raster.fillRect(3*j,3*i,3,3);
  }
}
rg=Math.sqrt(coord.reduce((sum,p)=>sum+p.reduce((v,n,k)=>v+(n-center[k])**2,0),0)/size);
el('geometry').textContent='Cα radius of gyration (equal bead weights): '+rg.toFixed(2)+' Å · Maximum Cα separation: '+farthest[2].toFixed(2)+' Å.';
const order=contacts.reduce((sum,[i,j])=>sum+rows[j][1]-rows[i][1],0)/(contacts.length*(rows[size-1][1]-rows[0][1]+1));
el('network').textContent=contacts.length+' unique contacts · Mean degree '+(2*contacts.length/size).toFixed(2)+' · Relative contact order '+(contacts.length?order.toFixed(3):'undefined (no contacts)')+'.';
const peak=Math.max(1,...degrees),width=550/size;
el('profile').innerHTML=degrees.map((n,i)=>'<rect fill="#28694e" x="'+(5+i*width)+'" y="'+(96-90*n/peak)+'" width="'+width+'" height="'+(90*n/peak)+'"><title>'+label(i)+': '+n+' partners</title></rect>').join('');
el('legend').textContent='Rows and columns follow resolved residues in chain order. Teal marks pairs within '+cutoff+' Å with residue-number separation ≥ '+separation+'. Click to measure any pair.';

}
map.onclick = e => {
  const r = map.getBoundingClientRect();
  const index = v => Math.max(0,Math.min(size-1,Math.floor(v*size)));
  el('a').value=index((e.clientX-r.left)/r.width);el('b').value=index((e.clientY-r.top)/r.height);update();
};
el('a').onchange=el('b').onchange=update;
el('zoom').oninput=draw;
el('reset').onclick=()=>{yaw=-0.4;pitch=0.3;el('zoom').value=1;draw();};
let drag=null;
scene.onpointerdown=e=>{scene.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY];};
scene.onpointermove=e=>{if(drag){yaw+=(e.clientX-drag[0])*0.012;pitch+=(e.clientY-drag[1])*0.012;drag=[e.clientX,e.clientY];draw();}};
scene.onlostpointercapture=()=>{drag=null;};
scene.onkeydown=e=>{
  const step={ArrowUp:[0,-.12],ArrowDown:[0,.12],ArrowLeft:[-.12,0],ArrowRight:[.12,0]}[e.key];
  if(step){e.preventDefault();yaw+=step[0];pitch+=step[1];draw();}
};
el('save').onclick=()=>{
  const [a,b]=pair();
  const csv='structure,source,chain,atom,residue_a,residue_b,sequence_separation,distance_angstrom\n'+[active.id,active.source,'A','CA',label(a),label(b),Math.abs(rows[a][1]-rows[b][1]),dist(a,b).toFixed(3)].join(',')+'\n';
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const link=document.createElement('a');link.href=url;link.download=active.id+'-'+rows[a][1]+'-'+rows[b][1]+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
let loadSerial=0;
function present(model){
  active=model;rows=model.rows;size=rows.length;
  coord=rows.map(r=>r.slice(2,5));
  center=[0,1,2].map(k=>coord.reduce((sum,p)=>sum+p[k],0)/size);
  const radius=Math.max(...coord.map(p=>Math.hypot(...p.map((v,k)=>v-center[k]))));
  scaleFactor=model.id==='1UBQ'?9:185/radius;
  for(const id of ['a','b']){
    el(id).replaceChildren();
    rows.forEach((_,i)=>el(id).add(new Option(label(i),i)));
  }
  el('b').value=Math.min(16,size-1);
  el('workspace').hidden=false;el('zoom').value=1;yaw=-.4;pitch=.3;
  buildMap();update();
}
function refLink(url,title){
  const a=document.createElement('a');a.href=url;a.textContent=title;return a;
}
async function selectStructure(){
  const serial=++loadSerial, id=picker.value;
  const record=dnaRecords[foldIds.indexOf(id)];
  el('workspace').hidden=true;el('load-status').textContent='';
  if(experimental[id]){
    const m=experimental[id],source='https://www.rcsb.org/structure/'+id;
    el('heading').textContent=m.name+' in 3D';document.title=m.name+' · Assay Evidence Lab';
    el('intro').textContent='Inspect the experimentally resolved chain A of '+m.name+'. Residue labels preserve the deposited numbering.';
    el('provenance').replaceChildren('Experimental X-ray coordinates · ',refLink(source,'PDB '+id));
    el('dna-link').href='dna.html';scene.setAttribute('aria-label','Rotatable '+m.name+' Cα trace');
    el('lesson').textContent='Compare the contact profile at 6 and 10 Å. Find a residue whose neighborhood changes and export the two contact lists.';
    el('load-status').textContent=m.rows.length+' resolved Cα positions';present({id,source,rows:m.rows});return;
  }
  if(!record){
    for(const key of Object.keys(original))el(key).innerHTML=original[key];
    scene.setAttribute('aria-label','Rotatable human ubiquitin trace. Use arrow keys to rotate.');
    el('dna-link').href='dna.html';
    document.title='Ubiquitin in 3D · Assay Evidence Lab';
    present({id:'1UBQ',source:'https://www.rcsb.org/structure/1UBQ',rows:residues.map(([name,...xyz],i)=>[name,i+1,...xyz])});
    return;
  }
  el('heading').textContent=record.gene+' protein in 3D';
  document.title=el('heading').textContent+' · Assay Evidence Lab';
  el('intro').textContent=record.species+' · '+record.note+' Follow the protein backbone from teal to gold.';
  el('lesson').textContent='Select a contact away from the diagonal. Record the two residues and their distance, then find a pair with similar sequence separation but a different distance. Explain what the folded geometry adds to the sequence.';
  const entry='https://alphafold.ebi.ac.uk/entry/'+id;
  el('provenance').replaceChildren('Single-chain structure predicted by AlphaFold DB (CC BY 4.0). Distances describe the model. Interactions with other subunits or within a membrane require additional evidence. ',refLink(entry,id+' · AlphaFold DB'));
  el('dna-link').href='dna.html?protein='+id;
  el('load-status').textContent='Loading protein coordinates…';
  try{
    const model=bundledFolds[id];
    if(!model) throw Error("Missing model");
    if(serial!==loadSerial)return;
    el('legend').textContent='Chain A contact map. Both axes follow residues 1–'+model.rows.length+'. Teal marks Cα pairs within 8 Å. Click a cell to inspect the pair.';
    scene.setAttribute('aria-label','Rotatable '+record.gene+' alpha-carbon trace. Use arrow keys to rotate.');
    el('load-status').textContent=model.rows.length+' modeled residues · UniProt '+id;
    present({id,source:model.source,rows:model.rows});
  }catch{
    if(serial!==loadSerial)return;
    const retry=document.createElement('button');retry.textContent='Retry';retry.onclick=selectStructure;
    el('load-status').replaceChildren('The coordinates could not be loaded. ',retry,' ',refLink(entry,'Open the database entry'));
  }
}
const initId=new URLSearchParams(location.search).get('protein');
picker.value=(foldIds.includes(initId)||Object.hasOwn(experimental,initId))?initId:'1UBQ';
picker.onchange=()=>{
  const url=new URL(location.href);
  if(picker.value==='1UBQ')url.searchParams.delete('protein');else url.searchParams.set('protein',picker.value);
  history.replaceState(null,'',url);selectStructure();
};
selectStructure();
el('trace').onclick=()=>{
  const data={accession:active.id,source:active.source,chain:'A',columns:['residue','position','x_angstrom','y_angstrom','z_angstrom'],rows:rows.map(r=>r.slice(0,5))};
  const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=active.id+'-trace.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

el('cut').onchange=el('sep').onchange=()=>{buildMap();update();};
el('extent').onclick=()=>{el('a').value=farthest[0];el('b').value=farthest[1];update();};
el('inspect').onclick=()=>{el('b').value=el('neighbors').value;update();};
el('edges').onclick=()=>{
  const lines=['structure,source,chain,residue_a,residue_b,distance_angstrom,cutoff_angstrom,min_separation'];
  for(const [i,j,d] of contacts)lines.push([active.id,active.source,'A',label(i),label(j),d.toFixed(4),el('cut').value,el('sep').value].join(','));
  const url=URL.createObjectURL(new Blob([lines.join('\n')+'\n'],{type:'text/csv'}));
  const link=document.createElement('a');link.href=url;link.download=active.id+'-contacts.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
