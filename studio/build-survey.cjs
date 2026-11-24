// Regenerate the browser dataset with the same slice and solver as the interactive lab.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const elements = {};
const context = vm.createContext({document:{getElementById(id){return elements[id] ||= {};}}});
const sources = ['dna-data.js','fold-catalog.js', ...fs.readdirSync(path.join(__dirname,'folds')).map(file=>'folds/'+file)];
for(const source of sources) vm.runInContext(read(source),context);
vm.runInContext(read('tomography.js').split('function raster')[0],context);
const rows = vm.runInContext(`
function run(){}
const rows=[];
for(const id of foldIds){
  get('specimen').value=id; choose();
  const slice=sample(0);
  const mean=slice.reduce((sum,value)=>sum+value,0)/slice.length;
  for(const span of [90,180]) for(const angles of [4,8,24,48]){
    const error=solve(slice,angles,span*Math.PI/180,20).history.at(-1);
    rows.push({id,gene:dnaRecords[foldIds.indexOf(id)].gene,span,angles,mean,error});
  }
}
rows`,context);
fs.writeFileSync(path.join(__dirname,'survey-data.js'),'const surveyRows = '+JSON.stringify(rows)+';\n');
