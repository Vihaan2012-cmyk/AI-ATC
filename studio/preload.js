// Preload — the only bridge between the sandboxed renderer and the main process.
// Exposes a small, explicit API; no Node globals leak into the page.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('studio', {
  // config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (cfg) => ipcRenderer.invoke('config:set', cfg),

  // environment / hardware
  checkEnv: () => ipcRenderer.invoke('env:check'),
  pollGpu: () => ipcRenderer.invoke('gpu:poll'),

  // ollama
  ollamaList: () => ipcRenderer.invoke('ollama:list'),
  ollamaDelete: (name) => ipcRenderer.invoke('ollama:delete', name),
  chat: (req) => ipcRenderer.invoke('ollama:chat', req),

  // pipeline
  generate: (cfg) => ipcRenderer.invoke('pipeline:generate', cfg),
  train: (cfg) => ipcRenderer.invoke('pipeline:train', cfg),
  deploy: (cfg) => ipcRenderer.invoke('pipeline:deploy', cfg),
  stop: () => ipcRenderer.invoke('pipeline:stop'),

  // runs
  openRun: (name) => ipcRenderer.invoke('runs:open', name),
  previewRun: (name) => ipcRenderer.invoke('runs:preview', name),

  // streamed events from main -> renderer
  on: (channel, cb) => {
    const valid = ['gen', 'train', 'deploy', 'chat:token', 'chat:done'];
    if (!valid.includes(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
