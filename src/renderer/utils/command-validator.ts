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
  // File system destruction
  { pattern: /^del\s+\/f\s+\/s/i, warning: 'Force-deleting all matching files recursively', severity: 'critical' },
  { pattern: /^rd\s+\/s/i, warning: 'Removing a directory and all its contents recursively', severity: 'critical' },
  { pattern: /^rmdir\s+\/s/i, warning: 'Removing a directory tree', severity: 'critical' },
  { pattern: /^format\s/i, warning: 'Formatting a disk drive — all data will be lost', severity: 'critical' },
  { pattern: /^diskpart/i, warning: 'Disk partition tool — can destroy all data on a drive', severity: 'critical' },

  // System-level operations
  { pattern: /^shutdown\s/i, warning: 'Shutting down or restarting the system', severity: 'high' },
  { pattern: /^taskkill\s+\/f/i, warning: 'Force-killing a process', severity: 'high' },
  { pattern: /^reg\s+delete/i, warning: 'Deleting registry keys', severity: 'critical' },

  // Network attacks (likely malicious)
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
  return command
    .trim()
    .replace(/\r?\n/g, '\r\n')
    .replace(/[^\x20-\x7E\r\n]/g, '');
}
