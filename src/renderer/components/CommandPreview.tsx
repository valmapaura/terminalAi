import React, { useState, useRef, useEffect } from 'react';
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
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(command);
  const editInputRef = useRef<HTMLTextAreaElement>(null);
  const isCritical = validation.severity === 'critical';

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editing]);

  const handleEdit = () => {
    setEditValue(command);
    setEditing(true);
  };

  const handleSaveEdit = () => {
    if (editValue.trim() && editValue !== command) {
      onModify(editValue.trim());
    }
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditValue(command);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSaveEdit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      handleCancelEdit();
    }
  };

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

        {editing ? (
          <div className="command-preview-edit">
            <textarea
              ref={editInputRef}
              className="command-preview-edit-input"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={Math.max(3, editValue.split('\n').length)}
            />
            <div className="command-preview-edit-hint">
              Ctrl+Enter to save &middot; Escape to cancel
            </div>
            <div className="command-preview-edit-actions">
              <button className="btn-secondary" onClick={handleCancelEdit}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveEdit}>Save</button>
            </div>
          </div>
        ) : (
          <code className="command-preview-text">{command}</code>
        )}

        {!editing && (
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
              className="btn-secondary edit-command-btn"
              onClick={handleEdit}
            >
              Edit Command
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
