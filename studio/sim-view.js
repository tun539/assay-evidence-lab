'use strict';
const get=id=>document.getElementById(id);
const ns='http://www.w3.org/2000/svg';
function svgNode(parent,tag,attrs,content){
  const n=document.createElementNS(ns,tag);
  for(const [name,value] of Object.entries(attrs))n.setAttribute(name,value);
  if(content!==undefined)n.textContent=content;
  parent.append(n);return n;
}
function plot(id,rows,xLabel,yLabel,names,step=false){
  const host=get('plot'+id);host.replaceChildren();
  const svg=svgNode(host,'svg',{viewBox:'0 0 620 204',role:'img','aria-label':get('cap'+id).textContent});
  const colors=['#067167','#ab592d'];
  const left=52,top=25,width=547,height=135;
  const xs=rows.map(r=>r[0]),ys=rows.flatMap(r=>r.slice(1));
  const low=Math.min(0,...ys),high=Math.max(...ys,low+0.001);
  const xpos=x=>left+width*(x-xs[0])/(xs.at(-1)-xs[0]);
  const ypos=y=>top+height*(high-y)/(high-low);
  for(let i=0;i<=4;i++){
    const y=top+height*i/4,x=left+width*i/4;
    svgNode(svg,'path',{d:'M'+left+' '+y+'h'+width,stroke:'#d7e2db'});
    svgNode(svg,'text',{x:left-6,y:y+4,'text-anchor':'end','font-size':12},Number((high-(high-low)*i/4).toFixed(2)));
    svgNode(svg,'text',{x,y:178,'text-anchor':'middle','font-size':12},Number((xs[0]+(xs.at(-1)-xs[0])*i/4).toFixed(2)));
  }
  svgNode(svg,'text',{x:left,y:16,'font-size':13},yLabel);
  svgNode(svg,'text',{x:320,y:198,'font-size':13,'text-anchor':'middle'},xLabel);
  names.forEach((n,j)=>{
    let d='';
    rows.forEach((r,i)=>{const x=xpos(r[0]),y=ypos(r[j+1]);d+=i&&step?'H'+x+'V'+y:(i?'L':'M')+x+' '+y});
    svgNode(svg,'path',{d,fill:'none',stroke:colors[j],'stroke-width':2,'stroke-dasharray':j?'6 3':'none'});
  });
  get('leg'+id).textContent=names.map((n,i)=>(i?'Dashed · ':'Solid · ')+n).join('     /     ');
}
const specs={
 force:{controls:[['width','Training half-width',0.2,2,0.1,0.5],['amplitude','Starting displacement',0.2,2,0.1,1.5]],
 question:'How well does a force law learned near equilibrium predict larger oscillations?',
 challenge:'Compare two starting displacements using the same training range. Decide when your team would request more reference data.',
 method:'Fit F = −kx by least squares to 21 synthetic forces from F = −x − 0.6x³. Integrate the reference and fitted systems for 12 reduced time units using velocity Verlet with a 0.025 step and unit mass. Force errors use reference trajectory positions.'},
 ensemble:{controls:[['gap','Free-energy gap ΔG/kBT',-3,3,0.1,1],['mix','Transition scale',0.01,1,0.01,0.1],['seed','Random seed',1,1000,1,42]],
 question:'When does a short trajectory misrepresent the equilibrium population?',
 challenge:'Keep the energy gap fixed, reduce transition frequency and repeat with three seeds. Explain which result changes from run to run and which quantity remains fixed.',
 method:'An abstract two-state chain starts in A. Equilibrium occupancy p(B)=1/(1+exp(gap)). Each step uses A→B probability scale × p(B) or B→A probability scale × (1−p(B)). The seeded 500-step trajectory contains correlated samples.'}
};
let snapshot;
const drafts=new Map();
const fields=["brief","prediction","review","decision"];
function setup(){
  if(snapshot) drafts.set(snapshot.mode,Object.fromEntries(fields.map(id=>[id,get(id).value])));
  const mode=get("mode").value, spec=specs[mode];
  for(const key of ['question','challenge','method'])get(key).textContent=spec[key];
  get('controls').replaceChildren();
  for(const [id,title,min,max,step,value] of spec.controls){
    const label=document.createElement('label'),input=document.createElement('input');
    label.htmlFor=id;input.type='range';Object.assign(input,{id,min,max,step,value});
    function update(){label.textContent=title+' · '+input.value}
    update();input.oninput=()=>{update();get('status').textContent='Controls changed. Run to update the charts.'};
    get('controls').append(label,input);
  }
  for(const id of fields)get(id).value=drafts.get(mode)?.[id]||'';
  run();
}
function run(){
  const mode=get('mode').value;
  const params=Object.fromEntries(specs[mode].controls.map(([id])=>[id,Number(get(id).value)]));
  const r=mode==='force'?forceRun(params.width,params.amplitude):ensembleRun(params.gap,params.mix,params.seed);
  snapshot={schema:'scientific-simulation/1',mode,params,prediction:get('prediction').value,result:r};
  if(mode==='force'){
    get('cap1').textContent='Force law across displacements';get('cap2').textContent='Time evolution from the same starting point';
    plot(1,r.curve,'Displacement','Force',['Reference','Fitted']);
    plot(2,r.trace,'Time','Displacement',['Reference','Fitted']);
    get('stats').textContent='Fitted stiffness '+r.stiffness.toFixed(3)+'  ·  Force RMSE '+r.rmse.toFixed(3)+'  ·  Force MAE '+r.mae.toFixed(3);
  }else{
    get('cap1').textContent='Conformational state over time';get('cap2').textContent='Estimated occupancy versus equilibrium';
    plot(1,r.trace,'Sampling step','State (0 = A, 1 = B)',['Simulated state'],true);
    plot(2,r.occupancy,'Sampling step','Fraction in state B',['Running estimate','Equilibrium']);
    get('stats').textContent='Observed B '+(100*r.observed).toFixed(1)+'%  ·  Equilibrium B '+(100*r.probability).toFixed(1)+'%  ·  State changes '+r.switches;
  }
  get('status').textContent='Showing the completed run.';
}
function download(filename,content,type){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
get('export').onclick=()=>download('simulation-report.json',JSON.stringify({...snapshot,discussion:{claim:get('brief').value,review:get('review').value,decision:get('decision').value}},null,2),'application/json');
get('csv').onclick=()=>{
  const r=snapshot.result, rows=['plot,x,series_1,series_2'];
  const charts=snapshot.mode==='force'?{force_reference_fitted:r.curve,trajectory_reference_fitted:r.trace}:{state:r.trace,occupancy_observed_equilibrium:r.occupancy};
  for(const [name,data] of Object.entries(charts))for(const [x,a,b] of data)rows.push([name,x,a,b??''].join(','));
  download('simulation-curves.csv',rows.join('\n'),'text/csv');
};
get('save-evidence').onclick=()=>{
  if(!snapshot)return;
  const r=snapshot.result, p=snapshot.params;
  try{
    if(snapshot.mode==='force'){
      evidenceRecords.capture({
        kind:'simulated',
        title:'Force law · train ±'+p.width+' / start '+p.amplitude,
        dataset:'Anharmonic oscillator force-law task',
        method:'Linear least-squares stiffness + velocity Verlet',
        metric:'Force RMSE',
        unit:'reduced force',
        value:Number(r.rmse.toFixed(4)),
        source:'studio/simulation.html',
        details:{
          comparisonKey:'simulation-force-amp-'+p.amplitude,
          trainingHalfWidth:p.width,
          startingAmplitude:p.amplitude,
          fittedStiffness:Number(r.stiffness.toFixed(4)),
          forceMae:Number(r.mae.toFixed(4)),
          claim:get('brief').value||undefined,
        },
      });
    }else{
      evidenceRecords.capture({
        kind:'simulated',
        title:'Two-state ensemble · ΔG '+p.gap+' / mix '+p.mix,
        dataset:'Two-conformation Markov chain (500 steps)',
        method:'Seeded discrete-time two-state sampling',
        metric:'Observed state B occupancy',
        unit:'fraction',
        value:Number(r.observed.toFixed(4)),
        source:'studio/simulation.html',
        details:{
          comparisonKey:'simulation-ensemble-gap-'+p.gap,
          freeEnergyGap:p.gap,
          transitionScale:p.mix,
          seed:p.seed,
          equilibriumB:Number(r.probability.toFixed(4)),
          absoluteError:Number(Math.abs(r.observed-r.probability).toFixed(4)),
          stateSwitches:r.switches,
          claim:get('brief').value||undefined,
        },
      });
    }
    get('save-status').textContent='Saved simulation run to the evidence workspace.';
  }catch(error){
    get('save-status').textContent='Could not save simulation run. '+error.message;
  }
};
get('mode').onchange=setup;get('run').onclick=run;setup();
