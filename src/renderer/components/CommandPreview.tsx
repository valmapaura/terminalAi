import React from 'react';
import type { ValidationResult } from '../utils/command-validator';

interface CommandPreviewProps {
  command: string;
  validation: ValidationResult;
  onAccept: () => void;
  onReject: () => void;
  onModify: (command: string) => void;
}

export const CommandPreview: React.FC<CommandPreviewProps> = ({
  command,
  validation,
  onAccept,
  onReject,
  onModify,
}) => {
  const isCritical = validation.severity === 'critical';

  return (
    <div className={`command-preview ${isCritical ? 'command-preview-danger' : ''}`}>
      <div className="command-preview-header">
        <span className="command-preview-icon">
          {isCritical ? '🚨' : '⚠️'}
        </span>
        <span className="command-preview-label">
          {isCritical ? 'Destructive Command' : 'Dangerous Command'}
        </span>
      </div>

      <div className="command-preview-body">
        <div className="command-preview-desc">
          {isCritical
            ? 'This command can delete or modify files and system settings. Only proceed if you trust the source.'
            : 'This command makes system-level changes. Review before allowing.'}
        </div>

        {validation.warnings.length > 0 && (
          <div className="command-preview-warnings">
            {validation.warnings.map((w, i) => (
              <div key={i} className="command-preview-warning-item">{w}</div>
            ))}
          </div>
        )}

        <code className="command-preview-text">{command}</code>

        <div className="command-preview-actions">
          <button className="btn-secondary" onClick={onReject}>
            Cancel
          </button>
          <button
            className="btn-inject allow-btn"
            onClick={onAccept}
          >
            {isCritical ? 'Allow Dangerous Command' : 'Allow'}
          </button>
          <button
            className="btn-secondary"
            onClick={() => {
              const modified = prompt('Modify command:', command);
              if (modified) onModify(modified);
            }}
          >
            Edit Command
          </button>
        </div>
      </div>
    </div>
  );
};
