'use strict';
const get=id=>document.getElementById(id);
const dt=.025, steps=160, count=96;
let frames, stats, config, yaw=.45, pitch=.27, playing=false, last=0;
function generator(seed){
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed+.5)/4294967296;};
}
function simulate(mode,D,k,seed){
  const random=generator(seed);
  const normal=()=>Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
  const trap=mode==='trap'&&k>0, decay=trap?Math.exp(-k*dt):1;
  const sigma=Math.sqrt(trap?-D*Math.expm1(-2*k*dt)/k:2*D*dt);
  const history=[new Float64Array(count*3)], summary=[];
  for(let frame=0;frame<=steps;frame++){
    const t=frame*dt;
    if(frame){
      const next=history[frame-1].map((p,i)=>decay*p+sigma*normal()+(mode==='drift'&&i%3===0?k*dt:0));
      history.push(next);
    }
    const p=history[frame], mean=[0,0,0];
    let msd=0;
    p.forEach((v,i)=>{msd+=v*v/count;mean[i%3]+=v/count;});
    const theory=trap?-3*D*Math.expm1(-2*k*t)/k:6*D*t+(mode==='drift'?(k*t)**2:0);
    summary.push([t,msd,theory,...mean]);
  }
  return [history,summary];
}
function controls(){
  const mode=get('mode').value;
  get('forceLabel').hidden=mode==='free';get('forceLabel').style.display=mode==='free'?'none':'grid';
  get('forceName').textContent=mode==='drift'?'Drift speed (μm/s)':'Restoring rate (1/s)';
  get('dval').textContent=get('D').value+' μm²/s';
  get('fval').textContent=mode==='free'?'':get('strength').value+(mode==='drift'?' μm/s':' /s');
}
function run(){
  if(!get('seed').reportValidity()||!get('seed').value)return;
  config={mode:get('mode').value,D:+get('D').value,k:get('mode').value==='free'?0:+get('strength').value,seed:+get('seed').value};
  [frames,stats]=simulate(config.mode,config.D,config.k,config.seed);
  get('formula').textContent={free:'Free diffusion: E[r²] = 6Dt.',drift:'Constant drift along x: E[r²] = 6Dt + (vt)².',trap:'Harmonic confinement: E[r²] = 3D(1 − exp(−2kt))/k. At k = 0 the free-diffusion limit applies.'}[config.mode];
  get('investigate').textContent={free:'Try doubling D with the same seed. What happens to the slope?',drift:'Compare the centroid motion to the random spread. When does the quadratic term dominate?',trap:'Increase the restoring rate. Does the plateau rise or fall? Repeat with a second seed.'}[config.mode];
  get('message').textContent='Displaying '+get('mode').selectedOptions[0].text+' · seed '+config.seed;
  stop();draw();
}
function draw(){
  const i=Number(get('time').value), frame=frames[i], [t,m,theory,x,y,z]=stats[i];
  get('clock').textContent=t.toFixed(3)+' s';
  get('metric').textContent='Measured '+m.toFixed(3)+' μm² · Expected '+theory.toFixed(3)+' μm² · RMS distance '+Math.sqrt(m).toFixed(3)+' μm · Centroid displacement '+Math.hypot(x,y,z).toFixed(3)+' μm';
  const canvas=get('world'), ctx=canvas.getContext('2d');
  const scale=170/Math.max(2,Math.sqrt(stats.at(-1)[2])*1.5);
  function project(a,b,c){
    const u=a*Math.cos(yaw)-c*Math.sin(yaw),v=a*Math.sin(yaw)+c*Math.cos(yaw);
    return [360+scale*u,235-scale*(b*Math.cos(pitch)-v*Math.sin(pitch)),v*Math.cos(pitch)+b*Math.sin(pitch)];
  }
  ctx.fillStyle='#102f33';ctx.fillRect(0,0,760,460);
  function line(points,color){
    ctx.beginPath();points.forEach(([a,b],j)=>j?ctx.lineTo(a,b):ctx.moveTo(a,b));ctx.strokeStyle=color;ctx.stroke();
  }
  for(let n=-3;n<=3;n++){
    line([project(n,0,-3),project(n,0,3)],'#265052');line([project(-3,0,n),project(3,0,n)],'#265052');
  }
  ['x','y','z'].forEach((s,k)=>{const v=[0,0,0];v[k]=1;const p=project(...v);line([project(0,0,0),p],'#a6cfc1');ctx.fillStyle='#c8e0d8';ctx.font='14px sans-serif';ctx.fillText(s,p[0]+4,p[1]);});
  line(frames.slice(Math.max(0,i-45),i+1).map(f=>project(f[0],f[1],f[2])),'#f3c470');
  const dots=Array.from({length:count},(_,j)=>[...project(...frame.subarray(j*3,j*3+3)),j]).sort((a,b)=>a[2]-b[2]);
  for(const [a,b,depth,j] of dots){
    const r=Math.max(3,Math.min(8,5+depth*.45))+(j===0?2:0);
    const g=ctx.createRadialGradient(a-r*.35,b-r*.35,0,a,b,r);g.addColorStop(0,j?'#ccf8de':'#fff2c8');g.addColorStop(1,j?'#36887f':'#d7983e');ctx.fillStyle=g;ctx.beginPath();ctx.arc(a,b,r,0,2*Math.PI);ctx.fill();
  }
  const ymax=Math.max(.01,...stats.flatMap(r=>r.slice(1,3)))*1.05;
  const poly=k=>stats.map((r,j)=>(50+590*j/steps)+','+(166-144*r[k]/ymax)).join(' ');
  const cursor=50+590*i/steps;
  get('graph').innerHTML='<path d="M50 15V166H640" fill="none" stroke="#51675b"/><polyline fill="none" stroke="#157452" stroke-width="3" points="'+poly(1)+'"/><polyline fill="none" stroke="#ac652c" stroke-width="2" stroke-dasharray="6 4" points="'+poly(2)+'"/><path stroke="#587482" d="M'+cursor+' 16V166"/><text x="2" y="24">'+ymax.toFixed(1)+'</text><text x="30" y="168">0</text><text x="48" y="190">0 s</text><text x="611" y="190">4 s</text>';
}
function stop(){playing=false;get('play').textContent='Play';}
let animation=0;
function animate(now){
  if(!playing)return;
  if(now-last>=25){last=now;get('time').value=+get('time').value+1;draw();}
  if(+get('time').value===steps)stop();else animation=requestAnimationFrame(animate);
}
get('play').onclick=()=>{cancelAnimationFrame(animation);if(playing){stop();return;}if(+get('time').value===steps)get('time').value=0;playing=true;get('play').textContent='Pause';last=0;animation=requestAnimationFrame(animate);};
get('reset').onclick=()=>{stop();get('time').value=0;draw();};
get('time').oninput=()=>{stop();draw();};
for(const id of ['mode','strength','D','seed'])get(id).oninput=()=>{controls();get('message').textContent='Settings changed. Run experiment to apply.';};
get('run').onclick=run;
const world=get('world');let drag;
world.onpointerdown=e=>{world.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY];};
world.onpointermove=e=>{if(drag){yaw+=(e.clientX-drag[0])*.01;pitch+=(e.clientY-drag[1])*.01;drag=[e.clientX,e.clientY];draw();}};
world.onlostpointercapture=()=>{drag=null;};
world.onkeydown=e=>{const step={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,.1],ArrowDown:[0,-.1]}[e.key];if(step){e.preventDefault();yaw+=step[0];pitch+=step[1];draw();}};
get('export').onclick=()=>{const csv='model,D,strength,seed,time_s,MSD_um2,expected_um2,mean_x_um,mean_y_um,mean_z_um\n'+stats.map(r=>[config.mode,config.D,config.k,config.seed,...r].join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='transport-'+config.mode+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
controls();run();
