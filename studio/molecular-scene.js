'use strict';

const molecularScene = (() => {
  const get = id => document.getElementById(id);
  const canvases = [get('scene-selected'), get('scene-fixed')];
  const slider = get('scene-time');
  const toggle = get('play-scene');
  const model = get('rate-model');
  const enzyme = [
    [-47, -15, -15, 36], [-52, 21, -12, 31], [-23, -38, -18, 33],
    [14, -38, -20, 28], [43, -15, -18, 28], [46, 18, -11, 29],
    [22, 36, -20, 27], [-20, 41, -18, 29], [-12, -4, -41, 34],
    [-43, -17, 18, 30], [34, 25, 11, 22],
  ];
  model.append(...Object.keys(molecularData.metrics).map(name=>new Option(name,name)));
  const previewParams = [180,.10];
  let yaw = -.25, pitch = .12, assay = null, frame = 0, playing = false, previous = 0;

  function project([x,y,z]) {
    const u = x*Math.cos(yaw)-z*Math.sin(yaw);
    const depth = x*Math.sin(yaw)+z*Math.cos(yaw);
    const v = y*Math.cos(pitch)-depth*Math.sin(pitch);
    const w = y*Math.sin(pitch)+depth*Math.cos(pitch);
    const scale = 1.55*380/(380-w);
    return [260+u*scale, 162-v*scale, w, scale];
  }

  function draw(canvas, rate) {
    const ctx = canvas.getContext('2d');
    const backdrop = ctx.createRadialGradient(260,165,10,260,165,286);
    backdrop.addColorStop(0,'#255257');
    backdrop.addColorStop(1,'#091f26');
    ctx.fillStyle=backdrop;
    ctx.fillRect(0,0,520,340);
    ctx.strokeStyle='#527a76';
    ctx.lineWidth=.7;
    for(let i=-120;i<=120;i+=30){
      for(const endpoints of [[[i,-66,-120],[i,-66,120]],[[-120,-66,i],[120,-66,i]]]){
        const [a,b]=endpoints.map(project);
        ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
      }
    }
    const spheres = enzyme.map(([x,y,z,r],i)=>({point:[x,y,z], r, color:i%2?'#6bb593':'#459987'}));
    let phase = 0;
    {
      // One turn per 120 rate units each playback second, identically scaled in both views.
      phase = (Number(slider.value)*Math.max(0,rate)/120)%1;
      const product = phase >= .63;
      const z = phase < .36 ? 106*(1-phase/.36)+16 : product ? 16+106*(phase-.63)/.37 : 16;
      spheres.push({point:[product?44*(phase-.63)/.37:0,0,z],r:product?9:11,color:product?'#c1a6f5':'#ffd184'});
    }
    const visible = spheres.map(sphere=>({...sphere, position:project(sphere.point)}));
    visible.sort((a,b)=>a.position[2]-b.position[2]);
    for(const {position:[x,y,,scale],r,color} of visible) {
      const radius = r*scale;
      const light = ctx.createRadialGradient(x-radius*.35,y-radius*.42,radius*.07,x,y,radius);
      light.addColorStop(0,'#eaf8e5');
      light.addColorStop(.30,color);
      light.addColorStop(1,'#164749');
      ctx.fillStyle=light;
      ctx.beginPath();
      ctx.arc(x,y,radius,0,2*Math.PI);
      ctx.fill();
    }
    return phase;
  }

  function render() {
    const {example,dose,fixed} = assay || {
      example:null, dose:molecularData.actions[Number(get('dose').value)], fixed:molecularData.fixedDose,
    };
    const truth = example?.params || previewParams;
    const [vmax,km] = model.value ? example.estimates[model.value] : truth;
    [dose,fixed].forEach((index,i)=>{
      const concentration=molecularData.doses[index];
      const rate=vmax*concentration/(km+concentration);
      const reference=truth[0]*concentration/(truth[1]+concentration);
      const suffix=i?'fixed':'selected';
      get('label-'+suffix).textContent=concentration+' ppm · '+rate.toFixed(1)+' counts/min/min'+
        (model.value?' · error '+(rate-reference).toFixed(1)+' vs reference':'');
      const phase=draw(canvases[i],rate);
      const cycles=Math.floor(Number(slider.value)*Math.max(0,rate)/120);
      get('phase-'+suffix).textContent=(phase<.36?'Substrate approaching':phase<.63?'Bound substrate':'Product release')+' · '+cycles+' completed cycles';
    });
    get('time-readout').textContent=Number(slider.value).toFixed(1)+' / 8 s';
    get('model-detail').textContent=(model.value||(example?'Generating model':'Illustrative preview'))+' · Vmax '+vmax.toFixed(1)+' counts/min/min · Km '+km.toFixed(3)+' ppm';
  }

  function pause() {
    playing=false;
    cancelAnimationFrame(frame);
    toggle.textContent='Play simulation';
  }

  function animate(now) {
    const delta=Math.min(.05,(now-previous)/1000);
    previous=now;
    const time=Number(slider.value)+delta;
    slider.value=Math.min(8,time).toFixed(3);
    if(get('auto-orbit').checked)yaw+=delta*.5;
    render();
    if(time>=8)pause();
    else frame=requestAnimationFrame(animate);
  }

  toggle.onclick=()=>{
    if(playing){pause();return;}
    if(Number(slider.value)>=8)slider.value=0;
    playing=true;
    toggle.textContent='Pause simulation';
    previous=performance.now();
    frame=requestAnimationFrame(animate);
  };
  slider.oninput=()=>{pause();render();};
  model.onchange=render;
  get('reset-camera').onclick=()=>{yaw=-.25;pitch=.12;render();};
  for(const canvas of canvases){
    let pointer=null;
    function orbit(dx,dy){
      yaw+=dx;
      pitch=Math.max(-1.4,Math.min(1.4,pitch+dy));
      render();
    }
    canvas.onpointerdown=e=>{pointer=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{
      if(!pointer)return;
      orbit((e.clientX-pointer[0])*.012,(e.clientY-pointer[1])*.012);
      pointer=[e.clientX,e.clientY];
    };
    canvas.onlostpointercapture=()=>{pointer=null;};
    canvas.onkeydown=e=>{
      const move={ArrowLeft:[-.15,0],ArrowRight:[.15,0],ArrowUp:[0,-.15],ArrowDown:[0,.15]}[e.key];
      if(move){e.preventDefault();orbit(...move);}
    };
  }
  return {render, load(data){
    pause();
    assay=data;
    slider.value=0;
    model.value='';
    model.disabled=!data;
    get('scene-mode').textContent=data?'Held-out assay revealed. Switch estimators to compare predicted turnover.':'Preview uses illustrative parameters. Reveal the second rate to compare trained estimators for your assay.';
    render();
  }};
})();
