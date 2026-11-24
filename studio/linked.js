'use strict';
const element=id=>document.getElementById(id);
const fold=element('fold'), map=element('map'), sequence=element('sequence');
const letters=Object.fromEntries('ALA:A ARG:R ASN:N ASP:D CYS:C GLN:Q GLU:E GLY:G HIS:H ILE:I LEU:L LYS:K MET:M PHE:F PRO:P SER:S THR:T TRP:W TYR:Y VAL:V'.split(' ').map(s=>s.split(':')));
let rows,points,pair,texture,screen,yaw=.4,pitch=.3,drag;
const distance=(a,b)=>Math.hypot(a[2]-b[2],a[3]-b[3],a[4]-b[4]);
const label=r=>r[0]+' '+r[1];
foldIds.forEach((id,i)=>element('protein').add(new Option(dnaRecords[i].gene+' · '+dnaRecords[i].species,id)));
function changeProtein(){
  const model=bundledFolds[element('protein').value];rows=model.rows;
  element('source').href=model.source;
  const center=[2,3,4].map(k=>rows.reduce((s,r)=>s+r[k],0)/rows.length);
  const xyz=rows.map(r=>center.map((c,k)=>r[k+2]-c));
  const extent=Math.max(...xyz.map(p=>Math.hypot(...p)));
  points=xyz.map(p=>p.map(v=>v*225/extent));
  texture=document.createElement('canvas');texture.width=texture.height=rows.length;
  const ctx=texture.getContext('2d'),pixels=ctx.createImageData(rows.length,rows.length);
  pair=[0,0];
  for(let y=0;y<rows.length;y++)for(let x=0;x<rows.length;x++){
    const contact=distance(rows[x],rows[y])<=8;
    pixels.data.set(contact?[34,112,91,255]:[230,240,232,255],4*(y*rows.length+x));
    if(contact && y-x>pair[1]-pair[0])pair=[x,y];
  }
  ctx.putImageData(pixels,0,0);sequence.replaceChildren();
  rows.forEach((r,i)=>{const b=document.createElement('button');b.textContent=letters[r[0]]||'X';b.title=label(r);b.setAttribute('aria-label',label(r));b.onclick=()=>pick(i);sequence.append(b);});
  element('slot').value='0';refresh();
}
function pick(i){const slot=Number(element('slot').value);pair[slot]=i;element('slot').value=String(1-slot);refresh();}
function drawFold(){
  const ctx=fold.getContext('2d');
  ctx.fillStyle='#102f31';ctx.fillRect(0,0,520,520);
  screen=points.map(([x,y,z])=>{
    const u=x*Math.cos(yaw)+z*Math.sin(yaw),v=z*Math.cos(yaw)-x*Math.sin(yaw);
    return [260+u,260-y*Math.cos(pitch)+v*Math.sin(pitch),y*Math.sin(pitch)+v*Math.cos(pitch)];
  });
  function line(a,b,color,width){ctx.beginPath();ctx.moveTo(...a.slice(0,2));ctx.lineTo(...b.slice(0,2));ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  screen.map((p,i)=>i).slice(1).sort((i,j)=>screen[i][2]-screen[j][2]).forEach(i=>line(screen[i-1],screen[i],'hsl(158 44% '+(52+screen[i][2]/12)+'%)',3));
  ctx.setLineDash([5,4]);line(screen[pair[0]],screen[pair[1]],'#fff',2);ctx.setLineDash([]);
  pair.forEach((i,k)=>{const [x,y]=screen[i];ctx.fillStyle=k?'#c2a8ff':'#ffc364';ctx.beginPath();ctx.arc(x,y,k?5:8,0,2*Math.PI);ctx.fill();ctx.font='bold 16px sans-serif';ctx.fillText(k?'B':'A',x+9,y+(k?16:-7));});
}
function refresh(){
  const [a,b]=pair,n=rows.length,d=distance(rows[a],rows[b]);
  Array.from(sequence.children).forEach((button,i)=>{button.className=i===a?'a':i===b?'b':'';button.setAttribute('aria-pressed',String(i===a||i===b));});
  element('measurement').textContent='A · '+label(rows[a])+'   /   B · '+label(rows[b])+'   ·   '+d.toFixed(2)+' Å   ·   '+Math.abs(rows[a][1]-rows[b][1])+' positions apart   ·   '+(d<=8?'within':'outside')+' 8 Å';
  const ctx=map.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(texture,0,0,520,520);
  const x=(a+.5)*520/n,y=(b+.5)*520/n;ctx.strokeStyle='#783660';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,520);ctx.moveTo(0,y);ctx.lineTo(520,y);ctx.stroke();drawFold();
}
function xy(e,canvas){const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*520/r.width,(e.clientY-r.top)*520/r.height];}
map.onclick=e=>{pair=xy(e,map).map(v=>Math.min(rows.length-1,Math.max(0,Math.floor(v*rows.length/520))));refresh();};
fold.onpointerdown=e=>{fold.setPointerCapture(e.pointerId);drag={x:e.clientX,y:e.clientY,moved:0};};
fold.onpointermove=e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved+=Math.hypot(dx,dy);yaw+=dx*.012;pitch+=dy*.012;drag.x=e.clientX;drag.y=e.clientY;drawFold();};
fold.onpointerup=e=>{if(drag&&drag.moved<4){const [x,y]=xy(e,fold);let best=12,index=-1;screen.forEach(([u,v],i)=>{const d=Math.hypot(x-u,y-v);if(d<best){best=d;index=i;}});if(index>=0)pick(index);}drag=null;};
fold.onpointercancel=()=>{drag=null;};
fold.onkeydown=e=>{const delta={ArrowLeft:[-.12,0],ArrowRight:[.12,0],ArrowUp:[0,.12],ArrowDown:[0,-.12]}[e.key];if(delta){e.preventDefault();yaw+=delta[0];pitch+=delta[1];drawFold();}};
element('protein').onchange=changeProtein;changeProtein();
