import React, { useState, useRef, useCallback, useEffect } from 'react';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  direction?: 'horizontal' | 'vertical';
  defaultSplit?: number; // 0–1 percentage for left pane
  minSplit?: number;
  maxSplit?: number;
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  left,
  right,
  direction = 'horizontal',
  defaultSplit = 0.5,
  minSplit = 0.2,
  maxSplit = 0.8,
}) => {
  const [splitPos, setSplitPos] = useState(defaultSplit);
  const containerRef = useRef<HTMLDivElement>(null);
  const dividerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    isDragging.current = true;
    // Use pointer capture so we get the release event even outside the window
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    if (!isDragging.current || !containerRef.current) return;
    e.preventDefault();

    const rect = containerRef.current.getBoundingClientRect();
    let pos: number;

    if (direction === 'horizontal') {
      pos = (e.clientX - rect.left) / rect.width;
    } else {
      pos = (e.clientY - rect.top) / rect.height;
    }

    setSplitPos(Math.min(maxSplit, Math.max(minSplit, pos)));
  }, [direction, minSplit, maxSplit]);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    const divider = dividerRef.current;
    if (!divider) return;

    divider.addEventListener('pointermove', handlePointerMove);
    divider.addEventListener('pointerup', handlePointerUp);
    return () => {
      divider.removeEventListener('pointermove', handlePointerMove);
      divider.removeEventListener('pointerup', handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: isHorizontal ? 'row' : 'column',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          [isHorizontal ? 'width' : 'height']: `${splitPos * 100}%`,
          overflow: 'hidden',
        }}
      >
        {left}
      </div>

      {/* Subtle divider — 1px line, wider hit area for grabbing */}
      <div
        ref={dividerRef}
        onPointerDown={handlePointerDown}
        className={`split-pane-divider ${isHorizontal ? 'divider-horizontal' : 'divider-vertical'}`}
      />

      <div
        style={{
          flex: 1,
          overflow: 'hidden',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {right}
      </div>
    </div>
  );
};
