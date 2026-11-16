const { contextBridge, ipcRenderer } = require('electron');

const api = {
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Streaming: onEvent menerima { kind: 'meta' | 'delta', ... }. Mengembalikan hasil akhir.
  askStream: (id, payload, onEvent) => {
    const fn = (_e, m) => { if (m.id === id) onEvent(m); };
    ipcRenderer.on('stream-event', fn);
    return ipcRenderer.invoke('ask-stream', { ...payload, id })
      .finally(() => ipcRenderer.removeListener('stream-event', fn));
  },
  cancelAsk: id => ipcRenderer.send('cancel-ask', id),

  ttsEdge: text => ipcRenderer.invoke('tts-edge', text),
  onActionEvent: cb => ipcRenderer.on('action-event', (_e, ev) => cb(ev)),
  onCursorAction: cb => ipcRenderer.on('cursor-action', (_e, data) => cb(data)),
  onFly: cb => ipcRenderer.on('fly', (_e, ev) => cb(ev)),
  flyToArea: area => ipcRenderer.invoke('fly-to-area', area),
  reportBusy: busy => ipcRenderer.send('ui-busy', busy),
  flyCancel: () => ipcRenderer.send('fly-cancel'),
  cancelOperator: () => ipcRenderer.send('cancel-operator'),
  cycleThink: () => ipcRenderer.invoke('cycle-think'),
  onThinkChanged: cb => ipcRenderer.on('think-changed', (_e, v) => cb(v)),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  setVision: on => ipcRenderer.invoke('set-vision', on),
  setIgnoreMouse: ignore => ipcRenderer.send('set-ignore-mouse', ignore),
  hide: () => ipcRenderer.send('hide-window'),
  quit: () => ipcRenderer.send('quit-app'),

  onAgentEvent: cb => ipcRenderer.on('agent-event', (_e, ev) => cb(ev)),
  cancelAgent: id => ipcRenderer.send('agent-cancel', id),

  onHotkey: cb => ipcRenderer.on('hotkey', () => cb()),
  onVisionChanged: cb => ipcRenderer.on('vision-changed', (_e, on) => cb(on)),
  onClearHistory: cb => ipcRenderer.on('history-cleared', () => cb())
};

// Ekspos ke window.assistant dan window.nova agar kompatibel penuh
contextBridge.exposeInMainWorld('assistant', api);
contextBridge.exposeInMainWorld('nova', api);
