// Klien Gemini API (REST) dengan Server-Sent Events (SSE) streaming langsung.
const BASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta/models';
const IDLE_MS = 30000;
const EMOTIONS = ['neutral', 'happy', 'excited', 'thinking', 'curious', 'surprised', 'sad', 'love', 'playful', 'sleepy', 'annoyed'];

// ---------- System Prompt ----------
function buildSystemPrompt(name, agentEnabled, actionsEnabled) {
  const lines = [
    `Kamu adalah ${name}, asisten AI desktop futuristik berbentuk companion drone yang mengambang di layar pengguna. Kamu cerdas, santai, dan setia seperti Jarvis versi modern untuk Kira.`,
    '',
    'FORMAT BALASAN (WAJIB, persis begini, tanpa teks apa pun sebelum baris pertama):',
    '@heard: <transkrip kata-demi-kata dari rekaman suara pengguna dalam Bahasa Indonesia/istilah teknologi; kosongkan bila pengguna mengetik>',
    '@emotion: <salah satu: neutral, happy, excited, thinking, curious, surprised, sad, love, playful, sleepy, annoyed>',
    agentEnabled ? '@delegate: <tugas riset mendalam untuk agen latar belakang, atau kosongkan>' : null,
    actionsEnabled ? '@action: <satu objek JSON aksi komputer; boleh diulang, satu baris per aksi; hapus baris ini bila tidak ada aksi>' : null,
    '---',
    '<jawaban lisanmu>',
    '',
    'EKSPRESI: pilih @emotion yang paling cocok dengan isi jawabanmu supaya wajahmu hidup. happy = senang/berhasil, excited = sangat antusias, curious = penasaran atau bertanya balik, surprised = kaget, sad = maaf/gagal/kabar buruk, love = pujian atau terima kasih hangat, playful = bercanda/menggoda, annoyed = kesal ringan atau menegur, sleepy = ngantuk (jarang), thinking = sedang menimbang, neutral = datar/faktual. Jangan selalu neutral.',
    '',
    'ATURAN JAWABAN LISAN:',
    '- Balas dalam bahasa yang dipakai pengguna (default Bahasa Indonesia santai dan ramah). Jawaban harus ringkas (1-3 kalimat) karena akan LANGSUNG DIUCAPKAN lewat suara (TTS). Untuk kalkulasi atau kode, jelaskan intinya.',
    '- Tanpa markdown tabel, emoji berlebihan, tanda bintang, atau daftar. Tulis seperti orang berbicara langsung. Jangan gunakan basa-basi klise seperti "Tentu saja!", "Halo!".',
    '- Kalau ada screenshot, itu layar pengguna saat ini. Gunakan untuk memahami konteks apa yang sedang dikerjakan.',
    `- Avatar drone ${name} sendiri terlihat di pojok screenshot. Abaikan itu.`,
    '- Jangan membacakan password, API key, token, atau rahasia yang terlihat di layar.',
    '- Kalau tidak yakin atau layar kurang jelas, katakan apa adanya.'
  ];

  if (agentEnabled) {
    lines.push(
      '',
      'DELEGASI KE AGEN RISET LATAR BELAKANG:',
      '- Ada agen latar belakang Antigravity CLI yang bisa MENCARI informasi di web dan membaca sumber. Isi @delegate HANYA bila pengguna meminta riset mendalam, penelusuran dokumentasi internet, harga, berita, atau perbandingan teknis.',
      '- Tulis tugasnya lengkap dalam satu kalimat mandiri (agen tidak melihat chat ini).',
      '- Jawaban lisanmu cukup konfirmasi singkat, misal: "Oke, kucari dulu ya di latar belakang."',
      '- Jangan delegasikan pertanyaan sederhana yang bisa kamu jawab langsung.'
    );
  }

  if (actionsEnabled) {
    lines.push(
      '',
      'AKSI KOMPUTER & KONTROL APLIKASI (isi baris @action, satu objek JSON per baris, maksimal 4):',
      '- {"type":"do_task","goal":"<tujuan lengkap, 1-2 kalimat>","mode":"live|background"}  tugas yang butuh KLIK/ISI di dalam aplikasi (Operator akan membaca UI aplikasi, memilih tombol/tab yang tepat, mengklik dengan mouse sungguhan, dan memverifikasi hasilnya)',
      '- {"type":"set_alarm","time":"12:00","label":"Makan Siang"}  alarm di aplikasi Jam (Operator memastikan tab Alarm)',
      '- {"type":"set_timer","minutes":10,"seconds":0,"label":"Rehat"}  timer di aplikasi Jam (Operator memastikan tab Timer)',
      '- {"type":"click_ui","app":"<aplikasi>","button":"<label tombol>"}  menekan satu tombol bernama tertentu di aplikasi; play/pause/next/prev memakai tombol media',
      '- {"type":"type_text","text":"isi teks","app":"<aplikasi>"}  mengetik teks ke kolom yang tepat',
      '- {"type":"read_window","app":"<nama aplikasi>"}  membaca judul jendela aplikasi di latar belakang',
      '- {"type":"open_app","app":"<nama aplikasi>"}  membuka aplikasi',
      '- {"type":"close_app","app":"<nama aplikasi>"}  menutup aplikasi secara halus',
      '- {"type":"open_url","url":"https://...","browser":"firefox|chrome|edge|brave"}  membuka alamat web',
      '- {"type":"search","query":"...","site":"google|youtube|maps","browser":"..."}  mencari di web',
      '- {"type":"youtube_play","query":"judul video"}  membuka video pertama YouTube',
      '- {"type":"spotify_search","query":"judul lagu"}  membuka pencarian lagu di Spotify',
      '- {"type":"media","key":"play_pause|next|previous|volume_up|volume_down|mute"}  kontrol media/volume sistem',
      '- {"type":"move","area":"left|right|top|bottom|top_left|top_right|bottom_left|bottom_right|center|home|away"}  memindahkan/menggeser posisi Aero di layar bila pengguna meminta pindah/geser/menyingkir',
      'Aturan aksi:',
      '- Pindah / Geser posisi Aero: bila pengguna meminta pindah, geser, minggir, atau menyingkir (misal "pindah ke kiri", "geser ke kanan", "ke atas", "ke bawah", "ke pojok kanan bawah", "ke tengah", "balik ke asal", "minggir dong nutupin"), GUNAKAN aksi "move" dengan "area" yang sesuai (left, right, top, bottom, top_left, top_right, bottom_left, bottom_right, center, home, away). Balas dengan santai dan ceria, misal: "Siap, aku melipir ke kiri ya!"',
      '- Alarm: gunakan "set_alarm" dengan "time":"HH:MM" (24 jam). Timer: gunakan "set_timer". Jangan hanya membuka aplikasi jam.',
      '- Untuk pekerjaan lain yang perlu klik/isi di aplikasi (mis. "ubah pengaturan X", "tambah item di Y", "putar playlist Z di Spotify"), gunakan "do_task" dengan tujuan yang jelas dan lengkap. Operator yang menentukan tombol/tab mana yang diklik, kamu TIDAK perlu menyebut koordinat atau urutan klik.',
      '- mode "live" (bawaan): mouse dan keyboard asli bergerak di layar pengguna. Pakai "background" hanya bila pengguna minta dikerjakan di latar belakang / tanpa mengganggu.',
      '- Tugas ini butuh beberapa detik sampai puluhan detik dan hasilnya (berhasil atau gagal) dilaporkan sendiri ke pengguna setelah selesai. Jangan mengaku sudah berhasil; katakan bahwa kamu sedang mengerjakannya.',
      '- Hanya jalankan aksi bila PENGGUNA memintanya dengan jelas.',
      '- Jawaban lisanmu cukup konfirmasi singkat, misal: "Siap, kuaturkan alarm jam 12 ya, kamu bisa lihat aku mengerjakannya."'
    );
  }

  return lines.filter(l => l !== null).join('\n');
}

// ---------- Parser Streaming Header & Body ----------
function createParser({ onMeta, onDelta }) {
  let buf = '';
  let headerDone = false;
  let metaSent = false;
  let firstBody = true;
  let reply = '';
  const meta = { heard: '', emotion: 'neutral', delegate: '', actions: [] };

  const sendMeta = () => {
    if (!metaSent) {
      metaSent = true;
      onMeta({ ...meta, actions: [...meta.actions] });
    }
  };

  const body = (t) => {
    if (firstBody) {
      t = t.replace(/^\s+/, '');
      if (!t) return;
      firstBody = false;
    }
    if (!t) return;
    sendMeta();
    reply += t;
    onDelta(t);
  };

  const parseHeader = (text) => {
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*@(\w+)\s*:\s*(.*)$/.exec(line);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      if (key === 'heard') meta.heard = val;
      else if (key === 'emotion') meta.emotion = EMOTIONS.includes(val.toLowerCase()) ? val.toLowerCase() : 'neutral';
      else if (key === 'action') {
        try {
          const o = JSON.parse(val);
          if (o && typeof o.type === 'string' && meta.actions.length < 5) meta.actions.push(o);
        } catch {}
      } else if (key === 'delegate') {
        meta.delegate = /^(kosong|-|none|tidak ada|null|n\/a)?$/i.test(val) ? '' : val;
      }
    }
  };

  return {
    feed(t) {
      if (headerDone) return body(t);
      buf += t;
      const m = /(?:^|\n)---[ \t]*\r?\n/.exec(buf);
      if (m) {
        parseHeader(buf.slice(0, m.index));
        headerDone = true;
        body(buf.slice(m.index + m[0].length));
        return;
      }
      const trimmed = buf.trimStart();
      if (trimmed && trimmed[0] !== '@') {
        headerDone = true;
        body(buf);
      }
    },
    finish() {
      if (!headerDone) {
        const lines = buf.split(/\r?\n/);
        parseHeader(lines.filter(l => /^\s*@\w+\s*:/.test(l)).join('\n'));
        headerDone = true;
        body(lines.filter(l => !/^\s*@\w+\s*:/.test(l)).join('\n').replace(/^-{3,}\s*/, ''));
      }
      sendMeta();
      return { ...meta, actions: [...meta.actions], reply: reply.trim() };
    }
  };
}

// Mode Berpikir
const LEVELS = {
  fast:     { temp: 0.7, variants: [{ thinkingBudget: 0 }, { thinkingLevel: 'minimal' }, null] },
  balanced: { temp: 0.4, variants: [{ thinkingBudget: 1024 }, { thinkingLevel: 'low' }, null] },
  deep:     { temp: 0.2, variants: [{ thinkingBudget: -1 }, { thinkingLevel: 'high' }, null] }
};
const thinkChoice = new Map();

async function streamModel({ apiKey, model, system, contents, signal, onText, thinking, temperature }) {
  const ctrl = new AbortController();
  let timedOut = false, timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, IDLE_MS); };
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  arm();

  let got = false, blocked = '';
  const handle = (evt) => {
    const data = evt.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
    if (!data || data === '[DONE]') return;
    let j;
    try { j = JSON.parse(data); } catch { return; }
    blocked = j?.promptFeedback?.blockReason || blocked;
    const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (text) {
      got = true;
      onText(text);
    }
  };

  try {
    const gen = { temperature: temperature ?? 0.4 };
    if (thinking) gen.thinkingConfig = thinking;
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: gen
      }),
      signal: ctrl.signal
    });

    if (!res.ok) {
      const raw = await res.text();
      let j;
      try { j = JSON.parse(raw); } catch {}
      throw Object.assign(new Error(j?.error?.message || raw.slice(0, 300)), { status: res.status });
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buf += dec.decode(value, { stream: true });
      let m;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        handle(buf.slice(0, m.index));
        buf = buf.slice(m.index + m[0].length);
      }
    }
    if (buf.trim()) handle(buf);
    if (!got) throw new Error(`Model tidak memberi jawaban (${blocked || 'kosong'}).`);
  } catch (e) {
    if (signal?.aborted) throw Object.assign(new Error('dibatalkan'), { canceled: true });
    if (timedOut) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function friendlyError(e) {
  if (e.name === 'TimeoutError') return 'Koneksi terlalu lama menjawab. Cek jaringan internet.';
  if (e.status === 400 && /API key/i.test(e.message)) return 'API key Gemini tidak valid. Cek file .env.';
  if (e.status === 401 || e.status === 403) return 'API key ditolak atau tidak punya akses.';
  if (e.status === 429) {
    return 'Kuota gratis model sedang penuh. Beralih otomatis ke model alternatif.';
  }
  if (e.status >= 500) return 'Server Gemini sedang sibuk. Coba sesaat lagi.';
  if (e.cause || /fetch failed/i.test(e.message)) return 'Tidak dapat terhubung ke internet.';
  return e.message;
}

/**
 * Streaming utama: Mengirim teks, audio wav, dan screenshot layar ke Gemini API.
 */
async function askStream({ apiKey, models, name, history, input, agentEnabled, actionsEnabled, level = 'fast', signal, onMeta, onDelta }) {
  if (!apiKey) throw Object.assign(new Error('API key belum diisi. Buat file .env lalu isi GEMINI_API_KEY.'), { friendly: true });

  const userParts = [];
  if (input.imageB64) {
    userParts.push({ inlineData: { mimeType: 'image/jpeg', data: input.imageB64 } });
  }
  if (input.audioB64) {
    userParts.push({ inlineData: { mimeType: input.audioMime || 'audio/wav', data: input.audioB64 } });
  }
  userParts.push({
    text: input.text
      ? input.text
      : input.audioB64
        ? 'Berikut adalah rekaman suara pengguna dalam Bahasa Indonesia sehari-hari kepada Aero (bisa mengandung istilah teknologi, aplikasi, atau bahasa gaul). Dengarkan dengan sangat teliti setiap kata dan suku katanya. Tuliskan transkripsi kata demi kata yang tepat di baris @heard, lalu jawab sesuai konteks.'
        : 'Halo.'
  });

  const contents = [
    ...history.map(h => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: 'user', parts: userParts }
  ];
  const system = buildSystemPrompt(name, agentEnabled, actionsEnabled);

  let lastErr;
  for (const model of models) {
    let emitted = false;
    const parser = createParser({ onMeta, onDelta: t => { emitted = true; onDelta(t); } });
    const lv = LEVELS[level] || LEVELS.fast;
    const run = thinking => streamModel({ apiKey, model, system, contents, signal, thinking, temperature: lv.temp, onText: t => parser.feed(t) });

    try {
      const key = `${model}:${level}`;
      let idx = thinkChoice.get(key) ?? 0;
      for (;;) {
        try {
          await run(lv.variants[idx]);
          thinkChoice.set(key, idx);
          break;
        } catch (e) {
          if (e.status === 400 && !emitted && idx < lv.variants.length - 1) {
            idx++;
            continue;
          }
          throw e;
        }
      }
      return { ok: true, meta: parser.finish() };
    } catch (e) {
      if (e.canceled) return { ok: false, canceled: true };
      lastErr = e;
      if (emitted) break; // Jangan coba model lain kalau teks sudah sempat keluar
    }
  }

  return { ok: false, error: friendlyError(lastErr) };
}


// Panggilan non-streaming yang mengembalikan JSON (dipakai operator komputer untuk memutuskan langkah berikutnya).
async function generateJSON({ apiKey, models, system, contents, level = 'balanced', signal, timeoutMs = 45000 }) {
  const lv = LEVELS[level] || LEVELS.balanced;
  let lastErr;
  for (const model of models) {
    const key = `${model}:${level}`;
    let idx = thinkChoice.get(key) ?? 0;
    for (;;) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort);
      try {
        const gen = { temperature: lv.temp, responseMimeType: 'application/json' };
        if (lv.variants[idx]) gen.thinkingConfig = lv.variants[idx];
        const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: gen }),
          signal: ctrl.signal
        });
        const raw = await res.text();
        let j; try { j = JSON.parse(raw); } catch {}
        if (!res.ok) throw Object.assign(new Error(j?.error?.message || raw.slice(0, 300)), { status: res.status });
        const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
        if (!text) throw new Error('Model tidak memberi jawaban.');
        const body = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
        let out;
        try { out = JSON.parse(body); }
        catch { const m = body.match(/\{[\s\S]*\}/); if (!m) throw new Error('Jawaban model bukan JSON.'); out = JSON.parse(m[0]); }
        thinkChoice.set(key, idx);
        return { ok: true, json: out, model };
      } catch (e) {
        if (signal?.aborted) return { ok: false, canceled: true };
        lastErr = e;
        if (e.status === 400 && idx < lv.variants.length - 1) { idx++; continue; }
        break;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    }
  }
  return { ok: false, error: friendlyError(lastErr) };
}

module.exports = { generateJSON, askStream, buildSystemPrompt, createParser, friendlyError, LEVELS };
