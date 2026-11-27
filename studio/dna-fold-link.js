(() => {
  const picker = document.getElementById('record');
  const link = document.getElementById('fold-link');
  const params = new URLSearchParams(location.search);
  const reqProtein = params.get('protein');
  const reqGene = params.get('gene');
  let index = reqProtein ? foldIds.indexOf(reqProtein) : -1;
  if (index < 0 && reqGene) {
    index = dnaRecords.findIndex(r => r.gene.toLowerCase() === reqGene.toLowerCase());
  }
  if (index >= 0) {
    picker.selectedIndex = index;
    picker.dispatchEvent(new Event('change'));
  }
  function sync() {
    const id = foldIds[picker.selectedIndex];
    const rec = dnaRecords[picker.selectedIndex];
    link.href = 'structure.html?protein=' + encodeURIComponent(id);
    link.textContent = 'Explore folded ' + rec.gene + ' protein in 3D →';
  }
  picker.addEventListener('change', sync);
  sync();
})();
