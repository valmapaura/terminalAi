/**
 * Universal AI Provider API client for Terminal AI.
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
      description: 'Run a command in the terminal and return its output. Use this as your PRIMARY tool for ALL system operations. The command runs in the visible terminal so the user can see it execute. The output is captured and returned to you. Supports: networking (ping, ipconfig, netstat, nslookup, curl), disk/file operations (dir/ls, find/findstr/grep, df/du/chkdsk), process management (ps/tasklist, kill/taskkill), system info (uname/systeminfo, neofetch/ver), and more. IMPORTANT: When the user asks you to check something or perform an operation, call this tool — do not hesitate or ask clarifying questions. Call this tool multiple times if needed for different commands.',
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
      description: 'Type a command directly into the VISIBLE terminal pane and press Enter. Use this when you want the user to SEE the command being executed in the terminal (like showing them how to do something). The command runs in the user\'s visible terminal, not a hidden one.',
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
];

/**
 * Build the system prompt for Terminal AI's assistant.
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

How to work:
- Say hello back, answer simple questions, and jump straight into action when a task is asked.
- Use tools right away for actions or system inspection — don't overthink it.
- If something is ambiguous or could cause trouble, it's fine to ask a quick clarifying question.
- Never claim to have done something without tool results, and never make up command output or file contents.
- Reach for the most specific tool first. Fall back to \`execute_command\` when nothing else fits.
- Before each tool call, say what you're about to do in one short sentence.
- If a tool fails, look at the error, adjust, and retry. Don't repeat the exact same failing call.
- For multi-step tasks, work through them in a logical order until everything is done.
- Follow each tool's JSON schema carefully and include ALL required properties.

Safety:
- Any command that deletes, overwrites, formats, touches the registry, terminates processes, or installs/uninstalls software needs explicit confirmation first.
- Don't access saved notes unless the user asks.
- If a request is unsafe or impossible, explain why and do what you safely can.

Style:
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
      // eslint-disable-next-line no-console
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
            ...m.toolCalls.map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments || '{}'),
            })),
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

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (type === 'azure') {
    headers['api-key'] = apiKey;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
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
  let pendingToolCalls: ToolCall[] = [];
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
  let pendingToolCalls: ToolCall[] = [];
  let finishReason = '';
  let currentToolIndex = 0;
  let inToolUse = false;
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
            inToolUse = true;
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
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments || '{}'),
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

  const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  logger.info('GEMINI', `→ POST ${url}`, {
    model,
    contentsCount: geminiContents.length,
    lastRole: geminiContents[geminiContents.length - 1]?.role,
    hasTools: geminiTools.length > 0,
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  let pendingToolCalls: ToolCall[] = [];
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

        const part = candidates[0].content?.parts?.[0];
        if (!part) continue;

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
