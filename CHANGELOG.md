# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] — 2026-06-27

### Added

- GitHub Actions CI workflow (lint + build + test on every PR)
- GitHub Actions Release workflow (auto-builds `.exe` installer on version tags)
- GitHub issue & PR templates (bug report, feature request, PR checklist)
- `SUPPORT.md` with self-serve guidance
- `SECURITY.md` with vulnerability reporting policy
- `CONTRIBUTING.md` with full contributor guide
- Stale issue auto-management (60d → close)
- `.editorconfig` and `.prettierrc` for consistent code style
- Rate limiting between AI tool calls (1200ms minimum gap)
- Dangerous command detection — even in auto mode, destructive commands (del, format, diskpart, shutdown, reg delete, etc.) require user approval
- Terminal reset capability via IPC
- Output caching for reliable terminal buffer reads
- `measure_bandwidth` tool using curl

### Fixed

- Terminal marker pollution — commands now use `@echo` wrapping instead of raw markers
- `read_terminal_output` retry with 800ms wait on empty buffer

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
