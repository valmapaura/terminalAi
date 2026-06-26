# ◆ Terminal AI

> **Your AI copilot for the terminal.** Multi-provider, split-screen terminal + AI assistant.

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
git clone https://github.com/your-username/terminal-ai.git
cd terminal-ai
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
terminal-ai/
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
