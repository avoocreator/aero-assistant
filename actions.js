// Aksi komputer yang boleh dijalankan Asisten: buka/tutup aplikasi, buka URL, cari di web/YouTube/Spotify, tombol media.
// DAFTAR PUTIH: model hanya bisa memilih jenis aksi di bawah ini. Tidak ada eksekusi perintah bebas.
// Semua nilai dari model dikirim ke PowerShell lewat variabel lingkungan (bukan disisipkan ke teks perintah),
// jadi aman dari injeksi perintah.
const { execFile, spawn } = require('child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Nama panggilan aplikasi umum -> { start: perintah/URI untuk dibuka, proc: nama proses untuk ditutup }
const BUILTIN_APPS = {
  firefox: { start: 'firefox', proc: 'firefox' },
  chrome: { start: 'chrome', proc: 'chrome' },
  'google chrome': { start: 'chrome', proc: 'chrome' },
  edge: { start: 'msedge', proc: 'msedge' },
  'microsoft edge': { start: 'msedge', proc: 'msedge' },
  brave: { start: 'brave', proc: 'brave' },
  spotify: { start: 'spotify:', proc: 'spotify' },
  notepad: { start: 'notepad', proc: 'notepad' },
  calculator: { start: 'calc', proc: 'CalculatorApp' },
  kalkulator: { start: 'calc', proc: 'CalculatorApp' },
  paint: { start: 'mspaint', proc: 'mspaint' },
  explorer: { start: 'explorer', proc: null },          // tidak boleh ditutup
  vscode: { start: 'code', proc: 'Code' },
  'visual studio code': { start: 'code', proc: 'Code' },
  clock: { start: 'ms-clock:', proc: 'Time' },
  jam: { start: 'ms-clock:', proc: 'Time' },
  alarm: { start: 'ms-clock:alarm', proc: 'Time' },
  timer: { start: 'ms-clock:timer', proc: 'Time' }
};

// Proses yang tidak pernah boleh ditutup asisten.
const PROTECTED = [
  'explorer', 'system', 'idle', 'csrss', 'winlogon', 'wininit', 'services', 'lsass', 'svchost', 'dwm',
  'electron', 'antigravity', 'node', 'cmd', 'powershell', 'pwsh', 'conhost', 'taskmgr', 'searchhost', 'startmenuexperiencehost'
];

const BROWSERS = { firefox: 'firefox', chrome: 'chrome', edge: 'msedge', msedge: 'msedge', brave: 'brave' };
const SEARCH = {
  google: q => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
  youtube: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  maps: q => `https://www.google.com/maps/search/${encodeURIComponent(q)}`
};

// "\kata kunci" di DuckDuckGo = langsung lompat ke video pertama di YouTube.
const YT_FIRST = q => `https://duckduckgo.com/?q=${encodeURIComponent('\\' + q + ' site:youtube.com/watch')}`;
const MEDIA_KEYS = { play_pause: 0xB3, next: 0xB0, previous: 0xB1, volume_up: 0xAF, volume_down: 0xAE, mute: 0xAD };

const NAME_RE = /^[\p{L}\p{N} .+_&'-]{1,48}$/u;
const QUERY_MAX = 200;

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

function ps(script, env = {}, timeout = 15000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      env: { ...process.env, ...env },
      windowsHide: true,
      timeout,
      maxBuffer: 1024 * 256
    }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).toString().trim().split('\n')[0]));
      resolve(String(stdout).trim());
    });
  });
}

function validUrl(u) {
  let url;
  try { url = new URL(String(u)); } catch { return null; }
  if (!/^https?:$/.test(url.protocol) || url.href.length > 2000) return null;
  return url.href;
}

// ---------- Pembuka URL ----------
async function openUrl(url, browser) {
  const exe = browser ? BROWSERS[String(browser).toLowerCase()] : null;
  if (IS_WIN) {
    if (exe) {
      await ps('Start-Process -FilePath $env:AGY_EXE -ArgumentList $env:AGY_URL', { AGY_EXE: exe, AGY_URL: url });
    } else {
      await ps('Start-Process $env:AGY_URL', { AGY_URL: url });
    }
  } else if (IS_MAC) {
    await new Promise((res, rej) => execFile('open', exe ? ['-a', exe, url] : [url], e => e ? rej(e) : res()));
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

// ---------- Aplikasi ----------
function resolveAlias(name, custom) {
  const key = name.toLowerCase();
  return (custom && custom[key]) ? custom[key] : BUILTIN_APPS[key] || null;
}

async function openApp(name, custom) {
  if (!NAME_RE.test(name)) throw new Error('Nama aplikasi tidak valid.');
  const alias = resolveAlias(name, custom);
  if (IS_WIN) {
    if (alias?.start) {
      await ps('Start-Process $env:AGY_APP', { AGY_APP: alias.start });
      return `Membuka ${name}`;
    }
    // Cari di aplikasi terpasang (Start Menu)
    const found = await ps(
      '$a = Get-StartApps | Where-Object { $_.Name -like ("*" + $env:AGY_APP + "*") } | Sort-Object { $_.Name.Length } | Select-Object -First 1;' +
      'if ($a) { Start-Process ("shell:AppsFolder\\" + $a.AppID); $a.Name }',
      { AGY_APP: name }
    );
    if (!found) throw new Error(`Aplikasi "${name}" tidak ditemukan di komputer ini.`);
    return `Membuka ${found}`;
  }
  if (IS_MAC) {
    await new Promise((res, rej) => execFile('open', ['-a', name], e => e ? rej(new Error(`Aplikasi "${name}" tidak ditemukan.`)) : res()));
    return `Membuka ${name}`;
  }
  throw new Error('Membuka aplikasi hanya didukung di Windows dan macOS.');
}

async function closeApp(name, custom) {
  if (!NAME_RE.test(name)) throw new Error('Nama aplikasi tidak valid.');
  const alias = resolveAlias(name, custom);
  if (alias && alias.proc === null) throw new Error(`${name} tidak boleh ditutup.`);
  const target = alias?.proc || name;
  if (PROTECTED.includes(target.toLowerCase()) || PROTECTED.includes(name.toLowerCase())) {
    throw new Error(`${name} dilindungi sistem dan tidak akan ditutup.`);
  }
  if (IS_WIN) {
    // Penutupan halus (setara klik X). Aplikasi yang punya dokumen belum tersimpan akan bertanya dulu.
    const n = await ps(
      '$prot = $env:AGY_PROT.Split(","); $q = $env:AGY_APP;' +
      '$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($prot -notcontains $_.ProcessName.ToLower()) -and ($_.ProcessName -like ("*" + $q + "*") -or $_.MainWindowTitle -like ("*" + $q + "*")) };' +
      'foreach ($x in $p) { [void]$x.CloseMainWindow() }; @($p).Count',
      { AGY_APP: target, AGY_PROT: PROTECTED.join(',') }
    );
    if (Number(n) === 0) throw new Error(`Tidak ada jendela "${name}" yang sedang terbuka.`);
    return `Menutup ${name}`;
  }
  if (IS_MAC) {
    await new Promise((res, rej) => execFile('osascript', ['-e', 'on run argv', '-e', 'tell application (item 1 of argv) to quit', '-e', 'end run', target], e => e ? rej(new Error(`Gagal menutup ${name}.`)) : res()));
    return `Menutup ${name}`;
  }
  throw new Error('Menutup aplikasi hanya didukung di Windows dan macOS.');
}

async function mediaKey(key) {
  const vk = MEDIA_KEYS[key];
  if (!vk) throw new Error('Tombol media tidak dikenal.');
  if (!IS_WIN) throw new Error('Tombol media hanya didukung di Windows.');
  await ps(
    'Add-Type -TypeDefinition \'using System.Runtime.InteropServices; public class AgyK { [DllImport("user32.dll")] public static extern void keybd_event(byte b, byte s, int f, int e); }\';' +
    '$k = [byte][int]$env:AGY_VK; [AgyK]::keybd_event($k,0,0,0); [AgyK]::keybd_event($k,0,2,0)',
    { AGY_VK: String(vk) }
  );
  return `Tombol media: ${key}`;
}

async function spotifySearch(query) {
  const uri = `spotify:search:${encodeURIComponent(query)}`;
  if (IS_WIN) await ps('Start-Process $env:AGY_APP', { AGY_APP: uri });
  else if (IS_MAC) await new Promise((res, rej) => execFile('open', [uri], e => e ? rej(e) : res()));
  else spawn('xdg-open', [uri], { detached: true, stdio: 'ignore' }).unref();
  return `Membuka pencarian Spotify: ${query}`;
}

// ---------- Tugas untuk Operator (kontrol UI nyata) ----------
// Aksi di bawah tidak lagi menekan tombol buta. Aksi diubah jadi "tujuan" yang dikerjakan Operator
// dengan membaca UI aplikasi sungguhan, memilih elemen yang tepat, dan memverifikasi hasilnya (lihat operator.js).
const MEDIA_BUTTON = /^(play|pause|putar|jeda|stop|next|lanjut|berikutnya|skip|prev|previous|sebelumnya)$/i;

function parseTime(timeStr) {
  const m = String(timeStr || '').replace(/\s+/g, '').replace('.', ':').match(/(\d{1,2}):(\d{2})/);
  if (!m) throw new Error('Format waktu alarm harus jam:menit, misal 12:00 atau 07.30.');
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error('Jam atau menit di luar rentang (00:00 - 23:59).');
  return { h, min, text: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}` };
}

function alarmGoal(timeStr, label) {
  const t = parseTime(timeStr);
  const name = clean(label).slice(0, 60);
  return {
    kind: 'alarm',
    title: `Alarm ${t.text}`,
    time: { h: t.h, min: t.min, text: t.text, label: name },
    goal: `Set an alarm for ${t.text} (24-hour clock; if the time picker uses AM/PM, set the equivalent, e.g. 12:00 = 12 PM, 00:00 = 12 AM) in the Windows Clock app (it may be named "Clock", "Alarms & Clock" or "Jam"). ` +
      `It MUST be done in the ALARM tab/page, NOT in Timer, Stopwatch or World clock: first make sure the Alarm tab shows as selected. ` +
      `If an alarm at that exact time already exists, just make sure it is turned On. Otherwise add a new alarm, set the hour and minute carefully, ${name ? `name it "${name}", ` : ''}and save. ` +
      `Finish only after the alarm list shows an alarm at ${t.text} that is turned On, and say what you saw.`,
    reminder: { delaySec: secondsUntil(t.h, t.min), title: `Alarm ${t.text}`, body: name || 'Waktunya tiba.' }
  };
}

function secondsUntil(h, min) {
  const now = new Date(), target = new Date();
  target.setHours(h, min, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return Math.max(1, Math.round((target - now) / 1000));
}

function timerGoal(minutes, seconds, label) {
  const m = Math.max(0, parseInt(minutes, 10) || 0);
  const s = Math.max(0, parseInt(seconds, 10) || 0);
  const total = m * 60 + s;
  if (total <= 0) throw new Error('Durasi timer harus lebih dari 0 detik.');
  const hh = Math.floor(total / 3600), mm = Math.floor((total % 3600) / 60), ss = total % 60;
  const dur = `${hh}h ${mm}m ${ss}s`;
  return {
    kind: 'timer',
    title: `Timer ${m}m ${s}s`,
    timer: { hours: hh, minutes: mm, seconds: ss, label: clean(label) },
    goal: `Start a countdown timer of ${dur} in the Windows Clock app (it may be named "Clock", "Alarms & Clock" or "Jam"). ` +
      `It MUST be done in the TIMER tab/page, NOT in Alarm or Stopwatch: first make sure the Timer tab shows as selected. ` +
      `Add or choose a timer, set hours/minutes/seconds to ${dur} carefully${clean(label) ? `, name it "${clean(label).slice(0, 60)}"` : ''}, and start it. ` +
      `Finish only after you see a timer counting down at about that duration, and say what you saw.`,
    reminder: { delaySec: total, title: `Timer selesai (${m}m ${s}s)`, body: clean(label) || 'Waktu timer habis.' }
  };
}

/** Ubah aksi dari model menjadi tugas Operator, atau null bila itu aksi biasa. */
function toTask(a) {
  const mode = String(a?.mode || '').toLowerCase() === 'background' ? 'background' : 'live';
  switch (String(a?.type || '')) {
    case 'do_task': {
      const goal = clean(a.goal).slice(0, 600);
      if (!goal) throw new Error('Tujuan tugas kosong.');
      return { kind: 'task', title: goal.slice(0, 40), goal, mode };
    }
    case 'set_alarm': return { ...alarmGoal(a.time, a.label), mode };
    case 'set_timer': return { ...timerGoal(a.minutes, a.seconds, a.label), mode };
    case 'click_ui': {
      const btn = clean(a.button || a.target);
      if (MEDIA_BUTTON.test(btn)) return null;     // play/pause/next ditangani tombol media sistem
      const app = clean(a.app);
      return { kind: 'task', title: `Klik ${btn}`, mode, goal: `In ${app ? `the app "${app}"` : 'the active app'}, find the control labelled "${btn}" and activate it. Verify the result on screen before finishing.` };
    }
    case 'type_text': {
      const text = String(a.text || '').slice(0, 500);
      if (!text) throw new Error('Teks yang ingin diketik tidak boleh kosong.');
      const app = clean(a.app);
      return { kind: 'task', title: 'Mengetik', mode: 'live', goal: `Type exactly this text (verbatim, as one string) into the appropriate text field of ${app ? `the app "${app}"` : 'the active window'}: ${JSON.stringify(text)}. Click the field first so it has focus, then verify the text appears.` };
    }
    default: return null;
  }
}

// Cadangan jujur kalau Operator gagal: notifikasi Windows pada waktunya (bukan alarm aplikasi Jam).
// Teks dikirim lewat variabel lingkungan dan skrip -EncodedCommand, jadi tidak bisa disisipi perintah.
async function scheduleReminder({ delaySec, title, body }) {
  if (!IS_WIN) return false;
  const inner = `
    Start-Sleep -Seconds ([int]$env:AGY_DELAY)
    try {
      [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
      $t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
      $x = $t.GetElementsByTagName('text')
      $x.Item(0).AppendChild($t.CreateTextNode($env:AGY_TITLE)) | Out-Null
      $x.Item(1).AppendChild($t.CreateTextNode($env:AGY_BODY)) | Out-Null
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aero Assistant').Show([Windows.UI.Notifications.ToastNotification]::new($t))
    } catch {}
    [System.Media.SystemSounds]::Exclamation.Play()
    Start-Sleep -Seconds 3`;
  const enc = Buffer.from(inner, 'utf16le').toString('base64');
  spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', enc], {
    env: { ...process.env, AGY_DELAY: String(delaySec), AGY_TITLE: String(title).slice(0, 80), AGY_BODY: String(body).slice(0, 160) },
    detached: true, stdio: 'ignore', windowsHide: true
  }).unref();
  return true;
}

async function readWindow(appName) {
  const q = clean(appName);
  if (!q) throw new Error('Nama aplikasi untuk dibaca tidak boleh kosong.');
  if (!IS_WIN) throw new Error('Fitur membaca jendela latar belakang saat ini didukung di Windows.');
  const out = await ps(
    '$q = $env:AGY_APP;' +
    '$p = Get-Process | Where-Object { $_.MainWindowTitle -and ($_.ProcessName -like ("*" + $q + "*") -or $_.MainWindowTitle -like ("*" + $q + "*")) } | Select-Object -First 3;' +
    'if ($p) { $lines = foreach ($x in $p) { "$($x.ProcessName): $($x.MainWindowTitle)" }; $lines -join " | " } else { "Tidak ditemukan jendela aktif untuk " + $q }',
    { AGY_APP: q }
  );
  return { label: `Membaca jendela ${appName}: ${out}`, text: out };
}

async function clickMedia(button) {
  const btn = clean(button).toLowerCase();
  if (/^(play|pause|putar|jeda|stop)$/.test(btn)) { await mediaKey('play_pause'); return 'Memutar/menjeda media'; }
  if (/^(next|lanjut|berikutnya|skip)$/.test(btn)) { await mediaKey('next'); return 'Track berikutnya'; }
  await mediaKey('previous');
  return 'Track sebelumnya';
}

// ---------- Pintu Masuk ----------
async function runAction(a, opts = {}) {
  try {
    const type = String(a?.type || '');
    const custom = opts.apps;
    switch (type) {
      case 'click_ui': {
        if (!MEDIA_BUTTON.test(clean(a.button || a.target))) throw new Error('click_ui non-media dijalankan oleh Operator.');
        return { ok: true, label: await clickMedia(a.button || a.target) };
      }
      case 'read_window': {
        const r = await readWindow(clean(a.app));
        return { ok: true, label: r.label, text: r.text };
      }
      case 'open_app': return { ok: true, label: await openApp(clean(a.app), custom) };
      case 'close_app': return { ok: true, label: await closeApp(clean(a.app), custom) };
      case 'open_url': {
        const url = validUrl(a.url);
        if (!url) throw new Error('Alamat web tidak valid (hanya http/https).');
        await openUrl(url, a.browser);
        return { ok: true, label: `Membuka ${new URL(url).hostname}` };
      }
      case 'search': {
        const q = clean(a.query).slice(0, QUERY_MAX);
        if (!q) throw new Error('Kata kunci pencarian kosong.');
        const site = SEARCH[String(a.site || 'google').toLowerCase()];
        if (!site) throw new Error('Situs pencarian tidak dikenal.');
        await openUrl(site(q), a.browser);
        return { ok: true, label: `Mencari "${q}"` };
      }
      case 'youtube_play': {
        const q = clean(a.query).slice(0, QUERY_MAX);
        if (!q) throw new Error('Kata kunci video kosong.');
        await openUrl(YT_FIRST(q), a.browser);
        return { ok: true, label: `Membuka video: ${q}` };
      }
      case 'spotify_search': {
        const q = clean(a.query).slice(0, QUERY_MAX);
        if (!q) throw new Error('Kata kunci lagu kosong.');
        return { ok: true, label: await spotifySearch(q) };
      }
      case 'media': return { ok: true, label: await mediaKey(String(a.key)) };
      default: throw new Error(`Aksi "${type}" tidak dikenal.`);
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function runActions(list, opts = {}) {
  const out = [];
  for (const a of (list || []).slice(0, 5)) {
    out.push(await runAction(a, opts));
    await new Promise(r => setTimeout(r, opts.gapMs ?? 700));
  }
  return out;
}

module.exports = { runAction, runActions, toTask, scheduleReminder, openApp, validUrl, BUILTIN_APPS, PROTECTED, YT_FIRST, SEARCH };
