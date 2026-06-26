export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: number;
  /** Reasoning/thinking content (e.g., DeepSeek R1, OpenAI o1) — rendered separately like VS Code Copilot */
  reasoning?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
  /** Tracks tool execution status for UI rendering (like VS Code Copilot's tool invocation states) */
  toolStatus?: 'running' | 'completed' | 'error';
}

/** A persisted chat session — like VS Code Copilot chat history */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** Full session data loaded from disk */
export interface ChatSessionData {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface CommandSuggestion {
  command: string;
  description: string;
  safe: boolean;
}

export interface TerminalTab {
  id: string;
  label: string;
}

// ─── AI Provider System (like VS Code's multi-model support) ───

export type AIProviderType =
  | 'deepseek'
  | 'openai'
  | 'azure'
  | 'anthropic'
  | 'google'
  | 'custom';

export interface AIProvider {
  id: AIProviderType;
  name: string;
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
  apiKeyLabel: string;
  helpUrl?: string;
  models?: string[];
}

export const AI_PROVIDERS: AIProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    label: 'DeepSeek Chat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    requiresApiKey: true,
    apiKeyLabel: 'DeepSeek API Key',
    helpUrl: 'https://platform.deepseek.com',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    requiresApiKey: true,
    apiKeyLabel: 'OpenAI API Key',
    helpUrl: 'https://platform.openai.com/api-keys',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
  },
  {
    id: 'azure',
    name: 'Azure OpenAI',
    label: 'Azure OpenAI',
    defaultBaseUrl: '',
    defaultModel: 'gpt-4o',
    requiresApiKey: true,
    apiKeyLabel: 'Azure API Key',
    helpUrl: 'https://portal.azure.com',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-35-turbo'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    label: 'Anthropic Claude',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-sonnet-4-20250514',
    requiresApiKey: true,
    apiKeyLabel: 'Anthropic API Key',
    helpUrl: 'https://console.anthropic.com',
    models: ['claude-sonnet-4-20250514', 'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'],
  },
  {
    id: 'google',
    name: 'Google',
    label: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    requiresApiKey: true,
    apiKeyLabel: 'Google API Key',
    helpUrl: 'https://aistudio.google.com',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  },
  {
    id: 'custom',
    name: 'Custom',
    label: 'Custom OpenAI-Compatible',
    defaultBaseUrl: 'http://localhost:8080/v1',
    defaultModel: 'gpt-4o-mini',
    requiresApiKey: false,
    apiKeyLabel: 'API Key (optional)',
  },
];

export interface ProviderConfig {
  type: AIProviderType;
  apiKey: string;
  baseUrl: string;
  model: string;
  label?: string;
}

export function getDefaultProviderConfig(type: AIProviderType): ProviderConfig {
  const provider = AI_PROVIDERS.find((p) => p.id === type)!;
  return {
    type,
    apiKey: '',
    baseUrl: provider.defaultBaseUrl,
    model: provider.defaultModel,
    label: provider.label,
  };
}

export interface AppSettings {
  activeProvider: AIProviderType;
  providers: Record<string, ProviderConfig>;
  theme: 'dark' | 'light' | 'solarized-dark' | 'solarized-light';
  fontSize: number;
  splitDirection: 'horizontal' | 'vertical';
  /** Whether the terminal pane is visible */
  showTerminal: boolean;
}

export type ActivityBarView = 'terminal' | 'chat' | 'settings' | 'extensions';
