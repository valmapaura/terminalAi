# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2025-01-01

### Added

- Initial release of OS Assistant
- Split-screen terminal + AI chat interface
- Multi-provider AI support: DeepSeek, OpenAI, Azure OpenAI, Anthropic Claude, Google Gemini, and custom OpenAI-compatible endpoints
- Streaming AI responses with real-time rendering
- Tool calling: AI can execute commands, read files, list directories, and manage memory
- Command preview with safety controls (sandbox mode)
- Encrypted API key storage via Electron `safeStorage`
- Resizable horizontal/vertical split panes
- 4 VS Code-inspired themes (Dark Modern, Light Modern, Solarized Dark, Solarized Light)
- Session history and message persistence
- Agent mode: auto-execute or interactive (ask before each tool call)
- E2E tests with Playwright
