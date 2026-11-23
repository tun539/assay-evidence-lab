// Profile out Vmax analytically, then minimize SSE over log(Km).
function fitCurve(rows) {
  let lo = Math.log(Math.min(...rows.map(r => r.conc))) - 9.21;
  let hi = Math.log(Math.max(...rows.map(r => r.conc))) + 9.21;
  const limits = [lo, hi];
  function at(logK) {
    const km = Math.exp(logK);
    const f = rows.map(r => r.conc / (r.conc + km));
    const vmax = rows.reduce((v,r,i) => v + f[i]*r.rate,0) / f.reduce((v,n) => v+n*n,0);
    const sse = rows.reduce((v,r,i) => v + (r.rate-vmax*f[i])**2,0);
    return {km,vmax,sse};
  }
  // Evaluate a coarse profile first to bracket the best sampled minimum.
  const grid = Array.from({length:65}, (_,i) => lo + (hi-lo)*i/64);
  const errors = grid.map(k => at(k).sse);
  const best = errors.indexOf(Math.min(...errors));
  lo=grid[Math.max(best-1,0)]; hi=grid[Math.min(best+1,64)];
  for(let i=0;i<48;i++){
    const a=(2*lo+hi)/3, b=(lo+2*hi)/3;
    if(at(a).sse<at(b).sse) hi=b; else lo=a;
  }
  const mid=(lo+hi)/2;
  return {...at(mid), boundary: Math.min(mid-limits[0],limits[1]-mid)<0.01};
}

function parseAssay(csv) {
  const lines=csv.trim().replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim());
  const fields=lines.shift()?.split(',').map(k=>k.trim()) || [];
  const cols=['conc','rate','state'].map(k=>fields.indexOf(k));
  if(cols.includes(-1) || new Set(fields).size!==fields.length) throw Error('Use unique headers including conc,rate,state.');
  if(lines.length>1000) throw Error('The classroom workspace supports up to 1,000 observations.');
  const rows=lines.map((line,i)=>{
    const cells=line.split(',').map(v=>v.trim());
    const [x,y,state]=cols.map(j=>cells[j]);
    const conc=Number(x),rate=Number(y);
    if(cells.length!==fields.length || !Number.isFinite(conc) || !Number.isFinite(rate) ||
       conc<=0 || rate<=0 || !['treated','untreated'].includes(state))
      throw Error('Check line '+(i+2)+'. Use positive finite measurements and state treated or untreated.');
    return {conc,rate,state};
  });
  const levels=[...new Set(rows.map(r=>r.conc))];
  if(levels.length<3 || levels.length>20 || levels.some(x=>['treated','untreated'].some(s=>!rows.some(r=>r.conc===x&&r.state===s))))
    throw Error('Provide 3–20 shared concentrations with both conditions at every level.');
  return rows;
}

function compareCurves(rows) {
  const levels=[...new Set(rows.map(r=>r.conc))].sort((a,b)=>a-b);
  const fits={};
  const models=['shared','separate'];
  for(const model of models){
    const predictions=[], folds=[];
    let boundary=false;
    const fitGroup=(rs)=>{const fit=fitCurve(rs);boundary ||= fit.boundary;return fit};
    const fitConditions=train=>model==='shared' ? {shared:fitGroup(train)} :
      Object.fromEntries(['treated','untreated'].map(s=>[s,fitGroup(train.filter(r=>r.state===s))]));
    for(const conc of levels){
      const params=fitConditions(rows.filter(r=>r.conc!==conc));
      const test=rows.filter(r=>r.conc===conc);
      let sse=0;
      for(const r of test){
        const {vmax,km}=params.shared||params[r.state];
        const prediction=vmax*r.conc/(km+r.conc);
        sse+=(r.rate-prediction)**2;
        predictions.push({...r,prediction});
      }
      folds.push({conc,n:test.length,mse:sse/test.length});
    }
    const params=fitConditions(rows);
    const pooled=Math.sqrt(folds.reduce((v,f)=>v+f.mse*f.n,0)/rows.length);
    const balanced=Math.sqrt(folds.reduce((v,f)=>v+f.mse,0)/folds.length);
    if (![pooled,balanced,...Object.values(params).flatMap(p=>[p.km,p.vmax,p.sse])].every(Number.isFinite))
      throw Error('Numerical overflow. Rescale the measurement units before fitting.');
    fits[model]={params,predictions,folds,pooled,balanced,boundary};
  }
  return fits;
}
if(typeof module!=='undefined') module.exports={parseAssay,compareCurves,fitCurve};
