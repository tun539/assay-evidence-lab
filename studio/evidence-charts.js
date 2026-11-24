// Each cell includes its numerical value so the scale can be read without color.
function evidenceMatrix(parent, caption, headers, rows, labels, signed=false){
  const table=document.createElement('table');
  table.className='evidence-matrix';
  table.createCaption().textContent=caption;
  const head=table.createTHead().insertRow();
  for(const label of headers){const th=document.createElement('th');th.scope='col';th.textContent=label;head.append(th);}
  const peak=Math.max(0.000001,...rows.flat().map(Math.abs));
  const body=table.createTBody();
  rows.forEach((values,i)=>{
    const tr=body.insertRow(),th=document.createElement('th');th.scope='row';th.textContent=labels[i];tr.append(th);
    for(const value of values){
      const cell=tr.insertCell(), intensity=Math.abs(value)/peak;
      cell.style.background='hsl('+(signed&&value<0?25:163)+' 48% '+(97-70*intensity)+'%)';
      cell.style.color=intensity>.65?'white':'#102c28';
      cell.textContent=Number.isInteger(value)?value:value.toFixed(3);
    }
  });
  const wrap=document.createElement('div');wrap.style.overflowX='auto';wrap.append(table);parent.append(wrap);
}
