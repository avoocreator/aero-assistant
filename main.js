const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain,
  desktopCapturer, screen, nativeImage, session
} = require('electron');
const fs = require('fs');
const path = require('path');
const gemini = require('./gemini');
const { AgentManager } = require('./agent');
const actions = require('./actions');
const edgeTts = require('./edge-tts');

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
  apps: {},
  agentEnabled: true,
  agentCommand: 'agy',
  agentArgs: ['--dangerously-skip-permissions'],
  agentTimeoutSec: 240,
  agentMaxTasks: 3
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
let tray = null;
let history = [];
let agents = null;
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

  win.on('closed', () => {
    win = null;
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
async function doActions(list) {
  const results = await actions.runActions(list, { apps: config.apps });
  results.forEach((r, i) => {
    if (r.ok) {
      console.log(`[Aksi Berhasil] ${r.label}`);
    } else {
      console.warn(`[Aksi Gagal] ${list[i]?.type}: ${r.error}`);
      send('action-event', { ok: false, type: list[i]?.type, error: r.error });
    }
  });
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

ipcMain.on('cancel-ask', (_e, id) => asks.get(id)?.abort());
ipcMain.on('agent-cancel', (_e, id) => agents?.cancel(id));

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

  setupAgents();
  createWindow();
  createTray();

  const ok = globalShortcut.register(config.hotkey, () => {
    showWindow();
    send('hotkey');
  });
  if (!ok) console.warn(`Hotkey ${config.hotkey} gagal didaftarkan.`);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  agents?.cancelAll();
});
app.on('window-all-closed', () => app.quit());
