# OS Assistant — Architecture

> **An open-source, split-screen terminal + AI assistant for Windows.**  
> Think of it as a local-first AI copilot for the command line — you type plain English, the AI runs the commands.

---

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Process Model (Electron)](#process-model-electron)
4. [Data Flow — AI Conversation with Tool Calling](#data-flow--ai-conversation-with-tool-calling)
5. [Directory Structure](#directory-structure)
6. [Key Modules](#key-modules)
   - [Main Process](#1-main-process-srcmain)
   - [Preload Bridge](#2-preload-bridge-srcpreload)
   - [Renderer / React App](#3-renderer--react-app-srcrenderer)
7. [AI Provider System](#ai-provider-system)
8. [Security Model](#security-model)
9. [State Management](#state-management)
10. [Build & Packaging](#build--packaging)
11. [Extending the App](#extending-the-app)

---

## Overview

OS Assistant is an Electron desktop app that combines a **full Windows CMD terminal** (`node-pty` + `xterm.js`) with an **AI chat interface** that can execute commands on the user's behalf. The AI uses tool calling to run commands, inspect files, read terminal output, and remember facts — all through a secure, encrypted configuration system.

**Key design principles:**

- **Single source of truth** — the `useAI()` hook lives in `App.tsx` and passes everything down as props (no dual hook instances).
- **While-loop AI flow** — no recursion, no module-level helper functions. A single `sendMessage` loops through AI calls → tool execution → AI calls until the answer is ready.
- **Electron security best practices** — `contextIsolation: true`, `sandbox: false` (required for `node-pty`), encrypted API keys via `safeStorage`, CSP headers.
- **VS Code-inspired UX** — command preview modal before dangerous execution, reasoning/collapsible sections, status bar, provider badge.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐    ┌──────────────────────────────────┐    │
│  │  Main Process    │    │  Renderer Process (React 18)      │    │
│  │  (Node.js)       │    │                                   │    │
│  │                  │    │  ┌────────────────────────────┐   │    │
│  │  main.ts         │◄───►│  App.tsx                     │   │    │
│  │  ─────────       │ IPC │  ┌──────┐ ┌────────────────┐ │   │    │
│  │  createWindow()  │     │  │ useAI│ │ useTerminal    │ │   │    │
│  │  toggleDevTools()│     │  │ hook │ │ hook           │ │   │    │
│  │                  │     │  └──┬───┘ └───────┬────────┘ │   │    │
│  │  ipc-handlers.ts │     │     │              │          │   │    │
│  │  ─────────       │     │  ┌──┴──────────────┴───────┐  │   │    │
│  │  Config (encrypt)│     │  │  SplitPane              │  │   │    │
│  │  Session storage │     │  │  ┌────────┐ ┌────────┐ │  │   │    │
│  │  Model discovery │     │  │  │Terminal│ │ Chat   │ │  │   │    │
│  │                  │     │  │  │Pane    │ │ Pane   │ │  │   │    │
│  │  terminal.ts     │◄───►│  │  └────────┘ └────────┘ │  │   │    │
│  │  ─────────       │ xterm│  └────────────────────────┘  │   │    │
│  │  node-pty spawn  │ data │                              │   │    │
│  │  Ring buffer     │      │  SettingsPanel               │   │    │
│  │  Command capture │      │  CommandPreview              │   │    │
│  └─────────────────┘       │  StatusBar                   │   │    │
│                            └──────────────────────────────────┘    │
│    ┌─────────────────────────────────────────────────────────┐     │
│    │  Preload Bridge (contextBridge + ipcRenderer)            │     │
│    │  preload.ts                                              │     │
│    │  window.terminalAPI, window.providerAPI,                 │     │
│    │  window.settingsAPI, window.chatAPI,                     │     │
│    │  window.memoryAPI, window.modelsAPI,                     │     │
│    │  window.aiToolsAPI, window.appAPI,                       │     │
│    │  window.windowControlsAPI                                │     │
│    └─────────────────────────────────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

---

## Process Model (Electron)

### Why Electron with `node-pty`?

- `node-pty` spawns a **real Windows CMD.exe** process — not a web terminal emulation. This means the AI runs actual Windows commands.
- `xterm.js` renders the terminal in the browser context and communicates with `node-pty` via IPC.

### Process boundaries

| Process      | Technology    | Responsibility                                     |
| ------------ | ------------- | -------------------------------------------------- |
| **Main**     | Node.js + PTY | Window management, terminal lifecycle, IPC, crypto |
| **Preload**  | contextBridge | Secure API exposure — no `nodeIntegration`         |
| **Renderer** | React 18      | UI, AI chat, streaming, tool execution             |

### Communication flow

```
Renderer ── ipcRenderer.invoke/handle ──► Main (IPC handler)
           ◄── webContents.send ──────────
           ◄── terminal.onData ───────────
```

All terminal data flows through IPC: the React renderer never touches `node-pty` directly.

---

## Data Flow — AI Conversation with Tool Calling

This is the core loop. It runs entirely in the renderer's `useAI()` hook.

### Simplified while-loop pattern

```
User types message ──────────────────────────────────────────────┐
                                                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│  sendMessage(content)                                            │
│                                                                  │
│  1. Block if processingRef.current === true (concurrent guard)   │
│  2. Check API key present                                        │
│  3. Add user message to state                                    │
│  4. Set isStreaming = true                                       │
│                                                                  │
│  ┌──── while (cycles < 5 && not aborted) ──────────────────┐    │
│  │                                                          │    │
│  │  5. Call streamChatCompletion(...)                      │    │
│  │     └── Provider-specific streaming function             │    │
│  │         (streamOpenAICompatible / streamAnthropic /      │    │
│  │          streamGoogle)                                   │    │
│  │     └── onDelta callback updates React state every chunk │    │
│  │                                                          │    │
│  │  6. If result.toolCalls is empty ──► break (AI answered) │    │
│  │                                                          │    │
│  │  7. Execute ALL tool calls in PARALLEL via Promise.all() │    │
│  │     └── executeTool(toolCall) per tool                   │    │
│  │     └── execute_command → terminalAPI.executeAndCapture  │    │
│  │     └── inject_terminal → terminalAPI.injectCommand      │    │
│  │     └── read_terminal_output → terminalAPI.readBuffer    │    │
│  │     └── read_file → aiToolsAPI.executeCommand('type ...')│    │
│  │     └── list_directory → aiToolsAPI.executeCommand(...)  │    │
│  │     └── save_note / read_notes / delete_note → memoryAPI │    │
│  │                                                          │    │
│  │  8. Add tool result messages to state                    │    │
│  │  9. cycles++ ──► loop back to step 5                     │    │
│  │                                                          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                  │
│  10. If cycles >= 5, add "max tool calls reached" note           │
│  11. On error: show error message                                │
│  12. Set isStreaming = false, processingRef = false              │
└──────────────────────────────────────────────────────────────────┘
```

### Why a while-loop?

- **No recursion** — avoids stack growth and stale closure bugs.
- **No module-level functions** — all state (messages, refs) is local to the hook.
- **Parallel tool execution** — tools that don't depend on each other execute simultaneously.
- **Max-cycles safety valve** — prevents infinite loops if the AI keeps requesting tools.

---

## Directory Structure

```
os-assistant/
├── src/
│   ├── main/                    # Electron main process
│   │   ├── main.ts              # Entry: window creation, DevTools global shortcuts
│   │   ├── terminal.ts          # TerminalManager: node-pty lifecycle + ring buffer
│   │   └── ipc-handlers.ts      # IPC registry: config (encrypted), sessions, models, memory
│   │
│   ├── preload/
│   │   └── preload.ts           # contextBridge: 9 API surfaces exposed to renderer
│   │
│   └── renderer/
│       ├── index.html           # Single-page shell
│       ├── index.tsx            # React root
│       ├── App.tsx              # Root component: split pane, settings modal, shortcuts
│       │
│       ├── components/
│       │   ├── SplitPane.tsx     # Resizable horizontal/vertical split
│       │   ├── TerminalPane.tsx  # xterm.js wrapper + fit addon
│       │   ├── ChatPane.tsx      # Messages, session management, streaming indicator
│       │   ├── SettingsPanel.tsx # Provider config, theme, debug panel
│       │   ├── CommandPreview.tsx# Pre-execution safety review
│       │   ├── StatusBar.tsx     # Provider, terminal count, orientation toggle
│       │   └── TinySpinner.tsx   # Three-dot color-cycling spinner component
│       │
│       ├── hooks/
│       │   ├── useAI.ts          # Core AI loop: sendMessage, tool execute, streaming
│       │   └── useTerminal.ts    # Terminal lifecycle: create, resize, data events
│       │
│       ├── utils/
│       │   ├── ai-client.ts      # Streaming clients for all AI providers
│       │   ├── command-validator.ts  # Danger pattern detection (VS Code-style)
│       │   └── logger.ts         # In-memory debug logger with timestamps
│       │
│       ├── types/
│       │   └── index.ts          # ChatMessage, ToolCall, AIProvider, settings types
│       │
│       └── styles/
│           └── app.css           # Complete application stylesheet
│
├── e2e/
│   ├── helpers.ts               # Playwright helpers: launchApp, sendMessage, setApiKey
│   ├── smoke.spec.ts            # Basic app startup test
│   └── ai-interaction.spec.ts   # AI conversation + command execution tests
│
├── assets/
│   └── icon.png                 # App icon
│
├── package.json                 # Dependencies, scripts, electron-builder config
├── electron-builder.yml         # Packaging/installer config
├── tsconfig.json                # TypeScript root config
├── tsconfig.main.json           # Main process TS config
├── tsconfig.preload.json        # Preload TS config
├── webpack.config.js            # Renderer bundler
├── playwright.config.ts         # E2E test config
├── ARCHITECTURE.md              # This file
└── README.md                    # Getting started guide
```

---

## Key Modules

### 1. Main Process (`src/main/`)

#### `main.ts` — App Entry

- Creates a **frameless** BrowserWindow (1400×900, min 900×600).
- Registers **global shortcuts**: `F12` / `Ctrl+Shift+I` for DevTools.
- Initializes `TerminalManager` and `registerIpcHandlers` on app ready.
- Cleans up terminals on `window-all-closed` and `before-quit`.

#### `terminal.ts` — TerminalManager

- **Spawns** `cmd.exe` (Windows) or `/bin/bash` (macOS/Linux) via `node-pty`.
- Maintains a **ring buffer** of the last 1000 lines of terminal output per terminal.
- Supports two execution modes:
  - **`executeOnTerminal()`** — runs a command on the **visible** terminal and waits for prompt detection (regex `/[\\$>#] ?$/m`). Used by the AI's `execute_command` tool.
  - **`executeCommand()`** — spawns a **hidden** terminal, runs a command, captures output, and kills it (used by `aiToolsAPI.executeCommand`).
- **Prompt detection**: uses a 200-char rolling buffer + regex to detect when a command completes on the visible terminal.

#### `ipc-handlers.ts` — IPC Handlers

| Handler Family  | IPC Channel                                         | Purpose                     |
| --------------- | --------------------------------------------------- | --------------------------- |
| Terminal        | `terminal:create`, `terminal:write`, etc            | PTY lifecycle               |
| Provider Config | `provider:get-config`, `provider:set-config`, etc   | Encrypted API key storage   |
| Settings        | `settings:has-api-key`                              | Key presence check          |
| Sessions        | `chat:list-sessions`, `chat:save-session`, etc      | Chat history persistence    |
| Models          | `models:get-all`, `models:fetch-from-provider`, etc | Model discovery             |
| AI Tools        | `ai-tools:execute`                                  | Hidden command execution    |
| Memory          | `memory:save-note`, `memory:get-all-notes`, etc     | AI persistent memory        |
| Window Controls | `window:minimize`, `window:maximize`, etc           | Frameless window management |

**Encryption**: API keys are encrypted via Electron's `safeStorage` (Windows Credential Manager). Falls back to base64 if unavailable.

**Chat sessions** are stored as individual JSON files in `{userData}/os-assistant-chats/` and loaded on demand.

### 2. Preload Bridge (`src/preload/preload.ts`)

Exposes **9 API surfaces** to the renderer via `contextBridge.exposeInMainWorld`:

| Window API                 | Methods                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `window.terminalAPI`       | `create`, `write`, `resize`, `kill`, `onData`, `readBuffer`, `injectCommand`, `executeAndCapture` |
| `window.providerAPI`       | `getConfig`, `setConfig`, `getActive`, `setActive`, `getAllConfigs`                               |
| `window.settingsAPI`       | `hasApiKey`                                                                                       |
| `window.chatAPI`           | `listSessions`, `loadSession`, `saveSession`, `deleteSession`, `searchSessions`                   |
| `window.modelsAPI`         | `getAll`, `fetchFromProvider`, `add`, `remove`, `setSelected`, `getSelected`                      |
| `window.aiToolsAPI`        | `executeCommand`                                                                                  |
| `window.memoryAPI`         | `saveNote`, `getNote`, `getAllNotes`, `deleteNote`, `clearAll`                                    |
| `window.appAPI`            | `getPlatform`, `getVersion`                                                                       |
| `window.windowControlsAPI` | `minimize`, `maximize`, `close`, `isMaximized`, `listenMaximize`                                  |

All APIs use `ipcRenderer.invoke` (async) or `ipcRenderer.send` (fire-and-forget) behind the scenes.

### 3. Renderer / React App (`src/renderer/`)

#### `App.tsx` — Root Component

- **Single source** of the `useAI()` hook. Passes all AI state (`messages`, `sendMessage`, `isStreaming`, `hasApiKey`, `providerLabel`, etc.) as props to child components.
- Manages: settings modal, command preview modal, keyboard shortcuts (`Ctrl+,`, `Ctrl+L`, `Escape`, `Ctrl+Shift+D` debug toggle, `Ctrl+Shift+L` log dump).
- Layout: minimal frameless title bar → `SplitPane` (TerminalPane | ChatPane) → `StatusBar`.

#### `ChatPane.tsx` — AI Chat Interface

- **Session management**: auto-saves to disk every 1.5s (debounced), loads most recent session on mount, search/delete history sidebar.
- **Message rendering**: supports reasoning sections (`ReasoningBlock`), tool invocations (`ToolInvocation`), code blocks with inject buttons, error states.
- **Streaming indicator**: `TinySpinner` at the bottom of the message list during AI "thinking" gaps (between tool call cycles). `llm-waiting-indicator` for the very first response.
- **Auto-scroll**: `messagesEndRef` scrolls into view on new messages.
- **Chat cleared detection**: watches `prevMessageCountRef` to detect external clears and shows a green toast.

#### `SettingsPanel.tsx` — Configuration UI

- Provider selector (DeepSeek, OpenAI, Azure, Anthropic, Google, Custom).
- Per-provider: API key, base URL, model selection (fetched models or manual entry).
- Theme selector (Dark Modern, Light Modern, Solarized Dark, Solarized Light).
- Debug tab: enable/disable logging, dump logs to console, clear logs, show provider config (masked key).
- Clear chat button with confirmation.

#### `ai-client.ts` — Universal Streaming Client

Routes to the correct streaming implementation based on provider type:

- `streamOpenAICompatible()` — DeepSeek, OpenAI, Azure OpenAI, Custom
- `streamAnthropic()` — Anthropic Claude (tool_use blocks)
- `streamGoogle()` — Google Gemini (functionCall parts)

**Tools are defined as `AI_TOOLS`**: `execute_command`, `inject_terminal`, `read_terminal_output`, `read_file`, `list_directory`, `save_note`, `read_notes`, `delete_note` — 8 tools modeled as OpenAI-compatible function definitions.

**System prompt**: instructs the AI to be action-oriented, use tools immediately, be concise, avoid emoji, and never greet the user.

#### `command-validator.ts` — Safety Checks

Pattern-matches commands against dangerous patterns:

| Severity | Examples                                                 |
| -------- | -------------------------------------------------------- |
| Critical | `del /f /s`, `rd /s`, `format`, `diskpart`, `reg delete` |
| High     | `shutdown`, `taskkill /f`, `ping -t`                     |
| Medium   | `net user`, `sc`, `wmic`, `powershell`                   |

Commands with high/critical severity trigger the `CommandPreview` modal — the user must explicitly accept before execution.

---

## AI Provider System

Supports 6 provider types via a unified interface:

```
ProviderConfig {
  type: AIProviderType  // 'deepseek' | 'openai' | 'azure' | 'anthropic' | 'google' | 'custom'
  apiKey: string        // Decrypted at runtime
  baseUrl: string       // API endpoint
  model: string         // Model name
  label?: string        // Display label
}
```

### Provider-specific differences

| Provider  | Auth header     | Streaming format       | Tool format               | Reasoning support |
| --------- | --------------- | ---------------------- | ------------------------- | ----------------- |
| DeepSeek  | Bearer token    | SSE + `data: [DONE]`   | `tool_calls` array        | R1 reasoning      |
| OpenAI    | Bearer token    | SSE + `data: [DONE]`   | `tool_calls` array        | o1 reasoning      |
| Azure     | Bearer + header | SSE + `data: [DONE]`   | `tool_calls` array        | —                 |
| Anthropic | x-api-key       | SSE (event stream)     | `tool_use` content blocks | —                 |
| Google    | Bearer token    | SSE (different format) | `functionCall` parts      | —                 |
| Custom    | Bearer token    | OpenAI-compatible SSE  | `tool_calls` array        | —                 |

All providers converge to the same `{ content, toolCalls, finishReason, reasoning }` return type.

---

## Security Model

### API Key Storage

```
User enters key ──► ipcMain handler
                   └── safeStorage.encryptString(key) ──► base64
                   └── JSON file on disk (encrypted)
Reading key:
                   JSON file ──► base64 ──► safeStorage.decryptString ──► renderer
```

Keys are never stored in plaintext. The renderer receives decrypted keys only at runtime.

### Command Safety

- **Command preview modal** blocks execution of dangerous commands (critical/high severity) until user clicks Accept.
- **`validateCommand()`** checks against a curated list of patterns.
- **`sanitizeCommand()`** strips non-ASCII and normalizes line endings.
- The AI's system prompt instructs it to ask for confirmation before destructive operations.

### Electron Security

- `contextIsolation: true` — renderer cannot access Node.js APIs.
- `nodeIntegration: false` — no `require()` in renderer.
- `sandbox: false` — required by `node-pty` (it needs native bindings).
- **CSP headers** limit renderer connectivity (configured in main process).
- **Global shortcuts** only for DevTools — no arbitrary key interception.

---

## State Management

### React state vs refs

| Concern            | Mechanism       | Why                                      |
| ------------------ | --------------- | ---------------------------------------- |
| Messages (display) | `useState`      | Triggers re-render                       |
| Messages (latest)  | `useRef` mirror | Avoids stale closures in async callbacks |
| Streaming flag     | `useState`      | Controls UI indicators                   |
| Processing guard   | `useRef`        | Must be synchronous, no re-render needed |
| AbortController    | `useRef`        | No re-render needed                      |
| Provider config    | `useRef`        | Stable across renders, no re-render      |

### Why the ref mirror pattern?

React 18 concurrent batching can cause `setState((prev) => ...)` updater functions to capture stale arrays between `await` calls. The `messagesRef.current` is updated synchronously alongside `setMessages()` so async callbacks always read the latest messages.

### `useAI()` is the single source

- Called once in `App.tsx`.
- All AI state flows down as props to `ChatPane`.
- `ChatPane` imports `useAI` **only in comments** (historical).
- This prevents the dual-instance bug where two independent `useAI()` hooks caused `isStreaming` to never report as `true`.

---

## Build & Packaging

### Build pipeline

```
tsc (main process) ──► dist/main/main.js
tsc (preload)      ──► dist/preload/preload.js
webpack (renderer) ──► dist/renderer/bundle.js + index.html
```

### Scripts

```bash
npm run build              # Full build
npm run dev                # Watch mode (concurrent tsc + webpack --watch)
npm run dev:start          # Watch + auto-launch Electron
npm start                  # Launch built app
npm run test:e2e           # Headless Playwright tests
npm run test:e2e:headed    # Visible Playwright tests
npm run pack               # Unpacked build (for testing)
npm run dist               # NSIS installer (electron-builder)
```

### Package output

- Installer: `release/OS Assistant Setup x.x.x.exe` (NSIS, per-user, optional desktop shortcut).
- Build resources: `assets/icon.png` for installer icon.

---

## Extending the App

### Add a new AI provider

1. Add the provider ID to `AIProviderType` union in `types/index.ts`.
2. Add a `AIProvider` entry with `defaultBaseUrl`, `defaultModel`, etc.
3. Add a case to `streamChatCompletion()` in `ai-client.ts`.
4. Implement the streaming function (modeled after `streamOpenAICompatible`).
5. Test with the Playwright e2e test suite.

### Add a new tool

1. Add a `ToolDefinition` entry to `AI_TOOLS` in `ai-client.ts`.
2. Add a `case` to the `executeTool()` function in `useAI.ts`.
3. Wire up the IPC handler in main process if needed.
4. Add the preload bridge method in `preload.ts` if needed.

### Add a new theme

1. Add the theme CSS variables to `app.css` (see existing theme blocks).
2. Add the theme name to the theme selector list in `SettingsPanel.tsx`.

### Run Playwright tests

```bash
# Headless (CI)
npm run test:e2e

# Visible (debugging)
npm run test:e2e:headed

# With Playwright debugger
npm run test:e2e:debug
```

The e2e tests require a valid API key. By default they use the DeepSeek key embedded in the test file — override with `TEST_DEEPSEEK_API_KEY` environment variable.

---

## Key Files at a Glance

| File                                      | Lines | Responsibility                               |
| ----------------------------------------- | ----- | -------------------------------------------- |
| `src/main/main.ts`                        | ~50   | Window creation, DevTools shortcuts          |
| `src/main/terminal.ts`                    | ~200  | PTY lifecycle, ring buffer, command capture  |
| `src/main/ipc-handlers.ts`                | ~400  | All IPC handlers, encrypted config, sessions |
| `src/preload/preload.ts`                  | ~200  | contextBridge — 9 API surfaces               |
| `src/renderer/App.tsx`                    | ~250  | Root component, shortcuts, layout            |
| `src/renderer/hooks/useAI.ts`             | ~350  | Core AI loop (while-loop), tool execution    |
| `src/renderer/components/ChatPane.tsx`    | ~650  | Chat UI, sessions, message rendering         |
| `src/renderer/utils/ai-client.ts`         | ~550  | Streaming clients, system prompt, tool defs  |
| `src/renderer/utils/command-validator.ts` | ~80   | Danger pattern detection                     |
| `src/renderer/styles/app.css`             | ~2000 | Full app stylesheet                          |
| `e2e/helpers.ts`                          | ~130  | Playwright test helpers                      |
