/**
 * Command validator and safety checker for OS Assistant.
 * Analyzes commands before injection to flag dangerous operations.
 */

export interface ValidationResult {
  safe: boolean;
  warnings: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; warning: string; severity: 'high' | 'critical' }> = [
  // ── File deletion / destruction ──
  { pattern: /^del\b/i, warning: 'Deleting files', severity: 'critical' },
  { pattern: /^erase\b/i, warning: 'Erasing files', severity: 'critical' },
  { pattern: /^deltree\b/i, warning: 'Deleting directory tree', severity: 'critical' },
  { pattern: /^rm\b/i, warning: 'Deleting files or directories', severity: 'critical' },
  { pattern: /^rmdir\b/i, warning: 'Removing directories', severity: 'critical' },
  { pattern: /^rd\b/i, warning: 'Removing directories', severity: 'critical' },
  // Forced recursive deletion is extra dangerous (only match flags, not paths)
  { pattern: /\s+\/[fsr]\b/i, warning: 'Recursive/force deletion flag detected', severity: 'critical' },

  // ── Disk / volume operations ──
  { pattern: /^format\b/i, warning: 'Formatting a disk drive — all data will be lost', severity: 'critical' },
  { pattern: /^diskpart\b/i, warning: 'Disk partition tool — can destroy all data on a drive', severity: 'critical' },
  { pattern: /^mkfs/i, warning: 'Creating a filesystem — will overwrite existing data', severity: 'critical' },
  { pattern: /^fdisk/i, warning: 'Disk partitioning tool — can destroy data', severity: 'critical' },
  { pattern: /^dd\b/i, warning: 'Low-level disk copy — can destroy data if misused', severity: 'critical' },

  // ── System-level operations ──
  { pattern: /^shutdown\b/i, warning: 'Shutting down or restarting the system', severity: 'high' },
  { pattern: /^reboot\b/i, warning: 'Rebooting the system', severity: 'high' },
  { pattern: /^poweroff\b/i, warning: 'Powering off the system', severity: 'high' },
  { pattern: /^taskkill\b/i, warning: 'Terminating a process', severity: 'high' },
  { pattern: /^kill\b/i, warning: 'Terminating a process', severity: 'high' },

  // ── Registry operations ──
  { pattern: /^reg\s+delete/i, warning: 'Deleting registry keys', severity: 'critical' },
  { pattern: /^reg\s+add/i, warning: 'Modifying registry keys', severity: 'high' },

  // ── Package / software management ──
  { pattern: /^(choco|winget|scoop|npm|pip)\s+(install|uninstall|remove)\b/i, warning: 'Installing or removing software', severity: 'high' },
  { pattern: /^apt-get\s+(install|remove|purge|autoremove)/i, warning: 'Installing or removing system packages', severity: 'high' },

  // ── Network attacks ──
  { pattern: /^ping\s+-t\s/i, warning: 'Continuous ping — could be used for network flooding', severity: 'high' },
];

const HIGHTLIGHT_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  { pattern: /^net\s+user/i, warning: 'User account management' },
  { pattern: /^sc\s+/i, warning: 'Windows service control' },
  { pattern: /^wmic\s+/i, warning: 'WMI management interface' },
  { pattern: /^powershell/i, warning: 'PowerShell execution' },
];

export function validateCommand(command: string): ValidationResult {
  const trimmed = command.trim();
  const warnings: string[] = [];
  let maxSeverity: 'low' | 'medium' | 'high' | 'critical' = 'low';

  // Check dangerous patterns
  for (const { pattern, warning, severity } of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) {
      warnings.push(`🚨 ${warning}`);
      maxSeverity = severity === 'critical' ? 'critical' : 'high';
    }
  }

  // Check highlighted patterns
  for (const { pattern, warning } of HIGHTLIGHT_PATTERNS) {
    if (pattern.test(trimmed)) {
      warnings.push(`ℹ️ ${warning}`);
      if (maxSeverity === 'low') maxSeverity = 'medium';
    }
  }

  return {
    safe: warnings.length === 0 || maxSeverity === 'low',
    warnings,
    severity: maxSeverity,
  };
}

/**
 * Sanitize a command before injection — trims whitespace and normalizes line endings.
 */
export function sanitizeCommand(command: string): string {
  // Only strip ASCII control characters (NUL, BEL, etc.) — preserve Unicode
  return command
    .trim()
    .replace(/\r?\n/g, '\r\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

/**
 * Check if a tool call involves a dangerous command that should always prompt.
 * Returns the validation result if dangerous, null if safe.
 */
export function checkToolCallForDanger(toolName: string, argsJson: string): ValidationResult | null {
  if (toolName !== 'execute_command' && toolName !== 'inject_terminal') return null;
  let command = '';
  try {
    const args = JSON.parse(argsJson);
    command = (args.command || args.commandLine || '') as string;
  } catch {
    return null;
  }
  if (!command.trim()) return null;
  const result = validateCommand(command);
  // Only flag critical/high severity as dangerous (low/medium are informational)
  if (result.severity === 'critical' || result.severity === 'high') {
    return result;
  }
  return null;
}
