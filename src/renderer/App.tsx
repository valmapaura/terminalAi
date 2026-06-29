import React, { useState, useCallback, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SplitPane } from './components/SplitPane';
import { TerminalPane } from './components/TerminalPane';
import { ChatPane } from './components/ChatPane';
import { SettingsPanel } from './components/SettingsPanel';
import { CommandPreview } from './components/CommandPreview';
import { StatusBar } from './components/StatusBar';
import { useTerminal } from './hooks/useTerminal';
import { useAI } from './hooks/useAI';
import type { AppSettings } from './types';
import { validateCommand, sanitizeCommand, type ValidationResult } from './utils/command-validator';

export const App: React.FC = () => {
  const { terminalId, injectCommand, writeToTerminal, terminalCount, loadSettings, saveSettings } = useTerminal();
  const {
    isStreaming,
    hasApiKey,
    providerLabel,
    messages,
    sendMessage,
    stopGeneration,
    clearMessages,
    loadMessages,
    pendingToolCalls,
    agentMode,
    approvePending,
    approveAlwaysPending,
    skipPending,
    setAgentMode,
    errorMessage,
    clearError,
  } = useAI();
  const [settings, setSettings] = useState<AppSettings>({
    theme: 'dark',
    fontSize: 14,
    splitDirection: 'horizontal',
    activeProvider: 'deepseek',
    providers: {},
    showTerminal: true,
    agentMode: 'auto',
  });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'api' | 'appearance' | 'debug' | 'agent' | 'about'>('api');
  const [previewCommand, setPreviewCommand] = useState<{ command: string; validation: ValidationResult } | null>(null);
  const [platform, setPlatform] = useState('win32');
  const [appVersion, setAppVersion] = useState('0.1.0');
  const [isMaximized, setIsMaximized] = useState(false);

  // Load settings and platform info on mount
  useEffect(() => {
    const init = async () => {
      const saved = await loadSettings();
      if (saved) setSettings(saved);
      const p = await window.appAPI.getPlatform();
      setPlatform(p);
      const v = await window.appAPI.getVersion();
      setAppVersion(v);
      const max = await window.windowControlsAPI.isMaximized();
      setIsMaximized(max);
      window.windowControlsAPI.listenMaximize((maximized) => setIsMaximized(maximized));
    };
    init();
    return () => {
      window.windowControlsAPI.removeMaximizeListener();
    };
  }, [loadSettings]);

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(next);
      return next;
    });
  }, [saveSettings]);

  // VS Code protection pattern: preview only dangerous/destructive commands
  const handleInjectCommand = useCallback(
    (command: string) => {
      const sanitized = sanitizeCommand(command);
      const validation = validateCommand(sanitized);

      if (validation.severity === 'high' || validation.severity === 'critical') {
        setPreviewCommand({ command: sanitized, validation });
      } else {
        injectCommand(sanitized);
      }
    },
    [injectCommand]
  );

  const handleAcceptCommand = useCallback(() => {
    if (previewCommand) {
      injectCommand(previewCommand.command);
      setPreviewCommand(null);
    }
  }, [previewCommand, injectCommand]);

  const handleRejectCommand = useCallback(() => {
    setPreviewCommand(null);
  }, []);

  const handleModifyCommand = useCallback(
    (modified: string) => {
      if (previewCommand) {
        const validation = validateCommand(modified);
        setPreviewCommand({ command: modified, validation });
      }
    },
    [previewCommand]
  );

  const handleToggleOrientation = useCallback(() => {
    updateSettings({
      splitDirection: settings.splitDirection === 'horizontal' ? 'vertical' : 'horizontal',
    });
  }, [settings.splitDirection, updateSettings]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (previewCommand) { setPreviewCommand(null); e.preventDefault(); }
        else if (showSettings) { setShowSettings(false); e.preventDefault(); }
      }
      if (e.ctrlKey && e.key === 'l') {
        writeToTerminal('\x0c');
        e.preventDefault();
      }
      if (e.ctrlKey && e.key === ',') {
        setShowSettings((prev) => !prev);
        e.preventDefault();
      }
      // Ctrl+Shift+P for command palette (placeholder)
      if (e.ctrlKey && e.shiftKey && e.key === 'P') {
        // Future: command palette
        e.preventDefault();
      }
      // Ctrl+Shift+D to toggle debug mode
      if (e.ctrlKey && e.shiftKey && e.key === 'D') {
        e.preventDefault();
        try {
          const logger = (window as unknown as Record<string, unknown>).__AI_LOGS as {
            setDebug: (v: boolean) => void;
          } | undefined;
          if (logger) {
            const isEnabled = localStorage.getItem('DEBUG_AI') === 'true';
            logger.setDebug(!isEnabled);
            console.log(`%c🐛 Debug mode: ${!isEnabled ? 'ENABLED' : 'DISABLED'}`, 'font-size:14px; font-weight:bold');
            alert(`Debug mode ${!isEnabled ? 'enabled ✅' : 'disabled ❌'}\n\nPress Ctrl+Shift+I to open DevTools and see logs.`);
          }
        } catch { /* ignore */ }
      }
      // Ctrl+Shift+L to dump logs to console
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        try {
          const logger = (window as unknown as Record<string, unknown>).__AI_LOGS as {
            dump: () => void;
          } | undefined;
          if (logger) {
            logger.dump();
            console.log('%c📋 Logs dumped above. Open DevTools to see them.', 'font-size:12px');
          }
        } catch { /* ignore */ }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [previewCommand, showSettings, writeToTerminal]);

  const minimize = () => window.windowControlsAPI.minimize();
  const maximize = () => window.windowControlsAPI.maximize();
  const closeWindow = () => window.windowControlsAPI.close();

  return (
    <ErrorBoundary>
    <div className={`app app-theme-${settings.theme}`} style={{ fontSize: settings.fontSize }}>
      {/* Minimal title bar — just window controls and drag region */}
      <div className="title-bar">
        <div className="title-bar-center">
          <span className="title-bar-label">{providerLabel} · Terminal + AI</span>
        </div>
        <div className="title-bar-right">
          <button
            className="title-bar-btn settings-gear-btn"
            onClick={() => setShowSettings(true)}
            title="Settings (Ctrl+,)"
          >
            <span className="settings-gear-icon">⚙</span>
            <span className="settings-gear-label">Settings</span>
          </button>
          <div className="window-controls">
            <button className="window-control" onClick={minimize} title="Minimize">&#x2014;</button>
            <button className="window-control" onClick={maximize} title={isMaximized ? 'Restore' : 'Maximize'}>
              {isMaximized ? '\u29C9' : '\u25A1'}
            </button>
            <button className="window-control window-control-close" onClick={closeWindow} title="Close">&#x2715;</button>
          </div>
        </div>
      </div>

      {/* Main content — minimal split layout */}
      <div className="app-body">
        <div className="app-main">
          {settings.showTerminal ? (
            <SplitPane
              direction={settings.splitDirection}
              defaultSplit={0.5}
              left={
                <TerminalPane
                  terminalId={terminalId}
                  theme={settings.theme}
                />
              }
              right={
                <ChatPane
                  onInjectCommand={handleInjectCommand}
                  hasApiKey={hasApiKey}
                  isStreaming={isStreaming}
                  onOpenSettings={() => setShowSettings(true)}
                  onClear={clearMessages}
                  onStop={stopGeneration}
                  messages={messages}
                  onSendMessage={sendMessage}
                  onClearMessages={clearMessages}
                  onLoadMessages={loadMessages}
                  providerLabel={providerLabel}
                  pendingToolCalls={pendingToolCalls}
                  agentMode={agentMode}
                  onApprove={approvePending}
                  onApproveAlways={approveAlwaysPending}
                  onSkip={skipPending}
                  errorMessage={errorMessage}
                  onClearError={clearError}
                />
              }
            />
          ) : (
            <ChatPane
              onInjectCommand={handleInjectCommand}
              hasApiKey={hasApiKey}
              isStreaming={isStreaming}
              onOpenSettings={() => setShowSettings(true)}
              onClear={clearMessages}
              onStop={stopGeneration}
              messages={messages}
              onSendMessage={sendMessage}
              onClearMessages={clearMessages}
              onLoadMessages={loadMessages}
              providerLabel={providerLabel}
              pendingToolCalls={pendingToolCalls}
              agentMode={agentMode}
              onApprove={approvePending}
              onApproveAlways={approveAlwaysPending}
              onSkip={skipPending}
              errorMessage={errorMessage}
              onClearError={clearError}
            />
          )}
        </div>
      </div>

      {/* Status bar — VS Code inspired */}
      <StatusBar
        platform={platform}
        version={appVersion}
        isStreaming={isStreaming}
        hasApiKey={hasApiKey}
        providerName={providerLabel}
        terminalCount={terminalCount}
        splitDirection={settings.splitDirection}
        onToggleOrientation={handleToggleOrientation}
        onShowAbout={() => { setSettingsInitialTab('about'); setShowSettings(true); }}
      />

      {/* Command preview modal — VS Code protection pattern */}
      {previewCommand && (
        <div className="preview-overlay">
          <CommandPreview
            command={previewCommand.command}
            validation={previewCommand.validation}
            onAccept={handleAcceptCommand}
            onReject={handleRejectCommand}
            onModify={handleModifyCommand}
          />
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => { setShowSettings(false); setSettingsInitialTab('api'); }}
          onClearChat={clearMessages}
          onAgentModeChange={setAgentMode}
          version={appVersion}
          initialTab={settingsInitialTab}
        />
      )}
    </div>
    </ErrorBoundary>
  );
};
