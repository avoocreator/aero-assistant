// Aero: avatar pixel-art prosedural. Bola emas dengan visor gelap bermata cyan
// dan sepasang "telinga" yang melayang terpisah. Digambar per piksel di kanvas 56x56
// (ditampilkan 2x tanpa smoothing), jadi tidak ada blur atau glow ala neon.
const PixelAvatar = (() => {
  const cv = document.getElementById('avatar');
  const g = cv.getContext('2d');
  const N = cv.width;                       // 56
  const buf = g.createImageData(N, N);
  const px32 = new Uint32Array(buf.data.buffer);

  const hex = h => { const n = parseInt(h.slice(1), 16); return (255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | (n >> 16); };
  const C = {
    line: hex('#3a1410'),
    l1: hex('#fbe88c'), l2: hex('#f1bd57'), l3: hex('#dd9238'), l4: hex('#b8461f'),
    glass: hex('#0a0a10'), glass2: hex('#14141c'),
    eye: hex('#19c8ff'), eyeHi: hex('#9ff1ff'), eyeLo: hex('#0b84b8'),
    gA: hex('#22f08a'), gB: hex('#5aa83a'),
    shadow: (70 << 24)
  };
  const BANDS = [C.l4, C.l3, C.l2, C.l1];

  let mood = 'neutral', mouth = 0;
  const look = { x: 0, y: 0 };
  let blinkAt = performance.now() + 2200, blinkEnd = 0;
  let pulse = 0;                            // kilatan kecil saat mood berubah

  function setMood(m) { mood = m || 'neutral'; pulse = 1; }
  function setMouth(v) { mouth = Math.max(0, Math.min(1, v)); }
  function setLook(x, y) { look.x = Math.max(-1, Math.min(1, x)); look.y = Math.max(-1, Math.min(1, y)); }

  const put = (x, y, c) => { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < N && y < N) px32[y * N + x] = c; };
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };

  // Mask bentuk -> isi berwarna (fn mengembalikan warna) + garis tepi gelap 1px.
  function shape(inside, color) {
    const m = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inside(x + .5, y + .5)) m[y * N + x] = 1;
    const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? 0 : m[y * N + x];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (m[y * N + x]) px32[y * N + x] = color(x + .5, y + .5);
      else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) px32[y * N + x] = C.line;
    }
  }

  // Cahaya jatuh dari kiri atas -> 4 pita warna.
  function lit(l) { return l > .78 ? C.l1 : l > .5 ? C.l2 : l > .2 ? C.l3 : C.l4; }

  function tri(ax, ay, bx, by, cx, cy) {
    const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    return (x, y) => {
      const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
  }

  function drawEar(ox, oy, flip, spin) {
    const sx = flip ? -1 : 1, cx0 = flip ? 51 : 5;
    const P = [[cx0, 17], [cx0 + 6 * sx, 2], [cx0 + 16 * sx, 14]].map(([x, y]) => [x + ox, y + oy]);
    const t = tri(...P[0], ...P[1], ...P[2]);
    // sudut dibulatkan: buang piksel yang terlalu dekat dengan ujung
    const inside = (x, y) => t(x, y) && P.every(([px, py]) => Math.hypot(x - px, y - py) > 1.6);
    const mx = (P[0][0] + P[1][0] + P[2][0]) / 3, my = (P[0][1] + P[1][1] + P[2][1]) / 3;
    shape(inside, (x, y) => {
      let l = .62 - ((x - mx) * sx * .045) - ((y - my) * .05) + (flip ? -.12 : .1);
      if (spin) l += Math.sin((x + y) * .9 + spin) * .08;
      return lit(l);
    });
    // aksen hijau kecil di tepi bawah telinga kiri, seperti pada referensi
    if (!flip) { put(cx0 + 2 + ox, 14 + oy, C.gA); put(cx0 + 3 + ox, 14 + oy, C.gA); put(cx0 + 4 + ox, 14 + oy, C.gB); }
  }

  function drawBody(by, sq) {
    const cx = 27, cy = 33 + by, rx = 17 + sq, ry = 15 - sq;
    shape((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, (x, y) => {
      const nx = (x - cx) / rx, ny = (y - cy) / ry, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      return lit(-.5 * nx - .62 * ny + .55 * nz);
    });
    // lumut/aksen hijau di bawah-kiri badan
    for (const [dx, dy, c] of [[-13, 9, C.gB], [-12, 10, C.gA], [-11, 10, C.gA], [-12, 11, C.gA], [-10, 11, C.gB], [-9, 12, C.gB], [-8, 13, C.gB]]) put(cx + dx, cy + dy, c);
    // pod samping kanan (lubang sensor)
    const px = cx + 12, py = cy + 1;
    shape((x, y) => ((x - px) / 4.6) ** 2 + ((y - py) / 7.2) ** 2 <= 1, (x, y) => lit(.42 - (x - px) * .06 - (y - py) * .035));
    rect(px - 1, py - 3, 3, 6, C.glass);
    return { cx, cy };
  }

  function drawVisor(cx, cy, t, state) {
    const vx = cx - 3, vy = cy + 1, rx = 13.2, ry = 8.4;
    // rim terang di bawah visor
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const e = ((x + .5 - vx) / (rx + 1.4)) ** 2 + ((y + .5 - vy - .8) / (ry + 1.2)) ** 2;
      if (e <= 1 && y + .5 > vy + 1) put(x, y, C.l1);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const e = ((x + .5 - vx) / rx) ** 2 + ((y + .5 - vy) / ry) ** 2;
      if (e <= 1) put(x, y, y + .5 < vy - 2 ? C.glass : C.glass2);
    }
    // garis hijau di bumbungan visor; saat thinking, titik terang menyapu
    for (let i = -8; i <= 5; i++) put(vx + i, vy - 9 + (Math.abs(i + 1) > 5 ? 1 : 0), i % 5 === 0 ? C.gA : C.gB);
    if (state === 'thinking') { const k = Math.floor((t / 90) % 14) - 8; put(vx + k, vy - 9, C.eyeHi); put(vx + k + 1, vy - 9, C.gA); }
    return { vx, vy };
  }

  function drawEyes(vx, vy, now, state) {
    const blinking = now < blinkEnd;
    const lx = Math.round(look.x * 1.6), ly = Math.round(look.y * 1.0);
    let ey = vy - 4 + ly - (state === 'thinking' ? 1 : 0), w = 3, h = 5;
    const ex = [vx - 7 + lx, vx + 4 + lx];
    if (mood === 'surprised') { h = 6; w = 4; ey -= 1; }
    for (let i = 0; i < 2; i++) {
      const x = ex[i];
      if (blinking) { rect(x, ey + 2, w, 1, C.eye); continue; }
      if (mood === 'happy') {            // mata ^ ^
        put(x, ey + 3, C.eye); put(x + 1, ey + 2, C.eyeHi); put(x + 2, ey + 3, C.eye); put(x + 1, ey + 1, C.eye);
        continue;
      }
      if (mood === 'sad') {              // mata turun, miring
        rect(x, ey + 1, w, h - 1, C.eye); put(x + (i ? 2 : 0), ey + 1, C.glass2); put(x + (i ? 2 : 0), ey + 2, C.eyeLo);
        continue;
      }
      rect(x, ey, w, h, C.eye);
      put(x, ey, C.eyeHi); put(x + 1, ey, C.eyeHi);            // kilau di atas
      rect(x, ey + h - 1, w, 1, C.eyeLo);                     // bayangan bawah
    }
    // mulut kecil bentuk "w" seperti referensi; terbuka saat bicara
    const mx = vx - 1 + lx, my = ey + h + 1;
    if (mouth > .55) { rect(mx - 1, my, 4, 2, C.eye); rect(mx, my + 2, 2, 1, C.eyeLo); }
    else if (mouth > .2) { rect(mx - 1, my, 4, 1, C.eye); rect(mx, my + 1, 2, 1, C.eye); }
    else if (mood === 'sad') { put(mx, my + 1, C.eye); put(mx + 1, my + 1, C.eye); put(mx - 1, my + 2, C.eye); put(mx + 2, my + 2, C.eye); }
    else { put(mx - 1, my, C.eye); put(mx, my + 1, C.eye); put(mx + 1, my + 1, C.eye); put(mx + 2, my, C.eye); }
  }

  function render(now = performance.now()) {
    const state = document.body.dataset.state || 'idle';
    if (now > blinkAt) { blinkEnd = now + 130; blinkAt = now + 2200 + Math.random() * 3200; }
    pulse = Math.max(0, pulse - .06);

    px32.fill(0);
    const sp = state === 'speaking' ? 1.6 : state === 'listening' ? 1.2 : 1;
    const bob = Math.round(Math.sin(now * .0026 * sp) * 1.2);            // naik-turun, per piksel utuh
    const earBob = Math.round(Math.sin(now * .0026 * sp + 1.7) * 1.4);   // telinga melayang beda fase
    const earBob2 = Math.round(Math.sin(now * .0026 * sp + 3.1) * 1.4);
    const lift = state === 'listening' ? -1 : 0;                         // telinga naik sedikit saat mendengar
    const sq = state === 'speaking' ? Math.round(Math.sin(now * .02) * .6) : 0;

    // bayangan lantai (dither 2 tingkat, mengecil saat naik)
    const sw = 11 - bob * 1.5;
    // (y 53-54 aman: kanvas 56)
    for (let x = -sw; x <= sw; x++) put(27 + x, 53, (x + 100) % 2 ? C.shadow : 0);
    for (let x = -sw + 3; x <= sw - 3; x++) put(27 + x, 54, C.shadow);

    const spin = state === 'thinking' ? now * .012 : 0;
    drawEar(0, earBob + lift + bob, false, spin);
    drawEar(0, earBob2 + lift + bob, true, spin);
    const { cx, cy } = drawBody(bob, sq);
    const { vx, vy } = drawVisor(cx, cy, now, state);
    drawEyes(vx, vy, now, state);

    if (state === 'error') rect(vx - 1, vy - 9, 3, 1, hex('#ff4d5e'));
    if (pulse > .5) { put(cx + 14, cy - 12, C.l1); put(cx + 15, cy - 13, C.l1); put(cx + 13, cy - 13, C.l1); put(cx + 15, cy - 11, C.l1); }

    g.putImageData(buf, 0, 0);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  return { setMood, setMouth, setLook };
})();

window.PixelAvatar = PixelAvatar;
window.Avatar = PixelAvatar;
