'use strict';
const byId = id => document.getElementById(id);
const {doses,anchor,actions,bins,q,examples,metrics,policies} = molecularData;
const families = ['Lower plateau · lower Km','Higher plateau · lower Km','Lower plateau · higher Km','Higher plateau · higher Km'];

function table(id, values) {
 const body = byId(id);
 for (const row of values) {
   const tr = body.insertRow();
   for (const value of row) tr.insertCell().textContent = value;
 }
}
function current() {
 const example = examples[Number(byId('episode').value)];
 const rate = example.rates[anchor];
 const bin = bins.filter(value => rate >= value).length;
 return {example, rate, values: q[bin]};
}
function reset() {
 const {rate, values} = current();
 molecularScene.load(null);
 byId('first').textContent = doses[anchor]+' ppm · observed rate '+rate.toFixed(1)+' counts/min/min';
 byId('result').textContent = '';
 byId('mechanism').textContent = 'Select the second concentration to reveal the observed rate and compare it with the simulator’s noiseless rate.';
 byId('measure').disabled = byId('policy').disabled = byId('dose').disabled = false;
 byId('actions').replaceChildren(...values.map((value,i) => {
   const label=document.createElement('label'), bar=document.createElement('progress');
   label.textContent=doses[actions[i]]+' ppm · Q '+value.toFixed(2);
   bar.max=1;bar.value=value;bar.setAttribute('aria-label','Estimated terminal reward at '+doses[actions[i]]+' ppm');
   label.append(bar);return label;
 }));
}
examples.forEach((_,i)=>byId('episode').add(new Option('Assay '+(i+1),i)));
actions.forEach((dose,i)=>byId('dose').add(new Option(doses[dose]+' ppm',i)));
byId('episode').onchange=reset;
byId('policy').onclick=()=>{
 const {values}=current();
 byId('dose').value=values.indexOf(Math.max(...values));
 byId('measure').focus();
};
byId('measure').onclick=()=>{
 const {example}=current(), choice=Number(byId('dose').value), dose=actions[choice];
 molecularScene.load({example, dose, fixed:molecularData.fixedDose});
 const [vmax,km]=example.params, fraction=doses[dose]/(km+doses[dose]);
 byId('result').textContent=doses[dose]+' ppm · observed '+example.rates[dose].toFixed(1)+' counts/min/min · predicted '+families[example.decoded[choice]]+' · generating family '+families[example.family];
 byId('mechanism').textContent='The generating model gives Km '+km.toFixed(3)+' ppm and Vmax '+vmax.toFixed(1)+' counts/min/min. At this concentration it reaches '+(100*fraction).toFixed(1)+'% of Vmax, for a noiseless rate of '+(fraction*vmax).toFixed(1)+' counts/min/min.';
 byId('measure').disabled=byId('policy').disabled=byId('dose').disabled=true;
};
table('ml',Object.entries(metrics).map(([name,[vmax,km]])=>[name,vmax.toFixed(2),km.toFixed(4)]));
table('rl',Object.entries(policies).map(([name,value])=>[name,(value*100).toFixed(2)+'%']));
byId('split').textContent=molecularData.train+' training curves · '+molecularData.rlTrain+' separate policy-training episodes · '+molecularData.test+' held-out curves. Learned minus fixed dose accuracy '+(100*molecularData.gain).toFixed(2)+' percentage points (paired 95% bootstrap interval '+molecularData.gainInterval.map(value=>(100*value).toFixed(2)).join(' to ')+').';
reset();
