// Ikon toolbar pixel 9x9, digambar dari bitmap teks lalu dipasang sebagai background tiap tombol.
(() => {
  const I = {
    grip: ['.........','.#.#.#.#.','.........','.#.#.#.#.','.........','.#.#.#.#.','.........','.#.#.#.#.','.........'],
    mic: ['...###...','..#####..','..#####..','..#####..','#.#####.#','#..###..#','.#.....#.','...###...','..#####..'].map(r=>r),
    type: ['.........','#########','#.#.#.#.#','#########','#.#.#.#.#','#########','#.#####.#','#########','.........'],
    fast: ['.........','.........','.........','.........','.........','.........','##.......','##.......','##.......'],
    balanced: ['.........','.........','.........','.........','....##...','....##...','##..##...','##..##...','##..##...'],
    deep: ['.........','.........','......##.','......##.','....####.','....####.','##..####.','##..####.','##..####.'],
    eye: ['.........','..#####..','.#.###.#.','#.##.##.#','#.#####.#','.#.###.#.','..#####..','.........','.........'],
    reset: ['..####...','.#....#..','#......#.','#....#.#.','#...###..','.....#...','#......#.','.#....#..','..####...'],
    hide: ['.........','.........','.........','.........','.#######.','.........','.........','.........','.........'],
    quit: ['.........','.##...##.','..##.##..','...###...','....#....','...###...','..##.##..','.##...##.','.........'],
    send: ['.........','....#....','....##...','#########','....###..','....##...','....#....','.........','.........']
  };
  const draw = (rows, color) => {
    const c = document.createElement('canvas'); c.width = c.height = 9;
    const g = c.getContext('2d'); g.fillStyle = color;
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '#') g.fillRect(x, y, 1, 1); }));
    return `url(${c.toDataURL()})`;
  };
  const ink = '#14141f';
  const map = { btnMic: 'mic', btnType: 'type', btnEye: 'eye', btnReset: 'reset', btnHide: 'hide', btnQuit: 'quit', btnSend: 'send', grip: 'grip' };
  for (const [id, k] of Object.entries(map)) document.getElementById(id)?.style.setProperty('--ico', draw(I[k], ink));
  const th = document.getElementById('btnThink');
  for (const k of ['fast', 'balanced', 'deep']) th?.style.setProperty('--ico-' + k, draw(I[k], ink));
  document.getElementById('btnSend')?.style.setProperty('--ico', draw(I.send, '#ffffff'));
})();
