import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, ToolCall, ProviderConfig, AIProviderType, SystemInfo, AgentMode } from '../types';
import { AI_TOOLS, buildSystemPrompt, streamChatCompletion, trimMessagesForContextWindow, estimateTokens, validateAndFixMessages } from '../utils/ai-client';
import { getDefaultProviderConfig, AI_PROVIDERS } from '../types';
import { logger } from '../utils/logger';

interface UseAIReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  sendMessage: (content: string) => Promise<void>;
  stopGeneration: () => void;
  clearMessages: () => void;
  loadMessages: (msgs: ChatMessage[]) => void;
  hasApiKey: boolean;
  checkApiKey: () => Promise<boolean>;
  activeProvider: AIProviderType;
  providerLabel: string;
  setActiveProvider: (type: AIProviderType) => Promise<void>;
  /** Tool calls awaiting user approval (agentMode === 'interactive') */
  pendingToolCalls: ToolCall[] | null;
  /** Current agent mode */
  agentMode: AgentMode;
  /** Approve pending tool calls and execute them */
  approvePending: () => void;
  /** Approve pending calls and auto-approve rest of session */
  approveAlwaysPending: () => void;
  /** Skip pending tool calls */
  skipPending: () => void;
  /** Set agent mode */
  setAgentMode: (mode: AgentMode) => void;
  /** User-friendly error message with optional detail (null = no error) */
  errorMessage: { friendly: string; detail: string } | null;
  /** Dismiss the current error */
  clearError: () => void;
}

const MAX_TOOL_CYCLES = 33;

/** Execute a single tool call and return its result. */
async function executeTool(toolCall: ToolCall): Promise<{
  toolCallId: string;
  name: string;
  displayContent: string;
  hadError: boolean;
}> {
  const { name, arguments: rawArgs } = toolCall.function;
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(rawArgs); } catch { args = { command: rawArgs }; }

  let result = '';
  let hadError = false;
  try {
    if (name === 'execute_command') {
      const cmd = args.command as string;
      const TIMEOUT_MS = 20000;
      let captureResult: { output?: string; error?: string };
      try {
        captureResult = await Promise.race([
          window.terminalAPI.executeAndCapture(cmd),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Command timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS)
          ),
        ]);
      } catch (err) {
        captureResult = { output: `(command timed out after ${TIMEOUT_MS / 1000}s - partial output may be available)` };
      }
      result = captureResult.output || '';
      result = result.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\u001b\][0-9;]*[a-zA-Z].*?(?:\u001b\\|\u0007)/g, '').replace(/[\u0000-\u001f]/g, '').trim();
      if (!result) result = '(command completed with no output)';
    } else if (name === 'inject_terminal') {
      const cmd = args.command as string;
      const injectResult = await window.terminalAPI.injectCommand(cmd);
      result = injectResult.success
        ? `Command "${cmd}" was typed into the visible terminal and executed.`
        : `Failed to inject command: ${injectResult.error || 'No terminal available'}. Please open a terminal first.`;
    } else if (name === 'read_terminal_output') {
      const lines = Math.min(Math.max((args.lines as number) || 30, 1), 200);
      result = await window.terminalAPI.readBuffer(lines);
      result = result.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').replace(/\u001b\][0-9;]*[a-zA-Z].*?(?:\u001b\\|\u0007)/g, '').replace(/[\u0000-\u001f]/g, '').trim();
    } else if (name === 'read_file') {
      const filePath = args.path as string;
      const readResult = await window.aiToolsAPI.readFile(filePath);
      if (readResult.success) {
        result = readResult.content;
      } else {
        result = `Error: ${readResult.error}`;
        hadError = true;
      }
    } else if (name === 'list_directory') {
      const dirPath = args.path as string;
      const listResult = await window.aiToolsAPI.listDirectory(dirPath);
      if (listResult.success) {
        const lines = listResult.entries.map(e => {
          const sizeStr = e.isDirectory ? '<DIR>' : `${e.size}`;
          return `${e.isDirectory ? '📁' : '📄'} ${e.name.padEnd(30)} ${sizeStr}`;
        });
        result = lines.join('\n') || '(empty directory)';
      } else {
        result = `Error: ${listResult.error}`;
        hadError = true;
      }
    } else if (name === 'save_note') {
      const key = args.key as string;
      const value = args.value as string;
      await window.memoryAPI.saveNote(key, value);
      result = `Note "${key}" saved successfully.`;
    } else if (name === 'read_notes') {
      const notes = await window.memoryAPI.getAllNotes();
      const entries = Object.entries(notes);
      result = entries.length === 0 ? '(no saved notes)' : entries.map(([k, v]) => `[${k}]\n${v}`).join('\n\n---\n\n');
    } else if (name === 'delete_note') {
      const key = args.key as string;
      await window.memoryAPI.deleteNote(key);
      result = `Note "${key}" deleted.`;
    } else {
      result = `Unknown tool: ${name}`;
    }
  } catch (err) {
    result = `Error: ${err instanceof Error ? err.message : 'Tool execution failed'}`;
    hadError = true;
  }
  if (result.length > 3000) result = result.slice(0, 3000) + '\n...(truncated)';
  return { toolCallId: toolCall.id, name, displayContent: result ? `\`\`\`\n${result}\n\`\`\`` : 'Done (no output)', hadError };
}

export function useAI(): UseAIReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [activeProvider, setActiveProviderState] = useState<AIProviderType>('deepseek');
  const providerConfigRef = useRef<ProviderConfig>(getDefaultProviderConfig('deepseek'));
  const abortControllerRef = useRef<AbortController | null>(null);
  const processingRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const systemInfoRef = useRef<SystemInfo | null>(null);
  const [pendingToolCalls, setPendingToolCalls] = useState<ToolCall[] | null>(null);
  const [agentMode, setAgentModeState] = useState<AgentMode>('auto');
  const [errorMessage, setErrorMessage] = useState<{ friendly: string; detail: string } | null>(null);
  const agentModeRef = useRef<AgentMode>('auto');
  const pendingResolverRef = useRef<((decision: 'approve' | 'always' | 'skip') => void) | null>(null);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const setAgentMode = useCallback((mode: AgentMode) => {
    agentModeRef.current = mode;
    setAgentModeState(mode);
    // If switching away from interactive mode while a prompt is pending, auto-resolve it
    if (mode !== 'interactive' && pendingResolverRef.current) {
      pendingResolverRef.current('approve');
      pendingResolverRef.current = null;
    }
  }, []);

  const approvePending = useCallback(() => {
    pendingResolverRef.current?.('approve');
  }, []);

  const approveAlwaysPending = useCallback(() => {
    pendingResolverRef.current?.('always');
  }, []);

  const skipPending = useCallback(() => {
    pendingResolverRef.current?.('skip');
  }, []);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // If there's a pending interactive prompt, resolve it to prevent deadlock
    if (pendingResolverRef.current) {
      pendingResolverRef.current('skip');
      pendingResolverRef.current = null;
    }
    setIsStreaming(false);
    processingRef.current = false;
  }, []);

  const checkApiKey = useCallback(async () => {
    const has = await window.settingsAPI.hasApiKey();
    setHasApiKey(has);
    return has;
  }, []);

  const setActiveProvider = useCallback(async (type: AIProviderType) => {
    await window.providerAPI.setActive(type);
    setActiveProviderState(type);
    const config = await window.providerAPI.getConfig(type);
    const prefix = config.apiKey ? config.apiKey.slice(0, 12) : '(empty)';
    const suffix = config.apiKey ? config.apiKey.slice(-4) : '';
    logger.info('AUTH', `setActiveProvider got config: hasKey=${!!config.apiKey}, len=${config.apiKey?.length}, prefix="${prefix}...", startsWithSk=${config.apiKey?.startsWith('sk-')}`);
    providerConfigRef.current = {
      type,
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || getDefaultProviderConfig(type).baseUrl,
      model: config.model || getDefaultProviderConfig(type).model,
      label: config.label,
    };
    setHasApiKey(!!config.apiKey);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const active = await window.providerAPI.getActive() as AIProviderType;
        setActiveProviderState(active);
        const config = await window.providerAPI.getConfig(active);
        const prefix = config.apiKey ? config.apiKey.slice(0, 12) : '(empty)';
        const suffix = config.apiKey ? config.apiKey.slice(-4) : '';
        logger.info('AUTH', `Init load provider "${active}": hasKey=${!!config.apiKey}, len=${config.apiKey?.length}, prefix="${prefix}...", startsWithSk=${config.apiKey?.startsWith('sk-')}`);
        providerConfigRef.current = {
          type: active,
          apiKey: config.apiKey || '',
          baseUrl: config.baseUrl || getDefaultProviderConfig(active).baseUrl,
          model: config.model || getDefaultProviderConfig(active).model,
          label: config.label,
        };
        const maskedKey = config.apiKey ? config.apiKey.slice(0, 8) + '...' + config.apiKey.slice(-4) : '(empty)';
        logger.info('INIT', `Provider loaded: ${active}`, { baseUrl: config.baseUrl, model: config.model, apiKey: maskedKey, hasKey: !!config.apiKey });
        setHasApiKey(!!config.apiKey);
      } catch (err) { logger.warn('INIT', 'Failed to load provider config, using defaults', err); }

      try {
        const info = await window.systemAPI.getInfo();
        systemInfoRef.current = info;
        logger.info('INIT', 'System info collected', { os: info.os, arch: info.architecture, user: info.username });
      } catch (err) {
        logger.warn('INIT', 'Failed to collect system info', err);
      }
    })();
  }, []);

  const providerInfo = AI_PROVIDERS.find((p) => p.id === activeProvider);

  // ─── SIMPLIFIED SINGLE-FLOW sendMessage ───
  // Inspired by clean while-loop pattern (no recursion, no module-level functions):
  //   1. Add user message
  //   2. Call AI → if no tool calls → stream & show response → done
  //   3. If tool calls → finalize assistant msg → execute ALL tools → add results → loop to step 2
  const sendMessage = useCallback(async (content: string) => {
    if (processingRef.current) {
      logger.warn('SEND', 'Blocked — already processing a request');
      return;
    }
    processingRef.current = true;
    setIsStreaming(true);

    logger.info('SEND', `User message: "${content.slice(0, 150)}"`);

    const hasKey = await checkApiKey();
    if (!hasKey) {
      logger.warn('SEND', 'No API key configured');
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'assistant', content: 'Please set your API key in Settings before sending messages.', timestamp: Date.now() }]);
      processingRef.current = false;
      setIsStreaming(false);
      return;
    }

    const userMsg: ChatMessage = { id: `user-${Date.now()}`, role: 'user', content, timestamp: Date.now() };
    const allMsgs = [...messagesRef.current, userMsg];
    setMessages(allMsgs);
    messagesRef.current = allMsgs;

    const provider = providerConfigRef.current;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const systemPrompt = buildSystemPrompt(providerInfo?.label || provider.type, systemInfoRef.current || undefined);
    const systemPromptTokens = estimateTokens(systemPrompt);

    let assistantContent = '';
    let assistantReasoning = '';
    let pendingToolCalls: ToolCall[] = [];
    let cycles = 0;
    let currentMsgs = allMsgs;
    let apiErrorCount = 0;
    const MAX_API_ERROR_RETRIES = 2;

    try {
      while (cycles < MAX_TOOL_CYCLES && !controller.signal.aborted) {
        assistantContent = '';
        assistantReasoning = '';
        pendingToolCalls = [];

        logger.info('CYCLE', `── Cycle ${cycles + 1} ──`, { messageCount: currentMsgs.length });

        // ── Trim messages to fit within 128K context window ──
        const beforeTrim = currentMsgs.length;
        currentMsgs = trimMessagesForContextWindow(currentMsgs, systemPromptTokens);
        if (currentMsgs.length < beforeTrim) {
          logger.info('CYCLE', `Trimmed ${beforeTrim - currentMsgs.length} oldest message(s) to stay within 128K context window`);
        }

        // ── Validate message structure before sending (prevents 400 errors from orphaned tool calls) ──
        validateAndFixMessages(currentMsgs);

        // ── Call AI (streams tokens into UI) ──
        let result: { content: string; toolCalls: ToolCall[]; finishReason: string; reasoning?: string };
        try {
          result = await streamChatCompletion(
            provider, currentMsgs, AI_TOOLS, systemPrompt,
          (deltaContent, deltaToolCalls, deltaReasoning) => {
            if (controller.signal.aborted) return;
            assistantContent = deltaContent;
            pendingToolCalls = deltaToolCalls;
            if (deltaReasoning) assistantReasoning = deltaReasoning;

            setMessages((prev) => {
              const filtered = prev.filter((m) => m.id !== 'streaming-assistant');
              if (assistantContent || pendingToolCalls.length > 0) {
                filtered.push({
                  id: 'streaming-assistant',
                  role: 'assistant',
                  content: assistantContent,
                  reasoning: assistantReasoning || undefined,
                  timestamp: Date.now(),
                  toolCalls: pendingToolCalls.filter(Boolean).length > 0 ? pendingToolCalls.filter(Boolean) : undefined,
                });
              }
              return filtered;
            });
          },
            controller.signal
          );
        } catch (apiErr) {
          const apiErrorMsg = apiErr instanceof Error ? apiErr.message : 'API call failed';
          logger.warn('CYCLE', `API error on cycle ${cycles + 1}: ${apiErrorMsg.slice(0, 200)}`);

          // Check if this is a recoverable error (tool_calls state issue, transient failure)
          const isRecoverable =
            apiErrorMsg.includes('tool_calls') ||
            apiErrorMsg.includes('insufficient tool messages') ||
            apiErrorMsg.includes('tool_call_id') ||
            (apiErr instanceof TypeError && apiErrorMsg.includes('fetch')) ||
            apiErrorMsg.includes('5' + '0' + '0') ||
            apiErrorMsg.includes('5' + '0' + '2') ||
            apiErrorMsg.includes('5' + '0' + '3') ||
            apiErrorMsg.includes('5' + '0' + '4');

          if (isRecoverable && apiErrorCount < MAX_API_ERROR_RETRIES) {
            apiErrorCount++;
            // Feed the error back to the LLM as a system feedback message so it can self-correct
            const feedbackMsg: ChatMessage = {
              id: `api-feedback-${Date.now()}`,
              role: 'user',
              content: `[System note: The API call returned an error. This was likely a transient state issue.
Error: ${apiErrorMsg}

Please review your previous response and try again. If you were making tool calls, the state may have been inconsistent — just respond naturally.]`,
              timestamp: Date.now(),
            };
            currentMsgs = [...currentMsgs, feedbackMsg];
            setMessages(currentMsgs);
            messagesRef.current = currentMsgs;
            logger.info('CYCLE', `↻ Injected API error feedback, retrying (attempt ${apiErrorCount}/${MAX_API_ERROR_RETRIES})...`);
            cycles++;
            continue;
          }

          // Non-recoverable: throw to outer handler
          throw apiErr;
        }

        if (controller.signal.aborted) break;

        const validToolCalls = result.toolCalls.filter(Boolean);

        // Finalize the assistant message (replace streaming placeholder)
        const finalAssistant: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.content,
          reasoning: result.reasoning || undefined,
          timestamp: Date.now(),
          toolCalls: validToolCalls.length > 0 ? validToolCalls : undefined,
        };

        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== 'streaming-assistant');
          filtered.push(finalAssistant);
          messagesRef.current = filtered;
          return filtered;
        });

        // ── No tool calls → AI has answered ──
        if (validToolCalls.length === 0) {
          logger.info('CYCLE', '✓ No tool calls — final response ready');
          break;
        }

        // ── Interactive mode: pause for user approval ──
        if (agentModeRef.current === 'interactive') {
          setPendingToolCalls(validToolCalls);
          const decision = await new Promise<'approve' | 'always' | 'skip'>((resolve) => {
            // Safety timeout: if user doesn't respond in 5 minutes, auto-approve to prevent deadlock
            const timeoutId = setTimeout(() => {
              logger.warn('INTERACTIVE', 'Interactive prompt timed out after 5 min, auto-approving');
              resolve('approve');
            }, 300_000);
            pendingResolverRef.current = (val: 'approve' | 'always' | 'skip') => {
              clearTimeout(timeoutId);
              resolve(val);
            };
          });
          setPendingToolCalls(null);
          pendingResolverRef.current = null;

          if (decision === 'skip') {
            const skipResults = validToolCalls.map(tc => ({
              toolCallId: tc.id,
              name: tc.function.name,
              displayContent: '```\n(Skipped — user chose not to run this)\n```',
              hadError: false,
            }));
            const skipToolResultMsgs = skipResults.map(tr => ({
              id: `tool-${tr.toolCallId}`,
              role: 'tool' as const,
              content: tr.displayContent,
              timestamp: Date.now(),
              toolCallId: tr.toolCallId,
              toolName: tr.name,
              toolStatus: 'completed' as const,
            }));
            setMessages((prev) => {
              const updated = [...prev, ...skipToolResultMsgs];
              messagesRef.current = updated;
              return updated;
            });
            // React functional updaters are deferred — ref not yet updated.
            // Build currentMsgs directly from last known ref + new messages.
            currentMsgs = [...messagesRef.current, ...skipToolResultMsgs];
            cycles++;
            continue;
          }

          if (decision === 'always') {
            // Auto-approve all remaining calls this session
            agentModeRef.current = 'auto';
            setAgentModeState('auto');
          }
          // 'approve' or 'always' → fall through to execute tools
        }

        // ── Execute ALL tools in parallel ──
        logger.info('TOOL', `→ Executing ${validToolCalls.length} tool(s)...`);
        const toolResults = await Promise.all(validToolCalls.map(executeTool));
        logger.info('TOOL', `← Tools completed`);

        // Add tool result messages + sync ref synchronously (no effect timing dependency)
        const toolResultMsgs = toolResults.map((tr) => ({
          id: `tool-${tr.toolCallId}`,
          role: 'tool' as const,
          content: tr.displayContent,
          timestamp: Date.now(),
          toolCallId: tr.toolCallId,
          toolName: tr.name,
          toolStatus: tr.hadError ? ('error' as const) : ('completed' as const),
        }));
        setMessages((prev) => {
          const updated = [...prev, ...toolResultMsgs];
          messagesRef.current = updated;
          return updated;
        });

        // React functional updaters are deferred — the ref update inside
        // setMessages hasn't been applied yet. Build currentMsgs directly
        // from the most recent ref value + the new tool results.
        currentMsgs = [...messagesRef.current, ...toolResultMsgs];
        cycles++;
      }

      if (cycles >= MAX_TOOL_CYCLES && !controller.signal.aborted) {
        logger.warn('CYCLE', `Reached max ${MAX_TOOL_CYCLES} tool cycles`);
        setMessages((prev) => [...prev, {
          id: `note-${Date.now()}`,
          role: 'assistant',
          content: '*Reached maximum tool call limit. Please ask in smaller steps if needed.*',
          timestamp: Date.now(),
        }]);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessages((prev) => {
          const filtered = prev.filter((m) => m.id !== 'streaming-assistant');
          if (assistantContent.trim()) {
            filtered.push({ id: `assistant-${Date.now()}`, role: 'assistant', content: assistantContent + '\n\n*⏹️ Generation stopped*', timestamp: Date.now() });
          } else {
            filtered.push({ id: `stopped-${Date.now()}`, role: 'assistant', content: '*⏹️ Generation stopped*', timestamp: Date.now() });
          }
          return filtered;
        });
      } else {
        const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
        const detail = err instanceof Error && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : errorMsg;
        logger.error('SEND', `Error: ${errorMsg}`, err instanceof Error ? { stack: err.stack } : err);
        // Show user-friendly message with expandable details instead of raw error in chat
        setErrorMessage({
          friendly: 'The AI encountered an issue while processing your request. Please try again or check your API settings.',
          detail: errorMsg,
        });
      }
    } finally {
      setIsStreaming(false);
      processingRef.current = false;
      abortControllerRef.current = null;
    }
  }, [checkApiKey, providerInfo]);

  const clearMessages = useCallback(() => {
    if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
    // Resolve any pending interactive prompt to prevent deadlock
    if (pendingResolverRef.current) {
      pendingResolverRef.current('skip');
      pendingResolverRef.current = null;
    }
    processingRef.current = false;
    setMessages([]);
  }, []);

  return {
    messages, isStreaming, sendMessage, stopGeneration, clearMessages,
    loadMessages: (msgs: ChatMessage[]) => { setMessages(msgs); messagesRef.current = msgs; },
    hasApiKey, checkApiKey, activeProvider,
    providerLabel: providerInfo?.label || 'AI', setActiveProvider,
    pendingToolCalls, agentMode, approvePending, approveAlwaysPending, skipPending, setAgentMode,
    errorMessage, clearError,
  };
}
