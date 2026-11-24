'use strict';
const byId = id => document.getElementById(id);
const pairs = {A:'T',T:'A',G:'C',C:'G'};
const color = {A:'#61d3a3',T:'#ffa86d',C:'#8abaff',G:'#df9af5'};
const complement = seq => Array.from(seq, base => pairs[base]).join('');
const reverse = seq => Array.from(seq).reverse().join('');
const record = () => dnaRecords[byId('record').selectedIndex];
const offset = () => Number(byId('start').value)-1;
const fragment = () => record().seq.slice(offset(),offset()+12);
function plot(seq){
  const angle = Number(byId('angle').value)*Math.PI/180;
  const layers = [];
  for(let strand=0;strand<2;strand++){
    let last;
    for(let i=0;i<seq.length;i++){
      const phase = angle + 2*Math.PI*i/10.5 + Math.PI*strand;
      const x = 58+36*i, y = 120+57*Math.cos(phase), z = Math.sin(phase);
      const base = strand ? pairs[seq[i]] : seq[i];
      if(last) layers.push([(last.z+z)/2,'<line x1="'+last.x+'" y1="'+last.y+'" x2="'+x+'" y2="'+y+'" stroke="'+(strand?'#b5c9d5':'#73c9bc')+'" stroke-width="4"/>']);
      layers.push([z/2,'<line x1="'+x+'" y1="120" x2="'+x+'" y2="'+y+'" stroke="'+color[base]+'" stroke-width="4"/>']);
      layers.push([z+.01,'<circle cx="'+x+'" cy="'+y+'" r="9" fill="'+color[base]+'"/><text x="'+x+'" y="'+(y+4)+'" text-anchor="middle" font-size="11">'+base+'</text>']);
      if(i===0 || i===seq.length-1){
        const end = (i===0) !== Boolean(strand) ? '5′':'3′';
        layers.push([2,'<text x="'+(i===0?x-34:x+12)+'" y="'+(y+(strand?16:-6))+'" fill="white">'+end+'</text>']);
      }
      last={x,y,z};
    }
  }
  byId('helix').innerHTML=layers.sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join('');
}
function refresh(){
  const r=record(),seq=fragment(),comp=complement(seq),task=byId('task').selectedIndex;
  byId('gene').textContent=r.gene+' · '+r.group;
  byId('note').textContent=r.note;
  byId('source').href='https://www.kegg.jp/entry/'+r.id;
  byId('source').textContent=r.species+' · '+r.id;
  byId('range').textContent='Reference positions '+(offset()+1)+'–'+(offset()+12)+' of the 60 bp excerpt';
  byId('strands').textContent='5′ '+seq+' 3′\n3′ '+comp+' 5′';
  byId('counts').textContent=Object.keys(pairs).map(b=>b+' '+Array.from(seq).filter(x=>x===b).length).join('  ·  ')+'  (reference strand)';
  byId('question').textContent=['Pair each reference base from left to right.','Pair the bases, then read the opposite strand from its 5′ end.','Read 1 starts at position 1 of the window. Read 2 ends at position 12 and was sequenced from the opposite strand. Orient it and merge the four overlapping bases.'][task];
  byId('prompt').textContent=task===2?'Read 1   5′ '+seq.slice(0,8)+' 3′\nRead 2   5′ '+reverse(comp.slice(4))+' 3′':'Reference   5′ '+seq+' 3′';
  byId('key').textContent=byId('strands').textContent+'\nOpposite, 5′ → 3′: '+reverse(comp);
  byId('answer').value='';byId('feedback').textContent='';document.querySelector('details').open=false;
  plot(seq);
}
dnaRecords.forEach(r=>byId('record').add(new Option(r.species+' · '+r.gene)));
byId('record').onchange=()=>{byId('start').value=1;refresh();};
byId('start').oninput=byId('task').onchange=refresh;
byId('angle').oninput=()=>plot(fragment());
byId('next').onclick=()=>{byId('start').value=(offset()+13)%49+1;refresh();};
byId('quiz').onsubmit=e=>{
  e.preventDefault();
  const seq=fragment(),task=byId('task').selectedIndex;
  const answer=byId('answer').value.toUpperCase().replace(/\s/g,'');
  const expected=[complement(seq),reverse(complement(seq)),seq][task];
  let message='Correct. Your sequence and strand direction match.';
  if(!/^[ACGT]+$/.test(answer)) message='Use only A, C, G and T.';
  else if(answer.length!==seq.length) message='Enter exactly 12 bases.';
  else if(answer!==expected) message=answer===reverse(expected)?'The bases are in reverse order. Check the requested strand ends.':'Check base '+(Array.from(answer).findIndex((b,i)=>b!==expected[i])+1)+' in your answer.';
  byId('feedback').textContent=message;
};
byId('export').onclick=()=>{
  const r=record(), data='>'+r.id+' coding_fragment '+(offset()+1)+'-'+(offset()+12)+' orientation=5to3\n'+fragment()+'\n';
  const url=URL.createObjectURL(new Blob([data],{type:'text/plain'}));
  const a=document.createElement('a');a.href=url;a.download=r.gene+'-'+(offset()+1)+'.fasta';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
refresh();
