import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatMessage, ToolCall, ProviderConfig, AIProviderType } from '../types';
import { AI_TOOLS, buildSystemPrompt, streamChatCompletion } from '../utils/ai-client';
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
}

const MAX_TOOL_CYCLES = 5;

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
      const captureResult = await window.terminalAPI.executeAndCapture(cmd, 60000);
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
      const path = args.path as string;
      result = await window.aiToolsAPI.executeCommand(`type "${path}"`);
    } else if (name === 'list_directory') {
      const path = args.path as string;
      result = await window.aiToolsAPI.executeCommand(`dir "${path}" /w`);
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
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
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
    const systemPrompt = buildSystemPrompt(providerInfo?.label || provider.type);

    let assistantContent = '';
    let assistantReasoning = '';
    let pendingToolCalls: ToolCall[] = [];
    let cycles = 0;
    let currentMsgs = allMsgs;

    try {
      while (cycles < MAX_TOOL_CYCLES && !controller.signal.aborted) {
        assistantContent = '';
        assistantReasoning = '';
        pendingToolCalls = [];

        logger.info('CYCLE', `── Cycle ${cycles + 1} ──`, { messageCount: currentMsgs.length });

        // ── Call AI (streams tokens into UI) ──
        const result = await streamChatCompletion(
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

        // ── Execute ALL tools in parallel ──
        logger.info('TOOL', `→ Executing ${validToolCalls.length} tool(s)...`);
        const toolResults = await Promise.all(validToolCalls.map(executeTool));
        logger.info('TOOL', `← Tools completed`);

        // Add tool result messages + sync ref synchronously (no effect timing dependency)
        setMessages((prev) => {
          const toolResultMsgs = toolResults.map((tr) => ({
            id: `tool-${tr.toolCallId}`,
            role: 'tool' as const,
            content: tr.displayContent,
            timestamp: Date.now(),
            toolCallId: tr.toolCallId,
            toolName: tr.name,
            toolStatus: tr.hadError ? ('error' as const) : ('completed' as const),
          }));
          const updated = [...prev, ...toolResultMsgs];
          messagesRef.current = updated;
          return updated;
        });

        // Ref is already synced — grab it immediately for next cycle
        currentMsgs = [...messagesRef.current];
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
        logger.error('SEND', `Error: ${errorMsg}`, err instanceof Error ? { stack: err.stack } : err);
        setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'assistant', content: `❌ Error: ${errorMsg}`, timestamp: Date.now() }]);
      }
    } finally {
      setIsStreaming(false);
      processingRef.current = false;
      abortControllerRef.current = null;
    }
  }, [checkApiKey, providerInfo]);

  const clearMessages = useCallback(() => {
    if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null; }
    processingRef.current = false;
    setMessages([]);
  }, []);

  return {
    messages, isStreaming, sendMessage, stopGeneration, clearMessages,
    loadMessages: (msgs: ChatMessage[]) => { setMessages(msgs); messagesRef.current = msgs; },
    hasApiKey, checkApiKey, activeProvider,
    providerLabel: providerInfo?.label || 'AI', setActiveProvider,
  };
}
