// Safe bridge from the widget/wizard UI to the Electron main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('atcWin', {
  isElectron: true,
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
  togglePin: () => ipcRenderer.invoke('win:togglePin'),
  setDrawer: (open) => ipcRenderer.invoke('win:drawer', open),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:save', s),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (c) => ipcRenderer.invoke('config:save', c),
  openWizard: () => ipcRenderer.invoke('wiz:open'),
  getLogbook: () => ipcRenderer.invoke('logbook:get'),
  addLogbook: (e) => ipcRenderer.invoke('logbook:add', e),
  clearLogbook: () => ipcRenderer.invoke('logbook:clear'),
  openDashboard: () => ipcRenderer.invoke('open:dashboard'),
  onPtt: (cb) => ipcRenderer.on('ptt:toggle', () => cb()),
  restartBrain: () => ipcRenderer.invoke('brain:restart'),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: (bundle) => ipcRenderer.invoke('config:import', bundle),
});

// Piper HD voice API
contextBridge.exposeInMainWorld('atcVoice', {
  status: () => ipcRenderer.invoke('piper:status'),
  installBinary: () => ipcRenderer.invoke('piper:installBinary'),
  installVoice: (key) => ipcRenderer.invoke('piper:installVoice', key),
  installAll: () => ipcRenderer.invoke('piper:installAll'),
  deleteAll: () => ipcRenderer.invoke('piper:deleteAll'),
  synth: (text, key) => ipcRenderer.invoke('piper:synth', text, key),
  onLog: (cb) => ipcRenderer.on('piper:log', (_e, line) => cb(line)),
});

// Install-wizard API
contextBridge.exposeInMainWorld('atcSetup', {
  status: () => ipcRenderer.invoke('wiz:status'),
  installDeps: () => ipcRenderer.invoke('wiz:installDeps'),
  writeEnv: () => ipcRenderer.invoke('wiz:writeEnv'),
  pullModel: () => ipcRenderer.invoke('wiz:pullModel'),
  openOllama: () => ipcRenderer.invoke('wiz:openOllama'),
  finish: () => ipcRenderer.invoke('wiz:finish'),
  onLog: (cb) => ipcRenderer.on('wiz:log', (_e, line) => cb(line)),
});
