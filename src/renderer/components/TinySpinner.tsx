import React from 'react';

/**
 * Three-dot color-changing spinner matching user preference.
 * Dots bounce with staggered delay, colors cycle between
 * primary and secondary-foreground. Use everywhere instead
 * of crescent/border spinners.
 */
export const TinySpinner: React.FC<{ className?: string }> = ({ className = '' }) => {
  return (
    <span className={`tiny-spinner ${className}`} aria-label="Loading" role="status">
      <span className="tiny-spinner-dot" />
      <span className="tiny-spinner-dot" />
      <span className="tiny-spinner-dot" />
    </span>
  );
};

/**
 * Inline three-dot spinner for use inside buttons or small text.
 */
export const InlineSpinner: React.FC = () => {
  return (
    <span className="inline-spinner" aria-label="Loading" role="status">
      <span className="inline-spinner-dot" />
      <span className="inline-spinner-dot" />
      <span className="inline-spinner-dot" />
    </span>
  );
};
