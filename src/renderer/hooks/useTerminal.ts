import { useState, useCallback, useEffect, useRef } from 'react';
import type { AppSettings } from '../types';

export function useTerminal() {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [terminalCount, setTerminalCount] = useState(0);
  const terminalRef = useRef<string | null>(null);

  const createTerminal = useCallback(async () => {
    const id = await window.terminalAPI.create();
    if (id) {
      terminalRef.current = id;
      setTerminalId(id);
      setIsReady(true);
      setTerminalCount((c) => c + 1);
    }
    return id;
  }, []);

  const writeToTerminal = useCallback((data: string) => {
    const id = terminalRef.current;
    if (id) {
      window.terminalAPI.write(id, data);
    }
  }, []);

  const injectCommand = useCallback((command: string) => {
    const id = terminalRef.current;
    if (id) {
      window.terminalAPI.write(id, command + '\r');
    }
  }, []);

  // NOTE: executeAndCapture logic is in useAI.ts's executeTool() which calls
  // window.terminalAPI.executeAndCapture directly. This hook function is kept
  // as a future convenience wrapper if needed from the terminal context.

  const killTerminal = useCallback(async () => {
    const id = terminalRef.current;
    if (id) {
      await window.terminalAPI.kill(id);
      terminalRef.current = null;
      setTerminalId(null);
      setIsReady(false);
    }
  }, []);

  /** Load settings from persistent storage */
  const loadSettings = useCallback(async (): Promise<AppSettings | null> => {
    try {
      const stored = await window.appSettingsAPI.load();
      return {
        theme: (['dark', 'light', 'solarized-dark', 'solarized-light'].includes(stored.theme) ? stored.theme : 'dark') as 'dark' | 'light' | 'solarized-dark' | 'solarized-light',
        fontSize: stored.fontSize || 14,
        splitDirection: (stored.splitDirection as 'horizontal' | 'vertical') || 'horizontal',
        activeProvider: 'deepseek',
        providers: {},
        showTerminal: stored.showTerminal !== false,
        agentMode: (stored.agentMode as 'auto' | 'interactive') || 'auto',
      };
    } catch (e) {
      console.warn('[useTerminal] Failed to load settings:', e);
      return null;
    }
  }, []);

  /** Save settings to persistent storage */
  const saveSettings = useCallback(async (settings: AppSettings): Promise<void> => {
    if (settings.activeProvider) {
      await window.providerAPI.setActive(settings.activeProvider);
    }
    // Persist UI settings (theme, fontSize, etc.) to disk
    await window.appSettingsAPI.save({
      theme: settings.theme,
      fontSize: settings.fontSize,
      splitDirection: settings.splitDirection,
      showTerminal: settings.showTerminal,
      agentMode: settings.agentMode,
    });
  }, []);

  // Auto-create terminal on mount, kill on unmount
  useEffect(() => {
    createTerminal();
    return () => {
      const id = terminalRef.current;
      if (id) {
        window.terminalAPI.kill(id);
        terminalRef.current = null;
      }
    };
  }, []);

  return {
    terminalId,
    isReady,
    terminalCount,
    createTerminal,
    writeToTerminal,
    injectCommand,
    killTerminal,
    loadSettings,
    saveSettings,
  };
}
