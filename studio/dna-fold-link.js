(() => {
  const picker=document.getElementById('record'), link=document.getElementById('fold-link');
  const index=foldIds.indexOf(new URLSearchParams(location.search).get('protein'));
  if(index>=0){picker.selectedIndex=index;picker.dispatchEvent(new Event('change'));}
  function sync(){
    link.href='structure.html?protein='+foldIds[picker.selectedIndex];
    link.textContent='Explore the folded '+dnaRecords[picker.selectedIndex].gene+' protein in 3D →';
  }
  picker.addEventListener('change',sync);sync();
})();
