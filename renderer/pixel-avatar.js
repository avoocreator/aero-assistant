// Aero: avatar pixel-art prosedural dengan sistem ekspresi.
// Bola emas dengan visor gelap bermata cyan dan dua telinga yang melayang. Digambar per piksel di kanvas 56x56
// (ditampilkan 2x tanpa smoothing).
//
// Ekspresi dibentuk dari bagian-bagian terpisah: bentuk mata, alis, mulut, posisi telinga, kepala/badan, dan partikel
// (hati, bintang, tanda tanya, keringat, zzz, nada). Selain mengikuti mood dari aplikasi, Aero punya "kebiasaan" sendiri
// yang muncul acak saat diam (melirik, kedip ganda, kedip sebelah, penasaran, bersenandung, menguap, tertidur),
// dan pose terbang saat jendela berpindah tempat.
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
    eye: hex('#19c8ff'), eyeHi: hex('#9ff1ff'), eyeLo: hex('#0b84b8'), brow: hex('#1aa0d6'),
    warm: hex('#ff7a59'), warmHi: hex('#ffc0a6'),
    pink: hex('#ff6b9a'), pinkHi: hex('#ffc1d6'), tongue: hex('#ff7a9a'),
    gA: hex('#22f08a'), gB: hex('#5aa83a'),
    star: hex('#ffe27a'), white: hex('#ffffff'), drop: hex('#7fd6ff'), z: hex('#cfeeff'),
    shadow: (70 << 24)
  };

  const MOODS = ['neutral', 'happy', 'excited', 'thinking', 'curious', 'surprised', 'sad', 'love', 'playful', 'sleepy', 'annoyed'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Keadaan ----------
  let mood = 'neutral';                    // mood dari aplikasi
  let mouth = 0;                           // 0..1, kekuatan bicara
  const look = { x: 0, y: 0 };
  let temp = null;                         // perilaku sementara {mood, until, look, wink, blinkEvery}
  let blinkAt = performance.now() + 2200, blinkEnd = 0, doubleBlink = 0;
  let lastActive = performance.now();      // terakhir kali ada aktivitas (untuk ngantuk/tidur)
  let nextIdle = performance.now() + rnd(3500, 7000);
  let sleeping = false;
  let wakeUntil = 0;
  let moodSince = performance.now();
  let flight = null;                       // {dx, dy, t0} saat terbang
  let landUntil = 0;
  let jy = 0, jv = 0, squash = 0;          // lompat & penyok saat mendarat
  let lastT = performance.now();
  let particles = [];
  let nextSpawn = 0;

  const touch = () => { lastActive = performance.now(); if (sleeping) wake(); };

  function setMood(m) {
    const next = MOODS.includes(m) ? m : 'neutral';
    if (next !== 'neutral') touch();
    if (next === mood) return;
    mood = next;
    moodSince = performance.now();
    onMoodStart(next);
  }
  function setMouth(v) { mouth = clamp(v, 0, 1); if (v > 0.1) touch(); }
  function setLook(x, y) { look.x = clamp(x, -1, 1); look.y = clamp(y, -1, 1); }

  /** Ekspresi singkat yang kembali ke normal sendiri (mis. saat disentuh kursor). */
  function react(name, ms = 1200) {
    if (!MOODS.includes(name) || flight) return;
    touch();
    temp = { mood: name, until: performance.now() + ms };
    onMoodStart(name);
  }

  function wake() {
    sleeping = false;
    temp = { mood: 'surprised', until: performance.now() + 650 };
    onMoodStart('surprised');
  }

  function onMoodStart(m) {
    if (m === 'surprised') { jv = -22; spawn('exclaim'); }
    if (m === 'excited') jv = -17;
    if (m === 'curious') spawn('question');
    if (m === 'sad') { spawn('sweat'); }
    if (m === 'love') spawn('heart');
    if (m === 'playful') { spawn('sparkle'); spawn('sparkle'); }
    if (m === 'happy') jv = -9;
  }

  // ---------- Terbang ----------
  function fly(dx, dy) {
    touch();
    temp = null;
    flight = { dx: clamp(dx, -1, 1), dy: clamp(dy, -1, 1), t0: performance.now() };
  }
  function land() {
    if (!flight) return;
    flight = null;
    squash = 3;
    jv = -16;
    landUntil = performance.now() + 900;
    for (let i = 0; i < 4; i++) spawn('sparkle');
  }

  // ---------- Piksel dasar ----------
  const put = (x, y, c) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < N && y < N) px32[y * N + x] = c; };
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, c); };
  const bits = (rows, x, y, c, c2) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') put(x + i, y + j, c); else if (ch === '+' && c2 !== undefined) put(x + i, y + j, c2); }));

  function shape(inside, color) {
    const m = new Uint8Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inside(x + .5, y + .5)) m[y * N + x] = 1;
    const at = (x, y) => (x < 0 || y < 0 || x >= N || y >= N) ? 0 : m[y * N + x];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (m[y * N + x]) px32[y * N + x] = color(x + .5, y + .5);
      else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) px32[y * N + x] = C.line;
    }
  }
  const lit = l => l > .78 ? C.l1 : l > .5 ? C.l2 : l > .2 ? C.l3 : C.l4;

  function tri(ax, ay, bx, by, cx, cy) {
    const d = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
    return (x, y) => {
      const d1 = d(x, y, ax, ay, bx, by), d2 = d(x, y, bx, by, cx, cy), d3 = d(x, y, cx, cy, ax, ay);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    };
  }

  // ---------- Telinga, badan, visor ----------
  function drawEar(ox, oy, flip, spin) {
    const sx = flip ? -1 : 1, cx0 = flip ? 51 : 5;
    const P = [[cx0, 17], [cx0 + 6 * sx, 2], [cx0 + 16 * sx, 14]].map(([x, y]) => [x + ox, y + oy]);
    const t = tri(...P[0], ...P[1], ...P[2]);
    const inside = (x, y) => t(x, y) && P.every(([px, py]) => Math.hypot(x - px, y - py) > 1.6);
    const mx = (P[0][0] + P[1][0] + P[2][0]) / 3, my = (P[0][1] + P[1][1] + P[2][1]) / 3;
    shape(inside, (x, y) => {
      let l = .62 - ((x - mx) * sx * .045) - ((y - my) * .05) + (flip ? -.12 : .1);
      if (spin) l += Math.sin((x + y) * .9 + spin) * .08;
      return lit(l);
    });
    if (!flip) { put(cx0 + 2 + ox, 14 + oy, C.gA); put(cx0 + 3 + ox, 14 + oy, C.gA); put(cx0 + 4 + ox, 14 + oy, C.gB); }
  }

  function drawBody(bx, by, sq) {
    const cx = 27 + bx, cy = 33 + by, rx = 17 + sq, ry = 15 - sq;
    shape((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, (x, y) => {
      const nx = (x - cx) / rx, ny = (y - cy) / ry, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      return lit(-.5 * nx - .62 * ny + .55 * nz);
    });
    for (const [dx, dy, c] of [[-13, 9, C.gB], [-12, 10, C.gA], [-11, 10, C.gA], [-12, 11, C.gA], [-10, 11, C.gB], [-9, 12, C.gB], [-8, 13, C.gB]]) put(cx + dx, cy + dy, c);
    const px = cx + 12, py = cy + 1;
    shape((x, y) => ((x - px) / 4.6) ** 2 + ((y - py) / 7.2) ** 2 <= 1, (x, y) => lit(.42 - (x - px) * .06 - (y - py) * .035));
    rect(px - 1, py - 3, 3, 6, C.glass);
    return { cx, cy };
  }

  function drawVisor(cx, cy, fx, now, scanning) {
    const vx = cx - 3 + fx, vy = cy + 1, rx = 13.2, ry = 8.4;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const e = ((x + .5 - vx) / (rx + 1.4)) ** 2 + ((y + .5 - vy - .8) / (ry + 1.2)) ** 2;
      if (e <= 1 && y + .5 > vy + 1) put(x, y, C.l1);
    }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const e = ((x + .5 - vx) / rx) ** 2 + ((y + .5 - vy) / ry) ** 2;
      if (e <= 1) put(x, y, y + .5 < vy - 2 ? C.glass : C.glass2);
    }
    for (let i = -8; i <= 5; i++) put(vx + i, vy - 9 + (Math.abs(i + 1) > 5 ? 1 : 0), i % 5 === 0 ? C.gA : C.gB);
    if (scanning) { const k = Math.floor((now / 90) % 14) - 8; put(vx + k, vy - 9, C.eyeHi); put(vx + k + 1, vy - 9, C.gA); }
    return { vx, vy };
  }

  // ---------- Bagian wajah ----------
  const HEART5 = ['.#.#.', '#####', '#####', '.###.', '..#..'];
  const STAR5 = ['..#..', '.###.', '#####', '.###.', '..#..'];

  function eye(kind, x, ey, side, col) {
    const c = col || C.eye, hi = col ? C.warmHi : C.eyeHi, lo = col ? C.warm : C.eyeLo;
    switch (kind) {
      case 'open': rect(x, ey, 3, 5, c); put(x, ey, hi); put(x + 1, ey, hi); rect(x, ey + 4, 3, 1, lo); break;
      case 'wide': { const xx = x - (side === 0 ? 1 : 0); rect(xx, ey - 1, 4, 6, c); put(xx, ey - 1, hi); put(xx + 1, ey - 1, hi); put(xx + 1, ey, hi); rect(xx, ey + 4, 4, 1, lo); break; }
      case 'happy': put(x, ey + 3, c); put(x + 1, ey + 2, hi); put(x + 2, ey + 3, c); put(x + 1, ey + 1, c); put(x, ey + 4, lo); put(x + 2, ey + 4, lo); break;
      case 'sad': rect(x, ey + 1, 3, 4, c); put(side === 0 ? x : x + 2, ey + 1, C.glass2); put(x + 1, ey + 2, hi); rect(x, ey + 4, 3, 1, lo); break;
      case 'line': rect(x, ey + 2, 3, 1, c); break;
      case 'sleepy': rect(x, ey + 3, 3, 2, c); rect(x, ey + 2, 3, 1, lo); break;
      case 'heart': bits(HEART5, x - 1, ey, C.pink); put(x, ey + 1, C.pinkHi); break;
      case 'star': bits(STAR5, x - 1, ey, hi); put(x + 1, ey + 2, C.white); break;
      case 'angry': rect(x, ey + 1, 3, 4, c); put(side === 0 ? x + 2 : x, ey + 1, C.glass2); put(x, ey + 4, lo); put(x + 1, ey + 4, lo); put(x + 2, ey + 4, lo); break;
      case 'dizzy': bits(['#...#', '.#.#.', '..#..', '.#.#.', '#...#'], x - 1, ey, C.eyeHi); break;
    }
  }

  function brow(x, by, side, kind) {
    const c = kind === 'angry' ? C.warm : C.brow;
    switch (kind) {
      case 'flat': rect(x, by, 3, 1, c); break;
      case 'raise': rect(x, by - 1, 3, 1, c); break;
      case 'angry': if (side === 0) { put(x, by - 1, c); put(x + 1, by, c); put(x + 2, by + 1, c); } else { put(x, by + 1, c); put(x + 1, by, c); put(x + 2, by - 1, c); } break;
      case 'sad': if (side === 0) { put(x, by + 1, c); put(x + 1, by, c); put(x + 2, by - 1, c); } else { put(x, by - 1, c); put(x + 1, by, c); put(x + 2, by + 1, c); } break;
    }
  }

  function drawMouth(kind, mx, my, now) {
    const c = C.eye;
    switch (kind) {
      case 'cat': put(mx - 1, my, c); put(mx, my + 1, c); put(mx + 1, my + 1, c); put(mx + 2, my, c); break;
      case 'smile': put(mx - 2, my, c); put(mx - 1, my + 1, c); put(mx, my + 1, c); put(mx + 1, my + 1, c); put(mx + 2, my, c); break;
      case 'grin': rect(mx - 2, my, 6, 1, C.eyeHi); rect(mx - 2, my + 1, 6, 1, c); rect(mx - 1, my + 2, 4, 1, C.eyeLo); break;
      case 'flat': rect(mx - 1, my + 1, 4, 1, c); break;
      case 'o': rect(mx, my, 2, 3, c); rect(mx, my + 1, 2, 1, C.glass2); put(mx, my + 1, C.glass2); put(mx + 1, my + 1, C.glass2); break;
      case 'frown': put(mx - 1, my + 2, c); put(mx, my + 1, c); put(mx + 1, my + 1, c); put(mx + 2, my + 2, c); break;
      case 'tongue': put(mx - 2, my, c); put(mx - 1, my + 1, c); put(mx, my + 1, c); put(mx + 1, my + 1, c); put(mx + 2, my, c); rect(mx + 1, my + 2, 2, 2, C.tongue); put(mx + 1, my + 2, C.pinkHi); break;
      case 'yawn': { const h = 2 + Math.round((Math.sin(now / 350) + 1) * 1.4); rect(mx - 1, my, 4, h, c); rect(mx, my + 1, 2, Math.max(1, h - 2), C.glass2); break; }
      case 'blush': break;
    }
  }

  // ---------- Partikel ----------
  const SP = {
    heart: { rows: ['.#.#.', '#####', '.###.', '..#..'], col: () => C.pink, hi: C.pinkHi, vy: -9, life: 1.8 },
    star: { rows: ['.#.', '###', '.#.'], col: () => C.star, vy: -8, life: 1.2 },
    sparkle: { rows: ['.#.', '###', '.#.'], col: () => pick([C.star, C.eyeHi, C.white]), vy: -5, life: .9 },
    note: { rows: ['.###', '.#.#', '.#..', '##..', '##..'], col: () => C.eyeHi, vy: -7, life: 2 },
    zzz: { rows: ['###', '.#.', '###'], col: () => C.z, vy: -5, life: 2.6 },
    question: { rows: ['###', '..#', '.#.', '...', '.#.'], col: () => C.eyeHi, vy: -3, life: 1.6 },
    exclaim: { rows: ['##', '##', '##', '..', '##'], col: () => C.warm, vy: -3, life: 1.1 },
    sweat: { rows: ['.#', '##', '##'], col: () => C.drop, vy: 5, life: 1.4 }
  };
  function spawn(type) {
    const s = SP[type]; if (!s) return;
    const side = Math.random() < .5 ? 1 : -1;
    let x = side > 0 ? rnd(44, 51) : rnd(2, 9), y = rnd(20, 27);
    if (type === 'sweat') { x = side > 0 ? 38 : 14; y = 24; }
    if (type === 'zzz') { x = rnd(42, 48); y = 20; }
    if (type === 'sparkle') { x = rnd(8, 48); y = rnd(8, 40); }
    particles.push({ type, x, y, vx: type === 'sweat' ? 0 : side * rnd(.5, 3), vy: s.vy, age: 0, life: s.life, col: s.col(), ph: rnd(0, 6) });
    if (particles.length > 18) particles.shift();
  }
  function stepParticles(dt, now) {
    for (const p of particles) {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'heart' || p.type === 'note' || p.type === 'zzz') p.x += Math.sin(now / 300 + p.ph) * .25;
    }
    particles = particles.filter(p => p.age < p.life);
  }
  function drawParticles(now) {
    for (const p of particles) {
      const s = SP[p.type];
      const fade = p.age > p.life - .3 && Math.floor(now / 70) % 2 === 0;
      if (fade) continue;
      if (p.type === 'sparkle' && Math.floor(p.age * 12) % 2) continue;
      bits(s.rows, p.x, p.y, p.col, s.hi);
      if (p.type === 'heart') put(p.x + 1, p.y + 1, C.pinkHi);
    }
  }

  // ---------- Perilaku acak saat diam ----------
  const IDLE = [
    { w: 22, run: now => { const a = pick([-1.3, 1.3]); temp = { start: now, span: 1700, until: now + 1700, look: t => (t < .35 ? { x: a, y: 0 } : t < .7 ? { x: -a, y: -.3 } : { x: 0, y: 0 }) }; } },
    { w: 18, run: () => { doubleBlink = 2; blinkAt = 0; } },
    { w: 10, run: now => { temp = { until: now + 650, wink: true }; spawn('sparkle'); } },
    { w: 10, run: now => { temp = { until: now + 1500, mood: 'curious' }; onMoodStart('curious'); } },
    { w: 12, run: now => { temp = { until: now + 1400, mood: 'happy' }; onMoodStart('happy'); } },
    { w: 8, run: now => { temp = { until: now + 2400, mood: 'happy', hum: true }; spawn('note'); } },
    { w: 7, run: now => { temp = { until: now + 1100, look: () => ({ x: 0, y: -1 }) }; } },
    { w: 6, run: () => { jv = -15; } },
    { w: 5, run: now => { if (now - lastActive > 25000) temp = { until: now + 2600, mood: 'sleepy' }; else temp = { until: now + 1200, mood: 'playful' }; } }
  ];
  function idleDirector(now, state) {
    if (flight || state !== 'idle' || mood !== 'neutral' || temp || sleeping || now < wakeUntil) { nextIdle = Math.max(nextIdle, now + 1500); return; }
    if (now - lastActive > 110000) { sleeping = true; return; }
    if (now < nextIdle) return;
    const total = IDLE.reduce((a, b) => a + b.w, 0);
    let r = Math.random() * total;
    for (const b of IDLE) { if ((r -= b.w) <= 0) { b.run(now); break; } }
    nextIdle = now + rnd(3500, 9000);        // jeda panjang supaya tidak gelisah terus
  }

  // ---------- Render ----------
  function render(now = performance.now()) {
    const dt = Math.min(.05, (now - lastT) / 1000); lastT = now;
    const state = document.body.dataset.state || 'idle';
    if (state !== 'idle') touch();

    if (temp && now > temp.until) temp = null;
    idleDirector(now, state);
    if (flight && now - flight.t0 > 6000) flight = null;       // pengaman

    // mood efektif
    let m = mood;
    if (sleeping) m = 'sleepy';
    else if (flight) m = 'flying';
    else if (m === 'neutral' && temp?.mood) m = temp.mood;
    else if (m === 'neutral' && now < landUntil) m = 'happy';
    else if (m === 'neutral' && state === 'thinking') m = 'thinking';
    const listening = state === 'listening' && m === 'neutral';

    // kedip
    if (now > blinkAt) { blinkEnd = now + 130; blinkAt = doubleBlink > 0 ? now + 230 : now + 2200 + Math.random() * 3200; if (doubleBlink > 0) doubleBlink--; }
    const blinking = now < blinkEnd && m !== 'love' && m !== 'excited' && m !== 'happy';

    // fisika lompat
    jv += 95 * dt; jy += jv * dt;
    if (jy > 0) { if (jv > 12) squash = Math.max(squash, 1); jy = 0; jv = 0; }
    if (squash > 0 && Math.random() < .25) squash = Math.max(0, squash - 1);

    // tabel ekspresi
    const F = { eyeL: 'open', eyeR: 'open', brow: null, mouth: 'cat', earL: 0, earR: 0, earSp: 0, drop: 0, wig: 0, ecol: null, scan: false, bob: 1 };
    switch (m) {
      case 'happy': F.eyeL = F.eyeR = 'happy'; F.mouth = 'smile'; F.earL = F.earR = -1; F.wig = 1; break;
      case 'excited': F.eyeL = F.eyeR = 'star'; F.mouth = 'grin'; F.earL = F.earR = -2; F.wig = 2; F.bob = 2; break;
      case 'thinking': F.brow = ['raise', 'flat']; F.mouth = 'flat'; F.earL = -1; F.scan = true; break;
      case 'curious': F.eyeL = F.eyeR = 'wide'; F.brow = ['flat', 'raise']; F.mouth = 'o'; F.earL = -2; F.earR = 1; break;
      case 'surprised': F.eyeL = F.eyeR = 'wide'; F.brow = ['raise', 'raise']; F.mouth = 'o'; F.earL = F.earR = -2; break;
      case 'sad': F.eyeL = F.eyeR = 'sad'; F.brow = ['sad', 'sad']; F.mouth = 'frown'; F.earL = F.earR = 2; F.earSp = 1; F.drop = 1; F.bob = .5; break;
      case 'love': F.eyeL = F.eyeR = 'heart'; F.mouth = 'smile'; F.earL = F.earR = -1; F.wig = 1; break;
      case 'playful': F.eyeR = 'happy'; F.mouth = 'tongue'; F.earL = -1; F.earR = 1; F.wig = 1; break;
      case 'sleepy': F.eyeL = F.eyeR = 'sleepy'; F.mouth = sleeping ? 'cat' : 'yawn'; F.earL = F.earR = 1; F.drop = 1; F.bob = .5; break;
      case 'annoyed': F.eyeL = F.eyeR = 'angry'; F.brow = ['angry', 'angry']; F.mouth = 'flat'; F.earL = F.earR = 1; F.ecol = C.warm; break;
      case 'flying': F.eyeL = F.eyeR = 'wide'; F.mouth = 'smile'; F.wig = 2; F.bob = 0; break;
    }
    if (listening) { F.eyeL = F.eyeR = 'wide'; F.earL = F.earR = -1; F.wig = 1; }
    if (temp?.wink) F.eyeR = 'happy';
    if (blinking && !temp?.wink) { if (F.eyeL !== 'sleepy') F.eyeL = 'line'; if (F.eyeR !== 'sleepy') F.eyeR = 'line'; }

    // arah pandang (temp.look menimpa, terbang menghadap arah gerak)
    let lk = { x: look.x, y: look.y };
    if (temp?.look) lk = temp.look(clamp((now - (temp.start ?? now)) / (temp.span || 1500), 0, 1));
    if (m === 'thinking') lk = { x: -.8, y: -1 };
    if (flight) lk = { x: flight.dx * 1.2, y: flight.dy * .6 };
    if (m === 'sleepy' || m === 'love') lk = { x: 0, y: 0 };

    // posisi dasar
    const sp = state === 'speaking' ? 1.6 : state === 'listening' ? 1.2 : flight ? 3 : (m === 'sleepy' ? .5 : 1);
    const bobAmp = 1.2 * F.bob;
    const bob = Math.round(Math.sin(now * .0026 * sp) * bobAmp) + Math.round(jy) + F.drop;
    const earPh = now * .0026 * sp;
    const wigAmp = F.wig + (m === 'happy' && temp?.hum ? 1 : 0);
    const wigL = wigAmp ? Math.round(Math.sin(now * (flight ? .03 : .012)) * wigAmp) : 0;
    const wigR = wigAmp ? Math.round(Math.sin(now * (flight ? .03 : .012) + 1.6) * wigAmp) : 0;
    const lean = flight ? flight.dx : 0, liftY = flight ? flight.dy : 0;
    let earLy = Math.round(Math.sin(earPh + 1.7) * 1.4) + F.earL + wigL + bob;
    let earRy = Math.round(Math.sin(earPh + 3.1) * 1.4) + F.earR + wigR + bob;
    const trailX = Math.round(-lean * 2), trailY = Math.round(-liftY * 1.5);
    earLy += trailY; earRy += trailY;
    const sq = squash > 0 ? Math.min(2, squash) : (state === 'speaking' ? Math.round(Math.sin(now * .02) * .6) : 0);
    const bx = Math.round(lean * 1.4);
    const fx = clamp(Math.round(lk.x * 1.5), 0, 2);

    px32.fill(0);

    // bayangan lantai
    if (!flight) {
      const sw = clamp(11 + bob * 1.2, 4, 12);
      for (let x = -sw; x <= sw; x++) put(27 + x, 53, (x + 100) % 2 ? C.shadow : 0);
      for (let x = -sw + 3; x <= sw - 3; x++) put(27 + x, 54, C.shadow);
    }

    // garis kecepatan di belakang saat terbang
    if (flight) {
      const dir = Math.abs(flight.dx) >= Math.abs(flight.dy) ? 'h' : 'v';
      for (let i = 0; i < 4; i++) {
        const o = Math.floor(rnd(0, 18)), l = Math.floor(rnd(3, 8));
        if (dir === 'h') { const sx = flight.dx > 0 ? 2 + Math.floor(rnd(0, 4)) : 53 - Math.floor(rnd(0, 4)); rect(flight.dx > 0 ? sx : sx - l, 14 + o + i * 4, l, 1, C.l1); }
        else { const sy = flight.dy > 0 ? 1 + Math.floor(rnd(0, 3)) : 54 - Math.floor(rnd(0, 3)); rect(10 + o + i * 6, flight.dy > 0 ? sy : sy - l, 1, l, C.l1); }
      }
    }

    const spin = m === 'thinking' ? now * .012 : 0;
    drawEar(trailX - F.earSp, earLy, false, spin);
    drawEar(trailX + F.earSp, earRy, true, spin);
    const { cx, cy } = drawBody(bx, bob, sq);
    const { vx, vy } = drawVisor(cx, cy, fx, now, F.scan);

    const ey = vy - 3 + Math.round(lk.y * 1) + (m === 'sad' ? 1 : 0);
    const lx = Math.round(lk.x * 2);
    const exL = vx - 7 + lx, exR = vx + 4 + lx;
    eye(F.eyeL, exL, ey, 0, F.ecol);
    eye(F.eyeR, exR, ey, 1, F.ecol);
    if (F.brow) { const by = ey - 2; brow(exL, by, 0, F.brow[0]); brow(exR, by, 1, F.brow[1]); }

    const mx = vx - 1 + lx, my = ey + 6;
    // saat bicara, mulut mengikuti suara tetapi mata tetap sesuai ekspresi
    if (mouth > .55) { rect(mx - 1, my, 4, 2, C.eye); rect(mx, my + 2, 2, 1, C.eyeLo); }
    else if (mouth > .2) { rect(mx - 1, my, 4, 1, C.eye); rect(mx, my + 1, 2, 1, C.eye); }
    else drawMouth(F.mouth, mx, my, now);

    if (state === 'error') rect(vx - 1, vy - 9, 3, 1, hex('#ff4d5e'));

    // partikel berdasarkan mood
    nextSpawn -= dt;
    if (nextSpawn <= 0) {
      const gap = { love: .55, excited: .3, sleepy: 1.2, happy: temp?.hum ? .6 : 99, sad: 3 }[m];
      if (gap) {
        spawn({ love: 'heart', excited: 'star', sleepy: 'zzz', happy: 'note', sad: 'sweat' }[m]);
        nextSpawn = gap * rnd(.8, 1.3);
      } else nextSpawn = .5;
    }
    stepParticles(dt, now);
    drawParticles(now);

    // tiga titik berpikir
    if (m === 'thinking') { const k = Math.floor(now / 350) % 4; for (let i = 0; i < k; i++) rect(44 + i * 3, 20, 2, 2, C.eyeHi); }

    g.putImageData(buf, 0, 0);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);

  return { setMood, setMouth, setLook, react, fly, land, MOODS };
})();

window.PixelAvatar = PixelAvatar;
window.Avatar = PixelAvatar;
