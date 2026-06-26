/**
 * Debug logger for Terminal AI.
 * 
 * Logs to console AND keeps an in-memory buffer that can be viewed
 * via `window.__AI_LOGS` in DevTools (Ctrl+Shift+I).
 * 
 * To enable verbose logging: localStorage.setItem('DEBUG_AI', 'true')
 * or set it from DevTools.
 */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  data?: unknown;
}

const MAX_LOG_ENTRIES = 2000;
const logBuffer: LogEntry[] = [];

function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('DEBUG_AI') === 'true';
  } catch {
    return false;
  }
}

function addLog(level: LogLevel, category: string, message: string, data?: unknown): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    message,
    data,
  };

  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.shift();
  }

  // Always log errors and warnings; only log info/debug when enabled
  const enabled = level === 'error' || level === 'warn' || isDebugEnabled();

  if (enabled) {
    const d = new Date(entry.timestamp);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    const prefix = `[${hh}:${mm}:${ss}.${ms}] [AI:${category}]`;
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    if (data !== undefined) {
      logFn(prefix, message, data);
    } else {
      logFn(prefix, message);
    }
  }
}

export const logger = {
  info: (category: string, message: string, data?: unknown) => addLog('info', category, message, data),
  warn: (category: string, message: string, data?: unknown) => addLog('warn', category, message, data),
  error: (category: string, message: string, data?: unknown) => addLog('error', category, message, data),
  debug: (category: string, message: string, data?: unknown) => addLog('debug', category, message, data),

  /** Dump all logs to console */
  dump: () => {
    console.group('📋 Terminal AI Debug Logs');
    for (const entry of logBuffer) {
      const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.category}]`;
      if (entry.data !== undefined) {
        console.log(prefix, entry.message, entry.data);
      } else {
        console.log(prefix, entry.message);
      }
    }
    console.groupEnd();
  },

  /** Get all log entries */
  getLogs: (): LogEntry[] => [...logBuffer],

  /** Clear logs */
  clear: () => {
    logBuffer.length = 0;
  },

  /** Enable/disable debug mode */
  setDebug: (enabled: boolean) => {
    try {
      localStorage.setItem('DEBUG_AI', String(enabled));
      if (enabled) {
        // Replay recent logs when enabling
        logBuffer.forEach((entry) => {
          if (entry.level !== 'error' && entry.level !== 'warn') {
            const prefix = `[AI:${entry.category}]`;
            console.log(prefix, entry.message, entry.data ?? '');
          }
        });
      }
    } catch { /* ignore */ }
  },
};

// Expose globally for DevTools
try {
  (window as unknown as Record<string, unknown>).__AI_LOGS = logger;
} catch { /* ignore */ }

// Auto-enable debug if URL hash contains 'debug'
try {
  if (window.location.hash.includes('debug')) {
    logger.setDebug(true);
  }
} catch { /* ignore */ }
