const data = window.assayResults;
const repo='https://github.com/tun539/assay-evidence-lab/blob/main/';
const el=id=>document.getElementById(id);
const studies={enz:{shared:'Shared curve',split_vmax:'Separate plateaus',split_km:'Separate half-saturation',split_both:'Separate both parameters'},cell:{all:'All 30 features',size_only:'Direct size only',without_direct_size:'Without direct size',majority_baseline:'Majority baseline'}};
const colors=['#175c55','#ab4c29'];
const text=(x,y,t,opts='')=>'<text x="'+x+'" y="'+y+'" '+opts+'>'+t+'</text>';
function frame(content,title){return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 650 355" role="img" aria-label="'+title+'" style="font:14px Arial,sans-serif;fill:#193e35"><title>'+title+'</title><rect width="650" height="355" fill="#f3f8ed"/>'+content+'</svg>'}
function enzyme(key){
 const fit=data.fits[key],p=fit.params;
 const X=x=>76+Math.log(x/.02)/Math.log(55)*528,Y=y=>269-y/230*194;
 let s=text(22,32,'GALACTOSYLTRANSFERASE','font-size="13" letter-spacing="2"')+text(76,62,'Initial rate (counts/min/min)');
 for(const y of [0,50,100,150,200]){s+='<path stroke="#ceddcb" d="M76 '+Y(y)+' H604"/>'+text(65,Y(y)+4,y,'text-anchor="end"')}
 for(const x of [.02,.06,.11,.22,.56,1.1])s+=text(X(x),292,x,'text-anchor="middle"');
 for(const [i,state] of ['untreated','treated'].entries()){
 const v=i&&['split_both','split_vmax'].includes(key)?p[2]:p[0],k=i&&['split_both','split_km'].includes(key)?p[p.length-1]:p[1];
 const pts=Array.from({length:90},(_,j)=>{const x=.02*Math.pow(55,j/89);return X(x)+','+Y(v*x/(k+x))}).join(' ');
 s+='<polyline points="'+pts+'" fill="none" stroke="'+colors[i]+'" stroke-width="3" '+(i?'stroke-dasharray="7 4"':'')+'/>';
 for(const r of data.rows.filter(r=>r.state===state)){s+='<circle cx="'+X(+r.conc)+'" cy="'+Y(+r.rate)+'" r="4.5" fill="'+colors[i]+'" stroke="white"><title>'+state+' · '+r.conc+' ppm · '+r.rate+' counts/min/min</title></circle>'}
 s+=text(90+i*200,340,'● '+state,'fill="'+colors[i]+'"');
 }
 s+=text(340,315,'Substrate concentration (ppm, log scale)','text-anchor="middle"');
 el('canvas').innerHTML=frame(s,'Measured rates and fitted curves');
 el('metric').textContent=fit.rmse.toFixed(2);el('unit').textContent='Held-concentration RMSE · counts/min/min';
 el('caption').textContent='Dots show all 23 measured rates. Lines are full-data fits. The inspector scores predictions with an entire concentration held out.';
 el('meaning').textContent=key==='shared'?'A single curve forces both conditions to share the same plateau and half-saturation point. Compare the separation between observations at the highest concentrations.':key==='split_km'?'The curves can shift horizontally while sharing a plateau. Check whether that constraint describes the high-concentration observations.':key==='split_both'?'This four-parameter fit has the lowest pooled error. Its gain over separate plateaus alone is about 0.30 counts/min/min.':'Allowing the plateau to vary reduces held-out error from 19.33 to 11.92. Both curves retain the same apparent half-saturation concentration.';
 el('limit').textContent='Each condition comes from one run. Independent preparations would separate treatment effects from run-to-run variation.';
 el('source').href=repo+'kinetics/predictions.csv';
}
function cytology(key){
 const m=data.cytology[key];let s=text(24,32,'HOLDOUT CLASSIFICATION','font-size="13" letter-spacing="2"')+text(320,68,'Predicted label','text-anchor="middle"');
 for(const [i,label] of ['Benign','Malignant'].entries()){s+=text(251+174*i,95,label,'text-anchor="middle"')+text(149,144+85*i,label,'text-anchor="end"')}
 for(const [i,n] of [m.tn,m.fp,m.fn,m.tp].entries()){
 const x=169+i%2*174,y=104+Math.floor(i/2)*85;
 s+='<rect x="'+x+'" y="'+y+'" width="166" height="77" rx="8" fill="'+(i===0||i===3?'#c5e0ca':'#f2dcca')+'"/>'+text(x+83,y+48,n,'font-size="36" text-anchor="middle"');
 }
 s+=text(25,190,'Actual label','transform="rotate(-90 25 190)" text-anchor="middle"')+text(330,312,'114 held-out specimens · threshold 0.50','text-anchor="middle"');
 el('canvas').innerHTML=frame(s,'Confusion matrix for '+studies.cell[key]);el('metric').textContent=m.auc.toFixed(4);el('unit').textContent='Held-out ROC-AUC';
 el('caption').textContent='Rows show the dataset label. Columns show the predicted label. The lower-left cell counts missed malignant specimens.';
 el('meaning').textContent='This configuration missed '+m.fn+' of 42 positive specimens and classified '+m.fp+' of 72 negative specimens as positive. ROC-AUC summarizes ranking across thresholds.';
 el('limit').textContent='Correlated shape descriptors may retain size information after size columns are removed. External specimens would test whether the result transfers to another laboratory.';
 el('source').href=repo+'NucleusAudit/results/metrics.json';
}
function evidenceMap(enz){
 const key=el('model').value;
 const items=enz?[
 ['OBSERVATIONS','Substrate series','6 concentrations'],
 ['CONDITION A','Untreated','11 rate observations'],
 ['CONDITION B','Treated','12 rate observations'],
 ['MODEL COMPARISON',studies.enz[key],'RMSE '+data.fits[key].rmse.toFixed(2)]
 ]:[
 ['OBSERVATIONS','Nuclear morphology','569 specimens'],
 ['TRAINING','Fit and select','455 specimens'],
 ['HOLDOUT','Score once','114 specimens'],
 ['EVALUATION',studies.cell[key],'AUC '+data.cytology[key].auc.toFixed(4)]];
 let s='<defs><marker id="tip" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="#738d78"/></marker></defs>';
 const edges=enz?['M325 87 Q325 109 166 127','M325 87 Q325 109 484 127','M166 198 Q166 222 325 249','M484 198 Q484 222 325 249']:['M325 87 Q325 109 166 127','M325 87 Q325 109 484 127','M281 159 H365','M484 198 Q484 222 325 249'];
 for(const d of edges)s+='<path d="'+d+'" stroke="#738d78" stroke-width="2" fill="none" marker-end="url(#tip)"/>';
 const boxes=[[210,14],[50,130],[370,130],[210,252]];
 items.forEach(([a,b,c],i)=>{const [x,y]=boxes[i];const dark=i===3;s+='<rect x="'+x+'" y="'+y+'" width="230" height="70" rx="12" fill="'+(dark?'#205444':'#ffffff')+'" stroke="#a4bfa7"/>'+text(x+13,y+18,a,'font-size="11" letter-spacing="1.5" fill="'+(dark?'#d6efbb':'#426b55')+'"')+text(x+13,y+40,b,'font-size="17" font-weight="bold" fill="'+(dark?'white':'#193e35')+'"')+text(x+13,y+59,c,'font-size="14" fill="'+(dark?'#e3efdf':'#465b50')+'"')});
 el('canvas').innerHTML=frame(s,'Evidence diagram for '+items[3][1]);
 el('chartTitle').textContent=enz?'Galactosyltransferase assay design':'Nuclear morphology evaluation design';
 el('caption').textContent=enz?'Both conditions share the same concentration grid. Each validation fold removes one concentration from both conditions.':'The training split fits the classifier. The frozen model scores held-out specimens. Both assets are available in the repository.';
}
function render(){const e=el('study').value==='enz';el('chartTitle').textContent=e?'Reaction velocity by substrate concentration':'Nuclear morphology · confusion matrix';(e?enzyme:cytology)(el('model').value);if(el('view').value==='map')evidenceMap(e)}
function setStudy(key){const s=el('study').value;el('model').replaceChildren(...Object.entries(studies[s]).map(([v,l])=>new Option(l,v)));el('model').value=key||(s==='enz'?'split_vmax':'all');render()}
el('study').onchange=()=>setStudy();el('model').onchange=render;el('view').onchange=render;
el('ask').onsubmit=e=>{e.preventDefault();const q=el('query').value.toLowerCase();let s,k;if(/cytology|nucle|classif|confusion|morphology|size|baseline/.test(q)){s='cell';k=/baseline/.test(q)?'majority_baseline':/without|remov/.test(q)?'without_direct_size':/size/.test(q)?'size_only':'all'}else if(/enzym|plateau|saturat|kinetic|vmax|both|shared|puromycin|galacto|\bkm\b/.test(q)){s='enz';k=/both/.test(q)?'split_both':/shared|common/.test(q)?'shared':/half|\bkm\b/.test(q)?'split_km':'split_vmax'}else{el('status').textContent='Available topics include enzyme plateaus, half-saturation, cytology errors and size ablation.';return}el('study').value=s;el('view').value=/diagram|map|workflow|design/.test(q)?'map':'chart';setStudy(k);el('status').textContent='Opened '+studies[s][k]+'.'};
el('download').onclick=()=>{const svg=el('canvas').querySelector('svg');const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));const a=document.createElement('a');a.href=url;a.download=el('study').value+'-'+el('model').value+'-'+el('view').value+'.svg';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
setStudy();
