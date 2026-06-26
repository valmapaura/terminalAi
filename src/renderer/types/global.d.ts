import type { TerminalAPI, SettingsAPI, ProviderAPI, AppAPI, AIToolsAPI, WindowControlsAPI, MemoryAPI, ModelsAPI, ChatAPI, SystemAPI } from '../../preload/preload';

declare global {
  interface Window {
    systemAPI: SystemAPI;
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
