'use strict';
const get = id => document.getElementById(id);
const {vocab, meanings, weights, bias, dictionary} = languageModel;
const index = new Map(vocab.map((word, i) => [word, i]));
const aliases = new Map(dictionary.flatMap(([en,es]) => [[en,en],[es,en]]));
const filler = new Set('please now the a could you one la el una un de color por favor ahora puedes'.split(' '));
const groups = [dictionary.slice(0,2),dictionary.slice(2,4),dictionary.slice(4)].map(group => new Set(group.map(pair => pair[0])));
const stages = ['Raw input','Action, object and color','Gradient-guided compression','Multilingual output and physics'];
const canvas = get('scene'), ctx = canvas.getContext('2d');
const dims = [0,5,11];
const centers = dims.map(d => weights.reduce((sum,row) => sum + row[d],0)/vocab.length);
let yaw=.5, drag=null, experiment, projected=[], animation;

function infer(tokens) {
 const logits = bias.slice();
 for (const word of tokens) {
   const row = weights[index.get(word)];
   if (row) row.forEach((weight,j) => { logits[j] += weight; });
 }
 const max = Math.max(...logits);
 const exp = logits.map(value => Math.exp(value-max));
 const sum = exp.reduce((a,b)=>a+b,0);
 const probs = exp.map(value=>value/sum);
 return {probs, best:logits.indexOf(max), entropy:-probs.reduce((s,p)=>s+(p?p*Math.log2(p):0),0)};
}
function parse(tokens) {
 if (tokens.some(word=>!aliases.has(word)&&!filler.has(word))) return null;
 const canonical = tokens.map(word=>aliases.get(word));
 const slots = groups.map(group=>canonical.filter(word=>group.has(word)));
 const firstContent = canonical.find(word=>word!==undefined);
 return slots.every(values=>values.length===1) && groups[0].has(firstContent) ? slots.map(values=>values[0]).join('|') : null;
}
function compress(tokens, meaning, best) {
 let beam=[{tokens,loss:0}], shortest=beam[0];
 const baseline=infer(tokens).probs[best];
 for(let step=0;step<tokens.length;step++){
   const candidates=new Map();
   for(const candidate of beam){
     const probabilities=infer(candidate.tokens).probs;
     const ranked=candidate.tokens.map((word,i)=>{
       const row=weights[index.get(word)];
       const gradient=row?row[best]-row.reduce((s,w,j)=>s+w*probabilities[j],0):0;
       return {word,i,gradient};
     }).filter(item=>filler.has(item.word)).sort((a,b)=>a.gradient-b.gradient).slice(0,5);
     for(const {i} of ranked){
       const next=candidate.tokens.filter((_,j)=>i!==j);
       const prediction=infer(next);
       const signature=next.join(' ');
       if(parse(next)===meaning && prediction.best===best)
         candidates.set(signature,{tokens:next,loss:Math.log(baseline/prediction.probs[best])});
     }
   }
   beam=[...candidates.values()].sort((a,b)=>a.loss-b.loss).slice(0,4);
   if(!beam.length) break;
   shortest=beam[0];
 }
 return shortest;
}

const distances=weights.map(a=>weights.map(b=>Math.hypot(...a.map((v,i)=>v-b[i]))));
const graph=weights.map(()=>new Map());
for(const [i,row] of distances.entries()){
 const neighbors=row.map((value,j)=>({value,j})).filter(edge=>edge.j!==i).sort((a,b)=>a.value-b.value).slice(0,4);
 for(const {value,j} of neighbors){graph[i].set(j,value);graph[j].set(i,value);}
}
function shortestPath(source,target){
 const remaining=new Set(vocab.map((_,i)=>i));
 const costs=weights.map(()=>Infinity), previous=[];
 costs[source]=0;
 while(remaining.size){
   const current=[...remaining].reduce((a,b)=>costs[a]<=costs[b]?a:b);
   if(!Number.isFinite(costs[current])||current===target) break;
   remaining.delete(current);
   for(const [j,weight] of graph[current]){
     if(costs[current]+weight<costs[j]){ costs[j]=costs[current]+weight;previous[j]=current; }
   }
 }
 const path=Number.isFinite(costs[target])?[target]:[];
 while(path.length && path[0]!==source) path.unshift(previous[path[0]]);
 return {cost:costs[target],path};
}
function run(){
 cancelAnimationFrame(animation);
 const raw=get('prompt').value.trim();
 const tokens=(raw.toLowerCase().match(/\p{L}+/gu)||[]).slice(0,61);
 if(tokens.length>60){get('status').textContent='Use at most 60 words.';return;}
 const prediction=infer(tokens), meaning=/^[\p{L}\s,.!?¡¿]+$/u.test(raw)?parse(tokens):null;
 const accepted=meaning!==null && meanings[prediction.best]===meaning;
 const compression=accepted?compress(tokens,meaning,prediction.best):{tokens,loss:0};
 experiment={raw,tokens,prediction,meaning,accepted,compression};
 get('token').replaceChildren(...[...new Set(tokens.filter(word=>index.has(word)))].map(word=>new Option(word,word)));
 get('status').textContent=accepted?'Command matched the scene grammar.':'Scene withheld. The command is outside the supported grammar or disagreed with the classifier.';
 get('uncertainty').textContent='Meaning entropy '+prediction.entropy.toFixed(3)+' bits · maximum '+Math.log2(meanings.length).toFixed(3)+' bits';
 const ranked=prediction.probs.map((p,i)=>({p,label:meanings[i]})).sort((a,b)=>b.p-a.p).slice(0,3);
 get('classes').replaceChildren(...ranked.map(({p,label})=>{
   const li=document.createElement('li');li.textContent=label.split('|').join(' · ')+' · '+(100*p).toFixed(1)+'%';return li;
 }));
 get('time').value=0;
 render();
}
function translate(meaning){
 const slots=meaning.split('|');
 if(get('target').value==='en')return slots[0]+' the '+slots[2]+' '+slots[1];
 const [action,object,color]=slots.map(word=>dictionary.find(pair=>pair[0]===word)[1]);
 return action+(object==='cubo'?' el ':' la ')+object+' de color '+color;
}
function project(x,y,z){
 const u=x*Math.cos(yaw)+z*Math.sin(yaw), depth=z*Math.cos(yaw)-x*Math.sin(yaw);
 return [360+u,220-y+.34*depth,depth];
}
function line(a,b,color,width=1){
 ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();
}
function scene(){
 const [action,shape,color]=experiment.meaning.split('|');
 const t=Number(get('time').value), fall=Math.sqrt(2*85/120);
 let y=25,x=-145;
 if(action==='drop'){
   if(t<=fall)y+=85-60*t*t;
   else {const d=t-fall;y+=Math.max(0,0.38*120*fall*d-60*d*d);}
 }else x+=Math.min(t,2.7)*100;
 for(let i=-200;i<=200;i+=40){
   line(project(i,0,-200),project(i,0,200),'#39736d');
   line(project(-200,0,i),project(200,0,i),'#39736d');
 }
 const tint={red:'#f18273',blue:'#70b9f4',green:'#75dca5'}[color];
 if(shape==='ball'){
   const [sx,sy]=project(x,y,0);
   const shading=ctx.createRadialGradient(sx-7,sy-9,1,sx,sy,25);
   shading.addColorStop(0,'white');shading.addColorStop(.45,tint);shading.addColorStop(1,'#173c3a');
   ctx.beginPath();ctx.arc(sx,sy,25,0,Math.PI*2);ctx.fillStyle=shading;ctx.fill();
 }else{
   const vertices=Array.from({length:8},(_,i)=>project(x+(i&1?25:-25),y+(i&2?25:-25),i&4?25:-25));
   const faces=[[0,1,3,2],[4,5,7,6],[0,2,6,4],[1,3,7,5],[2,3,7,6],[0,1,5,4]];
   const depth=face=>face.reduce((sum,i)=>sum+vertices[i][2],0);
   for(const face of faces.sort((a,b)=>depth(a)-depth(b))){
     ctx.beginPath();face.forEach((i,j)=>ctx[j?'lineTo':'moveTo'](...vertices[i].slice(0,2)));ctx.closePath();
     ctx.fillStyle=tint;ctx.fill();ctx.strokeStyle='#153e3a';ctx.stroke();
   }
 }
}
function render(){
 if(!experiment)return;
 const {raw,tokens,prediction,meaning,accepted,compression}=experiment;
 const stage=Number(get('stage').value);
 const selected=get('token').value, source=index.get(selected);
 const other=dictionary.find(pair=>pair.includes(selected))?.find(word=>word!==selected);
 const target=index.get(other);
 const path=source!==undefined&&target!==undefined?shortestPath(source,target):null;
 get('tokenInfo').textContent=source===undefined?'No known token to inspect.':selected+' · signed logit contribution '+weights[source][prediction.best].toFixed(3)+
   (path?' · '+other+' · direct '+distances[source][target].toFixed(3)+' · graph '+(Number.isFinite(path.cost)?path.cost.toFixed(3)+' via '+path.path.map(i=>vocab[i]).join(' → '):'disconnected'):'');
 get('stageName').textContent=stages[stage];
 get('stageData').textContent=[raw,meaning?JSON.stringify(Object.fromEntries(['action','object','color'].map((key,i)=>[key,meaning.split('|')[i]])),null,2):'No valid action/object/color record.',
   compression.tokens.join(' ')+(accepted?'\n'+tokens.length+' → '+compression.tokens.length+' tokens · Δ negative log probability '+compression.loss.toFixed(3):''),
   accepted?translate(meaning)+'\nRigid-body demo · ground contact · '+(meaning.startsWith('drop')?'gravity and one damped bounce':'constant-speed slide'):'Scene unavailable'][stage];
 get('play').disabled=get('time').disabled=stage!==3||!accepted;
 ctx.fillStyle='#102f32';ctx.fillRect(0,0,720,430);projected=[];
 if(stage===3&&accepted){scene();return;}
 const active=new Set(stage===2?compression.tokens:tokens);
 const coords=weights.map(row=>project(...dims.map((d,i)=>(row[d]-centers[i])*155)));
 if(path) for(let i=1;i<path.path.length;i++)line(coords[path.path[i-1]],coords[path.path[i]],'#72dfb3',2);
 for(const [i,word] of vocab.entries()){
   if(!active.has(word))continue;
   const value=weights[i][prediction.best];
   line(coords[i],[360,220],value>=0?'#559e8b':'#ad735a',1+Math.min(4,Math.abs(value)*3));
 }
 for(const [i,word] of vocab.entries()){
   if(!active.has(word)&&word!==other&&!path?.path.includes(i))continue;
   const [x,y]=coords[i];projected.push({word,x,y});
   ctx.beginPath();ctx.arc(x,y,word===selected?7:4,0,6.29);ctx.fillStyle=word===selected?'#ffc675':'#aff1d9';ctx.fill();
   ctx.font='13px system-ui';ctx.fillText(word,x+8,y-4);
 }
 ctx.fillStyle='#fff';ctx.fillRect(357,217,6,6);
}
get('run').onclick=run;
get('example').onclick=()=>{get('prompt').value='por favor desliza el cubo de color azul';get('target').value='en';run();};
for(const id of ['stage','target','token'])get(id).oninput=render;
get('time').oninput=()=>{cancelAnimationFrame(animation);render();};
get('play').onclick=()=>{
 cancelAnimationFrame(animation);
 const start=performance.now();
 function step(now){get('time').value=Math.min(4,(now-start)/1000);render();if(now-start<4000)animation=requestAnimationFrame(step);}
 animation=requestAnimationFrame(step);
};
canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag={x:e.clientX,moved:0};};
canvas.onpointermove=e=>{if(drag){const dx=e.clientX-drag.x;yaw+=dx*.012;drag.x=e.clientX;drag.moved+=Math.abs(dx);render();}};
canvas.onpointerup=e=>{
 if(drag&&drag.moved<4){
   const rect=canvas.getBoundingClientRect();
   const x=(e.clientX-rect.left)*720/rect.width,y=(e.clientY-rect.top)*430/rect.height;
   const hit=projected.find(p=>Math.hypot(p.x-x,p.y-y)<12);
   if(hit && Array.from(get('token').options).some(option=>option.value===hit.word)){get('token').value=hit.word;render();}
 }
 drag=null;
};
canvas.onpointercancel=()=>{drag=null;};
canvas.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();yaw+=e.key==='ArrowLeft'?-.12:.12;render();}};
get('training').textContent=languageModel.train+' training prompts · '+languageModel.test+' held-out prompts · '+(100*languageModel.accuracy).toFixed(1)+'% NumPy template-holdout accuracy.';
run();
