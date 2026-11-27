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
let protein;
const studies = [
  ['ATP synthase subunit a', 'Energy conversion', 'Trace the bends in the mitochondrial chain. At four views, which separated traces appear to merge in the central slice?'],
  ['Large ribosomal subunit protein L10', 'Protein synthesis', 'Follow the protruding part of the backbone. Move the slice through it. Does a narrow extension remain visible when the scan is limited to 90°?'],
  ['Glyceraldehyde-3-phosphate dehydrogenase (Tdh3)', 'Sugar metabolism', 'Find a slice containing adjacent dense regions. How many views do you need before the gap between them reappears?'],
  ['RuBisCO large subunit', 'Photosynthetic carbon fixation', 'Compare the crowded core with a slice near the edge. Which small features disappear first when you reduce the number of views?'],
  ['Zinc-binding ribosomal protein', 'Plant protein synthesis', 'Compare this plant chain with bacterial L10. Use the dimensions in ångströms to distinguish physical size from the automatic zoom.'],
  ['Tumor suppressor p53 (TP53)', 'Cell-cycle checkpoint & DNA repair', 'Slice through the dense DNA-binding domain versus the extended low-pLDDT tails. How does a sparse disordered tail distort limited-angle recovery?'],
  ['Hemoglobin subunit beta (HBB)', 'Oxygen transport', 'Locate the central heme-binding pocket surrounded by eight α-helices. How many projection angles are needed to keep the hollow interior resolved?'],
  ['Preproinsulin (INS)', 'Glucose hormone signaling', 'Notice the wide image span created by extended flexible precursor loops. Compare central slice RMSE at 8 vs 24 views.'],
  ['Recombinase RecA', 'Homologous DNA recombination', 'Trace the compact α/β ATPase core and projecting C-terminal lobe. Does a 90° missing-wedge scan smear the lobe boundary?'],
  ['Cu/Zn Superoxide dismutase (SOD1)', 'Antioxidant defense', 'Inspect a cross-section through the tight eight-strand β-barrel. Does the compact Greek-key ring survive with just 8 projections?']
];
function choose(){
  const id=get('specimen').value, index=foldIds.indexOf(id);
  protein=null;
  if(index>=0){
    const rows=bundledFolds[id].rows, info=dnaRecords[index], [name,role,question]=studies[index];
    const xyz=rows.map(r=>r.slice(2,5));
    const center=[0,1,2].map(k=>xyz.reduce((s,p)=>s+p[k],0)/xyz.length);
    const centered=xyz.map(p=>p.map((v,k)=>v-center[k]));
    const radius=Math.max(...centered.map(p=>Math.hypot(...p)))+5;
    protein={id,radius,points:centered.map(p=>p.map(v=>v/radius))};
    get('identity').textContent=name+' · '+info.species;
    get('biology').textContent=role+'. '+info.note;
    get('question').textContent='Investigate: '+question;
    get('measurement').textContent=info.gene+' · '+rows.length+' backbone positions · image width '+(2*radius).toFixed(1)+' Å';
    get('sources').innerHTML='<a href="https://alphafold.ebi.ac.uk/entry/'+id+'">AlphaFold model '+id+'</a> · <a href="https://www.uniprot.org/uniprotkb/'+id+'/entry">Protein annotation</a>';
  }else{
    get('identity').textContent='Geometric calibration sample';
    get('biology').textContent='Nested ellipsoids with known densities provide a reference for testing the solver.';
    get('question').textContent='Which small inclusion can you recover with four views?';
    get('measurement').textContent='Dimensionless reference grid';get('sources').textContent='';
  }
  get('slice').value=0;run();
}
function sample(z){
  if(protein){
    const values=new Float64Array(N*N),sigma=2.5/protein.radius;
    for(const [x,y,h] of protein.points){
      if(Math.abs(z-h)>3*sigma)continue;
      for(let j=Math.max(0,Math.floor((y-3*sigma+1)*N/2));j<Math.min(N,(y+3*sigma+1)*N/2);j++)
        for(let i=Math.max(0,Math.floor((x-3*sigma+1)*N/2));i<Math.min(N,(x+3*sigma+1)*N/2);i++){
          const dx=(i+.5)*2/N-1-x,dy=(j+.5)*2/N-1-y;
          values[j*N+i]+=Math.exp(-(dx*dx+dy*dy+(z-h)**2)/(2*sigma*sigma));
        }
    }
    const peak=Math.max(...values);
    return peak?values.map(v=>v/peak):values;
  }
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
  if(protein){
    ctx.lineWidth=2.4;
    for(let i=1;i<protein.points.length;i++){
      const a=protein.points[i-1],b=protein.points[i];
      path([a,b],Math.min(a[2],b[2])<=z+.04 && Math.max(a[2],b[2])>=z-.04?'#ffd077':'#71cfa9');
    }
    ctx.lineWidth=1;
  }else solids.forEach(([c,r],index)=>{
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
  record={specimen:protein?.id || "calibration",width_angstrom:protein?2*protein.radius:null,z,angles,span_degrees:span,passes,grid:N,bins_per_view:B,target:Array.from(target),angle_major_projections:Array.from(totals),reconstruction:Array.from(estimate),rmse:history};
}
for(const id of ['angles','steps','limited','slice'])get(id).oninput=run;
const canvas=get('volume');let drag;
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY];};
canvas.onpointermove=e=>{if(drag){yaw+=(e.clientX-drag[0])*.015;pitch+=(e.clientY-drag[1])*.015;drag=[e.clientX,e.clientY];world();}};
canvas.onlostpointercapture=()=>{drag=null;};
canvas.onkeydown=e=>{const d={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]}[e.key];if(d){e.preventDefault();yaw+=d[0];pitch+=d[1];world();}};
get('save').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(record)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tomography-experiment.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
get('save-evidence').onclick=()=>{
  if(!record)return;
  const label=get('specimen').selectedOptions[0].text;
  const finalRmse=record.rmse.at(-1);
  try{
    evidenceRecords.capture({
      kind:'simulated',
      title:record.specimen+' · '+record.angles+' views ('+record.span_degrees+'°)',
      dataset:'Simulated parallel-beam tomography · '+label,
      method:'Iterative back-projection ('+record.passes+' passes)',
      metric:'Density RMSE',
      unit:'normalized density',
      value:Number(finalRmse.toFixed(4)),
      source:protein?'https://alphafold.ebi.ac.uk/entry/'+protein.id:'studio/tomography.html',
      details:{
        comparisonKey:'tomography-'+record.specimen+'-z'+record.z.toFixed(2),
        specimen:record.specimen,
        sliceZ:record.z,
        angles:record.angles,
        spanDegrees:record.span_degrees,
        passes:record.passes,
        initialRmse:Number(record.rmse[0].toFixed(4)),
        widthAngstrom:record.width_angstrom?Number(record.width_angstrom.toFixed(1)):null,
      },
    });
    get('save-status').textContent='Saved tomography reconstruction (RMSE '+finalRmse.toFixed(4)+') to the evidence workspace.';
  }catch(error){
    get('save-status').textContent='Could not save reconstruction. '+error.message;
  }
};
get('specimen').onchange=choose;
choose();
