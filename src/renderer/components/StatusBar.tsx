import React from 'react';

interface StatusBarProps {
  platform: string;
  version: string;
  isStreaming: boolean;
  hasApiKey: boolean;
  providerName: string;
  terminalCount: number;
  splitDirection: 'horizontal' | 'vertical';
  onToggleOrientation: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  platform,
  version,
  isStreaming,
  hasApiKey,
  providerName,
  terminalCount,
  splitDirection,
  onToggleOrientation,
}) => {
  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <span className="status-bar-item" title="AI status">
          <span className={`status-indicator ${hasApiKey ? 'online' : 'offline'}`} />
          {hasApiKey ? `${providerName} Ready` : 'No API Key'}
        </span>
        {isStreaming && (
          <span className="status-bar-item streaming">
            <span className="streaming-dot" />
            Processing...
          </span>
        )}
      </div>
      <div className="status-bar-right">
        <span className="status-bar-item" title="Terminals">
          {'>_'} {terminalCount} terminal{terminalCount !== 1 ? 's' : ''}
        </span>
        <button
          className="status-bar-item status-bar-action"
          onClick={onToggleOrientation}
          title={`Toggle split orientation (${splitDirection})`}
        >
          {splitDirection === 'horizontal' ? '⊞ Split Left-Right' : '⊟ Split Top-Bottom'}
        </button>
        <span className="status-bar-item">
          {platform === 'win32' ? 'Windows' : platform}
        </span>
        <span className="status-bar-item version">
          v{version}
        </span>
      </div>
    </div>
  );
};
