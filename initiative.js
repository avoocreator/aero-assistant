// Mesin Inisiatif: Aero kadang memulai percakapan sendiri.
//
//   pemicu  ->  antrean  ->  gerbang  ->  penulisan kalimat  ->  penyampaian
//
// Prinsip utama: lebih baik diam daripada mengganggu.
//  - Hampir semua pemicu tanpa biaya model (kalimat dari kumpulan bervariasi). Model lite hanya dipakai bila ada jatah harian.
//  - Gerbang: tingkat keramaian, jenis yang diaktifkan, jam tenang, "diam dulu", jeda minimal, batas harian,
//    pengguna sedang sibuk/bicara/aplikasi layar penuh/sedang pergi.
//  - Backoff adaptif: jenis yang terus diabaikan atau ditutup otomatis dikurangi lalu dimatikan sementara.
//  - Pesan "tugas selesai" adalah balasan atas permintaan pengguna sendiri, jadi tidak ikut batas harian dan jeda.

const MIN = 60 * 1000;

const LEVEL_TABLE = {
  off:    { gapMin: Infinity, maxPerDay: 0,  maxModel: 0 },
  rare:   { gapMin: 90,       maxPerDay: 4,  maxModel: 2 },
  normal: { gapMin: 45,       maxPerDay: 8,  maxModel: 5 },
  chatty: { gapMin: 20,       maxPerDay: 16, maxModel: 8 }
};

// prio: urutan saat banyak yang antre. important: ikut bersuara pada mode suara "penting saja".
const KINDS = {
  task:    { prio: 100, reply: true,  important: true,  ttlMin: 30, chime: 'up' },
  battery: { prio: 60,  important: true,  ttlMin: 10, chime: 'down' },
  return:  { prio: 50,  ttlMin: 3,  chime: 'up' },
  break:   { prio: 40,  important: true,  ttlMin: 10, chime: 'up' },
  night:   { prio: 35,  ttlMin: 10, chime: 'up' },
  morning: { prio: 30,  ttlMin: 5,  chime: 'up' },
  meal:    { prio: 30,  ttlMin: 10, chime: 'up' }
};

// ---------- Kumpulan kalimat (gaya Aero: santai, hangat, singkat) ----------
const BANK = {
  return: [
    { t: 'Selamat datang kembali! Kamu pergi sekitar {away}. Ada yang bisa kubantu?', e: 'happy' },
    { t: 'Nah, balik juga. Kangen nih. Mau lanjut apa?', e: 'playful' },
    { t: 'Hai lagi! Aku di sini kok kalau butuh apa-apa.', e: 'happy' },
    { t: 'Kamu kembali! Semoga istirahatnya enak ya.', e: 'love' }
  ],
  morning: [
    { t: 'Selamat pagi! Semoga hari ini lancar ya. Ada rencana apa?', e: 'happy' },
    { t: 'Pagi! Sudah sarapan belum? Jangan lupa ya.', e: 'curious' },
    { t: 'Selamat pagi, semangat ya hari ini!', e: 'excited' }
  ],
  meal: [
    { t: 'Sudah masuk jam makan siang. Kamu sudah makan belum?', e: 'curious' },
    { t: 'Eh, sudah siang lho. Makan dulu yuk, kerjaannya bisa nunggu.', e: 'playful' },
    { t: 'Perutnya sudah bunyi belum? Waktunya makan siang.', e: 'happy' }
  ],
  night: [
    { t: 'Sudah larut nih. Jangan begadang terus ya, tubuhmu perlu istirahat.', e: 'sleepy' },
    { t: 'Sudah lewat jam sebelas. Nggak mau tidur dulu?', e: 'sleepy' },
    { t: 'Hoaam... aku sih sudah ngantuk. Kamu juga istirahat ya.', e: 'sleepy' }
  ],
  break: [
    { t: 'Kamu sudah sekitar {work} di depan layar. Istirahat sebentar yuk, minum atau regangkan badan.', e: 'curious' },
    { t: 'Sudah {work} nonstop lho. Mata dan punggungmu perlu rehat dulu.', e: 'sad' },
    { t: 'Waktunya jeda sebentar. Berdiri, regangkan, minum air. Aku tunggu di sini.', e: 'happy' }
  ],
  battery: [
    { t: 'Baterainya tinggal {pct} persen. Colok charger dulu ya.', e: 'surprised' },
    { t: 'Awas, baterai tinggal {pct} persen! Segera dicolok ya.', e: 'surprised' }
  ]
};

const pad2 = n => String(n).padStart(2, '0');
const dayKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dur = ms => {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} menit`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} jam ${r} menit` : `${h} jam`;
};

function parseHM(s, def) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : def;
}

function inQuiet(date, quiet) {
  const start = parseHM(quiet?.start, 23 * 60), end = parseHM(quiet?.end, 7 * 60);
  const cur = date.getHours() * 60 + date.getMinutes();
  return start === end ? false : start < end ? cur >= start && cur < end : cur >= start || cur < end;
}

function createInitiative(o) {
  const rng = o.rng || Math.random;
  const now = o.now || Date.now;
  const T = o.timers || { setInterval, clearInterval, setTimeout, clearTimeout };
  const cfg = () => o.config() || {};
  const st = () => o.settings.get();
  const patch = p => o.settings.set({ initiative: p });

  let queue = [];
  let current = null;                 // { id, kind, at }
  let seq = 0;
  let timer = null;
  let away = false, awaySince = 0, activeSince = now();
  let startedAt = now();
  let lastIdx = {};                   // kind -> indeks kalimat terakhir
  let strikes = {};                   // kind -> jumlah penolakan beruntun
  let done = {};                      // "kind:harinya" -> true
  let batteryWarn = 0;
  let quotaBackoffUntil = 0;
  let firstActivityDone = false;

  const level = () => LEVEL_TABLE[st().initiative.level] || LEVEL_TABLE.normal;
  const todayStats = () => {
    const key = dayKey(new Date(now()));
    const s = st().initiative;
    if (s.day !== key) { patch({ day: key, count: 0, modelCount: 0 }); return { count: 0, modelCount: 0 }; }
    return { count: s.count, modelCount: s.modelCount };
  };

  function enqueue(kind, facts = {}) {
    const k = KINDS[kind];
    if (!k) return false;
    queue = queue.filter(q => q.kind !== kind);
    queue.push({ kind, facts, born: now(), ttl: k.ttlMin * MIN, tries: 0 });
    return true;
  }

  // ---------- Pemicu berbasis waktu dan kehadiran ----------
  function tick() {
    const t = now();
    const idle = o.getIdleSec();
    const d = new Date(t);

    if (idle >= 300 && !away) { away = true; awaySince = t - idle * 1000; }
    if (idle < 15 && away) {
      away = false;
      const awayMs = t - awaySince;
      if (awayMs >= 20 * MIN) enqueue('return', { away: dur(awayMs), awayMs });
      if (awayMs >= 5 * MIN) activeSince = t;
      // sapaan pagi: aktivitas pertama setelah pergi lama
      maybeMorning(d, awayMs >= 4 * 60 * MIN);
    }
    if (!away && !firstActivityDone && idle < 15) {
      firstActivityDone = true;
      maybeMorning(d, true);
    }

    if (!away && idle < 120) {
      const h = d.getHours() * 60 + d.getMinutes();
      if (h >= 12 * 60 && h < 13 * 60 + 30 && !done[`meal:${dayKey(d)}`]) { done[`meal:${dayKey(d)}`] = true; enqueue('meal'); }
      if ((h >= 23 * 60 || h < 2 * 60) && !done[`night:${dayKey(new Date(t - 5 * 3600e3))}`]) {
        done[`night:${dayKey(new Date(t - 5 * 3600e3))}`] = true; enqueue('night');
      }
      const worked = t - activeSince;
      if (worked >= (cfg().initiative?.breakAfterMin ?? 90) * MIN) { enqueue('break', { work: dur(worked) }); activeSince = t; }
    }
    drain();
  }

  function maybeMorning(d, longAway) {
    const h = d.getHours();
    const key = `morning:${dayKey(d)}`;
    if (longAway && h >= 5 && h < 11 && !done[key]) { done[key] = true; enqueue('morning'); }
  }

  /** Pemicu dari luar: 'task' {text, ok, emotion}, 'battery' {percent, charging}. Mengembalikan true bila diterima. */
  function event(kind, facts = {}) {
    if (kind === 'battery') {
      if (facts.charging) { batteryWarn = 0; return false; }
      const p = Number(facts.percent);
      if (!Number.isFinite(p)) return false;
      const lvl = p <= 10 ? 10 : p <= 20 ? 20 : 0;
      if (!lvl || lvl <= 0 || (batteryWarn && lvl >= batteryWarn)) return false;
      batteryWarn = lvl;
      enqueue('battery', { pct: Math.round(p) });
    } else if (kind === 'task') {
      if (st().initiative.level === 'off') return false;      // mati total: biarkan jalur lama (bubble biasa)
      if (!facts.text) return false;
      enqueue('task', facts);
    } else return false;
    drain();
    return true;
  }

  // ---------- Gerbang ----------
  async function gate(item) {
    const s = st().initiative, k = KINDS[item.kind], t = now(), d = new Date(t);
    if (!k.reply) {
      if (s.level === 'off') return { drop: true };
      if (s.kinds[item.kind] === false) return { drop: true };
      if ((s.mutedUntil[item.kind] || 0) > t) return { drop: true };
      if (s.snoozeUntil > t) return { drop: true };
      if (inQuiet(d, cfg().initiative?.quiet)) return { drop: true };
      const L = level(), stats = todayStats();
      if (stats.count >= L.maxPerDay) return { drop: true };
      const penalty = 1 + (strikes[item.kind] || 0) * .5;
      if (s.lastAt && t - s.lastAt < L.gapMin * MIN * penalty) return { defer: true };
    }
    if (o.getIdleSec() > 120) return { defer: true };                 // pengguna sedang pergi: pesan akan terlewat
    if (o.isBusy()) return { defer: true };
    if (current && t - current.at < 25000) return { defer: true };     // jangan menumpuk pesan
    if (o.isInterruptible && !(await o.isInterruptible())) return { defer: true };   // layar penuh / presentasi / terkunci
    return { ok: true };
  }

  function pickLine(kind, facts) {
    const bank = BANK[kind];
    if (!bank) return null;
    let i = Math.floor(rng() * bank.length);
    if (bank.length > 1 && i === lastIdx[kind]) i = (i + 1) % bank.length;
    lastIdx[kind] = i;
    const b = bank[i];
    const text = b.t.replace(/\{(\w+)\}/g, (_m, key) => (facts[key] ?? ''));
    return { text, emotion: b.e };
  }

  function voiceFor(item) {
    const s = st(), mode = s.initiative.voice;
    if (s.muted || s.volume <= 0) return false;
    if (inQuiet(new Date(now()), cfg().initiative?.quiet)) return false;
    if (s.initiative.snoozeUntil > now()) return false;
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    return Boolean(KINDS[item.kind].important);
  }

  async function compose(item) {
    if (item.kind === 'task') {
      const f = item.facts;
      return { text: String(f.text).slice(0, 400), emotion: f.emotion || (f.ok === false ? 'sad' : 'happy') };
    }
    // Tahap 2: kalimat segar dari model lite bila ada jatah, kalau gagal pakai kumpulan kalimat.
    const L = level(), stats = todayStats();
    if (o.generate && stats.modelCount < L.maxModel && now() > quotaBackoffUntil && rng() < (cfg().initiative?.modelChance ?? .6)) {
      try {
        const r = await Promise.race([o.generate(item.kind, item.facts), new Promise(res => T.setTimeout(() => res(null), 8000))]);
        if (r?.quota) quotaBackoffUntil = now() + 3 * 60 * MIN;
        if (r?.text) { patch({ modelCount: stats.modelCount + 1 }); return { text: r.text, emotion: r.emotion || 'happy' }; }
      } catch {}
    }
    return pickLine(item.kind, item.facts);
  }

  let inflight = null, again = false;
  function drain() {
    if (inflight) { again = true; return inflight; }
    const run = async () => { do { again = false; await drainOnce(); } while (again); };
    inflight = run().finally(() => { inflight = null; });
    return inflight;
  }

  async function drainOnce() {
    try {
      const t = now();
      queue = queue.filter(q => t - q.born < q.ttl);
      queue.sort((a, b) => KINDS[b.kind].prio - KINDS[a.kind].prio);
      for (const item of [...queue]) {
        const g = await gate(item);
        if (g.drop) { queue = queue.filter(q => q !== item); continue; }
        if (g.defer) continue;
        queue = queue.filter(q => q !== item);
        const line = await compose(item);
        if (!line?.text) continue;
        const id = `i${++seq}`;
        const k = KINDS[item.kind];
        const ok = o.deliver({
          id, kind: item.kind, text: line.text, emotion: line.emotion,
          voice: voiceFor(item), chime: k.chime, ttlMs: Math.min(60000, 9000 + line.text.length * 70)
        });
        if (!ok) { item.tries++; if (item.tries < 3) queue.push(item); continue; }
        current = { id, kind: item.kind, at: now(), item, text: line.text, shown: false };
        if (!k.reply) patch({ lastAt: now(), count: todayStats().count + 1 });
        break;                                   // satu pesan per putaran
      }
    } catch (e) { console.warn('Inisiatif error:', e.message); }
  }

  /** Umpan balik dari renderer: 'shown' | 'engaged' | 'dismissed' | 'ignored' | 'busy'. */
  function feedback(id, outcome) {
    if (!current || current.id !== id) return;
    const kind = current.kind;
    if (outcome === 'shown') {
      // baru setelah benar-benar tampil, pesan masuk riwayat supaya jawaban pengguna nyambung
      if (!current.shown) {
        current.shown = true;
        o.addHistory('user', `(sistem: ${(cfg().assistantName || 'Aero')} memulai obrolan sendiri, alasan: ${kind})`);
        o.addHistory('model', current.text);
      }
      return;
    }
    if (outcome === 'busy') {
      const facts = current.item.facts;
      current = null;
      if (!queue.find(q => q.kind === kind)) enqueue(kind, facts);
      return;
    }
    if (KINDS[kind].reply) { current = null; return; }
    if (outcome === 'engaged') strikes[kind] = 0;
    else if (outcome === 'dismissed') strikes[kind] = (strikes[kind] || 0) + 1;
    else if (outcome === 'ignored') strikes[kind] = (strikes[kind] || 0) + .5;
    if ((strikes[kind] || 0) >= 3) {
      strikes[kind] = 0;
      patch({ mutedUntil: { ...st().initiative.mutedUntil, [kind]: now() + 24 * 60 * MIN } });
    }
    current = null;
  }

  const snooze = minutes => patch({ snoozeUntil: minutes > 0 ? now() + Math.min(minutes, 24 * 60) * MIN : 0 });

  function start() {
    startedAt = now();
    activeSince = now();
    timer = T.setInterval(tick, o.tickMs || 10000);
  }
  function stop() { T.clearInterval(timer); }

  return { start, stop, tick, event, feedback, snooze, drain, _queue: () => queue, _strikes: () => strikes };
}

module.exports = { createInitiative, inQuiet, LEVEL_TABLE, KINDS, BANK, dur };
