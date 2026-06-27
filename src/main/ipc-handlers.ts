import { ipcMain, BrowserWindow, app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import * as https from 'https';
import * as http from 'http';
import { TerminalManager } from './terminal';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'os-assistant-config.json');
}

function getMemoryPath(): string {
  return path.join(app.getPath('userData'), 'os-assistant-memory.json');
}

function getModelsPath(): string {
  return path.join(app.getPath('userData'), 'os-assistant-models.json');
}

function getChatsDir(): string {
  const dir = path.join(app.getPath('userData'), 'os-assistant-chats');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface ModelEntry {
  id: string;
  provider: string;
  source: 'auto' | 'manual';
}

interface ModelsFile {
  models: ModelEntry[];
  selectedModels: Record<string, string>; // provider -> model id
}

function loadModels(): ModelsFile {
  try {
    const p = getModelsPath();
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    console.error('[MODELS] Failed to load models file, resetting:', e);
  }
  return { models: [], selectedModels: {} };
}

function saveModels(data: ModelsFile): void {
  const p = getModelsPath();
  const tmpPath = p + '.tmp';
  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, p);
  } catch (e) {
    console.error('[MODELS] Failed to save models file:', e);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

interface StoredProviderData {
  apiKeyEncrypted?: string;
  baseUrl?: string;
  model?: string;
  label?: string;
}

interface StoredConfig {
  activeProvider?: string;
  providers?: Record<string, StoredProviderData>;
  [key: string]: unknown;
}

function loadConfig(): StoredConfig {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    console.error('[CONFIG] Failed to load config file, resetting to defaults:', e);
  }
  return {};
}

function saveConfig(config: StoredConfig): void {
  const configPath = getConfigPath();
  const tmpPath = configPath + '.tmp';
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8');
    fs.renameSync(tmpPath, configPath);
  } catch (e) {
    console.error('[CONFIG] Failed to save config file:', e);
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Encrypt a string using Electron's safeStorage (Credential Manager on Windows).
 * Falls back to base64 encoding if safeStorage is unavailable.
 */
function encryptValue(value: string): string {
  if (!value) return '';
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(value).toString('base64');
  }
  // Fallback: base64 is NOT encryption, but prevents casual shoulder-surfing
  console.warn('[CONFIG] safeStorage not available — API key is stored with base64 encoding only, which is NOT secure encryption.');
  return Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Decrypt a string that was encrypted with encryptValue.
 */
function decryptValue(encrypted: string): string {
  if (!encrypted) return '';
  try {
    let decrypted: string;
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encrypted, 'base64');
      decrypted = safeStorage.decryptString(buffer);
    } else {
      decrypted = Buffer.from(encrypted, 'base64').toString('utf-8');
    }
    const prefix = decrypted.slice(0, 12);
    const suffix = decrypted.slice(-4);
    console.log(`[AUTH] decryptValue: len=${decrypted.length}, prefix="${prefix}...", suffix="...${suffix}", printable=${/^[\x20-\x7E]+$/.test(decrypted)}, startsWithSk=${decrypted.startsWith('sk-')}`);
    return decrypted;
  } catch (err) {
    console.error('[AUTH] decryptValue FAILED:', err);
    return '';
  }
}

export function registerIpcHandlers(terminalManager: TerminalManager): void {
  // Terminal lifecycle
  ipcMain.handle('terminal:create', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const id = `term-${Date.now()}`;
    terminalManager.createTerminal(id, win);
    return id;
  });

  // Terminal write batching — coalesces small writes into larger chunks
  // to reduce IPC overhead during paste operations and rapid key repeat
  const writeBuffer = new Map<string, string>();
  let writeTimer: ReturnType<typeof setTimeout> | null = null;

  function flushWrites(): void {
    for (const [id, data] of writeBuffer) {
      terminalManager.writeToTerminal(id, data);
    }
    writeBuffer.clear();
    writeTimer = null;
  }

  function scheduleWriteFlush(): void {
    if (writeTimer) return;
    // Batch writes across one event-loop tick before flushing
    writeTimer = setTimeout(flushWrites, 0);
  }

  ipcMain.on('terminal:write', (_, { id, data }: { id: string; data: string }) => {
    // Accumulate data in buffer and flush asynchronously
    const existing = writeBuffer.get(id) || '';
    writeBuffer.set(id, existing + data);
    scheduleWriteFlush();
  });

  ipcMain.on('terminal:resize', (_, { id, cols, rows }: { id: string; cols: number; rows: number }) => {
    terminalManager.resizeTerminal(id, cols, rows);
  });

  ipcMain.handle('terminal:kill', (_, { id }: { id: string }) => {
    terminalManager.killTerminal(id);
  });

  // ─── AI Provider Config — encrypted at rest via safeStorage (like VS Code) ───
  const config = loadConfig();

  // Legacy migration: if old deepseekKeyEncrypted exists, migrate to new format
  if (config.deepseekKeyEncrypted && !config.providers) {
    const legacyKey = config.deepseekKeyEncrypted as string;
    config.providers = {};
    config.providers['deepseek'] = {
      apiKeyEncrypted: legacyKey,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    };
    config.activeProvider = 'deepseek';
    delete config.deepseekKeyEncrypted;
    saveConfig(config);
  }

  // Initialize defaults
  if (!config.providers) config.providers = {};
  if (!config.activeProvider) config.activeProvider = 'deepseek';

  ipcMain.handle('provider:get-config', (_, type: string) => {
    const data = config.providers?.[type];
    const apiKey = data?.apiKeyEncrypted ? decryptValue(data.apiKeyEncrypted) : '';
    console.log(`[AUTH] provider:get-config for "${type}": hasKey=${!!apiKey}, len=${apiKey.length}, startsWithSk=${apiKey.startsWith('sk-')}`);
    return {
      apiKey,
      baseUrl: data?.baseUrl || '',
      model: data?.model || '',
      label: data?.label || '',
    };
  });

  ipcMain.handle('provider:set-config', (_, { type, providerConfig }: { type: string; providerConfig: { apiKey?: string; baseUrl?: string; model?: string; label?: string } }) => {
    if (!config.providers) config.providers = {};
    const trimmedKey = providerConfig.apiKey !== undefined ? providerConfig.apiKey.trim() : undefined;
    if (trimmedKey !== undefined) {
      console.log(`[AUTH] provider:set-config for "${type}": rawLen=${providerConfig.apiKey?.length}, trimmedLen=${trimmedKey.length}, startsWithSk=${trimmedKey.startsWith('sk-')}`);
    } else {
      console.log(`[AUTH] provider:set-config for "${type}": key NOT provided (keeping existing)`);
    }
    config.providers[type] = {
      apiKeyEncrypted: trimmedKey !== undefined ? encryptValue(trimmedKey) : config.providers[type]?.apiKeyEncrypted,
      baseUrl: providerConfig.baseUrl !== undefined ? providerConfig.baseUrl : config.providers[type]?.baseUrl,
      model: providerConfig.model !== undefined ? providerConfig.model : config.providers[type]?.model,
      label: providerConfig.label !== undefined ? providerConfig.label : config.providers[type]?.label,
    };
    saveConfig(config);
    return true;
  });

  ipcMain.handle('provider:get-active', () => {
    return config.activeProvider || 'deepseek';
  });

  ipcMain.handle('provider:set-active', (_, type: string) => {
    config.activeProvider = type;
    saveConfig(config);
    return true;
  });

  ipcMain.handle('provider:get-all-configs', () => {
    const result: Record<string, { apiKey: string; baseUrl: string; model: string; label: string }> = {};
    for (const [type, data] of Object.entries(config.providers || {})) {
      const apiKey = data.apiKeyEncrypted ? decryptValue(data.apiKeyEncrypted) : '';
      console.log(`[AUTH] provider:get-all-configs for "${type}": hasKey=${!!apiKey}, len=${apiKey.length}, startsWithSk=${apiKey.startsWith('sk-')}`);
      result[type] = {
        apiKey,
        baseUrl: data.baseUrl || '',
        model: data.model || '',
        label: data.label || '',
      };
    }
    return result;
  });

  // ─── Legacy API key handlers (backward compat) ───
  ipcMain.handle('settings:set-api-key', (_, key: string) => {
    const type = config.activeProvider || 'deepseek';
    if (!config.providers) config.providers = {};
    console.log(`[AUTH] settings:set-api-key for "${type}": rawLen=${key.length}, trimmedLen=${key.trim().length}, startsWithSk=${key.trim().startsWith('sk-')}`);
    config.providers[type] = {
      ...config.providers[type],
      apiKeyEncrypted: encryptValue(key.trim()),
    };
    saveConfig(config);
    return true;
  });

  ipcMain.handle('settings:get-api-key', () => {
    const type = config.activeProvider || 'deepseek';
    const data = config.providers?.[type];
    if (!data?.apiKeyEncrypted) return null;
    const key = decryptValue(data.apiKeyEncrypted);
    console.log(`[AUTH] settings:get-api-key for "${type}": hasKey=${!!key}, len=${key.length}, startsWithSk=${key.startsWith('sk-')}`);
    return key || null;
  });

  ipcMain.handle('settings:has-api-key', () => {
    const type = config.activeProvider || 'deepseek';
    const data = config.providers?.[type];
    const hasIt = !!data?.apiKeyEncrypted;
    console.log(`[AUTH] settings:has-api-key for "${type}": ${hasIt}`);
    return hasIt;
  });

  // ─── App Settings (theme, fontSize, etc.) — persisted alongside provider config ───
  ipcMain.handle('settings:load', () => {
    const cfg = loadConfig();
    return {
      theme: (cfg as Record<string, unknown>).theme || 'dark',
      fontSize: (cfg as Record<string, unknown>).fontSize || 14,
      splitDirection: (cfg as Record<string, unknown>).splitDirection || 'horizontal',
      showTerminal: (cfg as Record<string, unknown>).showTerminal !== false,
      agentMode: (cfg as Record<string, unknown>).agentMode || 'auto',
    };
  });

  // Whitelist of allowed settings keys to prevent corruption and prototype pollution
  const ALLOWED_SETTINGS_KEYS = new Set([
    'theme', 'fontSize', 'splitDirection', 'showTerminal', 'agentMode'
  ]);

  ipcMain.handle('settings:save', (_, { settings }: { settings: Record<string, unknown> }) => {
    const cfg = loadConfig();
    // Reject prototype pollution attempts and only allow whitelisted keys
    for (const [key, value] of Object.entries(settings)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      if (!ALLOWED_SETTINGS_KEYS.has(key)) continue;
      cfg[key] = value;
    }
    saveConfig(cfg);
    return true;
  });

  // Terminal read — get last N lines for AI context
  ipcMain.handle('terminal:read-buffer', (_, { id, lineCount }: { id?: string; lineCount?: number }) => {
    return terminalManager.getBuffer(id, lineCount);
  });

  // Terminal reset — send Ctrl+C + cls to recover from stuck state
  ipcMain.handle('terminal:reset', (_, { id }: { id?: string }) => {
    const result = terminalManager.resetTerminal(id);
    return { success: result };
  });

  // Paths that the AI should never read (system files, credentials, etc.)
  const BLOCKED_FILE_PATTERNS = [
    /[\\/]etc[\\/]shadow$/i,
    /[\\/]etc[\\/]passwd$/i,
    /[\\/]config[\\/]config\.json$/i,
    /[\\/]os-assistant-config\.json$/i,
    /[\\/]os-assistant-memory\.json$/i,
    /[\\/]os-assistant-models\.json$/i,
    /[\\/]os-assistant-chats[\\/]/i,
    /\.env$/i,
    /\.env\.\w+$/i,
    /id_rsa$/,
    /id_ed25519$/,
    /known_hosts$/,
  ];

  // AI tool execution — run a command silently and return output
  // Safe file read — uses Node.js fs, no shell
  ipcMain.handle('ai:read-file', (_, { filePath }: { filePath: string }) => {
    try {
      // Prevent path traversal
      const resolved = path.resolve(filePath);
      // Block sensitive system files
      for (const pattern of BLOCKED_FILE_PATTERNS) {
        if (pattern.test(resolved)) {
          return { success: false, error: 'Access denied: this file is blocked for security', content: '' };
        }
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File not found', content: '' };
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return { success: false, error: 'Path is not a file', content: '' };
      }
      // Limit to 1MB to prevent memory issues
      if (stat.size > 1_048_576) {
        return { success: false, error: 'File too large (max 1MB)', content: '' };
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      return { success: true, content, error: '' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to read file', content: '' };
    }
  });

  // Safe directory listing — uses Node.js fs, no shell
  ipcMain.handle('ai:list-directory', (_, { dirPath }: { dirPath: string }) => {
    try {
      const resolved = path.resolve(dirPath);
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'Path not found', entries: [] };
      }
      const stat = fs.statSync(resolved);
      if (!stat.isDirectory()) {
        return { success: false, error: 'Path is not a directory', entries: [] };
      }
      const entries = fs.readdirSync(resolved, { withFileTypes: true }).map(e => ({
        name: e.name,
        isDirectory: e.isDirectory(),
        size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : 0,
      }));
      return { success: true, entries, error: '' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to list directory', entries: [] };
    }
  });

  // Safe file write — uses Node.js fs, no shell
  ipcMain.handle('ai:write-file', (_, { filePath, content }: { filePath: string; content: string }) => {
    try {
      const resolved = path.resolve(filePath);
      // Prevent path traversal
      for (const pattern of BLOCKED_FILE_PATTERNS) {
        if (pattern.test(resolved)) {
          return { success: false, error: 'Access denied: this file is blocked for security' };
        }
      }
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        return { success: false, error: 'Parent directory does not exist' };
      }
      fs.writeFileSync(resolved, content, 'utf-8');
      return { success: true, error: '' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to write file' };
    }
  });

  // Safe file edit (find-and-replace) — uses Node.js fs, no shell
  ipcMain.handle('ai:edit-file', (_, { filePath, oldText, newText }: { filePath: string; oldText: string; newText: string }) => {
    try {
      const resolved = path.resolve(filePath);
      for (const pattern of BLOCKED_FILE_PATTERNS) {
        if (pattern.test(resolved)) {
          return { success: false, error: 'Access denied: this file is blocked for security' };
        }
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File not found' };
      }
      const currentContent = fs.readFileSync(resolved, 'utf-8');
      const idx = currentContent.indexOf(oldText);
      if (idx === -1) {
        return { success: false, error: 'Could not find the specified text in the file. The exact string (including whitespace) must match.' };
      }
      const newContent = currentContent.slice(0, idx) + newText + currentContent.slice(idx + oldText.length);
      fs.writeFileSync(resolved, newContent, 'utf-8');
      const oldLines = oldText.split('\n').length;
      const newLines = newText.split('\n').length;
      return { success: true, error: '', linesChanged: `${oldLines} → ${newLines} lines` };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to edit file' };
    }
  });

  // Safe file delete — uses Node.js fs, no shell
  ipcMain.handle('ai:delete-file', (_, { filePath }: { filePath: string }) => {
    try {
      const resolved = path.resolve(filePath);
      for (const pattern of BLOCKED_FILE_PATTERNS) {
        if (pattern.test(resolved)) {
          return { success: false, error: 'Access denied: this file is blocked for security' };
        }
      }
      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File not found' };
      }
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) {
        return { success: false, error: 'Path is not a file' };
      }
      fs.unlinkSync(resolved);
      return { success: true, error: '' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to delete file' };
    }
  });

  ipcMain.handle('ai:create-directory', (_, { dirPath }: { dirPath: string }) => {
    try {
      const resolved = path.resolve(dirPath);
      fs.mkdirSync(resolved, { recursive: true });
      return { success: true, error: '' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to create directory' };
    }
  });

  ipcMain.handle('ai:copy-file', (_, { sourcePath, destPath }: { sourcePath: string; destPath: string }) => {
    try {
      const srcResolved = path.resolve(sourcePath);
      const dstResolved = path.resolve(destPath);
      if (!fs.existsSync(srcResolved)) {
        return { success: false, error: 'Source file not found' };
      }
      const stat = fs.statSync(srcResolved);
      if (!stat.isFile()) {
        return { success: false, error: 'Source path is not a file' };
      }
      const dstDir = path.dirname(dstResolved);
      if (!fs.existsSync(dstDir)) {
        return { success: false, error: 'Destination directory does not exist' };
      }
      fs.copyFileSync(srcResolved, dstResolved);
      return { success: true, error: '' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to copy file' };
    }
  });

  ipcMain.handle('ai:rename-file', (_, { oldPath, newPath }: { oldPath: string; newPath: string }) => {
    try {
      const oldResolved = path.resolve(oldPath);
      const newResolved = path.resolve(newPath);
      if (!fs.existsSync(oldResolved)) {
        return { success: false, error: 'Source path not found' };
      }
      const newDir = path.dirname(newResolved);
      if (!fs.existsSync(newDir)) {
        return { success: false, error: 'Destination directory does not exist' };
      }
      fs.renameSync(oldResolved, newResolved);
      return { success: true, error: '' };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to rename/move file' };
    }
  });

  ipcMain.handle('ai:search-files', (_, { rootPath, pattern }: { rootPath: string; pattern: string }) => {
    try {
      const resolvedRoot = path.resolve(rootPath);
      if (!fs.existsSync(resolvedRoot)) {
        return { success: false, results: [], error: 'Directory not found' };
      }
      const results: Array<{ file: string; line: number; content: string }> = [];
      const MAX_RESULTS = 50;
      const MAX_FILE_SIZE = 524_288; // 512KB
      const MAX_DEPTH = 10;

      function walk(dir: string, depth: number): void {
        if (depth > MAX_DEPTH || results.length >= MAX_RESULTS) return;
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch { return; }
        for (const entry of entries) {
          if (results.length >= MAX_RESULTS) break;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (!entry.name.startsWith('.')) walk(fullPath, depth + 1);
          } else if (entry.isFile()) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size > MAX_FILE_SIZE) continue;
              const content = fs.readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n');
              for (let i = 0; i < lines.length; i++) {
                if (lines[i].toLowerCase().includes(pattern.toLowerCase())) {
                  const snippet = lines[i].trim().substring(0, 200);
                  results.push({ file: fullPath, line: i + 1, content: snippet });
                  if (results.length >= MAX_RESULTS) return;
                }
              }
            } catch { /* skip unreadable files */ }
          }
        }
      }

      walk(resolvedRoot, 0);
      return { success: true, results, error: '' };
    } catch (err) {
      return { success: false, results: [], error: err instanceof Error ? err.message : 'Failed to search files' };
    }
  });

  ipcMain.handle('ai:fetch-url', (_, { url }: { url: string }) => {
    return new Promise<{ success: boolean; content: string; error: string }>((resolve) => {
      try {
        const parsedUrl = new URL(url);
        const mod = parsedUrl.protocol === 'https:' ? https : http;
        const options = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: 'GET',
          headers: {
            'User-Agent': 'OS-Assistant/1.0',
            'Accept': 'text/html,application/json,*/*',
          },
          timeout: 15000,
        };
        const req = mod.get(options, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf-8');
            const MAX_BODY = 100_000;
            const content = body.length > MAX_BODY
              ? body.substring(0, MAX_BODY) + '\n...(truncated at 100KB)'
              : body;
            resolve({ success: true, content, error: '' });
          });
        });
        req.on('error', (err) => resolve({ success: false, content: '', error: err.message }));
        req.on('timeout', () => { req.destroy(); resolve({ success: false, content: '', error: 'Request timed out after 15s' }); });
        req.end();
      } catch (err) {
        resolve({ success: false, content: '', error: err instanceof Error ? err.message : 'Invalid URL' });
      }
    });
  });

  ipcMain.handle('ai:execute-command', (_, { command }: { command: string }) => {
    return terminalManager.executeCommand(command);
  });

  // ─── System Info — collected once at startup ───
  ipcMain.handle('system:get-info', () => {
    const release = os.release();
    const parts = release.split('.');
    const majorVersion = parseInt(parts[0] || '0', 10);
    const buildNumber = parseInt(parts[2] || '0', 10);

    let osName = 'Windows';
    if (majorVersion === 10 && buildNumber >= 22000) osName = 'Windows 11';
    else if (majorVersion === 10) osName = 'Windows 10';
    else if (majorVersion === 6 && parts[1] === '3') osName = 'Windows 8.1';
    else if (majorVersion === 6 && parts[1] === '2') osName = 'Windows 8';
    else if (majorVersion === 6 && parts[1] === '1') osName = 'Windows 7';

    let psVersion = 'unknown';
    try {
      psVersion = execSync('powershell -NoProfile -Command "$PSVersionTable.PSVersion.ToString()"', { timeout: 5000, encoding: 'utf-8' }).trim();
    } catch { /* PowerShell not available */ }

    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : 'unknown';
    const totalRamGB = Math.round(os.totalmem() / (1024 * 1024 * 1024));

    return {
      os: `${osName} (Build ${release})`,
      architecture: os.arch(),
      shell: 'CMD.exe',
      powershellVersion: psVersion,
      username: os.userInfo().username,
      hostname: os.hostname(),
      cpu: cpuModel,
      totalRamGB,
      cpuCores: cpus.length,
    };
  });

  // App utilities
  ipcMain.handle('app:get-platform', () => {
    return process.platform;
  });

  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  // ─── Window Controls (custom title bar) ───
  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.minimize();
  });

  ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) win.close();
  });

  ipcMain.handle('window:is-maximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win ? win.isMaximized() : false;
  });

  // Send maximize/unmaximize state changes to renderer
  ipcMain.on('window:listen-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const sendState = () => {
      event.sender.send('window:maximize-changed', win.isMaximized());
    };
    win.on('maximize', sendState);
    win.on('unmaximize', sendState);
  });

  // ─── AI Memory — persistent notes (like VS Code Copilot's /memory) ───

  function loadMemory(): Record<string, string> {
    try {
      const memPath = getMemoryPath();
      if (fs.existsSync(memPath)) {
        return JSON.parse(fs.readFileSync(memPath, 'utf-8'));
      }
    } catch (e) {
      console.error('[MEMORY] Failed to load memory file, resetting:', e);
    }
    return {};
  }

  function saveMemory(memory: Record<string, string>): void {
    // Atomic write: write to temp file, then rename
    const memPath = getMemoryPath();
    const tmpPath = memPath + '.tmp';
    try {
      const dir = path.dirname(memPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(memory, null, 2), 'utf-8');
      fs.renameSync(tmpPath, memPath);
    } catch (e) {
      console.error('[MEMORY] Failed to save memory file:', e);
      // Clean up temp file if rename failed
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  ipcMain.handle('memory:save-note', (_, { key, value }: { key: string; value: string }) => {
    // Enforce size limits: 1KB per key, 10KB per value, 100KB total
    const MAX_KEY_LENGTH = 1024;
    const MAX_VALUE_LENGTH = 10_240;
    const MAX_TOTAL_SIZE = 102_400;
    if (!key || key.length > MAX_KEY_LENGTH) return false;
    if (!value || value.length > MAX_VALUE_LENGTH) return false;
    const memory = loadMemory();
    // Check total size
    const currentTotal = Object.entries(memory).reduce((sum, [k, v]) => sum + k.length + v.length, 0);
    const newEntrySize = key.length + value.length;
    const existingSize = memory[key] ? key.length + memory[key].length : 0;
    if (currentTotal - existingSize + newEntrySize > MAX_TOTAL_SIZE) return false;
    memory[key] = value;
    saveMemory(memory);
    return true;
  });

  ipcMain.handle('memory:get-note', (_, { key }: { key: string }) => {
    const memory = loadMemory();
    return memory[key] || null;
  });

  ipcMain.handle('memory:get-all-notes', () => {
    return loadMemory();
  });

  ipcMain.handle('memory:delete-note', (_, { key }: { key: string }) => {
    const memory = loadMemory();
    delete memory[key];
    saveMemory(memory);
    return true;
  });

  ipcMain.handle('memory:clear-all', () => {
    saveMemory({});
    return true;
  });

  // ─── Model Management (like VS Code's chatLanguageModels.json) ───
  loadModels();

  ipcMain.handle('models:get-all', () => {
    return loadModels();
  });

  ipcMain.handle('models:fetch-from-provider', async (_, { provider, baseUrl, apiKey }: { provider: string; baseUrl: string; apiKey: string }) => {
    const models = loadModels();
    const url = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/models` : '';
    if (!url) return { success: false, error: 'No base URL configured' };

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      if (provider === 'azure') {
        headers['api-key'] = apiKey;
      }

      const response = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { success: false, error: `HTTP ${response.status}: ${text || response.statusText}` };
      }

      const data = await response.json() as { data?: Array<{ id: string; [key: string]: unknown }> };
      if (!data.data || !Array.isArray(data.data)) {
        return { success: false, error: 'Unexpected API response format' };
      }

      // Add fetched models — replace existing auto models for this provider
      const otherModels = models.models.filter((m) => !(m.provider === provider && m.source === 'auto'));
      const newModels: ModelEntry[] = data.data.map((m: { id: string }) => ({
        id: m.id,
        provider,
        source: 'auto' as const,
      }));
      models.models = [...otherModels, ...newModels];
      saveModels(models);
      return { success: true, models: newModels.map((m) => m.id) };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch models' };
    }
  });

  ipcMain.handle('models:add', (_, { model }: { model: { id: string; provider: string } }) => {
    const models = loadModels();
    // Avoid duplicates
    if (models.models.some((m) => m.id === model.id && m.provider === model.provider)) {
      return { success: false, error: 'Model already exists' };
    }
    models.models.push({ id: model.id, provider: model.provider, source: 'manual' });
    saveModels(models);
    return { success: true };
  });

  ipcMain.handle('models:remove', (_, { modelId, provider }: { modelId: string; provider: string }) => {
    const models = loadModels();
    models.models = models.models.filter((m) => !(m.id === modelId && m.provider === provider));
    // Also clear selected if it was this one
    if (models.selectedModels[provider] === modelId) {
      delete models.selectedModels[provider];
    }
    saveModels(models);
    return { success: true };
  });

  ipcMain.handle('models:set-selected', (_, { provider, modelId }: { provider: string; modelId: string }) => {
    const models = loadModels();
    models.selectedModels[provider] = modelId;
    saveModels(models);
    return { success: true };
  });

  ipcMain.handle('models:get-selected', (_, { provider }: { provider: string }) => {
    const models = loadModels();
    return models.selectedModels[provider] || null;
  });

  // ─── Terminal Injection — write command to the most recent terminal ───
  ipcMain.handle('terminal:inject', (_, { command }: { command: string }) => {
    const targetId = terminalManager.getLastTerminalId();
    if (!targetId) {
      return { success: false, error: 'No terminal available. Open a terminal first.' };
    }
    terminalManager.writeToTerminal(targetId, command + '\r');
    return { success: true, terminalId: targetId };
  });

  // ─── Terminal Execute & Capture — runs in VISIBLE terminal so user can watch the AI work ───
  // Uses marker-based completion detection (__CSTART__/__CEND__) which resolves instantly
  // when the command finishes — no polling, no prompt-regex guessing.
  ipcMain.handle('terminal:execute-and-capture', async (_, { command }: { command: string }) => {
    const targetId = terminalManager.getLastTerminalId();
    if (!targetId) {
      return { success: false, error: 'No terminal available.', output: '' };
    }
    try {
      const result = await terminalManager.executeOnTerminal(targetId, command);
      return { success: true, output: result.output, terminalId: targetId };
    } catch (err) {
      return { success: false, error: String(err), output: '' };
    }
  });

  // ─── Chat Session Persistence (like VS Code Copilot chat history) ───
  ipcMain.handle('chat:list-sessions', () => {
    try {
      const chatsDir = getChatsDir();
      const files = fs.readdirSync(chatsDir).filter((f) => f.endsWith('.json'));
      const sessions = files.map((f) => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(chatsDir, f), 'utf-8'));
          return {
            id: data.id || f.replace('.json', ''),
            title: data.title || 'Untitled',
            createdAt: data.createdAt || 0,
            updatedAt: data.updatedAt || 0,
            messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
          };
        } catch { return null; }
      }).filter(Boolean).sort((a, b) => (b?.updatedAt || 0) - (a?.updatedAt || 0));
      return sessions;
    } catch { return []; }
  });

  ipcMain.handle('chat:load-session', (_, { id }: { id: string }) => {
    try {
      const p = path.join(getChatsDir(), `${id}.json`);
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch { /* ignore */ }
    return null;
  });

  ipcMain.handle('chat:save-session', (_, { session }: { session: { id: string; title?: string; messages: unknown[] } }) => {
    try {
      const chatsDir = getChatsDir();
      const existing: Record<string, unknown> = {};
      const existingPath = path.join(chatsDir, `${session.id}.json`);
      if (fs.existsSync(existingPath)) {
        try { Object.assign(existing, JSON.parse(fs.readFileSync(existingPath, 'utf-8'))); } catch { /* ignore */ }
      }
      const data = {
        ...existing,
        id: session.id,
        title: session.title || existing.title || 'Untitled',
        messages: session.messages,
        updatedAt: Date.now(),
        createdAt: (existing as Record<string, unknown>).createdAt || Date.now(),
      };
      fs.writeFileSync(existingPath, JSON.stringify(data, null, 2), 'utf-8');
      return true;
    } catch { return false; }
  });

  ipcMain.handle('chat:delete-session', (_, { id }: { id: string }) => {
    try {
      const p = path.join(getChatsDir(), `${id}.json`);
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return true;
    } catch { return false; }
  });

  ipcMain.handle('chat:search-sessions', (_, { query }: { query: string }) => {
    try {
      const chatsDir = getChatsDir();
      const files = fs.readdirSync(chatsDir).filter((f) => f.endsWith('.json'));
      const q = query.toLowerCase();
      const results = [];
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(chatsDir, f), 'utf-8'));
          const titleMatch = (data.title || '').toLowerCase().includes(q);
          const contentMatch = Array.isArray(data.messages) &&
            data.messages.some((m: { content?: string }) => (m.content || '').toLowerCase().includes(q));
          if (titleMatch || contentMatch) {
            results.push({
              id: data.id || f.replace('.json', ''),
              title: data.title || 'Untitled',
              createdAt: data.createdAt || 0,
              updatedAt: data.updatedAt || 0,
              messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
            });
          }
        } catch { /* skip corrupt files */ }
      }
      return results.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch { return []; }
  });
}
