/* global kineticsData, el, frame, text, studies, colors */
const assayValidation = (() => {
 const measurements = kineticsData.rows.map(row => ({
   id: row.rownames, level: Number(row.conc), rate: Number(row.rate), state: row.state,
 }));
 const folds = kineticsData.folds;
 const keys = Object.keys(studies.enz);
 const units = 'counts/min/min';

 function estimate(params, key, row) {
   const treated = row.state === 'treated';
   const vmax = treated && ['split_vmax','split_both'].includes(key) ? params[2] : params[0];
   const km = treated && ['split_km','split_both'].includes(key) ? params.at(-1) : params[1];
   return vmax * row.level / (km + row.level);
 }

 const evidence = folds.map(fold => Object.fromEntries(keys.map(key => {
   const test = measurements.filter(row => row.level === fold.level).map(row => {
     const predicted = estimate(fold.models[key], key, row);
     return {...row, predicted, residual: row.rate - predicted};
   });
   const rmse = Math.sqrt(test.reduce((sum,row) => sum + row.residual ** 2, 0) / test.length);
   return [key, {test, rmse}];
 })));
 const peak = Math.max(...evidence.flatMap(fold => keys.map(key => fold[key].rmse)));
 const selector = el('validationFold');
 selector.replaceChildren(...folds.map((fold,i) => new Option(fold.level+' ppm',i)));
 selector.value = '2';

 function matrix(active, selected) {
   let svg = text(20,31,'Held-out RMSE · '+units,'font-weight="bold"');
   svg += text(20,58,'Each column excludes one substrate concentration from both conditions.');
   folds.forEach((fold,i) => {
     const x = 199 + 71*i;
     svg += text(x+31,97,fold.level+' ppm','text-anchor="middle"');
     keys.forEach((key,j) => {
       const y = 109 + 45*j, score = evidence[i][key].rmse;
       const light = 96-61*score/peak;
       const stroke = selected===key && active===i ? '#813d20' : 'none';
       svg += '<rect x="'+x+'" y="'+y+'" width="63" height="37" rx="5" fill="hsl(159 42% '+light+'%)" stroke="'+stroke+'" stroke-width="3"/>';
       svg += text(x+31,y+24,score.toFixed(2),'text-anchor="middle" fill="'+(light<52?'white':'#193e35')+'"');
     });
   });
   keys.forEach((key,i) => { svg += text(20,133+45*i,studies.enz[key]); });
   svg += text(20,322,'Darker cells indicate higher prediction error. Outline marks the inspected fold.');
   return frame(svg,'Concentration holdout error for four enzyme models');
 }

 function render(key) {
   const active = Number(selector.value), fold = folds[active], result = evidence[active][key];
   const winner = keys.reduce((a,b) => evidence[active][a].rmse <= evidence[active][b].rmse ? a : b);
   el('chartTitle').textContent = 'Galactosyltransferase validation matrix';
   el('canvas').innerHTML = matrix(active,key);
   el('metric').textContent = result.rmse.toFixed(2);
   el('unit').textContent = 'Selected fold RMSE · '+units;
   const range = active===0 || active===folds.length-1 ? 'Extrapolation beyond the fitted concentration range.' : 'Interpolation within the fitted concentration range.';
   el('caption').textContent = fold.level+' ppm withheld · '+result.test.length+' test observations · '+(measurements.length-result.test.length)+' fitted observations. '+range;
   el('meaning').textContent = studies.enz[winner]+' gives the lowest error at '+fold.level+' ppm ('+evidence[active][winner].rmse.toFixed(2)+' '+units+'). Use the matrix to see where that ranking changes.';
   const tbody = el('validationRows');
   tbody.replaceChildren();
   for (const row of result.test) {
     const tr = tbody.insertRow();
     for (const value of [row.id,row.state,row.rate,row.predicted.toFixed(2),row.residual.toFixed(2)]) tr.insertCell().textContent = value;
   }
 }

 selector.onchange = () => render(el('model').value);
 return {render};
})();
