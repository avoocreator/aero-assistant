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
  'visual studio code': { start: 'code', proc: 'Code' }
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

// ---------- Pintu Masuk ----------
async function runAction(a, opts = {}) {
  try {
    const type = String(a?.type || '');
    const custom = opts.apps;
    switch (type) {
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

module.exports = { runAction, runActions, validUrl, BUILTIN_APPS, PROTECTED, YT_FIRST, SEARCH };
