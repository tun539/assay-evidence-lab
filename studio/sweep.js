function renderSweep(){
  const grid=document.getElementById('sweepGrid'),guide=document.getElementById('sweepGuide');
  grid.replaceChildren();
  if(document.getElementById('sweepMode').value==='force'){
    const widths=[.25,.5,1,1.5],amps=[.25,.5,1,1.5];
    guide.textContent='Read across a row to increase starting displacement while keeping the training interval fixed. Darker cells mean larger force RMSE over the trajectory, in reduced units.';
    evidenceMatrix(grid,'Force prediction error',['Training half-width / displacement',...amps],widths.map(w=>amps.map(a=>forceRun(w,a).rmse)),widths);
  }else{
    const gaps=[0,1,2],rates=[.02,.1,.4,1];
    guide.textContent='Each cell averages 20 reproducible 500-step trajectories (seeds 1–20). Darker cells mean larger absolute differences between sampled and theoretical state-1 occupancy. Read across to see the effect of mixing at fixed energy gap.';
    evidenceMatrix(grid,'Mean absolute occupancy error',['Energy gap / mixing',...rates],gaps.map(g=>rates.map(r=>{
      let sum=0;for(let seed=1;seed<=20;seed++){const run=ensembleRun(g,r,seed);sum+=Math.abs(run.observed-run.probability);}
      return sum/20;
    })),gaps);
  }
}
document.getElementById('sweepMode').onchange=renderSweep;renderSweep();
