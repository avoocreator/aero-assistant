// Roam: Aero terbang berpindah tempat di layar, kapan saja dia mau.
//
// Jendela Aero (transparan) digeser sepanjang lintasan melengkung ke titik baru; renderer memainkan pose terbang
// (condong ke arah gerak, telinga mengepak, garis kecepatan) dan animasi mendarat.
//
// Kapan terbang:
//  - acak setiap beberapa puluh detik sampai beberapa menit (tidak terus-menerus),
//  - tiba-tiba saat pengguna sedang beraktivitas (mouse bergerak), dengan peluang kecil per detik,
//  - kadang setelah selesai bicara atau menyelesaikan tugas.
// Tidak pernah terbang saat sedang mendengar/berpikir/bicara, ada bubble, kolom ketik terbuka, kursor di atas avatar,
// atau Operator sedang bekerja.

const WIN_W = 420;
const WIN_H = 720;
const ANCHOR_FROM_BOTTOM = 130;           // pusat avatar berada kira-kira 130px dari dasar jendela
const BUBBLE_ROOM = 330;                  // ruang di atas avatar untuk bubble
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const anchorOf = b => ({ x: b.x + b.width / 2, y: b.y + b.height - ANCHOR_FROM_BOTTOM });
const boundsFor = (a, size = { width: WIN_W, height: WIN_H }) => ({ x: Math.round(a.x - size.width / 2), y: Math.round(a.y - (size.height - ANCHOR_FROM_BOTTOM)), width: size.width, height: size.height });

/** Batas titik jangkar yang aman: jendela tetap utuh di layar secara horizontal, ada ruang bubble di atas. */
function limits(wa, size = { width: WIN_W }) {
  return {
    minX: wa.x + size.width / 2 + 12, maxX: wa.x + wa.width - size.width / 2 - 12,
    minY: wa.y + BUBBLE_ROOM, maxY: wa.y + wa.height - ANCHOR_FROM_BOTTOM
  };
}

function pickTarget(from, wa, cursor, home, rng = Math.random, size) {
  const L = limits(wa, size);
  if (L.maxX - L.minX < 200 || L.maxY - L.minY < 60) return null;
  for (let i = 0; i < 14; i++) {
    let t;
    if (home && rng() < .22) t = { ...home };
    else {
      const side = rng();
      let x;
      if (side < .35) x = L.minX + rng() * Math.min(260, L.maxX - L.minX);                  // dekat tepi kiri
      else if (side < .7) x = L.maxX - rng() * Math.min(260, L.maxX - L.minX);              // dekat tepi kanan
      else x = L.minX + rng() * (L.maxX - L.minX);
      t = { x, y: L.minY + rng() * (L.maxY - L.minY) };
    }
    t = { x: clamp(t.x, L.minX, L.maxX), y: clamp(t.y, L.minY, L.maxY) };
    const d = Math.hypot(t.x - from.x, t.y - from.y);
    if (d < 240) continue;                                                              // terlalu dekat, tidak seru
    if (cursor && Math.hypot(t.x - cursor.x, t.y - (cursor.y)) < 260) continue;        // jangan mendarat di atas kursor
    return t;
  }
  return null;
}

/** Titik pada kurva Bezier kuadrat. */
function bezier(p0, c, p1, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}
function bezierDir(p0, c, p1, t) {
  const dx = 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x);
  const dy = 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y);
  const m = Math.hypot(dx, dy) || 1;
  return { dx: dx / m, dy: dy / m };
}

function createRoamer(o) {
  const cfg = o.config;
  const rng = o.rng || Math.random;
  const now = o.now || Date.now;
  const T = o.timers || { setTimeout, clearTimeout, setInterval, clearInterval };
  const scale = o.durationScale || 1;

  let flying = null;               // { timer, cancel }
  let lastFlightAt = 0;
  let roamTimer = null, pollTimer = null;
  let lastCursor = null;
  let stopped = true;

  const cooldown = () => (cfg().roam?.cooldownSec ?? 30) * 1000;
  const enabled = () => cfg().roam?.enabled !== false;

  function canFly() {
    const w = o.getWin();
    if (stopped || !enabled() || flying || !w || w.isDestroyed() || !w.isVisible()) return false;
    if (o.isBusy()) return false;
    return now() - lastFlightAt >= cooldown();
  }

  function fly(reason) {
    if (!canFly()) return false;
    const w = o.getWin();
    const b = w.getBounds();
    const from = anchorOf(b);
    const wa = o.getWorkArea(from);
    const cursor = o.getCursor?.();
    const size = { width: b.width, height: b.height };
    const L = limits(wa, size);
    const to = pickTarget(from, wa, cursor, o.getHome?.(), rng, size);
    if (!to) return false;

    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const dur = clamp(dist / 900 * 1000 + 500, 900, 2400) * scale;
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const arc = Math.min(200, dist * .38) * (.6 + rng() * .6);
    const ctrl = { x: mid.x + (rng() - .5) * dist * .25, y: mid.y - arc };

    const t0 = now();
    let lastDirSent = 0;
    const d0 = bezierDir(from, ctrl, to, .05);
    o.send({ kind: 'start', dx: d0.dx, dy: d0.dy, dur, reason });

    const step = () => {
      const win = o.getWin();
      if (!win || win.isDestroyed()) return finish(false);
      const p = clamp((now() - t0) / dur, 0, 1);
      const e = ease(p);
      const pos = bezier(from, ctrl, to, e);
      // selama terbang boleh sedikit lebih tinggi dari batas bubble, tapi tetap di dalam layar
      const a = { x: clamp(pos.x, L.minX, L.maxX), y: clamp(pos.y, wa.y + 120, L.maxY) };
      win.setBounds(boundsFor(a, size), false);
      if (now() - lastDirSent > 110 && p < .92) {
        const d = bezierDir(from, ctrl, to, e);
        o.send({ kind: 'dir', dx: d.dx, dy: d.dy });
        lastDirSent = now();
      }
      if (p >= 1) finish(true);
    };
    const finish = ok => {
      if (!flying) return;
      T.clearInterval(flying.timer);
      flying = null;
      lastFlightAt = now();
      const win = o.getWin();
      if (ok && win && !win.isDestroyed()) win.setBounds(boundsFor(to, size), false);
      o.send({ kind: 'end' });
    };
    flying = { timer: T.setInterval(step, o.frameMs || 16), cancel: () => finish(false) };
    return true;
  }

  function cancel() { flying?.cancel(); }

  function scheduleRoam() {
    T.clearTimeout(roamTimer);
    if (stopped) return;
    const lo = (cfg().roam?.minSec ?? 50), hi = Math.max(lo + 1, cfg().roam?.maxSec ?? 160);
    const ms = (lo + rng() * (hi - lo)) * 1000;
    roamTimer = T.setTimeout(() => {
      if (!fly('acak')) { roamTimer = T.setTimeout(scheduleRoam, 8000); return; }   // sedang sibuk: coba lagi sebentar lagi
      scheduleRoam();
    }, ms * (o.timeScale || 1));
  }

  // Deteksi pengguna sedang beraktivitas: mouse bergerak cukup jauh antar pengecekan.
  function poll() {
    const c = o.getCursor?.();
    if (!c) return;
    const moved = lastCursor ? Math.hypot(c.x - lastCursor.x, c.y - lastCursor.y) : 0;
    lastCursor = c;
    if (moved > 40 && canFly() && rng() < (cfg().roam?.activityChance ?? .05)) fly('aktivitas');
  }

  /** Pemicu dari kejadian (selesai bicara, tugas selesai, dsb). */
  function nudge(reason, prob) {
    if (!canFly() || rng() >= prob) return;
    T.setTimeout(() => fly(reason), (600 + rng() * 900) * (o.timeScale || 1));
  }

  function start() {
    stopped = false;
    lastFlightAt = now() + (cfg().roam?.startDelaySec ?? 20) * 1000 - cooldown();   // tidak langsung terbang saat baru menyala
    scheduleRoam();
    pollTimer = T.setInterval(poll, 1500 * (o.timeScale || 1));
  }
  function stop() {
    stopped = true;
    cancel();
    T.clearTimeout(roamTimer);
    T.clearInterval(pollTimer);
  }

  return { start, stop, fly, cancel, nudge, isFlying: () => Boolean(flying), _canFly: canFly };
}

module.exports = { createRoamer, pickTarget, bezier, bezierDir, limits, anchorOf, boundsFor, WIN_W, WIN_H };
