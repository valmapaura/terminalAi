import { ipcMain, BrowserWindow, app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { TerminalManager } from './terminal';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'terminal-ai-config.json');
}

function getMemoryPath(): string {
  return path.join(app.getPath('userData'), 'terminal-ai-memory.json');
}

function getModelsPath(): string {
  return path.join(app.getPath('userData'), 'terminal-ai-models.json');
}

function getChatsDir(): string {
  const dir = path.join(app.getPath('userData'), 'terminal-ai-chats');
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
  } catch { /* ignore */ }
  return { models: [], selectedModels: {} };
}

function saveModels(data: ModelsFile): void {
  try {
    const p = getModelsPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8');
  } catch { /* ignore */ }
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
  } catch {
    // Ignore corrupt config
  }
  return {};
}

function saveConfig(config: StoredConfig): void {
  try {
    const configPath = getConfigPath();
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch {
    // Silently fail — config is non-critical
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
  // Fallback: simple base64 (still better than plaintext)
  return Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Decrypt a string that was encrypted with encryptValue.
 */
function decryptValue(encrypted: string): string {
  if (!encrypted) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encrypted, 'base64');
      return safeStorage.decryptString(buffer);
    }
    // Fallback
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  } catch {
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

  ipcMain.on('terminal:write', (_, { id, data }: { id: string; data: string }) => {
    terminalManager.writeToTerminal(id, data);
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
    return {
      apiKey: data?.apiKeyEncrypted ? decryptValue(data.apiKeyEncrypted) : '',
      baseUrl: data?.baseUrl || '',
      model: data?.model || '',
      label: data?.label || '',
    };
  });

  ipcMain.handle('provider:set-config', (_, { type, providerConfig }: { type: string; providerConfig: { apiKey?: string; baseUrl?: string; model?: string; label?: string } }) => {
    if (!config.providers) config.providers = {};
    config.providers[type] = {
      apiKeyEncrypted: providerConfig.apiKey !== undefined ? encryptValue(providerConfig.apiKey) : config.providers[type]?.apiKeyEncrypted,
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
      result[type] = {
        apiKey: data.apiKeyEncrypted ? decryptValue(data.apiKeyEncrypted) : '',
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
    config.providers[type] = {
      ...config.providers[type],
      apiKeyEncrypted: encryptValue(key),
    };
    saveConfig(config);
    return true;
  });

  ipcMain.handle('settings:get-api-key', () => {
    const type = config.activeProvider || 'deepseek';
    const data = config.providers?.[type];
    if (!data?.apiKeyEncrypted) return null;
    return decryptValue(data.apiKeyEncrypted) || null;
  });

  ipcMain.handle('settings:has-api-key', () => {
    const type = config.activeProvider || 'deepseek';
    const data = config.providers?.[type];
    return !!data?.apiKeyEncrypted;
  });

  // Terminal read — get last N lines for AI context
  ipcMain.handle('terminal:read-buffer', (_, { id, lineCount }: { id?: string; lineCount?: number }) => {
    return terminalManager.getBuffer(id, lineCount);
  });

  // AI tool execution — run a command silently and return output
  ipcMain.handle('ai:execute-command', (_, { command }: { command: string }) => {
    return terminalManager.executeCommand(command);
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
    } catch { /* ignore */ }
    return {};
  }

  function saveMemory(memory: Record<string, string>): void {
    try {
      fs.writeFileSync(getMemoryPath(), JSON.stringify(memory, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  ipcMain.handle('memory:save-note', (_, { key, value }: { key: string; value: string }) => {
    const memory = loadMemory();
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
  const modelsData = loadModels();

  // Ensure at least default models exist for each provider
  const PROVIDER_DEFAULTS: Record<string, string[]> = {
    deepseek: [],
    openai: [],
    azure: [],
    anthropic: [],
    google: [],
    custom: [],
  };

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

  // ─── Terminal Execute & Capture — inject command into visible terminal and return output ───
  ipcMain.handle('terminal:execute-and-capture', async (_, { command, timeout }: { command: string; timeout?: number }) => {
    const targetId = terminalManager.getLastTerminalId();
    if (!targetId) {
      return { success: false, error: 'No terminal available. Open a terminal first.', output: '' };
    }
    try {
      const result = await terminalManager.executeOnTerminal(targetId, command, timeout || 30000);
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
