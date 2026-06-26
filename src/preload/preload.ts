import { contextBridge, ipcRenderer } from 'electron';

export interface TerminalAPI {
  create(): Promise<string | null>;
  write(id: string, data: string): void;
  resize(id: string, cols: number, rows: number): void;
  kill(id: string): Promise<void>;
  onData(callback: (payload: { id: string; data: string }) => void): void;
  removeDataListener(): void;
  readBuffer(lineCount?: number): Promise<string>;
  /** Inject a command into the visible terminal — types it and presses Enter */
  injectCommand(command: string): Promise<{ success: boolean; error?: string; terminalId?: string }>;
  /** Execute a command in the visible terminal and capture output */
  executeAndCapture(command: string, timeout?: number): Promise<{ success: boolean; output: string; error?: string }>;
}

export interface SettingsAPI {
  setApiKey(key: string): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  hasApiKey(): Promise<boolean>;
}

export interface ProviderAPI {
  getConfig(type: string): Promise<{ apiKey: string; baseUrl: string; model: string; label: string }>;
  setConfig(type: string, config: { apiKey?: string; baseUrl?: string; model?: string; label?: string }): Promise<boolean>;
  getActive(): Promise<string>;
  setActive(type: string): Promise<boolean>;
  getAllConfigs(): Promise<Record<string, { apiKey: string; baseUrl: string; model: string; label: string }>>;
}

export interface WindowControlsAPI {
  minimize(): Promise<void>;
  maximize(): Promise<void>;
  close(): Promise<void>;
  isMaximized(): Promise<boolean>;
  listenMaximize(callback: (maximized: boolean) => void): void;
  removeMaximizeListener(): void;
}

export interface AppAPI {
  getPlatform(): Promise<string>;
  getVersion(): Promise<string>;
}

export interface SystemAPI {
  getInfo(): Promise<{
    os: string;
    architecture: string;
    shell: string;
    powershellVersion: string;
    username: string;
    hostname: string;
    cpu: string;
    totalRamGB: number;
    cpuCores: number;
  }>;
}

export interface AIToolsAPI {
  executeCommand(command: string): Promise<string>;
}

export interface MemoryAPI {
  saveNote(key: string, value: string): Promise<boolean>;
  getNote(key: string): Promise<string | null>;
  getAllNotes(): Promise<Record<string, string>>;
  deleteNote(key: string): Promise<boolean>;
  clearAll(): Promise<boolean>;
}

export interface ModelEntry {
  id: string;
  provider: string;
  source: 'auto' | 'manual';
}

export interface ModelsAPI {
  getAll(): Promise<{ models: ModelEntry[]; selectedModels: Record<string, string> }>;
  fetchFromProvider(provider: string, baseUrl: string, apiKey: string): Promise<{ success: boolean; models?: string[]; error?: string }>;
  add(model: { id: string; provider: string }): Promise<{ success: boolean; error?: string }>;
  remove(modelId: string, provider: string): Promise<{ success: boolean }>;
  setSelected(provider: string, modelId: string): Promise<{ success: boolean }>;
  getSelected(provider: string): Promise<string | null>;
}

export interface ChatSessionInfo {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ChatSessionData {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: unknown[];
}

export interface ChatAPI {
  listSessions(): Promise<ChatSessionInfo[]>;
  loadSession(id: string): Promise<ChatSessionData | null>;
  saveSession(session: { id: string; title?: string; messages: unknown[] }): Promise<boolean>;
  deleteSession(id: string): Promise<boolean>;
  searchSessions(query: string): Promise<ChatSessionInfo[]>;
}

contextBridge.exposeInMainWorld('terminalAPI', {
  create: () => ipcRenderer.invoke('terminal:create'),
  write: (id: string, data: string) => ipcRenderer.send('terminal:write', { id, data }),
  resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  kill: (id: string) => ipcRenderer.invoke('terminal:kill', { id }),
  onData: (callback: (payload: { id: string; data: string }) => void) => {
    ipcRenderer.on('terminal-data', (_event, payload) => callback(payload));
  },
  removeDataListener: () => {
    ipcRenderer.removeAllListeners('terminal-data');
  },
  readBuffer: (lineCount?: number) => ipcRenderer.invoke('terminal:read-buffer', { lineCount }),
  injectCommand: (command: string) => ipcRenderer.invoke('terminal:inject', { command }),
  executeAndCapture: (command: string, timeout?: number) => ipcRenderer.invoke('terminal:execute-and-capture', { command, timeout }),
} satisfies TerminalAPI);

contextBridge.exposeInMainWorld('settingsAPI', {
  setApiKey: (key: string) => ipcRenderer.invoke('settings:set-api-key', key),
  getApiKey: () => ipcRenderer.invoke('settings:get-api-key'),
  hasApiKey: () => ipcRenderer.invoke('settings:has-api-key'),
} satisfies SettingsAPI);

contextBridge.exposeInMainWorld('providerAPI', {
  getConfig: (type: string) => ipcRenderer.invoke('provider:get-config', type),
  setConfig: (type: string, config: { apiKey?: string; baseUrl?: string; model?: string; label?: string }) =>
    ipcRenderer.invoke('provider:set-config', { type, providerConfig: config }),
  getActive: () => ipcRenderer.invoke('provider:get-active'),
  setActive: (type: string) => ipcRenderer.invoke('provider:set-active', type),
  getAllConfigs: () => ipcRenderer.invoke('provider:get-all-configs'),
} satisfies ProviderAPI);

contextBridge.exposeInMainWorld('appAPI', {
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  getVersion: () => ipcRenderer.invoke('app:get-version'),
} satisfies AppAPI);

contextBridge.exposeInMainWorld('aiToolsAPI', {
  executeCommand: (command: string) => ipcRenderer.invoke('ai:execute-command', { command }),
} satisfies AIToolsAPI);

contextBridge.exposeInMainWorld('memoryAPI', {
  saveNote: (key: string, value: string) => ipcRenderer.invoke('memory:save-note', { key, value }),
  getNote: (key: string) => ipcRenderer.invoke('memory:get-note', { key }),
  getAllNotes: () => ipcRenderer.invoke('memory:get-all-notes'),
  deleteNote: (key: string) => ipcRenderer.invoke('memory:delete-note', { key }),
  clearAll: () => ipcRenderer.invoke('memory:clear-all'),
} satisfies MemoryAPI);

contextBridge.exposeInMainWorld('modelsAPI', {
  getAll: () => ipcRenderer.invoke('models:get-all'),
  fetchFromProvider: (provider: string, baseUrl: string, apiKey: string) =>
    ipcRenderer.invoke('models:fetch-from-provider', { provider, baseUrl, apiKey }),
  add: (model: { id: string; provider: string }) => ipcRenderer.invoke('models:add', { model }),
  remove: (modelId: string, provider: string) => ipcRenderer.invoke('models:remove', { modelId, provider }),
  setSelected: (provider: string, modelId: string) => ipcRenderer.invoke('models:set-selected', { provider, modelId }),
  getSelected: (provider: string) => ipcRenderer.invoke('models:get-selected', { provider }),
} satisfies ModelsAPI);

contextBridge.exposeInMainWorld('windowControlsAPI', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  maximize: () => ipcRenderer.invoke('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  listenMaximize: (callback: (maximized: boolean) => void) => {
    ipcRenderer.send('window:listen-maximize');
    ipcRenderer.on('window:maximize-changed', (_event, maximized) => callback(maximized));
  },
  removeMaximizeListener: () => {
    ipcRenderer.removeAllListeners('window:maximize-changed');
  },
} satisfies WindowControlsAPI);

contextBridge.exposeInMainWorld('systemAPI', {
  getInfo: () => ipcRenderer.invoke('system:get-info'),
} satisfies SystemAPI);

contextBridge.exposeInMainWorld('chatAPI', {
  listSessions: () => ipcRenderer.invoke('chat:list-sessions'),
  loadSession: (id: string) => ipcRenderer.invoke('chat:load-session', { id }),
  saveSession: (session: { id: string; title?: string; messages: unknown[] }) =>
    ipcRenderer.invoke('chat:save-session', { session }),
  deleteSession: (id: string) => ipcRenderer.invoke('chat:delete-session', { id }),
  searchSessions: (query: string) => ipcRenderer.invoke('chat:search-sessions', { query }),
} satisfies ChatAPI);
