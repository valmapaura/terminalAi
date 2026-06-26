import { app, BrowserWindow, ipcMain, globalShortcut } from 'electron';
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
    title: 'Terminal AI',
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

  // Register DevTools shortcuts
  globalShortcut.register('F12', toggleDevTools);
  globalShortcut.register('CommandOrControl+Shift+I', toggleDevTools);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
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
