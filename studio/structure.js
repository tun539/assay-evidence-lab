'use strict';
const el = id => document.getElementById(id);
const scene = el('view');
const map = el('map');
const ctx = map.getContext('2d');
const size = residues.length;
const coord = residues.map(r => r.slice(1));
const center = [0,1,2].map(k => coord.reduce((sum,p) => sum+p[k],0)/size);
const dist = (i,j) => Math.hypot(...coord[i].map((v,k) => v-coord[j][k]));
const label = i => residues[i][0]+' '+(i+1);
let yaw = -0.4, pitch = 0.3;
for (const id of ['a','b']) residues.forEach((_,i) => el(id).add(new Option(label(i),i)));
el('b').value = 16;
const pair = () => [Number(el('a').value),Number(el('b').value)];
function draw(){
  const [a,b] = pair();
  const scale = 9*Number(el('zoom').value);
  const points = coord.map(p => {
    const [x,y,z] = p.map((v,k) => v-center[k]);
    const depth = z*Math.cos(yaw)-x*Math.sin(yaw);
    return {x:280+scale*(x*Math.cos(yaw)+z*Math.sin(yaw)),y:220-scale*(y*Math.cos(pitch)-depth*Math.sin(pitch)),z:y*Math.sin(pitch)+depth*Math.cos(pitch)};
  });
  const parts = [];
  points.forEach((p,i) => {
    const color = 'rgb('+[0,1,2].map(k=>Math.round([80,202,197][k]+([250,198,91][k]-[80,202,197][k])*i/(size-1))).join(',')+')';
    const q = points[i-1];
    if(q) parts.push([(p.z+q.z)/2,'<line x1="'+q.x+'" y1="'+q.y+'" x2="'+p.x+'" y2="'+p.y+'" stroke="'+color+'" stroke-width="4"/>']);
    parts.push([p.z,'<circle cx="'+p.x+'" cy="'+p.y+'" r="4.6" fill="'+color+'"/>']);
  });
  const line = '<line x1="'+points[a].x+'" y1="'+points[a].y+'" x2="'+points[b].x+'" y2="'+points[b].y+'" stroke="white" stroke-dasharray="5 4"/>';
  const marks = [...new Set([a,b])].map(i=>'<circle cx="'+points[i].x+'" cy="'+points[i].y+'" r="8" stroke="white" stroke-width="2" fill="none"/><text x="'+(points[i].x+10)+'" y="'+(points[i].y-8)+'" fill="white" stroke="#112d32" stroke-width="3" paint-order="stroke" font-size="14">'+label(i)+'</text>');
  scene.innerHTML = parts.sort((p,q)=>p[0]-q[0]).map(p=>p[1]).join('')+line+marks.join('');
}
function update(){
  const [a,b] = pair();
  el('reading').textContent = dist(a,b).toFixed(2)+' Å';
  el('gap').textContent = 'Sequence separation: '+Math.abs(a-b)+' positions.';
  ctx.drawImage(base,0,0);
  ctx.strokeStyle='#d54f20';ctx.lineWidth=2;ctx.strokeRect(3*a-2,3*b-2,7,7);
  draw();
}
const base = document.createElement('canvas');base.width=base.height=3*size;
const raster=base.getContext('2d');
for(let j=0;j<size;j++) for(let i=0;i<size;i++){
  raster.fillStyle=dist(i,j)<=8?'#216960':'#e7efe7';raster.fillRect(3*i,3*j,3,3);
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
  const csv='pdb,chain,atom,residue_a,residue_b,sequence_separation,distance_angstrom\n'+['1UBQ','A','CA',label(a),label(b),Math.abs(a-b),dist(a,b).toFixed(3)].join(',')+'\n';
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const link=document.createElement('a');link.href=url;link.download='1ubq-'+(a+1)+'-'+(b+1)+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
update();
