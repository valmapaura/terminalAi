# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | ✅ Active          |

## Reporting a Vulnerability

**OS Assistant** can execute arbitrary commands on your machine. This is by design — the AI assistant is meant to be a powerful tool that operates on your behalf. However, this power comes with responsibility.

If you discover a security vulnerability, please take the following steps:

1. **Do not** open a public GitHub issue for the vulnerability.
2. Send a description of the issue to **valmapaura** via GitHub.
3. You should receive a response within **48 hours**.
4. If the issue is confirmed, we will release a patch as soon as possible.

### What to include in your report

- A clear description of the vulnerability
- Steps to reproduce the issue
- Potential impact
- Any suggested fixes (if applicable)

## Security Features

- **Encrypted API keys** — Keys are encrypted at rest via Electron `safeStorage` (Windows Credential Manager)
- **Context isolation** — The renderer process cannot access Node.js or system APIs directly
- **Command preview** — Sandbox mode previews all commands before execution (enabled by default)
- **Danger detection** — Potentially destructive commands always require explicit user confirmation
- **Content Security Policy** — CSP headers restrict what the renderer can connect to

## Best Practices for Users

- Always review commands before accepting them, especially when using **auto** agent mode
- Keep your API keys secure — they are encrypted locally, but treat them as sensitive
- Report any suspicious behavior or unexpected command execution
