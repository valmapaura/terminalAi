import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, ChatSession, ToolCall, AgentMode } from '../types';
import { TinySpinner } from './TinySpinner';

interface ChatPaneProps {
  onInjectCommand: (command: string) => void;
  hasApiKey: boolean;
  isStreaming: boolean;
  onOpenSettings: () => void;
  onClear?: () => void;
  onStop?: () => void;
  messages: ChatMessage[];
  onSendMessage: (content: string) => Promise<void>;
  onClearMessages: () => void;
  onLoadMessages: (msgs: ChatMessage[]) => void;
  providerLabel: string;
  /** Tool calls awaiting user approval */
  pendingToolCalls: ToolCall[] | null;
  agentMode: AgentMode;
  onApprove: () => void;
  onApproveAlways: () => void;
  onSkip: () => void;  errorMessage?: { friendly: string; detail: string } | null;
  onClearError?: () => void;}

/** Generate a deterministic session ID from the first user message */
function makeSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const ChatPane: React.FC<ChatPaneProps> = ({ onInjectCommand, hasApiKey, isStreaming, onOpenSettings, onClear, onStop, messages: apiMessages, onSendMessage: sendMessage, onClearMessages: clearMessages, onLoadMessages: loadMessages, providerLabel, pendingToolCalls, agentMode, onApprove, onApproveAlways, onSkip, errorMessage, onClearError }) => {
  const [input, setInput] = useState('');
  const [injectedCode, setInjectedCode] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ─── Chat Session State ───
  const [showHistory, setShowHistory] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState('New Chat');
  const [editingTitle, setEditingTitle] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // Refs to avoid stale closures in debounced auto-save
  const currentSessionIdRef = useRef<string | null>(null);
  const sessionTitleRef = useRef<string>('New Chat');
  const messagesRef = useRef<ChatMessage[]>([]);

  // Keep refs in sync with state
  useEffect(() => { currentSessionIdRef.current = currentSessionId; }, [currentSessionId]);
  useEffect(() => { sessionTitleRef.current = sessionTitle; }, [sessionTitle]);
  useEffect(() => { messagesRef.current = apiMessages; }, [apiMessages]);

  const displayMessages = apiMessages;
  const prevMessageCountRef = useRef(apiMessages.length);

  // ─── "Chat cleared" confirmation toast ───
  const [justCleared, setJustCleared] = useState(false);

  // ─── Detect external message clear (e.g. from Settings → Clear Chat) ───
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = apiMessages.length;

    // If messages were just emptied from outside ChatPane (prev > 0 and now 0),
    // reset local state and show a brief "Chat cleared" confirmation.
    if (apiMessages.length === 0 && prev > 0) {
      setCurrentSessionId(null);
      setSessionTitle('New Chat');
      setEditingTitle(false);
      setJustCleared(true);
      setTimeout(() => setJustCleared(false), 2000);
    }
  }, [apiMessages.length]);

  // ─── Auto-scroll ───
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [displayMessages]);

  // ─── Session List Loading ───
  const loadSessions = useCallback(async () => {
    try {
      const list = await window.chatAPI.listSessions();
      setSessions(list);
    } catch {
      console.error('Failed to load sessions');
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ─── Auto-restore most recent session on mount ───
  useEffect(() => {
    (async () => {
      try {
        const list = await window.chatAPI.listSessions();
        if (list && list.length > 0) {
          const mostRecent = list[0];
          const data = await window.chatAPI.loadSession(mostRecent.id);
          if (data && data.messages && Array.isArray(data.messages) && data.messages.length > 0) {
            setCurrentSessionId(data.id);
            setSessionTitle(data.title || 'Untitled');
            loadMessages(data.messages as ChatMessage[]);
          }
        }
      } catch {
        // No sessions to restore — that's fine
      }
    })();
    // Run only on mount — loadMessages is a stable callback from parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Auto-save messages to current session (ref-based, no stale closures) ───
  const saveSession = useCallback(async (msgs: ChatMessage[], title?: string) => {
    if (!msgs.length) return;
    try {
      let sid = currentSessionIdRef.current;
      if (!sid) {
        sid = makeSessionId();
        currentSessionIdRef.current = sid;
        setCurrentSessionId(sid);
      }
      // Auto-generate title from first user message
      const firstUserMsg = msgs.find((m) => m.role === 'user');
      const effectiveTitle = title || (firstUserMsg
        ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? '...' : '')
        : sessionTitleRef.current);
      if (!title && effectiveTitle !== sessionTitleRef.current) {
        setSessionTitle(effectiveTitle);
      }
      await window.chatAPI.saveSession({
        id: sid,
        title: effectiveTitle,
        messages: msgs,
      });
      // Refresh sidebar list
      loadSessions();
    } catch {
      console.error('Failed to save session');
    }
  }, [loadSessions]);

  // Debounced auto-save when messages change — uses refs to avoid stale closures
  // Skips saving while streaming to avoid spamming disk on every token
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!apiMessages.length || isStreaming) return;
    saveTimerRef.current = setTimeout(() => {
      saveSession(messagesRef.current);
    }, 2000);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [apiMessages, saveSession, isStreaming]);

  // ─── Load a session ───
  const handleLoadSession = useCallback(async (sessionId: string) => {
    try {
      const data = await window.chatAPI.loadSession(sessionId);
      if (data) {
        clearMessages();
        setCurrentSessionId(data.id);
        setSessionTitle(data.title || 'Untitled');
        setShowHistory(false);
        // Restore messages from disk
        if (data.messages && Array.isArray(data.messages)) {
          loadMessages(data.messages as ChatMessage[]);
        }
      }
    } catch { /* ignore */ }
  }, [clearMessages, loadMessages]);

  // ─── New Chat ───
  const handleNewChat = useCallback(() => {
    clearMessages();
    setCurrentSessionId(null);
    setSessionTitle('New Chat');
    setEditingTitle(false);
    setShowHistory(false);
  }, [clearMessages]);

  // ─── Delete Session ───
  const handleDeleteSession = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await window.chatAPI.deleteSession(sessionId);
      if (currentSessionIdRef.current === sessionId) {
        currentSessionIdRef.current = null;
        setCurrentSessionId(null);
        setSessionTitle('New Chat');
      }
      loadSessions();
    } catch {
      console.error('Failed to delete session');
    }
  }, [currentSessionId, loadSessions]);

  // ─── Search ───
  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      loadSessions();
      return;
    }
    try {
      const results = await window.chatAPI.searchSessions(query);
      setSessions(results);
    } catch { /* ignore */ }
  }, [loadSessions]);

  // ─── Title editing ───
  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleTitleSubmit = useCallback(() => {
    setEditingTitle(false);
    if (currentSessionIdRef.current && sessionTitleRef.current.trim()) {
      saveSession(messagesRef.current, sessionTitleRef.current.trim());
    }
  }, [saveSession]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;
    const msg = input.trim();
    setInput('');
    // Ensure we have a session ID before sending
    if (!currentSessionId) {
      const sid = makeSessionId();
      setCurrentSessionId(sid);
    }
    await sendMessage(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInject = (command: string) => {
    onInjectCommand(command);
    setInjectedCode(command);
    setTimeout(() => setInjectedCode(null), 1500);
  };

  // NOTE: Clear is handled by handleNewChat which calls onClearMessages

  // Extract code blocks for injection
  const extractCommands = (content: string): string[] => {
    const codeBlockRegex = /```(?:\w*)\n?([\s\S]*?)```/g;
    const commands: string[] = [];
    let match;
    while ((match = codeBlockRegex.exec(content)) !== null) {
      const code = match[1].trim();
      if (code) commands.push(code);
    }
    return commands;
  };

  // ─── Reasoning Section (collapsible, like VS Code Copilot's thinking section) ───
  const ReasoningBlock: React.FC<{ reasoning: string }> = ({ reasoning }) => {
    const [expanded, setExpanded] = useState(false);
    return (
      <div className="reasoning-block">
        <button className="reasoning-toggle" onClick={() => setExpanded(!expanded)}>
          <TinySpinner />
          <span className="reasoning-toggle-label">Reasoning</span>
          <span className={`reasoning-toggle-chevron${expanded ? ' expanded' : ''}`}>&#9662;</span>
        </button>
        {expanded && (
          <div className="reasoning-content">
            <pre>{reasoning}</pre>
          </div>
        )}
      </div>
    );
  };

  // Simple markdown-like rendering
  const renderContent = (content: string) => {
    const lines = content.split('\n');
    const elements: React.ReactNode[] = [];
    let inCodeBlock = false;
    let codeBuffer = '';

    lines.forEach((line, i) => {
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          elements.push(
            <div key={`code-${i}`} className="chat-code-block">
              <div className="chat-code-header">
                <span>Terminal</span>
                <button
                  className={`btn-code-copy${injectedCode === codeBuffer ? ' injected' : ''}`}
                  onClick={() => handleInject(codeBuffer)}
                  title="Run in terminal"
                >
                  {injectedCode === codeBuffer ? '✓' : 'Run'}
                </button>
              </div>
              <pre><code>{codeBuffer}</code></pre>
            </div>
          );
          codeBuffer = '';
          inCodeBlock = false;
        } else {
          inCodeBlock = true;
        }
        return;
      }

      if (inCodeBlock) {
        codeBuffer += (codeBuffer ? '\n' : '') + line;
        return;
      }

      if (line.startsWith('> ')) {
        elements.push(
          <blockquote key={i} className="chat-blockquote">
            {renderInline(line.slice(2))}
          </blockquote>
        );
        return;
      }

      if (!line.trim()) {
        elements.push(<div key={i} className="chat-spacer" />);
        return;
      }

      elements.push(
        <p key={i} className="chat-paragraph">
          {renderInline(line)}
        </p>
      );
    });

    if (codeBuffer) {
      elements.push(
        <div key="code-unclosed" className="chat-code-block">
          <div className="chat-code-header">
            <span>Terminal</span>
            <button
              className={`btn-code-copy${injectedCode === codeBuffer ? ' injected' : ''}`}
              onClick={() => handleInject(codeBuffer)}
              title="Run in terminal"
            >
              {injectedCode === codeBuffer ? '✓' : 'Run'}
            </button>
          </div>
          <pre><code>{codeBuffer}</code></pre>
        </div>
      );
    }

    return elements;
  };

  const renderInline = (text: string) => {
    const parts: React.ReactNode[] = [];
    let remaining = text;

    while (remaining) {
      const codeMatch = remaining.match(/`([^`]+)`/);
      const boldMatch = remaining.match(/\*\*(.+?)\*\*/);

      if (!codeMatch && !boldMatch) {
        parts.push(remaining);
        break;
      }

      const firstCode = codeMatch ? codeMatch.index! : Infinity;
      const firstBold = boldMatch ? boldMatch.index! : Infinity;

      if (firstCode < firstBold && codeMatch) {
        parts.push(remaining.slice(0, firstCode));
        parts.push(<code key={`code-${parts.length}`} className="chat-inline-code">{codeMatch[1]}</code>);
        remaining = remaining.slice(firstCode + codeMatch[0].length);
      } else if (boldMatch) {
        parts.push(remaining.slice(0, firstBold));
        parts.push(<strong key={`bold-${parts.length}`}>{boldMatch[1]}</strong>);
        remaining = remaining.slice(firstBold + boldMatch[0].length);
      } else {
        parts.push(remaining);
        break;
      }
    }

    return parts;
  };

  // ─── Tool Confirmation Card — like VS Code Copilot's ChatTerminalToolConfirmationSubPart ───
  const ToolConfirmationCard: React.FC = () => {
    if (!pendingToolCalls || pendingToolCalls.length === 0) return null;
    return (
      <div className="tool-confirmation-card">
        <div className="tool-confirmation-header">
          <span className="tool-confirmation-icon">🔧</span>
          <span className="tool-confirmation-title">
            {pendingToolCalls.length === 1
              ? 'Tool execution requires approval'
              : `${pendingToolCalls.length} tools require approval`}
          </span>
        </div>
        <div className="tool-confirmation-commands">
          {pendingToolCalls.map((tc, i) => {
            let label = tc.function.name;
            let detail = '';
            try {
              const args = JSON.parse(tc.function.arguments);
              if (tc.function.name === 'execute_command') detail = args.command || '';
              else if (tc.function.name === 'read_file') detail = args.path || '';
              else if (tc.function.name === 'list_directory') detail = args.path || '';
              else if (tc.function.name === 'inject_terminal') detail = args.command || '';
              else detail = '';
            } catch { detail = tc.function.arguments; }
            return (
              <div key={tc.id} className="tool-confirmation-command">
                <code className="tool-confirmation-label">{getToolLabel(tc.function.name)}</code>
                {detail && <pre className="tool-confirmation-detail">{detail}</pre>}
              </div>
            );
          })}
        </div>
        <div className="tool-confirmation-buttons">
          <button className="btn-confirm-allow" onClick={onApprove}>
            Allow {pendingToolCalls.length > 1 ? `All (${pendingToolCalls.length})` : ''}
          </button>
          <button className="btn-confirm-always" onClick={onApproveAlways} title="Auto-approve remaining tools this session">
            Always Allow
          </button>
          <button className="btn-confirm-skip" onClick={onSkip}>
            Skip
          </button>
        </div>
      </div>
    );
  };

  // ─── Error Banner — user-friendly error with expandable technical details ───
  const ErrorBanner: React.FC<{
    friendly: string;
    detail: string;
    onDismiss: () => void;
  }> = ({ friendly, detail, onDismiss }) => {
    const [showDetail, setShowDetail] = useState(false);
    return (
      <div className="error-banner">
        <div className="error-banner-header">
          <span className="error-banner-icon">⚠️</span>
          <span className="error-banner-text">{friendly}</span>
          <button className="error-banner-dismiss" onClick={onDismiss} title="Dismiss">✕</button>
        </div>
        <button
          className="error-banner-toggle"
          onClick={() => setShowDetail(!showDetail)}
        >
          {showDetail ? 'Hide details' : 'Show details'} {showDetail ? '▲' : '▼'}
        </button>
        {showDetail && (
          <pre className="error-banner-detail">{detail}</pre>
        )}
      </div>
    );
  };

  // ─── Tool name display — like VS Code Copilot's invocationMessage / pastTenseMessage ───
  const getToolLabel = (name: string): string => {
    switch (name) {
      case 'execute_command': return 'Running command';
      case 'inject_terminal': return 'Typing in terminal';
      case 'read_terminal_output': return 'Reading terminal output';
      case 'read_file': return 'Reading file';
      case 'list_directory': return 'Listing directory';
      case 'save_note': return 'Saving note';
      case 'read_notes': return 'Reading notes';
      case 'delete_note': return 'Deleting note';
      default: return `Using ${name}`;
    }
  };

  const getToolPastLabel = (name: string): string => {
    switch (name) {
      case 'execute_command': return 'Ran command';
      case 'inject_terminal': return 'Typed in terminal';
      case 'read_terminal_output': return 'Read terminal output';
      case 'read_file': return 'Read file';
      case 'list_directory': return 'Listed directory';
      case 'save_note': return 'Saved note';
      case 'read_notes': return 'Read notes';
      case 'delete_note': return 'Deleted note';
      default: return `Used ${name}`;
    }
  };

  // ─── Tool Invocation Block — like VS Code Copilot's ChatToolInvocationPart ───
  const ToolInvocation: React.FC<{
    toolName: string;
    toolStatus?: 'running' | 'completed' | 'error';
    content: string;
  }> = ({ toolName, toolStatus, content }) => {
    const [expanded, setExpanded] = useState(toolStatus === 'error');
    const isRunning = toolStatus === 'running' || toolStatus === undefined;
    const isError = toolStatus === 'error';

    return (
      <div className={`tool-invocation${isError ? ' tool-invocation-error' : ''}`}>
        <button
          className="tool-invocation-header"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Status indicator */}
          <span className="tool-invocation-status">
            {isRunning ? (
              <TinySpinner />
            ) : isError ? (
              <span className="tool-status-icon tool-status-error">!</span>
            ) : (
              <span className="tool-status-icon tool-status-ok">&#10003;</span>
            )}
          </span>
          {/* Label — present tense while running, past tense when done */}
          <span className="tool-invocation-label">
            {isRunning ? getToolLabel(toolName) : getToolPastLabel(toolName)}
          </span>
          {/* Chevron */}
          <span className={`tool-invocation-chevron${expanded ? ' expanded' : ''}`}>
            &#9662;
          </span>
        </button>
        {expanded && content && (
          <div className="tool-invocation-body">
            <pre className="tool-invocation-content">{content.replace(/^```\n?|\n?```$/g, '').trim()}</pre>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="chat-pane">
      {/* ─── Header ─── */}
      <div className="chat-header">
        <div className="chat-header-left">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="chat-title-input"
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => { if (e.key === 'Enter') handleTitleSubmit(); if (e.key === 'Escape') { setEditingTitle(false); } }}
            />
          ) : (
            <span
              className="chat-title"
              onDoubleClick={() => setEditingTitle(true)}
              title="Double-click to rename"
            >
              {sessionTitle}
            </span>
          )}
          {hasApiKey && <span className="chat-header-badge">{providerLabel}</span>}
        </div>
        <div className="chat-header-actions">
          <button
            className="chat-header-settings-btn"
            onClick={onOpenSettings}
            title="Settings (Ctrl+,)"
          >
            <span className="settings-gear-icon">⚙</span>
            <span className="settings-gear-label">Settings</span>
          </button>
          <button
            className="btn-clear-chat"
            onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadSessions(); }}
            title="Chat history"
          >
            ☰
          </button>
          {displayMessages.length > 0 && !isStreaming && (
            <button className="btn-clear-chat" onClick={handleNewChat} title="New chat">
              +
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isStreaming && <div className="streaming-progress-bar" />}

      <div className="chat-body">
        {/* ─── History Sidebar ─── */}
        {showHistory && (
          <div className="chat-history-sidebar">
            <div className="chat-history-header">
              <span className="chat-history-title">History</span>
              <button className="btn-clear-chat" onClick={() => setShowHistory(false)} title="Close">✕</button>
            </div>
            <div className="chat-history-search">
              <input
                className="chat-search-input"
                type="text"
                placeholder="Search conversations..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            <div className="chat-history-list">
              {sessions.length === 0 ? (
                <div className="chat-history-empty">
                  {searchQuery ? 'No results found' : 'No saved conversations'}
                </div>
              ) : (
                sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`chat-history-item${s.id === currentSessionId ? ' active' : ''}`}
                    onClick={() => handleLoadSession(s.id)}
                  >
                    <div className="chat-history-item-title">{s.title}</div>
                    <div className="chat-history-item-meta">
                      {s.messageCount} msgs · {new Date(s.updatedAt).toLocaleDateString()}
                    </div>
                    <button
                      className="chat-history-item-delete"
                      onClick={(e) => handleDeleteSession(e, s.id)}
                      title="Delete"
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* ─── Messages ─── */}
        <div className="chat-messages">
          {!hasApiKey && displayMessages.length === 0 && !isStreaming && (
            <div className="chat-empty setup-prompt">
              <h2>Welcome to OS Assistant</h2>
              <p>Connect your AI provider to get started.</p>
              <button className="btn-primary" onClick={onOpenSettings}>
                Configure API Key
              </button>
              <span className="setup-hint">Supports any OpenAI-compatible provider, Anthropic Claude, Google Gemini, and more</span>
            </div>
          )}
          {hasApiKey && displayMessages.length === 0 && !isStreaming && (
            <div className="chat-empty">
              {justCleared ? (
                <div className="chat-cleared-banner">
                  <span className="chat-cleared-icon">✓</span>
                  <span>Chat cleared</span>
                </div>
              ) : null}
              <p>Ask me to run a command or help you with something.</p>
            </div>
          )}

          {/* LLM Waiting indicator — shown when streaming but no content yet */}
          {isStreaming && displayMessages.length === 0 && (
            <div className="llm-waiting-indicator">
              <span className="llm-waiting-label">
                <TinySpinner />
                <span>Waiting for LLM response...</span>
              </span>
            </div>
          )}

          {displayMessages.map((msg) => (
            <div key={msg.id} className={`message message-${msg.role}`}>
              <div className="message-content">
                {/* Reasoning content — collapsible, like VS Code Copilot */}
                {msg.reasoning && (
                  <ReasoningBlock reasoning={msg.reasoning} />
                )}
                {/* Tool invocation — like VS Code Copilot's ChatToolInvocationPart */}
                {msg.toolName ? (
                  <ToolInvocation
                    toolName={msg.toolName}
                    toolStatus={msg.toolStatus}
                    content={msg.content}
                  />
                ) : (
                  <div className="message-text">{renderContent(msg.content)}</div>
                )}

                {/* Inject buttons for code blocks in assistant messages */}
                {msg.role === 'assistant' && !msg.toolCalls && extractCommands(msg.content).length > 0 && (
                  <div className="command-actions">
                    {extractCommands(msg.content).map((cmd, i) => (
                      <div key={i} className="command-suggestion">
                        <code className="command-code">{cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd}</code>
                        <div className="command-buttons">
                          <button
                            className={`btn-inject${injectedCode === cmd ? ' injected' : ''}`}
                            onClick={() => handleInject(cmd)}
                            title="Inject into terminal"
                          >
                            {injectedCode === cmd ? '✓ Injected' : 'Inject'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />

          {/* ─── AI response placeholder — dots where the next response will appear ─── */}
          {isStreaming && displayMessages.length > 0 && !displayMessages.some(m => m.id === 'streaming-assistant') && (
            <div className="ai-response-placeholder">
              <TinySpinner />
              <span className="ai-response-placeholder-label">Generating response...</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── Agent Mode Indicator ─── */}
      <div className="agent-mode-bar">
        <span className={`agent-mode-badge agent-mode-${agentMode}`}>
          {agentMode === 'interactive' ? '🔍 Interactive' : '🤖 Auto'}
        </span>
      </div>

      {/* ─── Error Banner — user-friendly with expandable details ─── */}
      {errorMessage && (
        <ErrorBanner
          friendly={errorMessage.friendly}
          detail={errorMessage.detail}
          onDismiss={() => onClearError?.()}
        />
      )}

      {/* ─── Tool Confirmation Card ─── */}
      <ToolConfirmationCard />

      {/* ─── Input Area ─── */}
      <div className="chat-input-area">
        <div className={`chat-input-wrapper${isStreaming ? ' streaming' : ''}`}>
          <textarea
            className="chat-input"
            placeholder={isStreaming ? 'Thinking...' : 'Ask me to run a command...'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <button className="btn-stop" onClick={onStop} title="Stop generation">
              <span className="stop-icon">■</span>
            </button>
          ) : (
            <button
              className="btn-send"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M1 1L15 8L1 15V10.5L11 8L1 5.5V1Z" fill="currentColor"/>
              </svg>
            </button>
          )}
        </div>
        <div className="chat-input-hint">
          Enter to send · Shift+Enter for new line
        </div>
      </div>
    </div>
  );
};
