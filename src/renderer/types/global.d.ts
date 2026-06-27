import type { TerminalAPI, SettingsAPI, ProviderAPI, AppAPI, AIToolsAPI, WindowControlsAPI, MemoryAPI, ModelsAPI, ChatAPI, SystemAPI, AppSettingsAPI } from '../../preload/preload';

declare global {
  interface Window {
    __AI_LOGS?: {
      setDebug?: (v: boolean) => void;
      dump?: () => void;
      clear?: () => void;
    };
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
    appSettingsAPI: AppSettingsAPI;
  }
}
