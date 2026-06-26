import React, { useState, useEffect, useRef } from 'react';
import type { AppSettings, AIProviderType, ProviderConfig } from '../types';
import { AI_PROVIDERS, getDefaultProviderConfig } from '../types';
import { TinySpinner } from './TinySpinner';

interface SettingsPanelProps {
  settings: AppSettings;
  onUpdate: (settings: Partial<AppSettings>) => void;
  onClose: () => void;
  onClearChat?: () => void;
  onAgentModeChange?: (mode: 'auto' | 'interactive') => void;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onUpdate, onClose, onClearChat, onAgentModeChange }) => {
  const [activeProvider, setActiveProvider] = useState<AIProviderType>(settings.activeProvider || 'deepseek');
  const [providerConfigs, setProviderConfigs] = useState<Record<string, ProviderConfig>>({});
  const [localKey, setLocalKey] = useState('');
  const [localBaseUrl, setLocalBaseUrl] = useState('');
  const [localModel, setLocalModel] = useState('');
  const [localLabel, setLocalLabel] = useState('');
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [activeTab, setActiveTab] = useState<'api' | 'appearance' | 'debug' | 'agent'>('api');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'idle' | 'success' | 'fail'>('idle');
  const [debugLogging, setDebugLogging] = useState(false);
  // Model management state (like VS Code's chatLanguageModels.json)
  const [modelEntries, setModelEntries] = useState<Array<{ id: string; provider: string; source: 'auto' | 'manual' }>>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [newModelName, setNewModelName] = useState('');
  const [showAddModel, setShowAddModel] = useState(false);
  // Snapshot for Cancel — captures ALL settings, not just API
  const snapshotRef = useRef<Record<string, unknown>>({});
  // Refs for keyboard handler to avoid stale closures
  const handleOkRef = useRef<() => void>(() => {});
  const handleCancelRef = useRef<() => void>(() => {});

  // Staged appearance + agent settings (applied only on OK/Apply)
  const [stagedTheme, setStagedTheme] = useState(settings.theme);
  const [stagedFontSize, setStagedFontSize] = useState(settings.fontSize);
  const [stagedSplitDirection, setStagedSplitDirection] = useState(settings.splitDirection);
  const [stagedShowTerminal, setStagedShowTerminal] = useState(settings.showTerminal);
  const [stagedAgentMode, setStagedAgentMode] = useState(settings.agentMode);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Keyboard shortcuts: Escape → Cancel, Ctrl+Enter → OK
  // Uses refs to always call the latest handler without re-registering the listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.repeat) {
        handleCancelRef.current();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        handleOkRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load all provider configs and models on mount
  useEffect(() => {
    (async () => {
      try {
        const active = await window.providerAPI.getActive() as AIProviderType;
        setActiveProvider(active);

        const allConfigs = await window.providerAPI.getAllConfigs();
        const configMap: Record<string, ProviderConfig> = {};
        for (const [type, cfg] of Object.entries(allConfigs)) {
          configMap[type] = {
            type: type as AIProviderType,
            apiKey: cfg.apiKey || '',
            baseUrl: cfg.baseUrl || getDefaultProviderConfig(type as AIProviderType).baseUrl,
            model: cfg.model || getDefaultProviderConfig(type as AIProviderType).model,
            label: cfg.label,
          };
        }
        setProviderConfigs(configMap);

        // Set local state for active provider
        const current = configMap[active] || getDefaultProviderConfig(active);
        setLocalKey(current.apiKey || '');
        setLocalBaseUrl(current.baseUrl || getDefaultProviderConfig(active).baseUrl);
        const model = current.model || getDefaultProviderConfig(active).model;
        setLocalModel(model);
        const providerDef = AI_PROVIDERS.find((p) => p.id === active);
        const isCustom = !!(providerDef?.models && !providerDef.models.includes(model));
        setIsCustomModel(isCustom);
        setLocalLabel(current.label || '');

        // Snapshot for Cancel — captures ALL settings
        snapshotRef.current = {
          activeProvider: active,
          localKey: current.apiKey || '',
          localBaseUrl: current.baseUrl || getDefaultProviderConfig(active).baseUrl,
          localModel: model,
          isCustomModel: isCustom,
          localLabel: current.label || '',
          theme: settings.theme,
          fontSize: settings.fontSize,
          splitDirection: settings.splitDirection,
          showTerminal: settings.showTerminal,
          agentMode: settings.agentMode,
        };

        // Load model entries
        const modelsData = await window.modelsAPI.getAll();
        setModelEntries(modelsData.models || []);
      } catch {
        // Use defaults
      }
    })();
  }, []);

  const currentProvider = AI_PROVIDERS.find((p) => p.id === activeProvider)!;
  const currentConfig = providerConfigs[activeProvider] || getDefaultProviderConfig(activeProvider);

  const handleProviderChange = async (type: AIProviderType) => {
    setActiveProvider(type);
    await window.providerAPI.setActive(type);

    const config = providerConfigs[type] || getDefaultProviderConfig(type);
    const model = config.model || getDefaultProviderConfig(type).model;
    setLocalKey(config.apiKey || '');
    setLocalBaseUrl(config.baseUrl || getDefaultProviderConfig(type).baseUrl);
    setLocalModel(model);
    const providerDef = AI_PROVIDERS.find((p) => p.id === type);
    const isCustom = !!(providerDef?.models && !providerDef.models.includes(model));
    setIsCustomModel(isCustom);
    setLocalLabel(config.label || '');
    setTestResult('idle');
    setFetchError(null);

    // Refresh model entries for this provider
    const modelsData = await window.modelsAPI.getAll();
    setModelEntries(modelsData.models || []);

    onUpdate({ activeProvider: type });
  };

  const saveCurrentProvider = async () => {
    const trimmedKey = localKey.trim();
    // Update local state to show trimmed key
    if (trimmedKey !== localKey) setLocalKey(trimmedKey);
    console.log(`[AUTH] SettingsPanel.saveCurrentProvider: provider=${activeProvider}, rawLen=${localKey.length}, trimmedLen=${trimmedKey.length}, startsWithSk=${trimmedKey.startsWith('sk-')}`);
    const config = {
      apiKey: trimmedKey,
      baseUrl: localBaseUrl,
      model: localModel,
      label: activeProvider === 'custom' ? localLabel : undefined,
    };
    await window.providerAPI.setConfig(activeProvider, config);
    setProviderConfigs((prev) => ({
      ...prev,
      [activeProvider]: {
        type: activeProvider,
        apiKey: trimmedKey,
        baseUrl: localBaseUrl,
        model: localModel,
        label: activeProvider === 'custom' ? localLabel : undefined,
      },
    }));
  };

  // Validate: if API key is set, a model must also be chosen
  const validate = (): string | null => {
    const trimmedKey = localKey.trim();
    const trimmedModel = localModel.trim();
    if (trimmedKey && !trimmedModel) {
      return 'Please select or enter a model before saving your API key.';
    }
    return null;
  };

  // Whether there are unsaved changes across any tab
  const hasChanges =
    localKey.trim() !== ((snapshotRef.current.localKey as string) ?? '') ||
    localBaseUrl !== (snapshotRef.current.localBaseUrl as string) ||
    localModel !== (snapshotRef.current.localModel as string) ||
    stagedTheme !== settings.theme ||
    stagedFontSize !== settings.fontSize ||
    stagedSplitDirection !== settings.splitDirection ||
    stagedShowTerminal !== settings.showTerminal ||
    stagedAgentMode !== settings.agentMode;

  const saveAll = async () => {
    await saveCurrentProvider();
    // Apply staged appearance + agent settings
    onUpdate({
      activeProvider,
      theme: stagedTheme,
      fontSize: stagedFontSize,
      splitDirection: stagedSplitDirection,
      showTerminal: stagedShowTerminal,
      agentMode: stagedAgentMode,
    });
    if (stagedAgentMode !== settings.agentMode) {
      onAgentModeChange?.(stagedAgentMode);
    }

    // Update snapshot so Cancel after Apply is safe
    snapshotRef.current = {
      activeProvider,
      localKey: localKey.trim(),
      localBaseUrl,
      localModel,
      isCustomModel,
      localLabel,
      theme: stagedTheme,
      fontSize: stagedFontSize,
      splitDirection: stagedSplitDirection,
      showTerminal: stagedShowTerminal,
      agentMode: stagedAgentMode,
    };
  };

  // ── OK: validate, save all, close ──
  const handleOk = async () => {
    const err = validate();
    if (err) { showToast(err, 'error'); return; }
    await saveAll();
    onClose();
  };

  handleOkRef.current = handleOk;

  // ── Apply: validate, save all, toast ──
  const handleApply = async () => {
    const err = validate();
    if (err) { showToast(err, 'error'); return; }
    await saveAll();
    showToast('Settings applied successfully', 'success');
  };

  // ── Cancel: restore ALL settings, close ──
  const handleCancel = () => {
    const snap = snapshotRef.current as Record<string, unknown>;
    if (snap.activeProvider && snap.activeProvider !== activeProvider) {
      setActiveProvider(snap.activeProvider as AIProviderType);
    }
    setLocalKey((snap.localKey as string) || '');
    setLocalBaseUrl((snap.localBaseUrl as string) || '');
    setLocalModel((snap.localModel as string) || '');
    setIsCustomModel(snap.isCustomModel === true);
    setLocalLabel((snap.localLabel as string) || '');
    // Revert staged appearance + agent
    setStagedTheme((snap.theme as typeof settings.theme) || settings.theme);
    setStagedFontSize((snap.fontSize as number) || settings.fontSize);
    setStagedSplitDirection((snap.splitDirection as 'horizontal' | 'vertical') || settings.splitDirection);
    setStagedShowTerminal((snap.showTerminal as boolean) ?? settings.showTerminal);
    setStagedAgentMode((snap.agentMode as 'auto' | 'interactive') || settings.agentMode);
    onClose();
  };
  handleCancelRef.current = handleCancel;

  const handleTest = async () => {
    setTesting(true);
    setTestResult('idle');
    try {
      // Simple test: send a minimal chat completion
      const { streamChatCompletion } = await import('../utils/ai-client');
      const config = {
        type: activeProvider,
        apiKey: localKey,
        baseUrl: localBaseUrl,
        model: localModel,
      };
      await streamChatCompletion(
        config,
        [],
        [],
        'Respond with exactly one word: ok',
        () => {},
        undefined
      );
      setTestResult('success');
    } catch {
      setTestResult('fail');
    } finally {
      setTesting(false);
    }
  };

  const handleClear = async () => {
    setLocalKey('');
    await window.providerAPI.setConfig(activeProvider, { apiKey: '' });
    setProviderConfigs((prev) => ({
      ...prev,
      [activeProvider]: { ...prev[activeProvider], apiKey: '' },
    }));
    showToast('API key cleared', 'success');
  };

  // ─── Model Management ───

  const handleFetchModels = async () => {
    setFetchingModels(true);
    setFetchError(null);
    try {
      const result = await window.modelsAPI.fetchFromProvider(activeProvider, localBaseUrl, localKey);
      if (result.success) {
        // Reload all models
        const modelsData = await window.modelsAPI.getAll();
        setModelEntries(modelsData.models || []);
        // If only one model came back, auto-select it
        if (result.models && result.models.length === 1) {
          setLocalModel(result.models[0]);
          setIsCustomModel(false);
          await window.modelsAPI.setSelected(activeProvider, result.models[0]);
        }
      } else {
        setFetchError(result.error || 'Failed to fetch models');
      }
    } catch {
      setFetchError('Failed to fetch models');
    } finally {
      setFetchingModels(false);
    }
  };

  const handleAddModel = async () => {
    const name = newModelName.trim();
    if (!name) return;
    const result = await window.modelsAPI.add({ id: name, provider: activeProvider });
    if (result.success) {
      const modelsData = await window.modelsAPI.getAll();
      setModelEntries(modelsData.models || []);
      setLocalModel(name);
      setIsCustomModel(false);
      setNewModelName('');
      setShowAddModel(false);
    }
  };

  const handleRemoveModel = async (modelId: string) => {
    await window.modelsAPI.remove(modelId, activeProvider);
    const modelsData = await window.modelsAPI.getAll();
    setModelEntries(modelsData.models || []);
    // If removed model was selected, revert to default
    if (localModel === modelId) {
      const defaults = AI_PROVIDERS.find((p) => p.id === activeProvider);
      const fallback = defaults?.defaultModel || '';
      setLocalModel(fallback);
      setIsCustomModel(false);
    }
  };

  const handleSelectModel = async (modelId: string) => {
    setLocalModel(modelId);
    setIsCustomModel(false);
    await window.modelsAPI.setSelected(activeProvider, modelId);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="icon-button" onClick={onClose}>✕</button>
        </div>

        {/* Tab bar */}
        <div className="settings-tabs">
          <button
            className={`settings-tab ${activeTab === 'api' ? 'active' : ''}`}
            onClick={() => setActiveTab('api')}
          >
            API Management
          </button>
          <button
            className={`settings-tab ${activeTab === 'appearance' ? 'active' : ''}`}
            onClick={() => setActiveTab('appearance')}
          >
            Appearance
          </button>
          <button
            className={`settings-tab ${activeTab === 'debug' ? 'active' : ''}`}
            onClick={() => setActiveTab('debug')}
          >
            🛠 Diagnostics
          </button>
          <button
            className={`settings-tab ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            🛡️ Agent
          </button>
        </div>

        <div className="settings-body">
          {activeTab === 'api' && (
            <>
              {/* AI Provider Selection */}
              <div className="settings-section">
                <h3>AI Provider</h3>
                <p className="settings-hint">
                  Choose your AI provider. Supports OpenAI-compatible APIs, Anthropic Claude, Google Gemini, and custom endpoints.
                </p>
                <div className="provider-selector">
                  {AI_PROVIDERS.map((provider) => (
                    <button
                      key={provider.id}
                      className={`provider-option ${activeProvider === provider.id ? 'active' : ''}`}
                      onClick={() => handleProviderChange(provider.id)}
                      title={provider.name}
                    >
                      <span className="provider-icon">
                        {provider.id === 'deepseek' ? '🌀' :
                         provider.id === 'openai' ? '○' :
                         provider.id === 'azure' ? '☁' :
                         provider.id === 'anthropic' ? '●' :
                         provider.id === 'google' ? '◈' :
                         provider.id === 'custom' ? '🔌' : '?'}
                      </span>
                      <span className="provider-name">{provider.name}</span>
                    </button>
                  ))}
                </div>
                <p className="settings-provider-label">{currentProvider.label}</p>
              </div>

              {/* API Key */}
              <div className="settings-section">
                <h3>{currentProvider.apiKeyLabel}</h3>
                {currentProvider.helpUrl && (
                  <p className="settings-hint">
                    Get your API key from{' '}
                    <a href={currentProvider.helpUrl} target="_blank" rel="noreferrer">
                      {currentProvider.helpUrl}
                    </a>
                  </p>
                )}
                <div className="api-key-input">
                  <input
                    type="password"
                    value={localKey}
                    onChange={(e) => setLocalKey(e.target.value)}
                    placeholder={currentProvider.requiresApiKey ? 'Enter your API key...' : 'API key (optional)'}
                    className="text-input"
                  />
                </div>
              </div>

              {/* Base URL */}
              <div className="settings-section">
                <h3>Base URL</h3>
                <p className="settings-hint">
                  {activeProvider === 'custom'
                    ? 'Enter the base URL for your OpenAI-compatible API endpoint.'
                    : activeProvider === 'azure'
                    ? 'Enter your Azure OpenAI endpoint (e.g., https://your-resource.openai.azure.com)'
                    : 'Override the default API endpoint (leave as default for most cases).'}
                </p>
                <input
                  type="text"
                  value={localBaseUrl}
                  onChange={(e) => setLocalBaseUrl(e.target.value)}
                  placeholder={currentProvider.defaultBaseUrl || 'https://...'}
                  className="text-input"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </div>

              {/* Model selection */}
              <div className="settings-section">
                <h3>Model</h3>
                <p className="settings-hint">
                  Select a model or add your own. Fetched models are loaded from the provider API.
                </p>

                {/* Model dropdown + compact action buttons on one row */}
                <div className="model-row">
                  <select
                    value={isCustomModel ? '__custom__' : localModel}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') {
                        setIsCustomModel(true);
                        setLocalModel('');
                      } else {
                        handleSelectModel(e.target.value);
                      }
                    }}
                    className="select-input model-select"
                  >
                    {modelEntries.filter((m) => m.provider === activeProvider && m.source === 'auto').length > 0 && (
                      <optgroup label="Auto-detected">
                        {modelEntries
                          .filter((m) => m.provider === activeProvider && m.source === 'auto')
                          .map((m) => (
                            <option key={m.id} value={m.id}>{m.id}</option>
                          ))}
                      </optgroup>
                    )}
                    {modelEntries.filter((m) => m.provider === activeProvider && m.source === 'manual').length > 0 && (
                      <optgroup label="Custom">
                        {modelEntries
                          .filter((m) => m.provider === activeProvider && m.source === 'manual')
                          .map((m) => (
                            <option key={m.id} value={m.id}>{m.id}</option>
                          ))}
                      </optgroup>
                    )}
                    {modelEntries.filter((m) => m.provider === activeProvider).length === 0 && currentProvider.models && (
                      <optgroup label="Default">
                        {currentProvider.models.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </optgroup>
                    )}
                    <option value="__custom__">Custom model…</option>
                  </select>

                  <div className="model-row-actions">
                    <button
                      className="btn-icon"
                      onClick={handleFetchModels}
                      disabled={fetchingModels || !localBaseUrl}
                      title="Fetch models from API"
                    >
                      {fetchingModels ? <TinySpinner /> : '🔄'}
                    </button>
                    <button
                      className="btn-icon"
                      onClick={() => setShowAddModel(true)}
                      title="Add custom model"
                    >
                      +
                    </button>
                    {modelEntries.some((m) => m.provider === activeProvider && m.source === 'manual' && m.id === localModel) && (
                      <button
                        className="btn-icon btn-icon-danger"
                        onClick={() => handleRemoveModel(localModel)}
                        title="Remove this model"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Custom model text input */}
                {isCustomModel && (
                  <input
                    type="text"
                    value={localModel}
                    onChange={(e) => setLocalModel(e.target.value)}
                    placeholder="Enter custom model name…"
                    className="text-input"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 6 }}
                  />
                )}

                {/* Inline add model form */}
                {showAddModel && (
                  <div className="add-model-form">
                    <input
                      type="text"
                      value={newModelName}
                      onChange={(e) => setNewModelName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleAddModel(); if (e.key === 'Escape') setShowAddModel(false); }}
                      placeholder="e.g. gpt-4o-custom…"
                      className="text-input"
                      autoFocus
                    />
                    <button className="btn-primary" onClick={handleAddModel} disabled={!newModelName.trim()}>Add</button>
                    <button className="btn-secondary" onClick={() => { setShowAddModel(false); setNewModelName(''); }}>Cancel</button>
                  </div>
                )}

                {/* Fetch error */}
                {fetchError && (
                  <p className="fetch-error">{fetchError}</p>
                )}
              </div>

              {/* Custom label (only for custom provider) */}
              {activeProvider === 'custom' && (
                <div className="settings-section">
                  <h3>Display Label</h3>
                  <p className="settings-hint">A friendly name for your custom endpoint (shown in the chat header).</p>
                  <input
                    type="text"
                    value={localLabel}
                    onChange={(e) => setLocalLabel(e.target.value)}
                    placeholder="My API"
                    className="text-input"
                  />
                </div>
              )}

              {/* Test Connection */}
              <div className="settings-section">
                <h3>Test Connection</h3>
                <p className="settings-hint">Verify your API endpoint is reachable with the current settings.</p>
                <div className="test-row">
                  <button
                    className="btn-secondary"
                    onClick={handleTest}
                    disabled={testing || !localKey}
                  >
                    {testing ? (
                      <span className="btn-loading-content">
                        <TinySpinner />
                        Testing...
                      </span>
                    ) : '🔌 Test Connection'}
                  </button>
                  {testResult === 'success' && <span className="test-pass">✓ Connected</span>}
                  {testResult === 'fail' && <span className="test-fail">✗ Connection failed</span>}
                </div>
              </div>

              {/* API Key Management */}
              <div className="settings-section">
                <h3>API Key</h3>
                <p className="settings-hint">Clear your stored API key for this provider.</p>
                <button className="btn-secondary" onClick={handleClear} disabled={!localKey}>
                  🗑 Clear API Key
                </button>
              </div>
            </>
          )}

          {activeTab === 'appearance' && (
            <>
              {/* Theme */}
              <div className="settings-section">
                <h3>Theme</h3>
                <label className="setting-row">
                  <span>Color scheme</span>
                  <select
                    value={stagedTheme}
                    onChange={(e) => setStagedTheme(e.target.value as typeof settings.theme)}
                    className="select-input"
                  >
                    <option value="dark">Dark Modern (VS Code)</option>
                    <option value="light">Light Modern (VS Code)</option>
                    <option value="solarized-dark">Solarized Dark</option>
                    <option value="solarized-light">Solarized Light</option>
                  </select>
                </label>
              </div>

              {/* Font Size */}
              <div className="settings-section">
                <h3>Font</h3>
                <label className="setting-row">
                  <span>Size</span>
                  <input
                    type="number"
                    min={10}
                    max={24}
                    value={stagedFontSize}
                    onChange={(e) => setStagedFontSize(parseInt(e.target.value))}
                    className="text-input"
                    style={{ width: 80 }}
                  />
                </label>
              </div>

              {/* Layout */}
              <div className="settings-section">
                <h3>Layout</h3>
                <label className="setting-row">
                  <span>Split Direction</span>
                  <select
                    value={stagedSplitDirection}
                    onChange={(e) =>
                      setStagedSplitDirection(e.target.value as 'horizontal' | 'vertical')
                    }
                    className="select-input"
                  >
                    <option value="horizontal">Horizontal (side by side)</option>
                    <option value="vertical">Vertical (top / bottom)</option>
                  </select>
                </label>
              </div>

              {/* Terminal Visibility */}
              <div className="settings-section">
                <h3>Terminal</h3>
                <label className="setting-row">
                  <span>Show terminal pane</span>
                  <input
                    type="checkbox"
                    checked={stagedShowTerminal}
                    onChange={(e) => setStagedShowTerminal(e.target.checked)}
                    className="checkbox-input"
                  />
                </label>
                <p className="settings-hint">
                  Hide the terminal to give the chat area full focus.
                  The terminal is still running in the background.
                </p>
              </div>

              {/* Clear Chat — immediate action (no staging needed) */}
              <div className="settings-section">
                <h3>Chat</h3>
                <div className="setting-row">
                  <span>Clear current conversation</span>
                  <button
                    className="btn-clear-danger"
                    onClick={() => {
                      if (window.confirm('Delete all messages in the current chat? This cannot be undone.')) {
                        onClearChat?.();
                      }
                    }}
                  >
                    🗑 Clear Chat
                  </button>
                </div>
              </div>
            </>
          )}

          {activeTab === 'debug' && (
            <>
              {/* Logging Toggle — shows current mode clearly */}
              <div className="settings-section">
                <h3>🪵 API Logging</h3>
                <p className="settings-hint">
                  When <strong>on</strong>, all API requests and responses are printed to the DevTools console
                  so you can inspect exactly what the AI sends and receives.
                </p>
                <div className="setting-row">
                  <span>Debug logging</span>
                  <span className="debug-status-badge">
                    {debugLogging ? (
                      <span className="debug-badge-on">● ON</span>
                    ) : (
                      <span className="debug-badge-off">○ OFF</span>
                    )}
                  </span>
                  <button
                    className={`btn-secondary ${debugLogging ? 'btn-active' : ''}`}
                    onClick={() => {
                      const next = !debugLogging;
                      setDebugLogging(next);
                      try {
                        (window as any).__AI_LOGS?.setDebug?.(next);
                      } catch { /* ignore */ }
                      const label = next ? 'ON' : 'OFF';
                      showToast(`Debug logging turned ${label}`, 'success');
                    }}
                    style={{ minWidth: 80 }}
                  >
                    {debugLogging ? 'Turn Off' : 'Turn On'}
                  </button>
                </div>
                {debugLogging && (
                  <p className="settings-hint" style={{ color: 'var(--text-success)', marginTop: 4 }}>
                    ✓ Logging is active — open <kbd>Ctrl+Shift+I</kbd> → Console tab → look for <code>[AI:…]</code> messages
                  </p>
                )}
              </div>

              {/* Actions — only shown when logging is on */}
              {debugLogging && (
                <div className="settings-section">
                  <h3>Actions</h3>
                  <div className="debug-actions">
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        try {
                          (window as any).__AI_LOGS?.dump?.();
                          showToast('Logs dumped to console', 'success');
                        } catch { /* ignore */ }
                      }}
                    >
                      📋 Dump to Console
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => {
                        try {
                          (window as any).__AI_LOGS?.clear?.();
                          showToast('Logs cleared', 'success');
                        } catch { /* ignore */ }
                      }}
                    >
                      🧹 Clear Logs
                    </button>
                  </div>
                </div>
              )}

              {/* Provider Config — collapsed card showing current state */}
              <div className="settings-section">
                <h3>🛠 Connection Summary</h3>
                <p className="settings-hint">
                  A read-only snapshot of your current API connection settings.
                </p>
                <div className="debug-config-card">
                  <div className="debug-config-row">
                    <span className="debug-config-label">Provider</span>
                    <span className="debug-config-value">{activeProvider}</span>
                  </div>
                  <div className="debug-config-row">
                    <span className="debug-config-label">Model</span>
                    <span className="debug-config-value">{localModel || <span style={{ color: 'var(--text-error)' }}>not set</span>}</span>
                  </div>
                  <div className="debug-config-row">
                    <span className="debug-config-label">Base URL</span>
                    <span className="debug-config-value debug-config-mono">{localBaseUrl}</span>
                  </div>
                  <div className="debug-config-row">
                    <span className="debug-config-label">API Key</span>
                    <span className="debug-config-value debug-config-mono">
                      {localKey ? localKey.slice(0, 8) + '…' + localKey.slice(-4) : <span style={{ color: 'var(--text-muted)' }}>not set</span>}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
          {activeTab === 'agent' && (
            <>
              <div className="settings-section">
                <h3>🤖 Agent Mode</h3>
                <p className="settings-hint">
                  Control how the AI assistant executes terminal commands. In <strong>Auto</strong> mode,
                  tools run without confirmation. In <strong>Interactive</strong> mode, the assistant asks
                  for your approval before each tool execution.
                </p>
                <div className="agent-mode-options">
                  <label className={`agent-mode-option${stagedAgentMode === 'auto' ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="agentMode"
                      value="auto"
                      checked={stagedAgentMode === 'auto'}
                      onChange={() => setStagedAgentMode('auto')}
                    />
                    <div className="agent-mode-option-content">
                      <span className="agent-mode-option-title">🤖 Auto</span>
                      <span className="agent-mode-option-desc">Execute commands automatically — no confirmation needed</span>
                    </div>
                  </label>
                  <label className={`agent-mode-option${stagedAgentMode === 'interactive' ? ' selected' : ''}`}>
                    <input
                      type="radio"
                      name="agentMode"
                      value="interactive"
                      checked={stagedAgentMode === 'interactive'}
                      onChange={() => setStagedAgentMode('interactive')}
                    />
                    <div className="agent-mode-option-content">
                      <span className="agent-mode-option-title">🔍 Interactive</span>
                      <span className="agent-mode-option-desc">Ask for approval before running each tool</span>
                    </div>
                  </label>
                </div>
              </div>

              <div className="settings-section">
                <h3>🔒 Safety Notes</h3>
                <div className="settings-hint">
                  <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
                    <li><strong>Auto mode</strong> is convenient but allows the AI to run commands directly.</li>
                    <li><strong>Interactive mode</strong> gives you a chance to review each command before execution.</li>
                    <li>Use <strong>Always Allow</strong> to temporarily trust commands during a session.</li>
                    <li>Switch modes anytime from this panel or the <strong>status bar</strong> indicator.</li>
                  </ul>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Footer: OK / Cancel / Apply ── */}
        <div className="settings-footer">
          <div className="settings-footer-left">
            {toast && (
              <span className={`settings-toast settings-toast-${toast.type}`}>
                {toast.type === 'success' ? '✓' : '⚠'} {toast.message}
              </span>
            )}
            {!toast && hasChanges && (
              <span className="settings-dirty-badge">● Unsaved changes</span>
            )}
          </div>
          <div className="settings-footer-actions">
            <button className="btn-primary" onClick={handleOk} title="Save &amp; close (Ctrl+Enter)">OK</button>
            <button className="btn-secondary" onClick={handleApply} title="Save without closing">Apply</button>
            <button className="btn-secondary" onClick={handleCancel} title="Discard changes (Escape)">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
};
