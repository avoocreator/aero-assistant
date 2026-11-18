const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain,
  desktopCapturer, screen, nativeImage, session, powerMonitor
} = require('electron');
const fs = require('fs');
const path = require('path');
const gemini = require('./gemini');
const { AgentManager } = require('./agent');
const actions = require('./actions');
const { UiaBridge } = require('./uia');
const { Operator } = require('./operator');
const { createRoamer, anchorOf } = require('./roam');
const edgeTts = require('./edge-tts');
const { createSettings } = require('./settings');
const { createInitiative } = require('./initiative');
const quns = require('./quns');

// ---------- Muat Variabel Lingkungan ----------
function loadEnv() {
  const envCandidates = [
    path.join(__dirname, '.env'),
    path.join(__dirname, '..', 'nova-assistant', '.env')
  ];
  for (const envPath of envCandidates) {
    try {
      if (fs.existsSync(envPath)) {
        const txt = fs.readFileSync(envPath, 'utf8');
        for (const line of txt.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
          if (m && !line.trim().startsWith('#')) {
            process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '');
          }
        }
      }
    } catch {}
  }
}
loadEnv();

let config = {
  assistantName: 'Aero',
  model: 'gemini-flash-latest',
  fallbackModels: ['gemini-flash-lite-latest', 'gemini-3.8-flash'],
  thinkingMode: 'fast',
  screenWidths: { fast: 1024, balanced: 1600, deep: 2200 },
  screenQuality: { fast: 65, balanced: 78, deep: 88 },
  ttsProvider: 'auto',
  edgeVoice: 'id-ID-GadisNeural',
  voiceLang: 'id-ID',
  voiceName: '',
  seeScreen: true,
  silenceMs: 1100,
  maxHistoryTurns: 8,
  hotkey: 'F9',
  actionsEnabled: true,
  roam: { enabled: true, minSec: 50, maxSec: 160, cooldownSec: 30, activityChance: 0.05 },
  operatorMaxSteps: 14,
  operatorThinking: 'balanced',
  operatorMode: 'live',
  stopHotkey: 'Ctrl+Alt+X',
  apps: {},
  agentEnabled: true,
  agentCommand: 'agy',
  agentArgs: ['--dangerously-skip-permissions'],
  agentTimeoutSec: 240,
  agentMaxTasks: 3,
  initiativeModel: 'gemini-flash-lite-latest',
  initiative: { quiet: { start: '23:00', end: '07:00' }, modelChance: 0.6, breakAfterMin: 90 }
};

try {
  config = { ...config, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8')) };
} catch (e) {
  console.warn('config.json tidak terbaca, pakai bawaan:', e.message);
}

const MODES = ['fast', 'balanced', 'deep'];
if (!MODES.includes(config.thinkingMode)) config.thinkingMode = 'fast';
let thinkMode = config.thinkingMode;
const MODE_NAME = { fast: 'Cepat (~1s)', balanced: 'Seimbang', deep: 'Dalam' };

// Hanya satu instans yang boleh berjalan
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}
app.on('second-instance', () => showWindow());

let win = null;
let cursorWin = null;
let roamer = null;
let uiBusy = false;
let homeAnchor = null;
let tray = null;
let history = [];
let agents = null;
let settings = null;
let initiative = null;
const asks = new Map();

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

// ---------- Riwayat Percakapan ----------
function addHistory(role, text) {
  if (!text) return;
  const last = history[history.length - 1];
  if (last && last.role === role) last.text += '\n' + text;
  else history.push({ role, text });
  history = history.slice(-(config.maxHistoryTurns * 2 + 4));
  while (history[0]?.role === 'model') history.shift();
}

// ---------- Overlay Kursor Virtual Aero (Layar Penuh, Klik Tembus) ----------
function createCursorOverlay() {
  if (cursorWin && !cursorWin.isDestroyed()) return;

  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;

  cursorWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  cursorWin.setAlwaysOnTop(true, 'screen-saver');
  cursorWin.setIgnoreMouseEvents(true);
  cursorWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  cursorWin.loadFile(path.join(__dirname, 'renderer', 'cursor.html'));

  cursorWin.on('closed', () => {
    cursorWin = null;
  });
}

// Menggerakkan kursor overlay ke titik layar SUNGGUHAN (piksel fisik, dari UI Automation).
// Di mode live, mouse Windows yang asli bergerak ke titik yang sama pada saat yang sama.
function cursorTo({ x, y, label, type }) {
  if (!cursorWin || cursorWin.isDestroyed()) createCursorOverlay();
  if (!cursorWin || cursorWin.isDestroyed()) return Promise.resolve();

  let dip = { x, y };
  try { if (process.platform === 'win32') dip = screen.screenToDipPoint({ x, y }); } catch {}
  const disp = screen.getDisplayNearestPoint(dip);
  const b = disp.bounds;
  const cur = cursorWin.getBounds();
  if (cur.x !== b.x || cur.y !== b.y || cur.width !== b.width || cur.height !== b.height) cursorWin.setBounds(b);

  const winB = win ? win.getBounds() : { x: b.x + b.width - 420, y: b.y + b.height - 720, width: 420, height: 720 };
  cursorWin.webContents.send('cursor-action', {
    from: { x: winB.x + winB.width / 2 - b.x, y: winB.y + winB.height - 180 - b.y },
    to: { x: dip.x - b.x, y: dip.y - b.y },
    label: label || 'Aksi',
    type: type || 'click'
  });
  return new Promise(r => setTimeout(r, 320));
}

// ---------- Jendela Transparan Mengambang ----------
function createWindow() {
  const W = 420, H = 720;
  const wa = screen.getPrimaryDisplay().workArea;

  win = new BrowserWindow({
    width: W,
    height: Math.min(H, wa.height),
    x: wa.x + wa.width - W - 14,
    y: wa.y + wa.height - Math.min(H, wa.height) - 10,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required'
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  createCursorOverlay();

  homeAnchor = anchorOf(win.getBounds());
  roamer?.stop();
  roamer = createRoamer({
    config: () => config,
    getWin: () => win,
    getCursor: () => screen.getCursorScreenPoint(),
    getWorkArea: p => screen.getDisplayNearestPoint({ x: Math.round(p.x), y: Math.round(p.y) }).workArea,
    getHome: () => homeAnchor,
    isBusy: () => uiBusy || Boolean(typeof opCtrl !== 'undefined' && opCtrl),
    send: ev => send('fly', ev)
  });
  roamer.start();
  if (initiative) initiative.stop();
  initiative = createInitiative({
    config: () => config,
    settings,
    getIdleSec: () => { try { return powerMonitor.getSystemIdleTime(); } catch { return 0; } },
    isBusy: () => uiBusy || Boolean(opCtrl),
    isInterruptible: () => quns.interruptible(),
    deliver: payload => { if (!win || win.isDestroyed() || !win.isVisible()) return false; send('initiative', payload); return true; },
    addHistory,
    generate: generateInitiative
  });
  initiative.start();

  win.on('closed', () => {
    roamer?.stop();
    win = null;
    if (cursorWin && !cursorWin.isDestroyed()) {
      cursorWin.close();
      cursorWin = null;
    }
  });
}

function showWindow() {
  if (!win) {
    createWindow();
    return;
  }
  win.show();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
  win.focus();
}

// ---------- Visi Layar (Vision) ----------
async function captureScreen() {
  const display = win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
  const maxW = config.screenWidths[thinkMode] || 1600;
  const scale = display.scaleFactor || 1;
  const targetW = Math.min(Math.round(display.bounds.width * scale), maxW);
  const targetH = Math.round(targetW * (display.bounds.height / display.bounds.width));

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: targetW, height: targetH }
  });

  const src = sources.find(s => s.display_id === String(display.id)) || sources[0];
  if (!src?.thumbnail || src.thumbnail.isEmpty()) return null;
  return src.thumbnail.toJPEG(config.screenQuality[thinkMode] || 78).toString('base64');
}

// ---------- Agen Latar Belakang (Antigravity CLI) ----------
function setupAgents() {
  if (!config.agentEnabled) return;
  agents = new AgentManager({
    command: config.agentCommand,
    extraArgs: config.agentArgs,
    cwd: path.join(app.getPath('userData'), 'agent-workspace'),
    timeoutMs: config.agentTimeoutSec * 1000,
    maxTasks: config.agentMaxTasks,
    onEvent: ev => {
      if (ev.type === 'done') {
        addHistory('model', `[Hasil riset latar belakang untuk "${ev.title}"] ${ev.summary}\n${(ev.details || '').slice(0, 3500)}`);
      }
      send('agent-event', ev);
    }
  });
}

// ---------- Aksi Komputer ----------
const sleep = ms => new Promise(r => setTimeout(r, ms));
let uia = null;
let operator = null;
let opCtrl = null;

function getOperator() {
  if (operator) return operator;
  uia = new UiaBridge();
  const models = () => [config.model, ...(config.fallbackModels || [])].filter(Boolean);
  operator = new Operator({
    uia,
    maxSteps: config.operatorMaxSteps,
    decide: ({ system, contents, signal }) => gemini.generateJSON({
      apiKey: process.env.GEMINI_API_KEY, models: models(), system, contents,
      level: config.operatorThinking, signal
    }),
    openApp: name => actions.openApp(name, config.apps),
    screenshot: () => captureScreen(),
    onCursor: cursorTo,
    onStatus: text => send('action-event', { ok: true, progress: text })
  });
  return operator;
}

function cancelOperator() {
  if (opCtrl) { opCtrl.abort(); return true; }
  return false;
}

// Hasil tugas: Aero yang membuka obrolan (lewat inisiatif); bila inisiatif mati, pakai bubble biasa.
function reportTask(ok, text, fallback) {
  const taken = initiative?.event('task', { ok, text, emotion: ok ? 'happy' : 'sad' });
  if (!taken) send('action-event', fallback);
}

async function runTask(task) {
  if (process.platform !== 'win32') {
    send('action-event', { ok: false, type: task.kind, error: 'Kontrol aplikasi langsung hanya didukung di Windows.' });
    return;
  }
  if (opCtrl) {
    send('action-event', { ok: false, type: task.kind, error: 'Aku masih mengerjakan tugas sebelumnya. Tunggu selesai atau hentikan dulu.' });
    return;
  }
  opCtrl = new AbortController();
  const mode = task.mode || config.operatorMode || 'live';
  console.log(`[Tugas] (${mode}) ${task.goal || task.title}`);
  send('action-event', { ok: true, progress: `Mengerjakan: ${task.title}` });
  try {
    // Jalur Cepat Deterministik untuk Alarm (< 3 detik)
    if (task.kind === 'alarm' && task.time) {
      getOperator();
      const res = await uia.call('clock_alarm', {
        hour: task.time.h,
        min: task.time.min,
        label: task.time.label || ''
      }, 15000);

      if (res && res.ok) {
        if (mode === 'live') {
          for (const st of res.steps || []) {
            if (opCtrl.signal.aborted) break;
            await cursorTo({ x: st.x, y: st.y, label: st.name, type: 'click' });
          }
        }
        console.log(`[Tugas Cepat Selesai] ${res.summary}`);
        reportTask(true, res.summary, { ok: true, type: task.kind, label: res.summary });
      roamer?.nudge('tugas', 0.5);
        return;
      }
      console.warn('[Jalur cepat alarm gagal, fallback ke Operator]', res?.error);
    }

    // Jalur Cepat Deterministik untuk Timer (< 3 detik)
    if (task.kind === 'timer' && task.timer) {
      getOperator();
      const res = await uia.call('clock_timer', {
        hours: task.timer.hours || 0,
        minutes: task.timer.minutes || 0,
        seconds: task.timer.seconds || 0,
        label: task.timer.label || ''
      }, 15000);

      if (res && res.ok) {
        if (mode === 'live') {
          for (const st of res.steps || []) {
            if (opCtrl.signal.aborted) break;
            await cursorTo({ x: st.x, y: st.y, label: st.name, type: 'click' });
          }
        }
        console.log(`[Tugas Cepat Selesai] ${res.summary}`);
        reportTask(true, res.summary, { ok: true, type: task.kind, label: res.summary });
        return;
      }
      console.warn('[Jalur cepat timer gagal, fallback ke Operator]', res?.error);
    }

    // Fallback: Operator cerdas adaptif umum
    const res = await getOperator().run({ goal: task.goal, mode, signal: opCtrl.signal });
    if (res.ok) {
      console.log(`[Tugas Selesai] ${res.summary} (${res.steps} langkah)`);
      reportTask(true, res.summary, { ok: true, type: task.kind, label: res.summary });
    } else {
      console.warn(`[Tugas Gagal] ${res.summary}`);
      let msg = res.summary;
      if (task.reminder && !res.canceled && !res.interrupted) {
        try {
          if (await actions.scheduleReminder(task.reminder)) msg += ' Sebagai gantinya, kupasang pengingat notifikasi Aero pada waktunya (bukan alarm aplikasi Jam).';
        } catch {}
      }
      reportTask(false, msg, { ok: false, type: task.kind, error: msg });
    }
  } catch (e) {
    console.warn('[Tugas Error]', e.message);
    send('action-event', { ok: false, type: task.kind, error: `Operator error: ${e.message}` });
  } finally {
    opCtrl = null;
  }
}

async function doActions(list) {
  for (const a of (list || []).slice(0, 5)) {
    let task = null;
    try { task = actions.toTask(a); }
    catch (e) { send('action-event', { ok: false, type: a?.type, error: e.message }); continue; }

    if (task) { await runTask(task); continue; }

    if (a?.type === 'move') {
      const area = a.area || a.direction || 'away';
      const ok = roamer?.flyToArea(area);
      if (ok) {
        console.log(`[Aksi Berhasil] Pindah ke area: ${area}`);
        send('action-event', { ok: true, type: 'move', label: `Pindah ke area ${area}` });
      } else {
        console.warn(`[Aksi Gagal] Tidak bisa pindah ke area: ${area}`);
        send('action-event', { ok: false, type: 'move', error: `Tidak bisa pindah ke area ${area}` });
      }
      await sleep(300);
      continue;
    }

    if (a?.type === 'set_volume') {
      const cur = settings.get().volume;
      const v = Number.isFinite(Number(a.percent)) ? Number(a.percent) : cur + (Number(a.delta) || 0);
      const n = settings.set({ volume: v, muted: v <= 0 ? true : false });
      send('settings-changed', n);
      buildTrayMenu();
      continue;
    }
    if (a?.type === 'snooze') {
      initiative?.snooze(Math.max(0, Number(a.minutes) || 60));
      send('settings-changed', settings.get());
      buildTrayMenu();
      continue;
    }
    if (a?.type === 'initiative') {
      settings.set({ initiative: { level: a.level } });
      send('settings-changed', settings.get());
      buildTrayMenu();
      continue;
    }

    const r = await actions.runAction(a, { apps: config.apps });
    if (r.ok) console.log(`[Aksi Berhasil] ${r.label}`);
    else {
      console.warn(`[Aksi Gagal] ${a?.type}: ${r.error}`);
      send('action-event', { ok: false, type: a?.type, error: r.error });
    }
    await sleep(500);
  }
}

// ---------- IPC Handler ----------
ipcMain.handle('get-config', () => ({
  assistantName: config.assistantName,
  voiceLang: config.voiceLang,
  voiceName: config.voiceName,
  ttsProvider: config.ttsProvider,
  seeScreen: config.seeScreen,
  silenceMs: config.silenceMs,
  agentEnabled: config.agentEnabled,
  hotkey: config.hotkey,
  thinkMode,
  hasKey: Boolean(process.env.GEMINI_API_KEY)
}));

ipcMain.handle('ask-stream', async (e, { id, text, audioB64, audioMime }) => {
  const ctrl = new AbortController();
  asks.set(id, ctrl);

  let imageB64 = null;
  if (config.seeScreen) {
    try {
      imageB64 = await captureScreen();
    } catch (err) {
      console.warn('Gagal capture screen:', err.message);
    }
  }

  const models = [config.model, ...(config.fallbackModels || [])].filter(Boolean);

  try {
    const res = await gemini.askStream({
      apiKey: process.env.GEMINI_API_KEY,
      models,
      name: config.assistantName,
      history,
      input: { text, audioB64, audioMime, imageB64 },
      agentEnabled: config.agentEnabled && Boolean(agents),
      actionsEnabled: config.actionsEnabled,
      level: thinkMode,
      signal: ctrl.signal,
      onMeta: meta => {
        send('stream-event', { id, kind: 'meta', ...meta });
        if (meta.actions?.length && config.actionsEnabled) {
          doActions(meta.actions);
        }
        if (meta.delegate && agents && config.agentEnabled) {
          agents.start(meta.delegate);
        }
      },
      onDelta: delta => {
        send('stream-event', { id, kind: 'delta', text: delta });
      }
    });

    if (res.ok && res.meta?.reply) {
      if (text) addHistory('user', text);
      else if (res.meta.heard) addHistory('user', res.meta.heard);
      addHistory('model', res.meta.reply);
    }
    return res;
  } finally {
    asks.delete(id);
  }
});

ipcMain.handle('settings-get', () => settings.get());
ipcMain.handle('settings-set', (_e, patch) => {
  // renderer hanya boleh mengubah volume/mute dan pilihan inisiatif, bukan status internal
  const p = {};
  if (patch && typeof patch === 'object') {
    if ('volume' in patch) p.volume = patch.volume;
    if ('muted' in patch) p.muted = patch.muted;
  }
  const n = settings.set(p);
  buildTrayMenu();
  return n;
});
ipcMain.on('initiative-feedback', (_e, { id, outcome } = {}) => initiative?.feedback(id, outcome));
ipcMain.on('initiative-event', (_e, { kind, facts } = {}) => { if (kind === 'battery') initiative?.event('battery', facts || {}); });

ipcMain.on('cancel-ask', (_e, id) => asks.get(id)?.abort());
ipcMain.on('agent-cancel', (_e, id) => agents?.cancel(id));
ipcMain.on('cancel-operator', () => cancelOperator());
let busySince = 0;
ipcMain.on('ui-busy', (_e, busy) => {
  const was = uiBusy;
  uiBusy = Boolean(busy);
  if (uiBusy && !was) busySince = Date.now();
  // selesai ngobrol: kadang Aero langsung terbang sendiri
  if (was && !uiBusy && Date.now() - busySince > 4000) roamer?.nudge('selesai', 0.2);
});
ipcMain.on('fly-cancel', () => roamer?.cancel());
ipcMain.handle('fly-to-area', (_e, area) => roamer?.flyToArea(area) || false);

ipcMain.handle('tts-edge', async (_e, text) => {
  try {
    const buf = await edgeTts.synth(text, config.edgeVoice);
    return { ok: true, audioB64: buf.toString('base64') };
  } catch (err) {
    console.warn('Edge TTS gagal:', err.message);
    return { ok: false, error: err.message };
  }
});

function setThink(m) {
  thinkMode = m;
  send('think-changed', { mode: m, name: MODE_NAME[m] });
  buildTrayMenu();
}

function setVision(on) {
  config.seeScreen = on;
  send('vision-changed', on);
  buildTrayMenu();
}

const loginOpts = () => ({ path: process.execPath, args: [app.getAppPath()] });
function autostartOn() {
  try { return app.getLoginItemSettings(loginOpts()).openAtLogin; } catch { return false; }
}
function setAutostart(on) {
  try { app.setLoginItemSettings({ ...loginOpts(), openAtLogin: on }); } catch (e) { console.warn('Autostart gagal:', e.message); }
}

ipcMain.handle('cycle-think', () => {
  setThink(MODES[(MODES.indexOf(thinkMode) + 1) % MODES.length]);
  return thinkMode;
});

ipcMain.handle('clear-history', () => {
  history = [];
  return true;
});

ipcMain.handle('set-vision', (_e, on) => {
  setVision(Boolean(on));
  return config.seeScreen;
});

ipcMain.on('set-ignore-mouse', (_e, ignore) => {
  win?.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

ipcMain.on('hide-window', () => win?.hide());
ipcMain.on('quit-app', () => app.quit());

// ---------- Pengaturan: volume & inisiatif ----------
function broadcastSettings() {
  send('settings-changed', settings.get());
  buildTrayMenu();
}
function setVolume(p) { settings.set(p); broadcastSettings(); }
function setInit(p) { settings.set({ initiative: p }); broadcastSettings(); }

// Kalimat segar untuk inisiatif (model lite, jatah terpisah). Gagal/kuota habis -> null, mesin pakai kumpulan kalimat.
const INIT_HINT = {
  return: 'Pengguna baru kembali setelah pergi {away}. Sapa singkat, hangat.',
  morning: 'Ini sapaan pagi pertama hari ini.',
  meal: 'Sudah waktu makan siang. Ingatkan dengan santai.',
  night: 'Sudah larut malam. Ingatkan istirahat dengan lembut.',
  break: 'Pengguna sudah aktif {work} tanpa jeda. Ajak rehat sebentar.',
  battery: 'Baterai laptop tinggal {pct}% dan tidak dicas. Ingatkan colok charger.'
};
async function generateInitiative(kind, facts) {
  const key = process.env.GEMINI_API_KEY;
  const hint = INIT_HINT[kind];
  if (!key || !hint) return null;
  const fill = s => s.replace(/\{(\w+)\}/g, (_m, k) => facts?.[k] ?? '');
  const system = `Kamu ${config.assistantName}, asisten desktop mungil berbentuk bola emas pixel. Kamu sedang membuka obrolan duluan. ` +
    'Tulis SATU kalimat pendek (maksimal 140 karakter) berbahasa Indonesia santai, hangat, tidak menggurui, tanpa emoji, tanpa tanda kutip. ' +
    'Balas JSON: {"emotion":"happy|curious|excited|sleepy|playful|love|sad","text":"..."}.';
  try {
    const r = await gemini.generateJSON({
      apiKey: key,
      models: [config.initiativeModel || 'gemini-flash-lite-latest'],
      system,
      contents: [{ role: 'user', parts: [{ text: fill(hint) }] }],
      level: 'fast', timeoutMs: 8000
    });
    const text = String(r?.json?.text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    return text ? { text, emotion: String(r.json.emotion || 'happy') } : null;
  } catch (e) {
    return { quota: /429|quota|kuota|jatah|exhaust/i.test(`${e.status || ''} ${e.message}`) };
  }
}

// ---------- Tray & Menu ----------
function buildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: win?.isVisible() ? `Sembunyikan ${config.assistantName}` : `Tampilkan ${config.assistantName} (F9)`,
      click: () => {
        win?.isVisible() ? win.hide() : showWindow();
        setTimeout(buildTrayMenu, 100);
      }
    },
    { type: 'separator' },
    {
      label: 'Mode Berpikir',
      submenu: MODES.map(m => ({
        label: MODE_NAME[m],
        type: 'radio',
        checked: thinkMode === m,
        click: () => setThink(m)
      }))
    },
    {
      label: 'Boleh Lihat Layar (Vision)',
      type: 'checkbox',
      checked: config.seeScreen,
      click: m => setVision(m.checked)
    },
    {
      label: 'Jalankan Saat Windows Menyala',
      type: 'checkbox',
      checked: autostartOn(),
      click: m => setAutostart(m.checked)
    },
    {
      label: 'Volume Suara',
      submenu: [
        { label: 'Senyap', type: 'checkbox', checked: settings.get().muted, click: m => setVolume({ muted: m.checked }) },
        { type: 'separator' },
        ...[25, 50, 75, 100].map(v => ({
          label: `${v}%`, type: 'radio',
          checked: !settings.get().muted && settings.get().volume === v,
          click: () => setVolume({ volume: v, muted: false })
        }))
      ]
    },
    {
      label: 'Inisiatif Aero (mulai ngobrol)',
      submenu: [
        ...[['off', 'Mati'], ['rare', 'Jarang'], ['normal', 'Normal'], ['chatty', 'Cerewet']].map(([k, n]) => ({
          label: n, type: 'radio', checked: settings.get().initiative.level === k, click: () => setInit({ level: k })
        })),
        { type: 'separator' },
        ...[['important', 'Suara untuk yang penting saja'], ['always', 'Selalu bersuara'], ['never', 'Bubble saja']].map(([k, n]) => ({
          label: n, type: 'radio', checked: settings.get().initiative.voice === k, click: () => setInit({ voice: k })
        })),
        { type: 'separator' },
        ...[['return', 'Sapa saat kembali'], ['morning', 'Sapaan pagi'], ['meal', 'Ingatkan makan'], ['night', 'Ingatkan tidur'], ['break', 'Ingatkan istirahat'], ['battery', 'Peringatan baterai']].map(([k, n]) => ({
          label: n, type: 'checkbox', checked: settings.get().initiative.kinds[k] !== false, click: m => setInit({ kinds: { [k]: m.checked } })
        })),
        { type: 'separator' },
        settings.get().initiative.snoozeUntil > Date.now()
          ? { label: 'Lanjutkan (batalkan diam)', click: () => { initiative?.snooze(0); broadcastSettings(); } }
          : { label: 'Diam dulu 1 jam', click: () => { initiative?.snooze(60); broadcastSettings(); } }
      ]
    },
    {
      label: 'Terbang Sendiri (berpindah tempat)',
      type: 'checkbox',
      checked: config.roam?.enabled !== false,
      click: m => { config.roam = { ...config.roam, enabled: m.checked }; if (!m.checked) roamer?.cancel(); }
    },
    {
      label: `Hentikan Aksi Komputer (${config.stopHotkey})`,
      click: () => cancelOperator()
    },
    {
      label: 'Batalkan Semua Tugas Latar Belakang',
      enabled: Boolean(agents),
      click: () => agents?.cancelAll()
    },
    {
      label: 'Lupakan Percakapan',
      click: () => {
        history = [];
        send('history-cleared');
      }
    },
    { type: 'separator' },
    {
      label: 'Keluar',
      click: () => app.quit()
    }
  ]));
}

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip(`${config.assistantName} (${config.hotkey})`);
  tray.on('click', () => {
    win?.isVisible() ? win.hide() : showWindow();
    buildTrayMenu();
  });
  buildTrayMenu();
}

app.whenReady().then(async () => {
  if (!gotLock) return;

  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  settings = createSettings(path.join(app.getPath('userData'), 'settings.json'));
  setupAgents();
  createWindow();
  createTray();

  const ok = globalShortcut.register(config.hotkey, () => {
    showWindow();
    send('hotkey');
  });
  if (!ok) console.warn(`Hotkey ${config.hotkey} gagal didaftarkan.`);
  if (config.stopHotkey && !globalShortcut.register(config.stopHotkey, () => {
    if (cancelOperator()) send('action-event', { ok: true, label: 'Aksi komputer dihentikan.' });
  })) console.warn(`Hotkey stop ${config.stopHotkey} gagal didaftarkan.`);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  initiative?.stop();
  settings?.flush();
  agents?.cancelAll();
  cancelOperator();
  uia?.stop();
});
app.on('window-all-closed', () => app.quit());
