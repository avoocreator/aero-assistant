// Pengaturan pengguna yang berubah-ubah saat aplikasi jalan (volume, tingkat inisiatif, dsb).
// Disimpan di settings.json di folder data aplikasi supaya config.json tetap statis dan pengaturan bertahan setelah restart.
// Semua nilai divalidasi: nilai buruk (dari file rusak, atau dari model lewat aksi) diabaikan, bukan dipercaya.
const fs = require('fs');
const path = require('path');

const LEVELS = ['off', 'rare', 'normal', 'chatty'];
const VOICE_MODES = ['important', 'always', 'never'];
const KIND_KEYS = ['return', 'morning', 'meal', 'night', 'break', 'battery'];

const DEFAULTS = Object.freeze({
  volume: 85,
  muted: false,
  initiative: {
    level: 'normal',
    voice: 'important',
    kinds: { return: true, morning: true, meal: true, night: true, break: true, battery: true },
    snoozeUntil: 0,
    // status harian (dipertahankan antar-restart supaya batas harian tidak ter-reset)
    day: '', count: 0, modelCount: 0, lastAt: 0,
    mutedUntil: {}
  }
});

const num = (v, lo, hi, def) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : def);

function sanitize(raw, base) {
  const out = JSON.parse(JSON.stringify(base));
  if (!raw || typeof raw !== 'object') return out;
  if ('volume' in raw) out.volume = Math.round(num(raw.volume, 0, 100, out.volume));
  if ('muted' in raw) out.muted = Boolean(raw.muted);
  const i = raw.initiative;
  if (i && typeof i === 'object') {
    if (LEVELS.includes(i.level)) out.initiative.level = i.level;
    if (VOICE_MODES.includes(i.voice)) out.initiative.voice = i.voice;
    if (i.kinds && typeof i.kinds === 'object') {
      for (const k of KIND_KEYS) if (k in i.kinds) out.initiative.kinds[k] = Boolean(i.kinds[k]);
    }
    if ('snoozeUntil' in i) out.initiative.snoozeUntil = num(i.snoozeUntil, 0, 8.64e15, 0);
    if (typeof i.day === 'string' && i.day.length <= 12) out.initiative.day = i.day;
    if ('count' in i) out.initiative.count = Math.round(num(i.count, 0, 10000, 0));
    if ('modelCount' in i) out.initiative.modelCount = Math.round(num(i.modelCount, 0, 10000, 0));
    if ('lastAt' in i) out.initiative.lastAt = num(i.lastAt, 0, 8.64e15, 0);
    if (i.mutedUntil && typeof i.mutedUntil === 'object') {
      const m = {};
      for (const k of KIND_KEYS) if (k in i.mutedUntil) m[k] = num(i.mutedUntil[k], 0, 8.64e15, 0);
      out.initiative.mutedUntil = m;
    }
  }
  return out;
}

function createSettings(file, { onChange } = {}) {
  let data = sanitize(null, DEFAULTS);
  try { data = sanitize(JSON.parse(fs.readFileSync(file, 'utf8')), DEFAULTS); } catch {}
  let timer = null;

  const write = () => {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    } catch (e) { console.warn('Gagal menyimpan pengaturan:', e.message); }
  };
  const flush = () => { clearTimeout(timer); timer = null; write(); };

  return {
    get: () => JSON.parse(JSON.stringify(data)),
    /** Gabungkan perubahan sebagian (sudah divalidasi) lalu simpan. */
    set(patch) {
      const merged = JSON.parse(JSON.stringify(data));
      if (patch && typeof patch === 'object') {
        if ('volume' in patch) merged.volume = patch.volume;
        if ('muted' in patch) merged.muted = patch.muted;
        if (patch.initiative && typeof patch.initiative === 'object') {
          const p = patch.initiative;
          merged.initiative = { ...merged.initiative, ...p, kinds: { ...merged.initiative.kinds, ...(p.kinds || {}) }, mutedUntil: p.mutedUntil ? { ...p.mutedUntil } : merged.initiative.mutedUntil };
        }
      }
      data = sanitize(merged, DEFAULTS);
      clearTimeout(timer);
      timer = setTimeout(write, 300);
      onChange?.(JSON.parse(JSON.stringify(data)));
      return JSON.parse(JSON.stringify(data));
    },
    flush
  };
}

module.exports = { createSettings, sanitize, DEFAULTS, LEVELS, VOICE_MODES, KIND_KEYS };
