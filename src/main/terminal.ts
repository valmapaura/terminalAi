import * as pty from 'node-pty';
import * as os from 'os';
import { BrowserWindow } from 'electron';

const MAX_BUFFER_LINES = 1000;

export class TerminalManager {
  private terminals: Map<string, pty.IPty> = new Map();
  private buffers: Map<string, string[]> = new Map();
  private lastCreatedTerminalId: string | null = null;

  createTerminal(id: string, win: BrowserWindow): void {
    const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash';
    const shellArgs: string[] = [];

    const term = pty.spawn(shell, shellArgs, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.USERPROFILE || process.env.HOME,
      env: process.env as { [key: string]: string },
    });

    this.buffers.set(id, []);

    term.onData((data: string) => {
      // Append to ring buffer for AI tool access
      const buf = this.buffers.get(id);
      if (buf) {
        const lines = data.split('\n');
        for (const line of lines) {
          if (buf.length >= MAX_BUFFER_LINES) {
            buf.shift();
          }
          buf.push(line);
        }
      }

      if (!win.isDestroyed()) {
        win.webContents.send('terminal-data', { id, data });
      }
    });

    this.lastCreatedTerminalId = id;
    this.terminals.set(id, term);
  }

  /** Get the most recently created terminal ID */
  getLastTerminalId(): string | null {
    return this.lastCreatedTerminalId;
  }

  writeToTerminal(id: string, data: string): void {
    const term = this.terminals.get(id);
    if (term) {
      term.write(data);
    }
  }

  resizeTerminal(id: string, cols: number, rows: number): void {
    const term = this.terminals.get(id);
    if (term) {
      term.resize(cols, rows);
    }
  }

  killTerminal(id: string): void {
    const term = this.terminals.get(id);
    if (term) {
      term.kill();
      this.terminals.delete(id);
    }
    this.buffers.delete(id);
  }

  killAll(): void {
    this.terminals.forEach((term) => term.kill());
    this.terminals.clear();
    this.buffers.clear();
  }

  /** Get all active terminal IDs */
  getAllTerminalIds(): string[] {
    return Array.from(this.terminals.keys());
  }

  /** Get last N lines of terminal output (for AI tool context) */
  getBuffer(id?: string, lineCount: number = 50): string {
    // Prefer the specified ID, then the last created terminal, then the first buffer
    const targetId = id || this.lastCreatedTerminalId || Array.from(this.buffers.keys())[0];
    if (!targetId) return '';

    const buf = this.buffers.get(targetId);
    if (!buf || buf.length === 0) return '(empty)';

    const lines = buf.slice(-lineCount).join('\n');
    // Strip ANSI codes before returning to AI
    return lines.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\u001b\][0-9;]*[a-zA-Z].*?(?:\u001b\\|\u0007)/g, '').replace(/[\u0000-\u001f]/g, '').trim();
  }

  /** Execute a command on an EXISTING visible terminal and capture output */
  async executeOnTerminal(id: string, command: string, timeoutMs: number = 5000): Promise<{ output: string; exitCode?: number }> {
    const term = this.terminals.get(id);
    if (!term) {
      // Fall back to hidden execution if no visible terminal
      const result = await this.executeCommand(command);
      return { output: result };
    }

    return new Promise((resolve) => {
      let output = '';
      // eslint-disable-next-line prefer-const -- timer IS reassigned below (line ~166), const can't be used
      let timer: ReturnType<typeof setTimeout>;
      let resolved = false;
      let startMarkerFound = false;

      // Use unique markers bracketing the command for reliable start/end detection.
      // This avoids fragile prompt-regex matching (which false-matches on %, $, > in Windows output).
      const uid = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const startMarker = `__CSTART_${uid}__`;
      const endMarker = `__CEND_${uid}__`;
      const startLine = `\r\n${startMarker}\r\n`;
      const endLine = `\r\n${endMarker}\r\n`;

      // Shared cleanup: dispose listener + clear timer
      const cleanup = () => {
        resolved = true;
        clearTimeout(timer);
        disp.dispose();
      };

      const dataHandler = (data: string) => {
        if (resolved) return;
        output += data;

        // Look for start marker to begin capturing
        if (!startMarkerFound) {
          const si = output.indexOf(startMarker);
          if (si !== -1) {
            startMarkerFound = true;
            // Keep only content after start marker
            output = output.slice(si + startMarker.length);
          }
          return;
        }

        // Look for end marker to know command completed
        const ei = output.indexOf(endMarker);
        if (ei !== -1) {
          let captured = output.slice(0, ei);
          // Strip ANSI escape codes immediately so IPC payload is smaller
          captured = captured.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\u001b\][0-9;]*[a-zA-Z].*?(?:\u001b\\|\u0007)/g, '').replace(/[\u0000-\u001f]/g, '').trim();
          // Remove prompt suffix artifacts (e.g., "C:\Users\valma>" at end)
          captured = captured.replace(/[A-Z]:\\(?:[^\\>]+\\)*[^\\>]*>\s*$/, '').trim();
          cleanup();
          resolve({ output: captured });
        }
      };

      // Use onData (node-pty's typed method) instead of on('data')
      const disp = term.onData(dataHandler);

      // Send marker-then-command-then-marker sequence
      term.write(startLine + command + endLine);

      // Safety timeout
      timer = setTimeout(() => {
        if (!resolved) {
          cleanup();
          // Return whatever we captured (may be partial)
          let captured = startMarkerFound ? output : '(no output captured before timeout)';
          if (startMarkerFound) {
            captured = captured.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\u001b\][0-9;]*[a-zA-Z].*?(?:\u001b\\|\u0007)/g, '').replace(/[\u0000-\u001f]/g, '').trim();
          }
          resolve({ output: captured });
        }
      }, timeoutMs);
    });
  }

  /** Execute a command and return output (for AI tool execution) */
  executeCommand(command: string): Promise<string> {
    return new Promise((resolve, _reject) => {
      const shell = os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash';
      const shellFlag = os.platform() === 'win32' ? '/c' : '-c';
      const term = pty.spawn(shell, [shellFlag, command], {
        name: 'xterm-256color',
        cols: 120,
        rows: 100,
        cwd: process.env.USERPROFILE || process.env.HOME,
        env: process.env as { [key: string]: string },
      });

      let output = '';
      const timeout = setTimeout(() => {
        term.kill();
        resolve(output || '(command timed out)');
      }, 10000);

      term.onData((data: string) => {
        output += data;
        // Stop capturing if output exceeds limit (truncation guard)
        if (output.length > 100_000) {
          clearTimeout(timeout);
          term.kill();
          resolve(output + '\n...(output truncated at 100KB)');
        }
      });

      term.onExit(() => {
        clearTimeout(timeout);
        resolve(output);
      });
    });
  }
}
