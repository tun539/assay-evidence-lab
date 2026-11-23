'use strict';
// Each returned row contains a common x coordinate followed by the two series.
function forceRun(width, amplitude) {
  const force = x => -x - 0.6*x**3;
  const training = Array.from({length:21}, (_,i) => (i-10)*width/10);
  const sum = a => a.reduce((s,x)=>s+x,0);
  const stiffness = -sum(training.map(x=>x*force(x)))/sum(training.map(x=>x*x));
  const learned = x => -stiffness*x;
  const dt=0.025, steps=480;
  let truth=amplitude, guess=amplitude, vt=0, vg=0;
  const trace=[], errors=[];
  function advance(x,v,f){
    const half=v+dt*f(x)/2;
    const next=x+dt*half;
    return [next,half+dt*f(next)/2];
  }
  for(let i=0;i<=steps;i++){
    trace.push([i*dt,truth,guess]);
    errors.push(learned(truth)-force(truth));
    [truth,vt]=advance(truth,vt,force);
    [guess,vg]=advance(guess,vg,learned);
  }
  const span=Math.max(width,amplitude)*1.1;
  const curve=Array.from({length:101},(_,i)=>{
    const x=span*(i-50)/50;
    return [x,force(x),learned(x)];
  });
  return {trace,curve,errors,stiffness,mae:sum(errors.map(Math.abs))/errors.length,
    rmse:Math.sqrt(sum(errors.map(x=>x*x))/errors.length)};
}

function ensembleRun(gap, mixing, seed){
  const probability=1/(1+Math.exp(gap));
  let random=seed>>>0, state=0, occupied=0, switches=0;
  const trace=[], occupancy=[];
  for(let i=1;i<=500;i++){
    random=(Math.imul(1664525,random)+1013904223)>>>0;
    const switchProbability=mixing*(state ? 1-probability : probability);
    if(random/4294967296<switchProbability){state=1-state;switches++}
    occupied+=state;
    trace.push([i,state]);occupancy.push([i,occupied/i,probability]);
  }
  return {trace,occupancy,probability,observed:occupied/500,switches};
}
if(typeof module!=='undefined') module.exports={forceRun,ensembleRun};
