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

// ---------- Otomasi Alarm & Timer ----------
async function setAlarm(timeStr, label = 'Alarm Aero') {
  const cleanTime = String(timeStr || '').replace(/\s+/g, '').replace('.', ':');
  const m = cleanTime.match(/(\d{1,2}):(\d{2})/);
  if (!m) throw new Error('Format waktu alarm harus jam:menit, misal 12:00 atau 07.30.');
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error('Jam atau menit di luar rentang (00:00 - 23:59).');

  const formatted = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  const now = new Date();
  const target = new Date();
  target.setHours(h, min, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const diffSec = Math.max(1, Math.round((target.getTime() - now.getTime()) / 1000));

  if (IS_WIN) {
    const h1 = String(h).length > 1 ? String(h)[0] : '0';
    const h2 = String(h).length > 1 ? String(h)[1] : String(h)[0];
    const m1 = String(min).padStart(2, '0')[0];
    const m2 = String(min).padStart(2, '0')[1];

    const psAutomateClock = `
      Start-Process "ms-clock:alarm"
      Start-Sleep -Milliseconds 1300

      Add-Type -TypeDefinition @"
      using System;
      using System.Runtime.InteropServices;
      using System.Threading;

      public class ClockBot {
          [DllImport("user32.dll")]
          public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
          const uint KEYUP = 0x0002;

          public static void Tap(byte vk) {
              keybd_event(vk, 0, 0, UIntPtr.Zero);
              Thread.Sleep(60);
              keybd_event(vk, 0, KEYUP, UIntPtr.Zero);
              Thread.Sleep(60);
          }

          public static void Shortcut(byte mod, byte key) {
              keybd_event(mod, 0, 0, UIntPtr.Zero);
              Thread.Sleep(60);
              keybd_event(key, 0, 0, UIntPtr.Zero);
              Thread.Sleep(60);
              keybd_event(key, 0, KEYUP, UIntPtr.Zero);
              Thread.Sleep(60);
              keybd_event(mod, 0, KEYUP, UIntPtr.Zero);
              Thread.Sleep(80);
          }

          public static void TypeChar(char c) {
              if (c >= '0' && c <= '9') {
                  Tap((byte)(0x30 + (c - '0')));
              }
          }
      }
"@

      # 1. Buka form Add Alarm dengan Ctrl+N
      [ClockBot]::Shortcut(0x11, 0x4E)
      Start-Sleep -Milliseconds 800

      # 2. Masukkan jam
      [ClockBot]::TypeChar([char]'${h1}')
      [ClockBot]::TypeChar([char]'${h2}')
      Start-Sleep -Milliseconds 300

      # 3. Pindah ke kolom menit
      [ClockBot]::Tap(0x09)
      Start-Sleep -Milliseconds 300

      # 4. Masukkan menit
      [ClockBot]::TypeChar([char]'${m1}')
      [ClockBot]::TypeChar([char]'${m2}')
      Start-Sleep -Milliseconds 300

      # 5. Simpan alarm (Ctrl+S lalu Enter)
      [ClockBot]::Shortcut(0x11, 0x53)
      Start-Sleep -Milliseconds 350
      [ClockBot]::Tap(0x0D)
    `;

    // Jalankan automasi nyata ke Clock app
    ps(psAutomateClock).catch(e => console.warn('Clock bot error:', e.message));

    // Backup: jadwal notifikasi alarm mandiri
    const psDetached = `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", "Start-Sleep -Seconds ${diffSec}; try { [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; \\$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \\$texts = \\$template.GetElementsByTagName('text'); \\$texts.Item(0).AppendChild(\\$template.CreateTextNode('⏰ Alarm ${formatted}')) | Out-Null; \\$texts.Item(1).AppendChild(\\$template.CreateTextNode('Waktu ${formatted} telah tiba (${clean(label) || 'Aero'}).')) | Out-Null; \\$toast = [Windows.UI.Notifications.ToastNotification]::new(\\$template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aero Assistant').Show(\\$toast); } catch {}; [System.Media.SystemSounds]::Exclamation.Play()"`;
    await ps(psDetached).catch(() => {});
  }

  return {
    label: `Alarm berhasil disetel untuk pukul ${formatted}`,
    cursorSteps: [
      { action: 'click', label: 'Tambah Alarm (+)', relX: 0.72, relY: 0.80, duration: 1100 },
      { action: 'type', label: `Setel ${formatted}`, relX: 0.50, relY: 0.45, duration: 1100 },
      { action: 'click', label: 'Simpan Alarm', relX: 0.52, relY: 0.62, duration: 900 }
    ]
  };
}

async function setTimer(minutes, seconds = 0, label = 'Timer Aero') {
  const m = Math.max(0, parseInt(minutes, 10) || 0);
  const s = Math.max(0, parseInt(seconds, 10) || 0);
  const totalSec = m * 60 + s;
  if (totalSec <= 0) throw new Error('Durasi timer harus lebih dari 0 detik.');

  if (IS_WIN) {
    const psAutomateTimer = `
      Start-Process "ms-clock:timer"
      Start-Sleep -Milliseconds 1300

      Add-Type -TypeDefinition @"
      using System;
      using System.Runtime.InteropServices;
      using System.Threading;

      public class TimerBot {
          [DllImport("user32.dll")]
          public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
          const uint KEYUP = 0x0002;

          public static void Shortcut(byte mod, byte key) {
              keybd_event(mod, 0, 0, UIntPtr.Zero);
              Thread.Sleep(60);
              keybd_event(key, 0, 0, UIntPtr.Zero);
              Thread.Sleep(60);
              keybd_event(key, 0, KEYUP, UIntPtr.Zero);
              Thread.Sleep(60);
              keybd_event(mod, 0, KEYUP, UIntPtr.Zero);
              Thread.Sleep(80);
          }
      }
"@
      [TimerBot]::Shortcut(0x11, 0x4E)
      Start-Sleep -Milliseconds 600
      [TimerBot]::Shortcut(0x11, 0x53)
    `;
    ps(psAutomateTimer).catch(e => console.warn('Timer bot error:', e.message));

    const psDetached = `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", "Start-Sleep -Seconds ${totalSec}; try { [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; \\$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); \\$texts = \\$template.GetElementsByTagName('text'); \\$texts.Item(0).AppendChild(\\$template.CreateTextNode('⏳ Timer Selesai (${m}m ${s}s)')) | Out-Null; \\$texts.Item(1).AppendChild(\\$template.CreateTextNode('Waktu timer ${clean(label) || 'Aero'} telah habis.')) | Out-Null; \\$toast = [Windows.UI.Notifications.ToastNotification]::new(\\$template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Aero Assistant').Show(\\$toast); } catch {}; [System.Media.SystemSounds]::Exclamation.Play()"`;
    await ps(psDetached).catch(() => {});
  }

  return {
    label: `Timer dipasang untuk ${m} menit ${s} detik`,
    cursorSteps: [
      { action: 'click', label: 'Tambah Timer (+)', relX: 0.72, relY: 0.80, duration: 1000 },
      { action: 'click', label: `Nyalakan Timer ${m}m`, relX: 0.52, relY: 0.62, duration: 900 }
    ]
  };
}

// ---------- Kontrol UI Interaktif & Pembaca Latar Belakang ----------
async function clickUi(app, button) {
  const btn = clean(button).toLowerCase();
  const targetApp = clean(app);

  if (/^(play|pause|putar|jeda|stop)$/i.test(btn)) {
    await mediaKey('play_pause');
    return {
      label: `Memutar/menjeda media (${targetApp || 'sistem'})`,
      cursor: { action: 'click', label: `Play/Pause ${targetApp || ''}` }
    };
  }
  if (/^(next|lanjut|berikutnya|skip)$/i.test(btn)) {
    await mediaKey('next');
    return {
      label: `Memutar track berikutnya`,
      cursor: { action: 'click', label: `Next Track` }
    };
  }
  if (/^(prev|previous|sebelumnya)$/i.test(btn)) {
    await mediaKey('previous');
    return {
      label: `Memutar track sebelumnya`,
      cursor: { action: 'click', label: `Previous Track` }
    };
  }

  return {
    label: `Mengklik tombol "${button}" di ${targetApp || 'aplikasi'}`,
    cursor: { action: 'click', label: `Klik ${button}` }
  };
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

  return {
    label: `Membaca jendela ${appName}: ${out}`,
    text: out,
    cursor: { action: 'click', label: `Baca Jendela ${appName}` }
  };
}

async function typeText(text, app) {
  const t = String(text || '').slice(0, 500);
  if (!t) throw new Error('Teks yang ingin diketik tidak boleh kosong.');

  if (IS_WIN) {
    await ps(
      'Add-Type -AssemblyName System.Windows.Forms;' +
      '[System.Windows.Forms.SendKeys]::SendWait($env:AGY_TEXT)',
      { AGY_TEXT: t }
    );
  }

  return {
    label: `Mengetik: "${t.slice(0, 35)}${t.length > 35 ? '...' : ''}"`,
    cursor: { action: 'type', label: `Ketik: ${t.slice(0, 20)}` }
  };
}

// ---------- Pintu Masuk ----------
async function runAction(a, opts = {}) {
  try {
    const type = String(a?.type || '');
    const custom = opts.apps;
    switch (type) {
      case 'set_alarm': {
        const r = await setAlarm(a.time, a.label);
        return { ok: true, label: r.label, cursor: r.cursor, cursorSteps: r.cursorSteps };
      }
      case 'set_timer': {
        const r = await setTimer(a.minutes, a.seconds, a.label);
        return { ok: true, label: r.label, cursor: r.cursor, cursorSteps: r.cursorSteps };
      }
      case 'click_ui': {
        const r = await clickUi(clean(a.app), clean(a.button || a.target));
        return { ok: true, label: r.label, cursor: r.cursor };
      }
      case 'read_window': {
        const r = await readWindow(clean(a.app));
        return { ok: true, label: r.label, cursor: r.cursor, text: r.text };
      }
      case 'type_text': {
        const r = await typeText(clean(a.text), clean(a.app));
        return { ok: true, label: r.label, cursor: r.cursor };
      }
      case 'open_app': return { ok: true, label: await openApp(clean(a.app), custom), cursor: { action: 'click', label: `Buka ${clean(a.app)}` } };
      case 'close_app': return { ok: true, label: await closeApp(clean(a.app), custom) };
      case 'open_url': {
        const url = validUrl(a.url);
        if (!url) throw new Error('Alamat web tidak valid (hanya http/https).');
        await openUrl(url, a.browser);
        return { ok: true, label: `Membuka ${new URL(url).hostname}`, cursor: { action: 'click', label: `Buka Web` } };
      }
      case 'search': {
        const q = clean(a.query).slice(0, QUERY_MAX);
        if (!q) throw new Error('Kata kunci pencarian kosong.');
        const site = SEARCH[String(a.site || 'google').toLowerCase()];
        if (!site) throw new Error('Situs pencarian tidak dikenal.');
        await openUrl(site(q), a.browser);
        return { ok: true, label: `Mencari "${q}"`, cursor: { action: 'click', label: `Cari "${q.slice(0, 15)}"` } };
      }
      case 'youtube_play': {
        const q = clean(a.query).slice(0, QUERY_MAX);
        if (!q) throw new Error('Kata kunci video kosong.');
        await openUrl(YT_FIRST(q), a.browser);
        return { ok: true, label: `Membuka video: ${q}`, cursor: { action: 'click', label: `Buka Video` } };
      }
      case 'spotify_search': {
        const q = clean(a.query).slice(0, QUERY_MAX);
        if (!q) throw new Error('Kata kunci lagu kosong.');
        return { ok: true, label: await spotifySearch(q), cursor: { action: 'click', label: `Cari Lagu` } };
      }
      case 'media': return { ok: true, label: await mediaKey(String(a.key)), cursor: { action: 'click', label: `Media: ${a.key}` } };
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
