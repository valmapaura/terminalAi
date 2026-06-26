import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { TerminalManager } from './terminal';
import { registerIpcHandlers } from './ipc-handlers';

let mainWindow: BrowserWindow | null = null;
let terminalManager: TerminalManager;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OS Assistant',
    backgroundColor: '#1e1e1e',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function toggleDevTools(): void {
  if (mainWindow) {
    mainWindow.webContents.toggleDevTools();
  }
}

app.whenReady().then(() => {
  terminalManager = new TerminalManager();
  registerIpcHandlers(terminalManager);

  createWindow();

  // DevTools via window-level shortcuts (only when app is focused)
  if (mainWindow) {
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.key === 'F12' || (input.key === 'I' && input.control && input.shift)) {
        toggleDevTools();
      }
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  // No global shortcuts to unregister — using window-level shortcuts now
});

app.on('window-all-closed', () => {
  terminalManager.killAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  terminalManager.killAll();
});
