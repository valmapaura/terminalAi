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
    const targetId = id || Array.from(this.buffers.keys())[0];
    if (!targetId) return '';

    const buf = this.buffers.get(targetId);
    if (!buf || buf.length === 0) return '(empty)';

    const lines = buf.slice(-lineCount).join('\n');
    return lines;
  }

  /** Execute a command on an EXISTING visible terminal and capture output */
  async executeOnTerminal(id: string, command: string, timeoutMs: number = 30000): Promise<{ output: string; exitCode?: number }> {
    const term = this.terminals.get(id);
    if (!term) {
      // Fall back to hidden execution if no visible terminal
      const result = await this.executeCommand(command);
      return { output: result };
    }

    return new Promise((resolve) => {
      let output = '';
      let timer: ReturnType<typeof setTimeout>;
      let bufferSincePrompt = '';
      let resolved = false;

      // Regex to detect command prompts at end of output
      const promptRegex = /[\\$>#] ?$/m;

      const dataHandler = (data: string) => {
        if (resolved) return;
        output += data;
        bufferSincePrompt += data;

        // Keep only last 200 chars for prompt detection
        if (bufferSincePrompt.length > 200) {
          bufferSincePrompt = bufferSincePrompt.slice(-200);
        }

        // Detect prompt — the command is done when we see a prompt pattern
        // at the end of a non-empty output
        if (bufferSincePrompt.length > 10 && promptRegex.test(bufferSincePrompt.trim())) {
          resolved = true;
          clearTimeout(timer);
          resolve({ output });
        }
      };

      // Use onData (node-pty's typed method) instead of on('data')
      const disp = term.onData(dataHandler);

      // Send the command to the visible terminal
      term.write(command + '\r');

      // Safety timeout
      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          resolve({ output });
        }
      }, timeoutMs);
    });
  }

  /** Execute a command and return output (for AI tool execution) */
  executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
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
        // Stop capturing if we see the prompt again (simple heuristic)
        if (output.length > 5000) {
          clearTimeout(timeout);
          term.kill();
          resolve(output);
        }
      });

      term.onExit(() => {
        clearTimeout(timeout);
        resolve(output);
      });
    });
  }
}
