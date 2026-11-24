// Independent camera for the complete coding sequence. The strand exercise keeps its own window.
(() => {
  const get = id => document.getElementById(id);
  const canvas = get('gene-stage');
  const ctx = canvas.getContext('2d');
  const pos = get('position');
  const zoom = get('camera-zoom');
  const bases = {A:'#61d3a3',T:'#ffa86d',C:'#8abaff',G:'#df9af5'};
  const opposite = {A:'T',T:'A',C:'G',G:'C'};
  let overview = false, yaw = -.21, pitch = .18, drag = null;

  function render() {
    const r = dnaRecords[get('record').selectedIndex];
    const seq = codingDNA[r.id];
    const selected = Number(pos.value)-1;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const w = rect.width, h = rect.height, dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {
      canvas.width = Math.round(w*dpr); canvas.height = Math.round(h*dpr);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle = '#112d32'; ctx.fillRect(0,0,w,h);
    const first = overview ? 0 : Math.min(Math.max(0,selected-11),seq.length-24);
    const last = overview ? seq.length : first+24;
    const columns = overview ? 60 : 24;
    const rows = Math.ceil((last-first)/columns);
    const rowSpace = 3.45;
    const scale = Math.min((w-42)/((columns-1)*.34+2.7),(h-54)/((rows-1)*rowSpace+3.25))*Number(zoom.value)/100;
    const layers = [];
    function project(x,y,z) {
      const u = x*Math.cos(yaw)+z*Math.sin(yaw), v = z*Math.cos(yaw)-x*Math.sin(yaw);
      const depth = y*Math.sin(pitch)+v*Math.cos(pitch);
      return {x:w/2+scale*u,y:h/2-scale*(y*Math.cos(pitch)-v*Math.sin(pitch)),z:depth};
    }
    function tube(a,b,c,width) {
      layers.push({a,b,c,width,z:(a.z+b.z)/2});
    }
    let previous = [];
    for(let i=first;i<last;i++) {
      const col=(i-first)%columns, row=Math.floor((i-first)/columns);
      const x=(col-(columns-1)/2)*.34, midY=((rows-1)/2-row)*rowSpace;
      const phase=2*Math.PI*i/10.5;
      const mid=project(x,midY,0);
      for(let strand=0;strand<2;strand++) {
        const sign=strand?-1:1, base=strand?opposite[seq[i]]:seq[i];
        const p=project(x,midY+sign*Math.cos(phase),sign*Math.sin(phase));
        if(col) tube(previous[strand],p,strand?'#b5c9d5':'#73c9bc',Math.max(.8,scale*.16));
        tube(p,mid,bases[base],Math.max(.75,scale*.12));
        layers.push({p,c:bases[base],radius:Math.max(.8,scale*.145),z:p.z,marked:i===selected});
        previous[strand]=p;
      }
    }
    ctx.lineCap='round';
    for(const item of layers.sort((a,b)=>a.z-b.z)){
      ctx.beginPath();
      if(item.p){
        const {p,radius}=item;
        ctx.arc(p.x,p.y,radius,0,2*Math.PI);ctx.fillStyle=item.c;ctx.fill();
        if(item.marked){ctx.strokeStyle='white';ctx.lineWidth=2;ctx.stroke();}
      } else {
        ctx.moveTo(item.a.x,item.a.y);ctx.lineTo(item.b.x,item.b.y);ctx.strokeStyle=item.c;ctx.lineWidth=item.width;ctx.stroke();
      }
    }
    get('model-caption').textContent=r.species+' · '+r.gene+' · '+seq.length.toLocaleString('en-US')+' bp in the complete coding sequence.';
    get('model-position').textContent='bp '+(selected+1)+' · '+seq[selected]+'–'+opposite[seq[selected]]+' · view '+(first+1)+'–'+last;
    canvas.setAttribute('aria-label',get('model-caption').textContent+' '+get('model-position').textContent+' Arrow keys rotate the model.');
  }
  function reset(){yaw=-.21;pitch=.18;zoom.value=100;render();}
  function mode(full){
    overview=full;
    get('detail-mode').setAttribute('aria-pressed',String(!full));
    get('full-mode').setAttribute('aria-pressed',String(full));
    reset();
  }
  function changeRecord(){
    const r=dnaRecords[get('record').selectedIndex];
    pos.max=codingDNA[r.id].length;pos.value=1;reset();
  }
  canvas.onpointerdown=e=>{canvas.setPointerCapture(e.pointerId);drag=[e.clientX,e.clientY];};
  canvas.onpointermove=e=>{
    if(!drag)return;
    yaw+=(e.clientX-drag[0])*.01;pitch+=(e.clientY-drag[1])*.01;
    drag=[e.clientX,e.clientY];render();
  };
  canvas.onlostpointercapture=()=>{drag=null;};
  canvas.onkeydown=e=>{
    const turn={ArrowLeft:[-.1,0],ArrowRight:[.1,0],ArrowUp:[0,-.1],ArrowDown:[0,.1]}[e.key];
    if(turn){e.preventDefault();yaw+=turn[0];pitch+=turn[1];render();}
  };
  get('record').addEventListener('change',changeRecord);
  get('full-mode').onclick=()=>mode(true);get('detail-mode').onclick=()=>mode(false);
  get('reset-camera').onclick=reset;pos.oninput=zoom.oninput=render;
  new ResizeObserver(render).observe(canvas);
  changeRecord();
})();
