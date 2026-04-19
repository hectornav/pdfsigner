const { contextBridge, ipcRenderer } = require('electron');

// Store callbacks for IPC events (contextBridge can lose them)
const callbacks = {};

function registerCallback(channel, callback) {
  callbacks[channel] = callback;
}

// Listen to all IPC channels and dispatch to stored callbacks
const ipcChannels = [
  'pdf:loaded', 'menu:save', 'menu:loadCert', 'menu:sign',
  'menu:zoomIn', 'menu:zoomOut', 'menu:zoomReset',
  'cert:generated', 'menu:rotateCW', 'menu:rotateCCW',
  'menu:deletePage', 'menu:extractPages', 'menu:splitAll', 'menu:merge'
];

ipcChannels.forEach(channel => {
  ipcRenderer.on(channel, (event, data) => {
    if (callbacks[channel]) {
      callbacks[channel](data);
    }
  });
});

contextBridge.exposeInMainWorld('signpdf', {
  // PDF operations
  openPDF: () => ipcRenderer.invoke('dialog:openPDF'),
  openFromPath: (filePath) => ipcRenderer.invoke('pdf:openFromPath', filePath),
  saveCopy: () => ipcRenderer.invoke('pdf:saveCopy'),

  // Certificate operations
  loadCertificateDialog: () => ipcRenderer.invoke('dialog:loadCertificate'),
  loadCertificate: (certPath, password) => ipcRenderer.invoke('certificate:load', { certPath, password }),
  getCertificateInfo: () => ipcRenderer.invoke('certificate:getInfo'),

  // Signing
  signPDF: (options) => ipcRenderer.invoke('pdf:sign', options),

  // PDF Tools
  rotatePage: (pageIndices, angle) => ipcRenderer.invoke('pdf:rotate', { pageIndices, angle }),
  deletePages: (pageIndices) => ipcRenderer.invoke('pdf:deletePages', { pageIndices }),
  extractPages: (pageIndices) => ipcRenderer.invoke('pdf:extractPages', { pageIndices }),
  splitAll: () => ipcRenderer.invoke('pdf:splitAll'),
  mergePDFs: () => ipcRenderer.invoke('pdf:merge'),
  getPDFInfo: () => ipcRenderer.invoke('pdf:getInfo'),
  addWatermark: (options) => ipcRenderer.invoke('pdf:watermark', options),

  // Event listeners — store callbacks in preload scope (survives contextBridge)
  onPDFLoaded: (cb) => registerCallback('pdf:loaded', cb),
  onMenuSave: (cb) => registerCallback('menu:save', cb),
  onMenuLoadCert: (cb) => registerCallback('menu:loadCert', cb),
  onMenuSign: (cb) => registerCallback('menu:sign', cb),
  onMenuZoomIn: (cb) => registerCallback('menu:zoomIn', cb),
  onMenuZoomOut: (cb) => registerCallback('menu:zoomOut', cb),
  onMenuZoomReset: (cb) => registerCallback('menu:zoomReset', cb),
  onCertGenerated: (cb) => registerCallback('cert:generated', cb),
  onMenuRotateCW: (cb) => registerCallback('menu:rotateCW', cb),
  onMenuRotateCCW: (cb) => registerCallback('menu:rotateCCW', cb),
  onMenuDeletePage: (cb) => registerCallback('menu:deletePage', cb),
  onMenuExtractPages: (cb) => registerCallback('menu:extractPages', cb),
  onMenuSplitAll: (cb) => registerCallback('menu:splitAll', cb),
  onMenuMerge: (cb) => registerCallback('menu:merge', cb),
  onCertAutoloaded: (cb) => registerCallback('cert:autoloaded', cb)
});
