/**
 * Universal AI Provider API client for OS Assistant.
 *
 * Supports OpenAI-compatible, Anthropic Claude, and Google Gemini
 * — all with tool calling. Like VS Code Copilot, which supports
 * multiple model providers.
 *
 * To add a new provider: add a case to streamChatCompletion()
 * and implement the streaming function below.
 */

import type { ChatMessage, ToolCall, AIProviderType, ProviderConfig, SystemInfo } from '../types';
import { logger } from './logger';

export interface ToolCallPayload {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * Tool definitions for the AI assistant — full computer operations.
 * Like VS Code Copilot's tool system, but focused on system administration.
 */
export const AI_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Run a command in the terminal and return its output. Use this as your PRIMARY tool for ALL system operations. The command runs in the visible terminal so the user can see it execute. The output is captured and returned to you. Supports: networking (ping, ipconfig, netstat, nslookup, curl), disk/file operations (dir/ls, find/findstr/grep, df/du/chkdsk), process management (ps/tasklist, kill/taskkill, wmic), recovery (cls, taskkill, Ctrl+C via echo), system info (uname/systeminfo, neofetch/ver), and more. IMPORTANT: When the user asks you to check something or perform an operation, call this tool — use good judgment and ask clarifying questions when something is ambiguous. Call this tool multiple times if needed for different commands.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of what this command does and why',
          },
        },
        required: ['command', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inject_terminal',
      description: 'Type a command directly into the VISIBLE terminal pane and press Enter. Use this when you want the user to SEE the command being executed in the terminal (like showing them how to do something), or to send Ctrl+C/interrupt to a stuck process. The command runs in the user\'s visible terminal, not a hidden one.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to type into the visible terminal',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of what this command does and why',
          },
        },
        required: ['command', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_terminal_output',
      description: 'Read the last N lines of terminal output. Use this to see command results, error messages, or current directory after running a command.',
      parameters: {
        type: 'object',
        properties: {
          lines: {
            type: 'number',
            description: 'Number of recent lines to read (default 30, max 200)',
          },
        },
        required: ['lines'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a text file from the filesystem. Use this to inspect log files, configuration files, scripts, or any other text file on the system.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Full absolute path to the file (e.g., C:\\Users\\... on Windows, /home/... on Linux/Mac)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory. Use this to explore the filesystem, find files, or check directory structure.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Full absolute path to the directory (e.g., C:\\Users\\... on Windows, /home/... on Linux/Mac)',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'measure_bandwidth',
      description: 'Measure internet download speed using curl. Downloads a test file and reports speed in Mbps. Uses curl which is native on Windows — prefer this over PowerShell download methods which are fragile on this system.',
      parameters: {
        type: 'object',
        properties: {
          serverUrl: {
            type: 'string',
            description: 'Optional. Speed test server URL. Defaults to http://speedtest.tele2.net/10MB.zip (10MB file for accurate measurement)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_note',
      description: 'Save a note to persistent memory. Use this to remember important facts about this computer, the user\'s preferences, network configurations, or anything you want to recall in future conversations. Notes persist across chat sessions.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'A descriptive key for the note (e.g., "user-preferences", "network-config", "issue-notes")',
          },
          value: {
            type: 'string',
            description: 'The note content to remember',
          },
        },
        required: ['key', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_notes',
      description: 'Read saved notes from persistent memory. DO NOT call this unless the user explicitly asks about saved notes or previous context. Never call it automatically at conversation start.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_note',
      description: 'Delete a specific note from persistent memory.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: 'The key of the note to delete',
          },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a text file. Creates the file if it doesn\'t exist, overwrites if it does. Use this to create new files, save generated code, apply configuration changes, or write scripts. The parent directory must already exist.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Full absolute path to the file (e.g., C:\\Users\\... on Windows, /home/... on Linux/Mac)',
          },
          content: {
            type: 'string',
            description: 'The full content to write to the file',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of what this write accomplishes',
          },
        },
        required: ['path', 'content', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Make a targeted find-and-replace edit in an existing text file. Reads the file, replaces the FIRST occurrence of oldText with newText, and writes the file back. Returns a diff summary. Use this for surgical changes to config files, scripts, or code without rewriting the entire file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Full absolute path to the file (e.g., C:\\Users\\... on Windows, /home/... on Linux/Mac)',
          },
          oldText: {
            type: 'string',
            description: 'The exact text to search for — must match exactly including whitespace and indentation',
          },
          newText: {
            type: 'string',
            description: 'The replacement text',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of what this edit does',
          },
        },
        required: ['path', 'oldText', 'newText', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file from the filesystem. Permanently removes the file. Use this to clean up temporary files, remove old logs, or delete unwanted configuration files. Directories cannot be deleted with this tool — use execute_command with rm/Remove-Item for directories.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Full absolute path to the file to delete',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of why this file is being deleted',
          },
        },
        required: ['path', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_directory',
      description: 'Create a directory (and any missing parent directories) using Node.js fs. Use this to set up folder structures for projects, organize files, or create output directories. Unlike execute_command mkdir, this works silently without cluttering the visible terminal.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Full absolute path to the directory to create (e.g., C:\\Users\\...\\new-folder on Windows)',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of what this directory is for',
          },
        },
        required: ['path', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'copy_file',
      description: 'Copy a file from source to destination using Node.js fs. Use this to duplicate files, back up configuration, or copy templates. Directories cannot be copied with this tool — use execute_command for recursive directory copies.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Full absolute path to the source file',
          },
          destination: {
            type: 'string',
            description: 'Full absolute path to the destination (including filename)',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of why this file is being copied',
          },
        },
        required: ['source', 'destination', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_file',
      description: 'Move or rename a file using Node.js fs. Use this to reorganize files, rename configuration, or move files between directories. Works for both moving and renaming. Directories cannot be moved with this tool — use execute_command with mv/Move-Item for directories.',
      parameters: {
        type: 'object',
        properties: {
          source: {
            type: 'string',
            description: 'Full absolute path to the current file location',
          },
          destination: {
            type: 'string',
            description: 'Full absolute path to the new file location (including new filename)',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of why this file is being moved/renamed',
          },
        },
        required: ['source', 'destination', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_in_files',
      description: 'Search for a text pattern in files under a directory. Recursively walks the directory (up to 10 levels deep), reads text files, and returns matching lines with file paths and line numbers. Case-insensitive. Max 50 results, skips dot-directories and binary files over 512KB.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Full absolute path to the root directory to search in',
          },
          pattern: {
            type: 'string',
            description: 'The text pattern to search for (case-insensitive)',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of what you are searching for and why',
          },
        },
        required: ['path', 'pattern', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_url',
      description: 'Fetch a URL and return its content as text. Use this to retrieve web pages, API responses, documentation, or any online resource. Returns up to 100KB of content. Supports http and https URLs. Timeout after 15 seconds.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to fetch (e.g., https://example.com/page)',
          },
          description: {
            type: 'string',
            description: 'Brief explanation of why this URL is being fetched',
          },
        },
        required: ['url', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_system_info',
      description: 'Get detailed system information: OS name and version, architecture, shell type, PowerShell version, username, hostname, CPU model, RAM, and CPU core count. Use this when you need to understand the user\'s system environment — e.g., to determine available tools, file paths, or platform-specific behavior. Returns structured data without running any terminal commands.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Brief explanation of why you need system info',
          },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scan_wifi',
      description: 'Scan for nearby Wi-Fi networks and return a list with SSID, signal strength (%), channel, authentication type, encryption, and BSSID. Uses netsh to perform the scan. Use this to check available networks, find the best signal, diagnose connectivity issues, or verify network bands (2.4GHz vs 5GHz). Requires Wi-Fi adapter to be enabled.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Brief explanation of why you are scanning Wi-Fi',
          },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'monitor_hardware',
      description: 'Get real-time hardware monitoring data: CPU usage (%), CPU temperature (°C, if sensors available), memory usage (total/used/free), disk usage (per drive), and system uptime. Uses WMI and PowerShell to query live sensor data. Use this to diagnose performance issues, overheating, memory pressure, or disk space concerns. Some metrics (like CPU temp) may not be available on all hardware — the tool reports what it can.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Brief explanation of why you are monitoring hardware',
          },
        },
        required: ['description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'process_tree',
      description: 'Get a hierarchical tree view of all running processes showing parent-child relationships. For each process includes: PID, name, parent PID, CPU time, memory usage (MB), and command line. Uses WMI to query process data and builds the tree on the server side. Use this to understand process ancestry, find resource-hungry sub-processes, diagnose orphaned processes, or explore what\'s running on the system.',
      parameters: {
        type: 'object',
        properties: {
          description: {
            type: 'string',
            description: 'Brief explanation of why you need the process tree',
          },
        },
        required: ['description'],
      },
    },
  },
];

/**
 * Build the system prompt for OS Assistant.
 * VS Code Copilot-aligned: concise identity, tool-centric, action-oriented.
 * No conflicting rules — the AI is told to act, not to hesitate.
 */
export function buildSystemPrompt(providerName?: string, systemInfo?: SystemInfo): string {
  // Derive OS label from system info or default gracefully
  const osName = systemInfo?.os || 'your';
  const shellLabel = systemInfo?.shell || 'terminal';
  const psLabel = systemInfo?.powershellVersion
    ? `\nPowerShell ${systemInfo.powershellVersion}`
    : '';

  const context = systemInfo
    ? `\nSystem context:\n${osName} | ${systemInfo.architecture} | Shell: ${shellLabel}${psLabel} | User: ${systemInfo.username} | ${systemInfo.cpu} | ${systemInfo.totalRamGB} GB RAM`
    : '';

  return `You are a helpful ${osName} terminal assistant with access to tools.${context}

Your job is to get things done — quickly and reliably.

## Core Behavior
- Say hello back, answer simple questions, and jump straight into action when a task is asked.
- Use tools right away for actions or system inspection — act decisively but use good judgment.
- If something is ambiguous or could cause trouble, ask a quick clarifying question first.
- Never claim to have done something without tool results, and never make up command output or file contents.
- Reach for the most specific tool first. Fall back to \`execute_command\` when nothing else fits.

## Windows-Specific Guidance
- **On Windows, always prefer \`curl\` over PowerShell for HTTP/download tasks.** \`curl\` is natively available on this system (curl 8.x) and produces reliable output. PowerShell one-liners with \`net.webclient\`, \`Invoke-WebRequest\`, or \`[diagnostics.stopwatch]\` are fragile on Windows and often fail with encoding or timing errors.
- For bandwidth/speed tests, use the dedicated \`measure_bandwidth\` tool which handles curl flags and output parsing correctly.
- For simple connectivity checks, \`ping -n 3 google.com\` or \`curl -s --connect-timeout 5 --max-time 10 -o NUL -w "%{http_code}" http://example.com\`.
- Keep commands simple — avoid long compound PowerShell one-liners.

## File Operations (CRUD)
- Use \`read_file\` to inspect any text file, \`write_file\` to create or overwrite files, \`edit_file\` for surgical find-and-replace edits (first occurrence only), and \`delete_file\` to remove files.
- These tools use Node.js fs directly — no shell, no encoding issues. Prefer them over \`execute_command\` with PowerShell for any file read/write/edit/delete task.
- For \`edit_file\`, include enough surrounding context in \`oldText\` to uniquely identify the target (at least 2-3 lines). The match is exact and case-sensitive.
- \`write_file\` overwrites the entire file — use \`edit_file\` if you only need to change part of a file.
- Sensitive system files (keys, .env, etc.) are blocked for safety.
- Creating files in directories that don't exist yet will fail — create the directory first.

## Visible Terminal Workflow (TRANSPARENCY)
- The \`execute_command\` tool runs commands in the **visible terminal** so the user can watch in real-time.
- The user sees every command you type and every result.
- For multi-step interactive workflows (e.g., \`cd\` then \`git status\`), use \`execute_command\` for each step — the terminal keeps its state between calls.
- Use \`inject_terminal\` to type a command into the visible terminal without capturing output.
- Use \`read_terminal_output\` to peek at recent terminal buffer.
- If the terminal appears stuck or unresponsive, use \`execute_command\` with a simple probe like \`echo "ready"\` or call \`execute_command\` with a fresh command — the terminal reset mechanism will automatically recover.

## Process & Terminal Recovery (CRITICAL)
Things can go wrong — stuck processes, messy terminals, orphaned jobs. Here's your recovery toolkit:

### 🧹 Clearing the Terminal
- \`cls\` — clears the visible terminal screen when it's cluttered. Run it as a regular \`execute_command\`.
- After clearing, the terminal state (current directory, env vars) is preserved.

### ⏹️ Stopping Stuck / Hung Processes
- **Ctrl+C equivalent**: Use \`execute_command\` with a simple command like \`echo done\` — the terminal reset mechanism will automatically break out of stuck states.
- List running processes: \`tasklist /FI "STATUS eq running"\` (Windows) or list specific processes: \`tasklist /FI "IMAGENAME eq node.exe"\`.
- Kill by PID: \`taskkill /F /PID 1234\` (forceful) or \`taskkill /PID 1234\` (graceful).
- Kill by name: \`taskkill /F /IM node.exe\` or \`taskkill /F /IM python.exe\`.
- **Process termination for recovery purposes is allowed without extra confirmation** — the user wants you to clean things up.

### 🔄 Recovering the Terminal
If the terminal is in a weird state (stuck at a prompt, half-executed command, etc.):
1. First try \`echo ready\` — this usually unsticks it.
2. If that doesn't work, try \`cd .\` (no-op that resets state).
3. If still stuck, send Ctrl+C via inject_terminal: \`inject_terminal\` with command being just an empty/space (sends Enter), then another with \`cls\`.
4. Worst case: the terminal auto-recovers on the next \`execute_command\` — the system detects stuck states and resets automatically.

### 🗑️ Orphaned / Background Processes
- Sometimes processes linger after the terminal moves on. Check with \`tasklist | findstr node\` or similar.
- Kill orphans aggressively — they consume resources. Use \`taskkill /F /IM <name>\`.
- Common orphans to watch for: \`node.exe\`, \`python.exe\`, \`java.exe\`, \`npm\`, \`npx\`.

### 🚀 Starting Fresh
- When the user says "start fresh", "reset", or things are too messy:
  1. Clear the screen: \`cls\`
  2. Check current dir: \`cd\` or \`echo %cd%\`
  3. Kill any obvious orphaned build/dev processes if present
  4. Report back that the terminal is clean and ready

## Multi-Step Reasoning (CRITICAL)
- When given a complex request, break it down into logical steps and work through them one at a time.
- Think ahead about what information you'll need and gather it early.
- **Combine steps where possible** — e.g., to get weather you need location first: use one \`curl -s --connect-timeout 5 --max-time 15 ip-api.com/json\` to get location, then immediately fetch weather in the same cycle. When multiple independent pieces of data are needed, prefer a single compound command (piped or chained) over separate tool calls to save rounds.
- Example: "what's the weather?" → figure out user's location via curl → use the result to fetch weather → present answer in as few tool rounds as possible.
- Don't give up if the first approach fails — try a different approach. If one tool doesn't work, try another.
- Only tell the user you can't do something AFTER you've exhausted all reasonable approaches.

## Error Recovery
- If a tool fails, study the error carefully, adjust your approach, and retry.
- Never repeat the exact same failing call — change something.
- If a command times out, try a simpler or faster approach.
- For \`execute_command\`, always add timeouts to network commands (e.g., use \`curl -s --connect-timeout 5 --max-time 15\` instead of plain \`curl -s\`) so responses come back quickly even if servers are slow.
- For long-running commands, capture what you need and move on — don't wait for every last byte.
- If \`read_terminal_output\` returns empty, the command output was already captured by \`execute_command\` — just use the result you already have.

## Pacing
- Allow adequate time between tool calls. A minimum gap is enforced by the system, so don't rush.
- After a command completes, wait for the result before making the next tool call.
- Don't call \`read_terminal_output\` immediately after \`execute_command\` — the output is already captured in the \`execute_command\` result.

## Safety — Destructive Commands
> ⚠️ **CRITICAL: Destructive operations MUST be confirmed with the user first.**

- **Any command that deletes, removes, overwrites, formats, wipes, or destroys data** — including but not limited to \`rm\`, \`del\`, \`rd/rmdir\`, \`format\`, \`diskpart\`, \`dd\`, \`mkfs\`, \`> /dev/null\` tricks, registry edits (\`reg delete\`), or recursive force deletions — **requires explicit user confirmation before execution**.
- Similarly, installing or uninstalling software requires confirmation.
- **Process termination is allowed without confirmation when it's clearly recovery or cleanup** (stuck builds, hung apps, orphaned processes). Use good judgment — killing a random system process still needs confirmation.
- Don't access saved notes unless the user asks.
- If a request is unsafe or impossible, explain why and do what you safely can.

## Style
- Be concise but friendly — one or two sentences usually does it.
- It's okay to use emoji now and then if it fits the tone.
- Don't introduce yourself every time — just jump in.`;
}

// ── Context window management ──

const CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_CONTEXT_TOKENS = 128000;
const MAX_TOOL_CONTENT_TOKENS = 6000; // truncate oversized tool results (~24K chars)

/**
 * Rough token estimate for a text string (~4 chars per token for English).
 */
export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens used by a single message (content + metadata overhead).
 */
function estimateMessageTokens(msg: ChatMessage): number {
  let total = estimateTokens(msg.content || '');
  total += 4; // role + formatting overhead
  if (msg.toolCallId) total += 3;
  if (msg.toolName) total += 2;
  if (msg.toolCalls) {
    total += estimateTokens(JSON.stringify(msg.toolCalls));
  }
  return total;
}

/**
 * Truncate oversized tool result content in-place so we don't
 * have to drop entire messages (which would orphan parent tool_calls).
 */
function truncateLargeToolResults(messages: ChatMessage[]): void {
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.content) {
      const tokens = estimateTokens(msg.content);
      if (tokens > MAX_TOOL_CONTENT_TOKENS) {
        const maxLen = MAX_TOOL_CONTENT_TOKENS * CHARS_PER_TOKEN;
        msg.content = msg.content.slice(0, maxLen) +
          `\n...(truncated from ~${tokens} tokens to ${MAX_TOOL_CONTENT_TOKENS})`;
      }
    }
  }
}

/**
 * Remove any tool_calls messages that would orphan their tool results,
 * and any tool result messages whose parent tool_calls got removed.
 * Operates on the array in-place for performance.
 */
function removeOrphanedToolMessages(messages: ChatMessage[]): void {
  // Collect all tool_call_ids that have a matching tool result
  const toolResultIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId) {
      toolResultIds.add(msg.toolCallId);
    }
  }

  // Collect all tool_call_ids referenced by assistant tool_calls
  const toolCallIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        if (tc.id) toolCallIds.add(tc.id);
      }
    }
  }

  // For each assistant with tool_calls, check if ALL its tool calls have results
  // If any are missing, drop the entire assistant message (tool calls without results cause 400 errors)
  const assistantIdsToRemove = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.toolCalls && msg.id) {
      for (const tc of msg.toolCalls) {
        if (tc.id && !toolResultIds.has(tc.id)) {
          assistantIdsToRemove.add(msg.id);
          break;
        }
      }
    }
  }

  // Remove orphaned tool results (results whose parent tool_calls got removed)
  const toolIdsToRemove = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.toolCallId && !toolCallIds.has(msg.toolCallId)) {
      toolIdsToRemove.add(msg.id);
    }
  }

  // Filter out everything marked for removal
  if (assistantIdsToRemove.size > 0 || toolIdsToRemove.size > 0) {
    let removedCount = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (assistantIdsToRemove.has(msg.id) || toolIdsToRemove.has(msg.id)) {
        messages.splice(i, 1);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      console.warn(`[TRIM] Removed ${removedCount} orphaned tool-related message(s) to prevent 400 errors`);
    }
  }
}

/**
 * Trim messages to fit within the model's context window.
 * First truncates oversized tool content, then trims oldest messages.
 * Ensures no assistant message with tool_calls is left without its tool results.
 * Always keeps at least the last message.
 *
 * @param messages - Full message array
 * @param systemPromptTokens - Token count of the system prompt (already accounted for)
 * @param maxContextTokens - Total context window (default 128K for DeepSeek)
 */
export function trimMessagesForContextWindow(
  messages: ChatMessage[],
  systemPromptTokens: number,
  maxContextTokens: number = DEFAULT_MAX_CONTEXT_TOKENS
): ChatMessage[] {
  if (messages.length <= 1) return messages;

  // Step 1: Truncate oversized tool result content (preserves message structure)
  truncateLargeToolResults(messages);

  // Step 2: Walk newest→oldest, collect what fits
  const maxMsgTokens = maxContextTokens - systemPromptTokens;
  if (maxMsgTokens <= 0) return messages;

  let totalTokens = 0;
  const keep: ChatMessage[] = [];

  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(messages[i]);
    if (totalTokens + tokens <= maxMsgTokens) {
      keep.unshift(messages[i]);
      totalTokens += tokens;
    } else {
      break;
    }
  }

  // Always keep at least the last message
  if (keep.length === 0 && messages.length > 0) {
    keep.push(messages[messages.length - 1]);
  }

  // Step 3: Remove any orphaned tool messages
  removeOrphanedToolMessages(keep);

  return keep;
}

/**
 * Validate message array before sending to the API.
 * Returns true if valid, false if problems were found and fixed.
 */
export function validateAndFixMessages(messages: ChatMessage[]): boolean {
  const before = messages.length;
  removeOrphanedToolMessages(messages);
  return messages.length === before;
}

/**
 * Convert our internal messages to OpenAI-compatible format.
 */
function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    // For assistant messages with tool_calls, content MUST be null (not empty string)
    // to avoid API validation errors with some providers
    const content = (m.role === 'assistant' && m.toolCalls && !m.content) ? null : m.content;
    const base: Record<string, unknown> = { role: m.role, content };
    if (m.toolCallId) base.tool_call_id = m.toolCallId;
    if (m.role === 'assistant' && m.toolCalls) {
      base.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    return base;
  });
}

/**
 * Convert our messages to Anthropic Claude format.
 */
function toAnthropicMessages(messages: ChatMessage[]): { messages: Record<string, unknown>[]; system?: string } {
  const systemMsgs = messages.filter((m) => m.role === 'system');
  const system = systemMsgs.map((m) => m.content).join('\n');

  const apiMessages = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: m.toolCallId,
              content: m.content,
            },
          ],
        };
      }
      if (m.toolCalls && m.role === 'assistant') {
        return {
          role: 'assistant',
          content: [
            { type: 'text', text: m.content || '' },
            ...m.toolCalls.map((tc) => {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.function.arguments || '{}');
              } catch {
                logger.warn('ANTHROPIC', `Failed to parse tool arguments for ${tc.function.name}: ${(tc.function.arguments || '').slice(0, 100)}`);
                parsedArgs = { _parseError: true, raw: (tc.function.arguments || '').slice(0, 500) };
              }
              return {
                type: 'tool_use',
                id: tc.id,
                name: tc.function.name,
                input: parsedArgs,
              };
            }),
          ],
        };
      }
      return { role: m.role, content: m.content };
    });

  return { messages: apiMessages, system };
}

/**
 * Stream a chat completion from any supported provider.
 */
export async function streamChatCompletion(
  provider: ProviderConfig,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  systemPrompt: string,
  onDelta: (content: string, toolCalls: ToolCall[], reasoning?: string) => void,
  signal?: AbortSignal
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string; reasoning?: string }> {
  const { type, apiKey, baseUrl, model } = provider;

  logger.info('CHAT', `Selected provider: ${type}, model: ${model}, baseUrl: ${baseUrl}, hasApiKey: ${!!apiKey}`);
  logger.info('CHAT', `Total messages: ${messages.length}, last message: "${(messages[messages.length - 1]?.content || '(empty)').slice(0, 100)}"`);

  switch (type) {
    case 'anthropic':
      return streamAnthropic(apiKey, baseUrl, model, messages, tools, systemPrompt, onDelta, signal);
    case 'google':
      return streamGoogle(apiKey, baseUrl, model, messages, tools, systemPrompt, onDelta, signal);
    default:
      return streamOpenAICompatible(type, apiKey, baseUrl, model, messages, tools, systemPrompt, onDelta, signal);
  }
}

/**
 * OpenAI-compatible providers: OpenAI, Azure OpenAI, Custom.
 */
async function streamOpenAICompatible(
  type: AIProviderType,
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  systemPrompt: string,
  onDelta: (content: string, toolCalls: ToolCall[], reasoning?: string) => void,
  signal?: AbortSignal
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string; reasoning?: string }> {
  const url = type === 'azure'
    ? `${baseUrl}/openai/deployments/${model}/chat/completions?api-version=2024-08-01-preview`
    : `${baseUrl}/chat/completions`;

  const maskedKey = apiKey ? apiKey.slice(0, 8) + '...' + apiKey.slice(-4) : '(empty)';

  // ── Auth key debug ──
  logger.info('AUTH', `streamOpenAICompatible: type=${type}, keyLen=${apiKey.length}, startsWithSk=${apiKey.startsWith('sk-')}, endsWithNewline=${apiKey.endsWith('\n')}, endsWithCR=${apiKey.endsWith('\r')}, endsWithSpace=${apiKey.endsWith(' ')}, printable=${/^[\x20-\x7E]+$/.test(apiKey)}, charCodes=[${apiKey.slice(0, 10).split('').map(c => c.charCodeAt(0)).join(',')}]`);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (type === 'azure') {
    headers['api-key'] = apiKey;
    logger.info('AUTH', `Azure auth: api-key header set, len=${apiKey.length}`);
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
    const authHeaderPrefix = headers['Authorization'].slice(0, 25);
    const authHeaderSuffix = headers['Authorization'].slice(-5);
    logger.info('AUTH', `OpenAI auth: Authorization header="${authHeaderPrefix}...${authHeaderSuffix}", headerLen=${headers['Authorization'].length}`);
  }

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...toOpenAIMessages(messages),
  ];

  // ── Log the outgoing request ──
  const bodyPreview = {
    model,
    messageCount: apiMessages.length,
    systemPrompt: systemPrompt.slice(0, 200) + (systemPrompt.length > 200 ? '...' : ''),
    lastUserMessage: [...apiMessages].reverse().find((m: Record<string, unknown>) => m.role === 'user')?.content,
    toolCount: tools.length,
  };
  logger.info('API', `→ POST ${url}`, { model, headers: { ...headers, Authorization: `Bearer ${maskedKey}` }, body: bodyPreview });

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: apiMessages,
      tools: tools as unknown as Record<string, unknown>[],
      tool_choice: 'auto',
      stream: true,
    }),
    signal,
  });

  logger.info('API', `← Response status: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    logger.error('API', `API error (${response.status})`, { errorText: errText.slice(0, 500) });
    throw new Error(`API error (${response.status}): ${errText || response.statusText}`);
  }

  return parseOpenAIStream(response, onDelta);
}

/**
 * Parse an SSE stream from an OpenAI-compatible API.
 * Handles reasoning_content (DeepSeek R1, OpenAI o1, etc.)
 */
async function parseOpenAIStream(
  response: Response,
  onDelta: (content: string, toolCalls: ToolCall[], reasoning?: string) => void
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string; reasoning?: string }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream');

  let content = '';
  const pendingToolCalls: ToolCall[] = [];
  let finishReason = '';
  let reasoning = '';
  let chunkCount = 0;
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') {
        logger.debug('STREAM', '← [DONE] signal received');
        continue;
      }

      try {
        const parsed = JSON.parse(data);
        chunkCount++;
        const delta = parsed.choices?.[0]?.delta || {};

        // Log every 10th chunk or first chunk or if it has interesting data
        if (chunkCount === 1 || chunkCount % 50 === 0 || delta.reasoning_content || parsed.choices?.[0]?.finish_reason) {
          logger.debug('STREAM', `← chunk #${chunkCount}`, {
            content: delta.content ? delta.content.slice(0, 100) : '',
            reasoningContent: delta.reasoning_content ? delta.reasoning_content.slice(0, 100) : '',
            toolCalls: delta.tool_calls ? `[${delta.tool_calls.length} tool call parts]` : undefined,
            finishReason: parsed.choices?.[0]?.finish_reason,
          });
        }

        if (delta.content) {
          content += delta.content;
        }

        // Capture reasoning content (DeepSeek R1, OpenAI o1, etc.)
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.index !== undefined) {
              if (!pendingToolCalls[tc.index]) {
                pendingToolCalls[tc.index] = {
                  id: tc.id || `tool-call-${tc.index}`,
                  type: 'function',
                  function: { name: tc.function?.name || '', arguments: tc.function?.arguments || '' },
                };
              } else {
                if (tc.function?.arguments) {
                  pendingToolCalls[tc.index].function.arguments += tc.function.arguments;
                }
                if (tc.function?.name) pendingToolCalls[tc.index].function.name = tc.function.name;
                if (tc.id) pendingToolCalls[tc.index].id = tc.id;
              }
            }
          }
        }

        const validToolCalls = pendingToolCalls.filter(Boolean);
        onDelta(content, validToolCalls, reasoning);

        if (parsed.choices?.[0]?.finish_reason) {
          finishReason = parsed.choices[0].finish_reason;
          logger.info('STREAM', `← finish_reason: ${finishReason} after ${chunkCount} chunks`);
        }
      } catch {
        // skip malformed JSON
      }
    }
  }

  const validToolCalls = pendingToolCalls.filter(Boolean);
  logger.info('STREAM', `← Stream complete`, {
    totalChunks: chunkCount,
    contentLength: content.length,
    contentPreview: content.slice(0, 200),
    toolCallCount: validToolCalls.length,
    finishReason,
    hasReasoning: !!reasoning,
  });
  return { content, toolCalls: validToolCalls, finishReason, reasoning: reasoning || undefined };
}

/**
 * Anthropic Claude streaming.
 */
async function streamAnthropic(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  systemPrompt: string,
  onDelta: (content: string, toolCalls: ToolCall[]) => void,
  signal?: AbortSignal
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
  const { messages: anthropicMsgs, system } = toAnthropicMessages([
    { id: 'system', role: 'system', content: systemPrompt, timestamp: Date.now() },
    ...messages,
  ]);

  logger.info('ANTHROPIC', `→ POST ${baseUrl}/messages`, {
    model,
    hasSystem: !!system,
    messageCount: anthropicMsgs.length,
    lastMsgRole: anthropicMsgs[anthropicMsgs.length - 1]?.role,
    lastMsgContent: (anthropicMsgs[anthropicMsgs.length - 1]?.content as string || '').slice(0, 100),
  });

  const response = await fetch(`${baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: anthropicMsgs,
      tools: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: t.function.parameters,
      })),
      stream: true,
    }),
    signal,
  });

  logger.info('ANTHROPIC', `← Status: ${response.status}`);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    logger.error('ANTHROPIC', `API error (${response.status})`, errText.slice(0, 500));
    throw new Error(`API error (${response.status}): ${errText || response.statusText}`);
  }

  return parseAnthropicStream(response, onDelta);
}

/**
 * Parse Anthropic SSE stream.
 */
async function parseAnthropicStream(
  response: Response,
  onDelta: (content: string, toolCalls: ToolCall[]) => void
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream');

  let content = '';
  const pendingToolCalls: ToolCall[] = [];
  let finishReason = '';
  let currentToolIndex = 0;
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const eventType = parsed.type;

        if (eventType === 'content_block_delta') {
          if (parsed.delta?.type === 'text_delta') {
            content += parsed.delta.text || '';
          }
          if (parsed.delta?.type === 'input_json_delta') {
            if (pendingToolCalls[currentToolIndex]) {
              pendingToolCalls[currentToolIndex].function.arguments += parsed.delta.partial_json || '';
            }
          }
        } else if (eventType === 'content_block_start') {
          if (parsed.content_block?.type === 'tool_use') {
            pendingToolCalls.push({
              id: parsed.content_block.id,
              type: 'function',
              function: {
                name: parsed.content_block.name || '',
                arguments: '',
              },
            });
            currentToolIndex = pendingToolCalls.length - 1;
          }
        } else if (eventType === 'message_delta') {
          if (parsed.delta?.stop_reason === 'tool_use' || parsed.delta?.stop_reason === 'end_turn') {
            finishReason = parsed.delta.stop_reason;
          }
        } else if (eventType === 'message_stop') {
          finishReason = finishReason || 'stop';
        }

        onDelta(content, pendingToolCalls.filter(Boolean));
      } catch {
        // skip
      }
    }
  }

  return {
    content,
    toolCalls: pendingToolCalls.filter(Boolean),
    finishReason: finishReason || 'stop',
  };
}

/**
 * Google Gemini streaming.
 */
async function streamGoogle(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  systemPrompt: string,
  onDelta: (content: string, toolCalls: ToolCall[]) => void,
  signal?: AbortSignal
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
  // Convert to Gemini format
  const geminiContents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      const role = m.role === 'assistant' ? 'model' : m.role === 'tool' ? 'user' : 'user';
      const parts: Record<string, unknown>[] = [];
      if (m.content) parts.push({ text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || '{}');
          } catch {
            logger.warn('GEMINI', `Failed to parse tool arguments for ${tc.function.name}: ${(tc.function.arguments || '').slice(0, 100)}`);
            parsedArgs = { _parseError: true, raw: (tc.function.arguments || '').slice(0, 500) };
          }
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: parsedArgs,
            },
          });
        }
      }
      if (m.toolCallId) {
        parts.push({
          functionResponse: {
            name: m.toolName || 'unknown',
            response: { content: m.content },
          },
        });
      }
      return { role, parts };
    });

  const geminiTools = tools.map((t) => ({
    functionDeclarations: [{
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }],
  }));

  const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse`;

  logger.info('GEMINI', `→ POST ${url}`, {
    model,
    contentsCount: geminiContents.length,
    lastRole: geminiContents[geminiContents.length - 1]?.role,
    hasTools: geminiTools.length > 0,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
    body: JSON.stringify({
      contents: geminiContents,
      systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      tools: geminiTools,
    }),
    signal,
  });

  logger.info('GEMINI', `← Status: ${response.status}`);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    logger.error('GEMINI', `API error (${response.status})`, errText.slice(0, 500));
    throw new Error(`API error (${response.status}): ${errText || response.statusText}`);
  }

  return parseGoogleStream(response, onDelta);
}

/**
 * Parse Google Gemini SSE stream.
 */
async function parseGoogleStream(
  response: Response,
  onDelta: (content: string, toolCalls: ToolCall[]) => void
): Promise<{ content: string; toolCalls: ToolCall[]; finishReason: string }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response stream');

  let content = '';
  const pendingToolCalls: ToolCall[] = [];
  let finishReason = '';
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const candidates = parsed.candidates;
        if (!candidates || !candidates[0]) continue;

        const parts = candidates[0].content?.parts || [];
        if (parts.length === 0) continue;

        for (const part of parts) {
          if (part.text) {
            content += part.text;
            onDelta(content, []);
          }

          if (part.functionCall) {
            pendingToolCalls.push({
              id: `fc-${Date.now()}-${pendingToolCalls.length}`,
              type: 'function',
              function: {
                name: part.functionCall.name || '',
                arguments: JSON.stringify(part.functionCall.args || {}),
              },
            });
            onDelta(content, pendingToolCalls.filter(Boolean));
          }
        }

        if (candidates[0]?.finishReason) {
          finishReason = mapGoogleFinishReason(candidates[0].finishReason);
        }
      } catch {
        // skip
      }
    }
  }

  return {
    content,
    toolCalls: pendingToolCalls.filter(Boolean),
    finishReason: finishReason || 'stop',
  };
}

function mapGoogleFinishReason(reason: string): string {
  switch (reason) {
    case 'STOP': return 'stop';
    case 'MAX_TOKENS': return 'length';
    case 'SAFETY': return 'content_filter';
    case 'RECITATION': return 'content_filter';
    case 'FUNCTION_CALL': return 'tool_calls';
    default: return reason;
  }
}
