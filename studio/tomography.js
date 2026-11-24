'use strict';
const N=64, B=94;
const solids=[
  [[0,0,0],[.84,.69,.78],.22],
  [[-.22,.12,.04],[.35,.32,.4],.42],
  [[.29,-.16,-.16],[.15,.22,.3],.56],
  [[.21,.32,.22],[.11,.11,.16],.72]
];
const get=id=>document.getElementById(id);
let yaw=.44,pitch=.36,record;
function sample(z){
  return Float64Array.from({length:N*N},(_,i)=>{
    const p=[2*((i%N+.5)/N)-1,2*((Math.floor(i/N)+.5)/N)-1,z];
    return solids.reduce((s,[c,r,d])=>s+(p.reduce((v,x,k)=>v+((x-c[k])/r[k])**2,0)<=1?d:0),0);
  });
}
function solve(target,angles,span,passes){
  const bins=new Uint16Array(angles*N*N), totals=new Float64Array(angles*B), counts=new Uint16Array(angles*B);
  for(let a=0;a<angles;a++){
    const theta=a*span/angles;
    for(let i=0;i<target.length;i++){
      const b=a*B+Math.round((B-1)/2+(i%N-31.5)*Math.cos(theta)+(Math.floor(i/N)-31.5)*Math.sin(theta));
      bins[a*N*N+i]=b;totals[b]+=target[i];counts[b]++;
    }
  }
  const estimate=new Float64Array(N*N), history=[];
  for(let pass=0;pass<=passes;pass++){
    const residual=totals.slice();
    for(let j=0;j<bins.length;j++)residual[bins[j]]-=estimate[j%(N*N)];
    const rmse=Math.sqrt(target.reduce((s,v,i)=>s+(v-estimate[i])**2,0)/target.length);
    history.push(rmse);
    if(pass===passes)break;
    for(let j=0;j<residual.length;j++)if(counts[j])residual[j]/=counts[j];
    for(let j=0;j<bins.length;j++)estimate[j%(N*N)]+=residual[bins[j]]/angles;
    for(let i=0;i<estimate.length;i++)estimate[i]=Math.max(0,estimate[i]);
  }
  return {estimate,totals,history};
}
function raster(id,w,h,fn){
  const c=get(id);c.width=w;c.height=h;const ctx=c.getContext('2d'), img=ctx.createImageData(w,h);
  for(let i=0;i<w*h;i++){
    const v=Math.min(1,Math.max(0,fn(i)));
    img.data.set([10+232*v,33+206*v,39+147*v,255],4*i);
  }
  ctx.putImageData(img,0,0);
}
function world(){
  const ctx=get('volume').getContext('2d'),z=+get('slice').value/100;
  ctx.fillStyle='#0a2127';ctx.fillRect(0,0,240,240);
  function project([x,y,z]){
    const u=x*Math.cos(yaw)-y*Math.sin(yaw), v=x*Math.sin(yaw)+y*Math.cos(yaw);
    return [120+95*u,120-95*(z*Math.cos(pitch)-v*Math.sin(pitch))];
  }
  function path(points,color,fill=false){
    ctx.beginPath();points.forEach((p,i)=>{const [x,y]=project(p);if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});
    ctx.strokeStyle=color;ctx.stroke();if(fill){ctx.fillStyle='rgba(237,189,94,.13)';ctx.fill();}
  }
  solids.forEach(([c,r],index)=>{
    for(let line=0;line<12;line++){
      const phi=line*Math.PI/6;
      path(Array.from({length:35},(_,j)=>{const t=j*Math.PI/34;return [c[0]+r[0]*Math.cos(phi)*Math.sin(t),c[1]+r[1]*Math.sin(phi)*Math.sin(t),c[2]+r[2]*Math.cos(t)];}),['#356768','#64bfa0','#cd9971','#c8b8e7'][index]);
    }
  });
  path([[-.9,-.9,z],[.9,-.9,z],[.9,.9,z],[-.9,.9,z],[-.9,-.9,z]],'#eec57c',true);
}
function run(){
  world();const z=+get('slice').value/100, angles=+get('angles').value, passes=+get('steps').value, span=get('limited').checked?90:180;
  const target=sample(z),{estimate,totals,history}=solve(target,angles,span*Math.PI/180,passes);
  raster('truth',N,N,i=>target[i]);raster('recon',N,N,i=>estimate[i]);
  const peak=Math.max(1,...totals);
  raster('sino',angles,B,i=>totals[(i%angles)*B+Math.floor(i/angles)]/peak);
  get('sino').style.aspectRatio='1';
  get('metrics').textContent='Slice z = '+z.toFixed(2)+' · '+angles+' views across '+span+'° · '+passes+' passes · Density RMSE '+history.at(-1).toFixed(4);
  const max=Math.max(.001,history[0]);
  const points=history.map((v,i)=>(60+510*i/passes)+','+(95-75*v/max)).join(' ');
  get('curve').innerHTML='<path d="M60 15V95H570" fill="none" stroke="#657b70"/><polyline fill="none" stroke="#167356" stroke-width="3" points="'+points+'"/><text x="4" y="24">'+max.toFixed(3)+'</text><text x="35" y="99">0</text><text x="55" y="118">0</text><text x="505" y="118">Pass '+passes+'</text>';
  record={z,angles,span_degrees:span,passes,grid:N,bins_per_view:B,target:Array.from(target),angle_major_projections:Array.from(totals),reconstruction:Array.from(estimate),rmse:history};
}
for(const id of ['angles','steps','limited','slice'])get(id).oninput=run;
const canvas=get('volume');let drag;
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY];};
canvas.onpointermove=e=>{if(drag){yaw+=(e.clientX-drag[0])*.015;pitch+=(e.clientY-drag[1])*.015;drag=[e.clientX,e.clientY];world();}};
canvas.onlostpointercapture=()=>{drag=null;};
canvas.onkeydown=e=>{const d={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]}[e.key];if(d){e.preventDefault();yaw+=d[0];pitch+=d[1];world();}};
get('save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(record)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tomography-experiment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
run();
