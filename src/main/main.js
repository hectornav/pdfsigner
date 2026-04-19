const { app, BrowserWindow, Menu, ipcMain, dialog, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { signPDF, addWatermark } = require('./signer');
const { loadCertificate, getCertificateInfo, generateTestCertificate } = require('./certificate');
const { rotatePages, deletePages, extractPages, splitAllPages, mergePDFs, reorderPages, getPDFInfo } = require('./pdf-tools');

let mainWindow;
let currentPdfPath = null;
let currentCertificate = null;

// ─── Settings Persistence ───────────────────────────────
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'signpdf-settings.json');
}

function loadSettings() {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (e) { /* ignore */ }
  return {};
}

function saveSettings(data) {
  try {
    const current = loadSettings();
    fs.writeFileSync(getSettingsPath(), JSON.stringify({ ...current, ...data }, null, 2));
  } catch (e) { /* ignore */ }
}

function autoLoadCertificate() {
  const settings = loadSettings();
  if (settings.certPath && settings.certPassword && fs.existsSync(settings.certPath)) {
    try {
      const cert = loadCertificate(settings.certPath, settings.certPassword);
      currentCertificate = { path: settings.certPath, password: settings.certPassword, info: cert };
      console.log('Certificate auto-loaded:', cert.commonName);
      return cert;
    } catch (e) {
      console.log('Auto-load cert failed:', e.message);
    }
  }
  return null;
}

function createWindow() {
  // Load icon using nativeImage for proper Linux support
  const iconPath = path.join(__dirname, '../renderer/assets/icons/icon.png');
  console.log('Icon path:', iconPath, 'exists:', fs.existsSync(iconPath));
  const appIcon = nativeImage.createFromPath(iconPath);
  console.log('Icon loaded, empty:', appIcon.isEmpty(), 'size:', appIcon.getSize());
  
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SignPDF',
    icon: appIcon,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: true,
      sandbox: false
    }
  });
  
  // Force icon on Linux
  if (process.platform === 'linux') {
    mainWindow.setIcon(appIcon);
  }

  // Auto-open PDF from CLI args — register BEFORE loadFile
  const args = process.argv.slice(2);
  const pdfArg = args.find(a => a.endsWith('.pdf'));
  
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      // Auto-load saved certificate
      const certInfo = autoLoadCertificate();
      if (certInfo) {
        mainWindow.webContents.send('cert:autoloaded', certInfo);
      }
      
      // Auto-open CLI PDF
      if (pdfArg) {
        const pdfPath = path.resolve(pdfArg);
        if (fs.existsSync(pdfPath)) {
          try {
            const buf = fs.readFileSync(pdfPath);
            currentPdfPath = pdfPath;
            mainWindow.webContents.send('pdf:loaded', {
              buffer: Array.from(buf),
              path: pdfPath,
              name: path.basename(pdfPath)
            });
          } catch (e) { console.error('Auto-open error:', e); }
        }
      }
    }, 800);
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  createMenu();
}

function createMenu() {
  const template = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Abrir PDF...',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleOpenPDF()
        },
        {
          label: 'Guardar PDF firmado...',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu:save')
        },
        { type: 'separator' },
        {
          label: 'Salir',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: 'Firma',
      submenu: [
        {
          label: 'Cargar Certificado (.p12/.pfx)...',
          accelerator: 'CmdOrCtrl+K',
          click: () => mainWindow.webContents.send('menu:loadCert')
        },
        {
          label: 'Firmar Documento...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow.webContents.send('menu:sign')
        },
        { type: 'separator' },
        {
          label: 'Generar Certificado de Prueba',
          click: () => handleGenerateTestCert()
        }
      ]
    },
    {
      label: 'Herramientas',
      submenu: [
        {
          label: 'Rotar Página 90°',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow.webContents.send('menu:rotateCW')
        },
        {
          label: 'Rotar Página -90°',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow.webContents.send('menu:rotateCCW')
        },
        { type: 'separator' },
        {
          label: 'Eliminar Página Actual',
          click: () => mainWindow.webContents.send('menu:deletePage')
        },
        {
          label: 'Extraer Páginas...',
          click: () => mainWindow.webContents.send('menu:extractPages')
        },
        { type: 'separator' },
        {
          label: 'Dividir PDF (todas las páginas)',
          click: () => mainWindow.webContents.send('menu:splitAll')
        },
        {
          label: 'Unir PDFs...',
          accelerator: 'CmdOrCtrl+M',
          click: () => mainWindow.webContents.send('menu:merge')
        }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        {
          label: 'Acercar',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => mainWindow.webContents.send('menu:zoomIn')
        },
        {
          label: 'Alejar',
          accelerator: 'CmdOrCtrl+-',
          click: () => mainWindow.webContents.send('menu:zoomOut')
        },
        {
          label: 'Tamaño Original',
          accelerator: 'CmdOrCtrl+0',
          click: () => mainWindow.webContents.send('menu:zoomReset')
        },
        { type: 'separator' },
        {
          label: 'Pantalla Completa',
          accelerator: 'F11',
          click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen())
        }
      ]
    },
    {
      label: 'Ayuda',
      submenu: [
        {
          label: 'Acerca de SignPDF',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Acerca de SignPDF',
              message: 'SignPDF v1.0.0',
              detail: 'Visor y firmador de PDFs con firmas digitales PAdES.\nCompatible con Adobe Acrobat.\n\n© 2026 Hector'
            });
          }
        },
        {
          label: 'Herramientas de Desarrollo',
          accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── IPC Handlers ────────────────────────────────────────────

async function handleOpenPDF() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir PDF',
    filters: [{ name: 'Documentos PDF', extensions: ['pdf'] }],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    try {
      const pdfBuffer = fs.readFileSync(filePath);
      currentPdfPath = filePath;
      mainWindow.webContents.send('pdf:loaded', {
        buffer: Array.from(pdfBuffer),
        path: filePath,
        name: path.basename(filePath)
      });
    } catch (err) {
      dialog.showErrorBox('Error', `No se pudo abrir el PDF: ${err.message}`);
    }
  }
}

ipcMain.handle('dialog:openPDF', async () => {
  await handleOpenPDF();
});

ipcMain.handle('dialog:loadCertificate', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Cargar Certificado Digital',
    filters: [
      { name: 'Certificados PKCS#12', extensions: ['p12', 'pfx'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return { path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
  }
  return null;
});

ipcMain.handle('certificate:load', async (event, { certPath, password }) => {
  try {
    const cert = loadCertificate(certPath, password);
    currentCertificate = { path: certPath, password, info: cert };
    // Save for next session
    saveSettings({ certPath, certPassword: password });
    return { success: true, info: cert };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('certificate:getInfo', () => {
  if (currentCertificate) {
    return currentCertificate.info;
  }
  return null;
});

ipcMain.handle('pdf:sign', async (event, { reason, location, contactInfo, borderColor, pageIndex, leftPct, topPct, sigWPct, sigHPct }) => {
  if (!currentPdfPath) return { success: false, error: 'No hay ningún PDF cargado' };
  if (!currentCertificate) return { success: false, error: 'No hay ningún certificado cargado' };

  try {
    const pdfBuffer = fs.readFileSync(currentPdfPath);
    const certBuffer = fs.readFileSync(currentCertificate.path);

    const signedBuffer = await signPDF(pdfBuffer, certBuffer, currentCertificate.password, {
      reason: reason || 'Firma digital',
      location: location || '',
      contactInfo: contactInfo || '',
      borderColor: borderColor || '#B83030',
      name: currentCertificate.info.commonName || 'Firmante',
      pageIndex: pageIndex || 0,
      leftPct: leftPct || 0.05,
      topPct: topPct || 0.85,
      sigWPct: sigWPct || 0.40,
      sigHPct: sigHPct || 0.12
    });

    const savePath = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar PDF Firmado',
      defaultPath: currentPdfPath.replace('.pdf', '_firmado.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (!savePath.canceled && savePath.filePath) {
      fs.writeFileSync(savePath.filePath, Buffer.from(signedBuffer));
      const newBuffer = fs.readFileSync(savePath.filePath);
      currentPdfPath = savePath.filePath;
      mainWindow.webContents.send('pdf:loaded', {
        buffer: Array.from(newBuffer),
        path: savePath.filePath,
        name: path.basename(savePath.filePath)
      });
      return { success: true, path: savePath.filePath };
    }
    return { success: false, error: 'Guardado cancelado' };
  } catch (err) {
    console.error('Signing error:', err);
    return { success: false, error: err.message };
  }
});

// ─── Watermark IPC Handler ──────────────────────────────────
ipcMain.handle('pdf:watermark', async (event, { text, fontSize, opacity, angle, color }) => {
  if (!currentPdfPath) return { success: false, error: 'No hay PDF cargado' };
  try {
    const pdfBuffer = fs.readFileSync(currentPdfPath);
    const result = await addWatermark(pdfBuffer, { text, fontSize, opacity, angle, color });
    fs.writeFileSync(currentPdfPath, result);
    const newBuffer = fs.readFileSync(currentPdfPath);
    mainWindow.webContents.send('pdf:loaded', {
      buffer: Array.from(newBuffer),
      path: currentPdfPath,
      name: path.basename(currentPdfPath)
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf:saveCopy', async (event) => {
  if (!currentPdfPath) return { success: false, error: 'No hay PDF cargado' };

  const savePath = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar Copia',
    defaultPath: currentPdfPath,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });

  if (!savePath.canceled && savePath.filePath) {
    try {
      fs.copyFileSync(currentPdfPath, savePath.filePath);
      return { success: true, path: savePath.filePath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Cancelado' };
});

async function handleGenerateTestCert() {
  const savePath = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar Certificado de Prueba',
    defaultPath: path.join(app.getPath('documents'), 'test_certificate.p12'),
    filters: [{ name: 'Certificado PKCS#12', extensions: ['p12'] }]
  });

  if (!savePath.canceled && savePath.filePath) {
    try {
      const password = 'test1234';
      generateTestCertificate(savePath.filePath, password);
      
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Certificado Generado',
        message: 'Certificado de prueba creado correctamente',
        detail: `Ruta: ${savePath.filePath}\nContraseña: ${password}\n\n⚠️ Este certificado es solo para pruebas. Para firmas legalmente válidas, usa un certificado de una Autoridad Certificadora reconocida.`
      });

      mainWindow.webContents.send('cert:generated', {
        path: savePath.filePath,
        password: password
      });
    } catch (err) {
      dialog.showErrorBox('Error', `No se pudo generar el certificado: ${err.message}`);
    }
  }
}

// Drag & drop support
ipcMain.handle('pdf:openFromPath', async (event, filePath) => {
  try {
    const pdfBuffer = fs.readFileSync(filePath);
    currentPdfPath = filePath;
    mainWindow.webContents.send('pdf:loaded', {
      buffer: pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength),
      path: filePath,
      name: path.basename(filePath)
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── PDF Tools IPC Handlers ─────────────────────────────────

ipcMain.handle('pdf:rotate', async (event, { pageIndices, angle }) => {
  if (!currentPdfPath) return { success: false, error: 'No hay PDF cargado' };
  try {
    const pdfBuffer = fs.readFileSync(currentPdfPath);
    const result = await rotatePages(pdfBuffer, pageIndices, angle);
    fs.writeFileSync(currentPdfPath, result);
    // Reload
    mainWindow.webContents.send('pdf:loaded', {
      buffer: Array.from(result),
      path: currentPdfPath,
      name: path.basename(currentPdfPath)
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf:deletePages', async (event, { pageIndices }) => {
  if (!currentPdfPath) return { success: false, error: 'No hay PDF cargado' };
  try {
    const pdfBuffer = fs.readFileSync(currentPdfPath);
    const result = await deletePages(pdfBuffer, pageIndices);
    fs.writeFileSync(currentPdfPath, result);
    mainWindow.webContents.send('pdf:loaded', {
      buffer: Array.from(result),
      path: currentPdfPath,
      name: path.basename(currentPdfPath)
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf:extractPages', async (event, { pageIndices }) => {
  if (!currentPdfPath) return { success: false, error: 'No hay PDF cargado' };
  const savePath = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar Páginas Extraídas',
    defaultPath: currentPdfPath.replace('.pdf', '_extracto.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (savePath.canceled) return { success: false, error: 'Cancelado' };
  try {
    const pdfBuffer = fs.readFileSync(currentPdfPath);
    const result = await extractPages(pdfBuffer, pageIndices);
    fs.writeFileSync(savePath.filePath, result);
    return { success: true, path: savePath.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf:splitAll', async (event) => {
  if (!currentPdfPath) return { success: false, error: 'No hay PDF cargado' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar Carpeta de Destino',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled) return { success: false, error: 'Cancelado' };
  try {
    const pdfBuffer = fs.readFileSync(currentPdfPath);
    const baseName = path.basename(currentPdfPath, '.pdf');
    const paths = await splitAllPages(pdfBuffer, result.filePaths[0], baseName);
    return { success: true, paths, count: paths.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf:merge', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Seleccionar PDFs para Unir',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });
  if (result.canceled || result.filePaths.length < 1) return { success: false, error: 'Cancelado' };

  const savePath = await dialog.showSaveDialog(mainWindow, {
    title: 'Guardar PDF Unido',
    defaultPath: path.join(path.dirname(result.filePaths[0]), 'unido.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (savePath.canceled) return { success: false, error: 'Cancelado' };

  try {
    const buffers = result.filePaths.map(p => fs.readFileSync(p));
    const merged = await mergePDFs(buffers);
    fs.writeFileSync(savePath.filePath, merged);
    
    // Load the merged PDF
    currentPdfPath = savePath.filePath;
    mainWindow.webContents.send('pdf:loaded', {
      buffer: merged.buffer.slice(merged.byteOffset, merged.byteOffset + merged.byteLength),
      path: savePath.filePath,
      name: path.basename(savePath.filePath)
    });
    return { success: true, path: savePath.filePath, fileCount: result.filePaths.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('pdf:getInfo', async (event) => {
  if (!currentPdfPath) return null;
  try {
    const pdfBuffer = fs.readFileSync(currentPdfPath);
    return await getPDFInfo(pdfBuffer);
  } catch (err) {
    return null;
  }
});

// ─── App Lifecycle ──────────────────────────────────────────

// Set WM_CLASS for Linux taskbar icon matching
app.name = 'SignPDF';
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', 'SignPDF');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
