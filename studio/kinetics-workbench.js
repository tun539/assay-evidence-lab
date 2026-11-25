'use strict';

const byId = id => document.getElementById(id);
const models = {
  shared: 'Shared Vmax and Km',
  split_vmax: 'Condition-specific Vmax',
  split_km: 'Condition-specific Km',
  split_both: 'Condition-specific Vmax and Km',
};
const {rows, folds} = kineticsData;
const data = rows.map(row => ({id: row.rownames, concentration: +row.conc, rate: +row.rate, state: row.state}));
const colors = {treated: '#096b54', untreated: '#884627'};

function parameters(values, model, state) {
  const treated = state === 'treated';
  return [
    treated && ['split_vmax', 'split_both'].includes(model) ? values[2] : values[0],
    treated && ['split_km', 'split_both'].includes(model) ? values.at(-1) : values[1],
  ];
}

function predict(values, model, state, concentration) {
  const [vmax, km] = parameters(values, model, state);
  return vmax * concentration / (km + concentration);
}

function observations(fold, model) {
  return data.map(row => {
    const prediction = predict(fold.models[model], model, row.state, row.concentration);
    return {...row, prediction, residual: row.rate - prediction, held: row.concentration === fold.level};
  });
}

function rmse(records) {
  return Math.sqrt(records.reduce((sum, row) => sum + row.residual ** 2, 0) / records.length);
}

function draw(id, records, fold, model, residualPlot) {
  const right = 678, left = 72, top = 20, bottom = 218;
  const maxX = folds.at(-1).level;
  const maxY = residualPlot
    ? Math.max(1, ...records.map(row => Math.abs(row.residual))) * 1.12
    : Math.max(...records.flatMap(row => [row.rate, row.prediction])) * 1.12;
  const minY = residualPlot ? -maxY : 0;
  const x = value => left + value / maxX * (right - left);
  const y = value => bottom - (value - minY) / (maxY - minY) * (bottom - top);
  const ticks = Array.from({length: 5}, (_, i) => minY + i * (maxY - minY) / 4);
  const grid = ticks.map(value => {
    const pos = y(value);
    return '<line x1="'+left+'" x2="'+right+'" y1="'+pos+'" y2="'+pos+'" stroke="'+(value===0?'#7b9185':'#d6e2d8')+'"/><text x="64" y="'+(pos+4)+'" text-anchor="end">'+value.toFixed(0)+'</text>';
  }).join('');
  const curves = residualPlot ? '' : Object.entries(colors).map(([state, color]) => {
    const points = Array.from({length: 81}, (_, i) => {
      const concentration = i * maxX / 80;
      return x(concentration)+','+y(predict(fold.models[model],model,state,concentration));
    }).join(' ');
    return '<polyline fill="none" stroke="'+color+'" stroke-width="2.5" points="'+points+'"/>';
  }).join('');
  const points = records.map(row => {
    const px = x(row.concentration), py = y(residualPlot ? row.residual : row.rate);
    const label = row.state+' #'+row.id+' measured '+row.rate+', predicted '+row.prediction.toFixed(2);
    const shape = row.held
      ? '<path d="M-5 -5L5 5 M-5 5L5 -5" stroke-width="2.5"/>'
      : '<circle r="4"/>';
    return '<g transform="translate('+px+' '+py+')" fill="'+colors[row.state]+'" stroke="'+colors[row.state]+'"><title>'+label+'</title>'+shape+'</g>';
  }).join('');
  const xTicks = Array.from({length: 5}, (_, i) => i * maxX / 4).map(value => '<text x="'+x(value)+'" y="237" text-anchor="middle">'+value.toFixed(2)+'</text>').join('');
  byId(id).innerHTML = grid + '<line x1="'+x(fold.level)+'" x2="'+x(fold.level)+'" y1="'+top+'" y2="'+bottom+'" stroke="#7a634a" stroke-dasharray="4 4"/>' + curves + points + xTicks +
    '<text x="375" y="258" text-anchor="middle">Substrate concentration (ppm)</text><text transform="translate(17 125) rotate(-90)" text-anchor="middle">'+(residualPlot?'Residual':'Rate')+' (counts/min/min)</text>';
}

function table(id, values) {
  const body = byId(id);
  body.replaceChildren();
  for (const row of values) {
    const tr = body.insertRow();
    for (const value of row) tr.insertCell().textContent = value;
  }
}

const pooled = Object.fromEntries(Object.keys(models).map(model => [
  model, folds.flatMap(fold => observations(fold, model).filter(row => row.held)),
]));

function render() {
  const fold = folds[byId('concentration').value];
  const model = byId('model').value;
  const records = observations(fold, model);
  const held = records.filter(row => row.held);
  byId('fold-summary').textContent = fold.level+' ppm held out · '+held.length+' held-out observations · '+(records.length-held.length)+' fitted observations';
  byId('parameters').textContent = Object.keys(colors).map(state => {
    const [vmax, km] = parameters(fold.models[model], model, state);
    return state+' Vmax '+vmax.toFixed(2)+' counts/min/min, Km '+km.toFixed(4)+' ppm';
  }).join(' · ');
  draw('curves', records, fold, model, false);
  draw('residuals', records, fold, model, true);
  table('replicates', held.map(row => [row.id,row.state,row.rate,row.prediction.toFixed(2),row.residual.toFixed(2)]));
  table('comparison', Object.entries(models).map(([key,name]) => {
    const test = observations(fold,key).filter(row => row.held);
    const mae = test.reduce((sum,row) => sum + Math.abs(row.residual),0) / test.length;
    return [name,mae.toFixed(2),rmse(test).toFixed(2),rmse(pooled[key]).toFixed(2)];
  }));
}

folds.forEach((fold,i) => byId('concentration').add(new Option(String(fold.level),i)));
Object.entries(models).forEach(([id,name]) => byId('model').add(new Option(name,id)));
byId('concentration').value = '2';
byId('concentration').onchange = byId('model').onchange = render;
byId('download').onclick = () => {
  const lines = ['model,observation,condition,concentration_ppm,observed,predicted,residual'];
  for (const [model,records] of Object.entries(pooled)) {
    for (const row of records) lines.push([model,row.id,row.state,row.concentration,row.rate,row.prediction,row.residual].join(','));
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')],{type:'text/csv'}));
  const link = document.createElement('a');
  link.href=url;
  link.download='kinetics-held-out-predictions.csv';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
};
render();

byId('save-evidence').onclick = () => {
  const fold = folds[byId('concentration').value];
  const model = byId('model').value;
  const records = observations(fold,model);
  const held = records.filter(row=>row.held);
  try {
    evidenceRecords.capture({
      kind:'measured', title:models[model]+' · '+fold.level+' ppm',
      dataset:'Puromycin · galactosyltransferase initial rates', method:'Leave one concentration out',
      metric:'Held-out RMSE', value:rmse(held), unit:'counts/min/min',
      source:'https://stat.ethz.ch/R-manual/R-devel/library/datasets/html/Puromycin.html',
      details:{comparisonKey:'puromycin-holdout-'+fold.level, concentrationPpm:fold.level, model,
        trainingIds:records.filter(row=>!row.held).map(row=>row.id),
        fittedParameters:fold.models[model], heldOut:held},
    });
    byId('save-status').textContent='Saved the selected fold, model, and residuals.';
  } catch(error) {
    byId('save-status').textContent='Could not save the run. '+error.message;
  }
};
