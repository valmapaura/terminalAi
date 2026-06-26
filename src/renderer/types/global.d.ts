import type { TerminalAPI, SettingsAPI, ProviderAPI, AppAPI, AIToolsAPI, WindowControlsAPI, MemoryAPI, ModelsAPI, ChatAPI } from '../../preload/preload';

declare global {
  interface Window {
    terminalAPI: TerminalAPI;
    settingsAPI: SettingsAPI;
    providerAPI: ProviderAPI;
    appAPI: AppAPI;
    aiToolsAPI: AIToolsAPI;
    windowControlsAPI: WindowControlsAPI;
    memoryAPI: MemoryAPI;
    modelsAPI: ModelsAPI;
    chatAPI: ChatAPI;
  }
}
