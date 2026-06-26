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

import type { ChatMessage, ToolCall, AIProviderType, ProviderConfig } from '../types';
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
      description: 'Run a Windows CMD or PowerShell command and return its output. Use this as your PRIMARY tool for ALL system operations. The command runs in the visible terminal so the user can see it execute. The output is captured and returned to you. Supports: networking (ping, ipconfig, netstat, nslookup, tracert), disk operations (chkdsk, fsutil, wmic diskdrive, dir), process management (tasklist, taskkill), system information (systeminfo, wmic os, ver), file operations (type, find, findstr, echo), and more. IMPORTANT: When the user asks you to check something or perform an operation, call this tool — do not hesitate or ask clarifying questions. Call this tool multiple times if needed for different commands.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute (CMD or PowerShell)',
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
            description: 'Full path to the file (can use Windows paths like C:\\Users\\...)',
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
            description: 'Full path to the directory (can use Windows paths like C:\\Users\\...)',
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
export function buildSystemPrompt(providerName?: string): string {
  return `You are a tool-assisted terminal assistant for Windows.

The user will ask you questions or ask you to perform tasks. You have access to tools that let you execute commands, read files, and inspect the system. Use them to fulfill requests — do not just describe what you would do.

When to use tools:
- If the user asks a simple question or says hello, respond directly without using any tool.
- If the user asks you to do something (run a command, check connectivity, look up info, inspect a file, etc.), use your tools immediately. Do not wait, do not ask clarifying questions — just do it.

## Tool usage
- Follow each tool's JSON schema carefully and include ALL required properties.
- No need to ask permission before using a tool.
- Prefer \`execute_command\` for all system operations (networking, disk, processes, files, system info).
- Explain briefly before acting: say what you're going to do, then do it.
- If multiple independent actions are needed, you can use multiple tools.
- If a tool fails, read the error and adapt — don't repeat the same failing call.

## Boundaries
- Destructive commands (del, rd, format, diskpart, reg delete) require explicit user confirmation.
- Never call \`read_notes\` automatically — only if the user explicitly asks about saved notes.
- Be concise: one or two sentences unless a complex explanation is needed.
- No emoji unless the user uses them first.
- Never greet or introduce yourself.`;
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
