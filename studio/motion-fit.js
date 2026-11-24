// Fit conditional Gaussian increments on complete training trajectories.
function fitMotion(paths, dt, trainCount) {
  const count = paths[0].length / 3;
  const omega = Math.PI; // Known forcing period of two seconds.
  const models = ['Isotropic diffusion','Constant drift','Periodic flow','Restoring force','Axis-dependent diffusion'];
  function predictor(model, axis, t, x) {
    if (model === 'Constant drift') return axis === 0 ? dt : 0;
    if (model === 'Periodic flow') return axis === 0 ? (Math.sin(omega*t)-Math.sin(omega*(t-dt)))/omega : 0;
    if (model === 'Restoring force') return -x;
    return 0;
  }
  return models.map(model => {
    let xy=0, xx=0;
    const obs=[];
    for(let f=1;f<paths.length;f++){
      for(let i=0;i<3*count;i++){
        const old=paths[f-1][i], delta=paths[f][i]-old;
        const feature=predictor(model,i%3,f*dt,old);
        const training=i<3*trainCount;
        if(training){xy+=feature*delta;xx+=feature*feature;}
        obs.push([i%3,delta,feature,training]);
      }
    }
    let beta=xx ? xy/xx : 0;
    if(model==='Restoring force') beta=Math.min(.999999,Math.max(0,beta));
    const variances=[0,0,0], n=trainCount*(paths.length-1);
    for(const [a,y,h,training] of obs)if(training)variances[a]+=(y-beta*h)**2/n;
    const pooled=variances.reduce((s,v)=>s+v,0)/3;
    const v=variances.map(x=>Math.max(1e-12,model==='Axis-dependent diffusion'?x:pooled));
    let loss=0;
    for(const [a,y,h,training] of obs)if(!training)loss+=.5*(Math.log(2*Math.PI*v[a])+(y-beta*h)**2/v[a]);
    const rate=-Math.log1p(-beta*(model==='Restoring force'))/dt;
    const diffusivity=v.map(x=>rate>0?x*rate/(-Math.expm1(-2*rate*dt)):x/(2*dt));
    return {model, beta,rate,diffusivity,loss:loss/(3*(count-trainCount)*(paths.length-1))};
  }).sort((a,b)=>a.loss-b.loss);
}
