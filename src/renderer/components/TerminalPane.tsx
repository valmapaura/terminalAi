import React, { useRef, useEffect, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

// xterm CSS is imported globally in app.css

interface TerminalPaneProps {
  terminalId: string | null;
  theme: string;
}

/**
 * Return xterm.js theme colors matching the current CSS theme.
 */
function getXtermTheme(theme: string): Record<string, string> {
  switch (theme) {
    case 'light':
      return {
        background: '#ffffff',
        foreground: '#1e1e1e',
        cursor: '#1e1e1e',
        selectionBackground: '#add6ff',
        black: '#000000',
        red: '#cd3131',
        green: '#1b8a4b',
        yellow: '#8a6d3b',
        blue: '#005fb8',
        magenta: '#7b3fa0',
        cyan: '#005fb8',
        white: '#a0a0a0',
        brightBlack: '#666666',
        brightRed: '#c41e3a',
        brightGreen: '#1b8a4b',
        brightYellow: '#8a6d3b',
        brightBlue: '#005fb8',
        brightMagenta: '#7b3fa0',
        brightCyan: '#005fb8',
        brightWhite: '#1e1e1e',
      };
    case 'solarized-dark':
      return {
        background: '#002b36',
        foreground: '#839496',
        cursor: '#839496',
        selectionBackground: '#094552',
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
        brightBlack: '#002b36',
        brightRed: '#cb4b16',
        brightGreen: '#859900',
        brightYellow: '#b58900',
        brightBlue: '#268bd2',
        brightMagenta: '#6c71c4',
        brightCyan: '#2aa198',
        brightWhite: '#fdf6e3',
      };
    case 'solarized-light':
      return {
        background: '#fdf6e3',
        foreground: '#657b83',
        cursor: '#657b83',
        selectionBackground: '#eee8d5',
        black: '#073642',
        red: '#dc322f',
        green: '#859900',
        yellow: '#b58900',
        blue: '#268bd2',
        magenta: '#d33682',
        cyan: '#2aa198',
        white: '#eee8d5',
        brightBlack: '#002b36',
        brightRed: '#cb4b16',
        brightGreen: '#859900',
        brightYellow: '#b58900',
        brightBlue: '#268bd2',
        brightMagenta: '#6c71c4',
        brightCyan: '#2aa198',
        brightWhite: '#fdf6e3',
      };
    default: // dark
      return {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11b8bd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      };
  }
}

export const TerminalPane: React.FC<TerminalPaneProps> = ({ terminalId, theme }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const [, setReady] = useState(false);

  // Keep a ref in sync with the prop to avoid stale closures in IPC callbacks
  useEffect(() => {
    terminalIdRef.current = terminalId;
  }, [terminalId]);

  // Update xterm theme when CSS theme changes
  useEffect(() => {
    const term = xtermRef.current;
    if (term) {
      term.options.theme = getXtermTheme(theme);
    }
  }, [theme]);

  useEffect(() => {
    if (!terminalRef.current || xtermRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
      theme: getXtermTheme(theme),
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    fitAddonRef.current = fitAddon;

    term.open(terminalRef.current);

    // Fit terminal to container after opening and send dimensions to pty
    const sendResize = () => {
      fitAddon.fit();
      const dims = fitAddon.proposeDimensions();
      const id = terminalIdRef.current;
      if (id && dims) {
        window.terminalAPI.resize(id, dims.cols, dims.rows);
      }
    };

    // Track first-fit so we can clear the cmd.exe welcome banner
    const firstFitRef = { current: true };

    requestAnimationFrame(() => {
      sendResize();
      // Clear the cmd.exe welcome banner after the initial resize so
      // the terminal starts at the correct dimensions with just a prompt.
      if (firstFitRef.current) {
        firstFitRef.current = false;
        const id = terminalIdRef.current;
        if (id) {
          window.terminalAPI.write(id, 'cls\r');
        }
      }
      setReady(true);
    });

    // Handle resize — fit and propagate new dimensions to the pty process
    const observer = new ResizeObserver(() => {
      sendResize();
    });
    observer.observe(terminalRef.current);

    // Send user input to main process
    term.onData((data) => {
      const id = terminalIdRef.current;
      if (id) {
        window.terminalAPI.write(id, data);
      }
    });

    // Receive data from main process
    // Line buffer to handle marker text split across node-pty data chunks.
    // Processes complete lines (ending with \n) individually, filtering out
    // any lines containing AI execution markers. Also detects and discards
    // partial marker fragments (uid tails like "x3z7__") in the incomplete buffer.
    //
    // Delayed flush: cmd.exe output after "cls" (or any command where the
    // prompt is the final output) does NOT end with \n.  Without a timeout
    // the prompt stays stuck in the buffer and the terminal appears blank.
    // A 150 ms timer flushes orphaned tail data so the prompt always renders.
    const lineBufferRef = { current: '' };
    const flushTimerRef: { current: ReturnType<typeof setTimeout> | null } = { current: null };

    const flushRemainder = () => {
      const remainder = lineBufferRef.current;
      if (!remainder) return;
      lineBufferRef.current = '';
      // Still filter out any marker-like fragments before writing
      if (!/__C(?:START|END)__/.test(remainder)) {
        term.write(remainder);
      }
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        flushRemainder();
      }, 150);
    };

    const dataHandler = ({ id, data }: { id: string; data: string }) => {
      if (id !== terminalIdRef.current) return;

      // Append new data to the line buffer
      const lb = lineBufferRef.current + data;

      // Find the last complete line (boundary at \n)
      const nlIdx = lb.lastIndexOf('\n');
      if (nlIdx === -1) {
        // No complete line yet — check if this partial data looks like
        // a marker fragment (e.g., uid tail) and discard it to prevent
        // garbage text appearing in the visible terminal.
        if (/__C\w*$/.test(lb) || /^\w{3,8}__\r?$/.test(lb)) {
          lineBufferRef.current = '';
        } else {
          lineBufferRef.current = lb;
          scheduleFlush();
        }
        return;
      }

      // Has complete line(s) — cancel any pending delayed flush
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }

      // Extract complete lines (including the terminal \n)
      const completePortion = lb.slice(0, nlIdx + 1);
      lineBufferRef.current = lb.slice(nlIdx + 1);

      // Filter out any line containing AI execution markers
      const cleaned = completePortion
        .split('\n')
        .filter((line) => !line.includes('__CSTART_') && !line.includes('__CEND_'))
        .join('\n');

      if (cleaned) term.write(cleaned);

      // Check remaining buffer for partial marker fragments
      if (lineBufferRef.current.length > 0) {
        if (/__C\w*$/.test(lineBufferRef.current) || /^\w{3,8}__\r?$/.test(lineBufferRef.current)) {
          lineBufferRef.current = '';
        } else {
          // Schedule delayed flush — prompt text after cls won't have \n
          scheduleFlush();
        }
      }
    };
    window.terminalAPI.onData(dataHandler);

    // Focus terminal when ready (fix for frameless window focus)
    requestAnimationFrame(() => {
      term.focus();
    });

    // Also focus when the container is clicked
    const focusTerm = () => term.focus();
    const container = terminalRef.current;
    container.addEventListener('click', focusTerm);

    xtermRef.current = term;

    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      observer.disconnect();
      window.terminalAPI.removeDataListener();
      container.removeEventListener('click', focusTerm);
      term.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [terminalId, theme]);

  return (
    <div className="terminal-pane">
      <div className="terminal-header">
        <span className="terminal-title">⚡ Terminal</span>
        <span className="terminal-hint">Ctrl+L clear</span>
      </div>
      <div
        ref={terminalRef}
        className="terminal-container"
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
};
