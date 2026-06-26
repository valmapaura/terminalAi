# ◆ OS Assistant

> **Your AI assistant for the operating system.** Multi-provider, split-screen terminal + AI assistant that can control your machine through natural language.

---

## Features

| Feature                 | Description                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| **Split‑Screen Layout** | Resizable terminal and chat panes (horizontal or vertical)                                         |
| **Terminal Pane**       | Windows CMD via `node-pty` + `xterm.js`                                                            |
| **AI Chat**             | Streaming AI assistant with tool calling — run commands, read output, help you script              |
| **Multi-Provider**      | DeepSeek, OpenAI, Azure OpenAI, Anthropic Claude, Google Gemini, or any OpenAI-compatible endpoint |
| **Command Injection**   | AI suggests commands → preview → accept/reject before execution                                    |
| **Safety Controls**     | VS Code protection pattern — preview dangerous commands before execution                           |
| **4 VS Code Themes**    | Dark Modern, Light Modern, Solarized Dark, Solarized Light — with matching xterm terminal colors   |
| **Encrypted Keys**      | API keys encrypted at rest via Electron `safeStorage` (Windows Credential Manager)                 |

### Supported AI Providers

| Provider      | Default Model      | Streaming | Tool Calling |
| ------------- | ------------------ | --------- | ------------ |
| DeepSeek      | `deepseek-chat`    | ✅        | ✅           |
| OpenAI        | `gpt-4o`           | ✅        | ✅           |
| Azure OpenAI  | `gpt-4o`           | ✅        | ✅           |
| Anthropic     | `claude-sonnet-4`  | ✅        | ✅           |
| Google Gemini | `gemini-2.0-flash` | ✅        | ✅           |
| Custom (any)  | configurable       | ✅        | ✅           |

### Tech Stack

| Layer         | Technology                                                                           |
| ------------- | ------------------------------------------------------------------------------------ |
| **Framework** | [Electron](https://www.electronjs.org/) 28+                                          |
| **Terminal**  | [xterm.js](https://xtermjs.org/) + [node-pty](https://github.com/microsoft/node-pty) |
| **Frontend**  | [React](https://react.dev/) 18 + TypeScript                                          |
| **Build**     | Webpack 5 + Electron Builder                                                         |
| **Security**  | `safeStorage` encryption, `contextIsolation`, CSP                                    |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Python](https://www.python.org/) (required for `node-pty` build on Windows)

### Install & Run

```bash
git clone https://github.com/your-username/os-assistant.git
cd os-assistant
npm install
npm run build
npm start
```

### First Launch

1. The app opens with a terminal (left) and chat (right)
2. Click **Configure API Key** in the chat pane, or ⚙️ in the menu bar
3. Pick your AI provider and enter your API key
4. Start chatting — the AI can run commands, read terminal output, and help you script

> **No template text, no cruft.** Just a terminal, an AI chat, and your API key.

---

## Usage

- **`Ctrl+,`** — Toggle settings
- **`Escape`** — Close command preview / settings
- **`Ctrl+L`** — Clear terminal
- Type in chat → AI responds with code blocks → click **⚡ Run** to execute
- Sandbox mode previews all commands before execution (enabled by default)

---

## Project Structure

```
os-assistant/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── main.ts           # App entry, frameless window
│   │   ├── terminal.ts       # node-pty terminal manager
│   │   └── ipc-handlers.ts   # IPC + encrypted provider config
│   ├── preload/
│   │   └── preload.ts        # Context bridge (terminal, provider, window controls)
│   └── renderer/
│       ├── App.tsx            # Root — menu bar, split pane, status bar
│       ├── components/
│       │   ├── SplitPane.tsx      # Resizable split
│       │   ├── TerminalPane.tsx   # xterm.js wrapper
│       │   ├── ChatPane.tsx       # AI chat + API setup prompt
│       │   ├── SettingsPanel.tsx  # Provider config UI
│       │   └── CommandPreview.tsx # Pre-execution preview
│       ├── hooks/
│       │   ├── useTerminal.ts     # Terminal lifecycle
│       │   └── useDeepSeek.ts     # Multi-provider AI hook
│       ├── utils/
│       │   ├── deepseek-api.ts    # Universal streaming client
│       │   └── command-validator.ts
│       └── styles/
│           └── app.css
└── package.json
```

---

## Development

```bash
npm run dev     # Watch mode — auto-rebuild on changes
npm run build   # Production build
npm run dist    # Package installer
```

---

## Vision

OS Assistant is not just a terminal tool. It is a step toward an **Operating System Assistant** — an AI that understands and operates your machine the way a human would.

### The Long-Term Goal

We envision an AI that can:

- **Navigate any desktop application** — click buttons, fill forms, read UI elements, and perform multi-step workflows across any Windows application, not just the terminal.
- **Understand system state holistically** — monitor processes, services, event logs, network connections, and disk activity to give you a complete picture of what your computer is doing.
- **Automate complex OS tasks** — install software, configure system settings, manage users, troubleshoot drivers, and orchestrate multi-tool workflows without requiring custom scripting.
- **Learn from your patterns** — remember how you like your system configured, anticipate maintenance needs, and proactively suggest optimizations.
- **Cross-platform parity** — deliver the same deep integration on macOS and Linux, adapting to each platform's unique APIs and conventions.
- **Operate with transparency and safety** — always show what it intends to do, ask for confirmation on destructive actions, and let you audit every decision it made.

### Why This Matters

The terminal is the most powerful interface to a computer — but it has a steep learning curve. GUIs are accessible but limit what you can express. OS Assistant bridges the gap: it lets you express intent in natural language and translates that into precise, safe, multi-step operations across the full breadth of your operating system.

We start with the terminal because it is the most direct, most capable interface to the machine. From there, we expand to window management, application control, and eventually full OS orchestration — all while keeping you in control.

> **Today: A terminal AI that runs commands. Tomorrow: An AI that runs your computer — with your permission.**

---

## Security

- API keys encrypted at rest via Electron `safeStorage` (Windows Credential Manager)
- Commands validated before injection into the terminal
- Dangerous commands always require user confirmation
- Sandbox mode prevents any execution without preview
- CSP headers restrict renderer connectivity

---

## License

MIT

---

## 🙌 Contributing

Contributions are welcome! This project is structured to grow:

1. Fork the repo
2. Create a feature branch
3. Make your changes
4. Submit a PR

See the [Roadmap](#roadmap) for planned features.
