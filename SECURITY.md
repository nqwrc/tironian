# Security Policy

## Supported Versions

This is a personal fork. Only the latest commit on the default branch is supported.

| Version | Supported          |
| ------- | ------------------ |
| latest  | :white_check_mark: |
| older   | :x:                |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Open a [GitHub issue on nqwrc/tironian](https://github.com/nqwrc/tironian/issues) marked as a security report, addressed to the maintainer, Nicola Pandolfi. There is no separate disclosure channel; use the issue tracker.

### What to Include in Your Report

Please include the following information to help triage your report quickly:

- Type of issue (e.g., remote code execution, API key exposure, cross-site scripting, etc.)
- Full paths of source file(s) related to the manifestation of the issue
- The location of the affected source code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce the issue
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if possible)
- Impact of the issue, including how an attacker might exploit it

### Security Considerations Specific to Tironian

Given that Tironian is a Tauri-based desktop application that handles API keys and sensitive data, reports about the following are particularly welcome:

- **API Key Security**: Issues related to how user API keys are stored, transmitted, or exposed
- **Local Data Storage**: Vulnerabilities in how transcriptions and user data are stored locally
- **Tauri IPC**: Security issues in the communication between frontend and backend
- **File System Access**: Unauthorized file system access or path traversal vulnerabilities
- **Audio Processing**: Issues in audio file handling that could lead to code execution
- **Update Mechanism**: Vulnerabilities in the auto-update process
- **Third-party Integrations**: Security issues with LLM provider integrations (OpenAI, Anthropic, etc.)

### What to Expect

- **Response Time**: Best effort; this is a single-maintainer fork, not a company.
- **Communication**: Progress will be posted on the issue.
- **Resolution**: Patches are released as time allows, prioritized by severity.

## Security Best Practices for Users

While using Tironian:

1. **API Keys**: Never share your API keys. Tironian stores them locally and never transmits them to a server it does not own.
2. **Updates**: Keep Tironian updated to the latest build for security fixes.
3. **Downloads**: Only download Tironian from the [nqwrc/tironian](https://github.com/nqwrc/tironian) GitHub releases.
4. **Local Storage**: Transcriptions are stored locally; secure your device appropriately.

## Safe Harbor

Any activities conducted in a manner consistent with this policy will be considered authorized conduct. If legal action is initiated by a third party against you in connection with activities conducted under this policy, the maintainer will take steps to make it known that your actions were conducted in compliance with this policy.

## License

Tironian is open source under a split license: the apps are [AGPL-3.0](licenses/LICENSE-AGPL-3.0), and the developer toolkit is [MIT](licenses/LICENSE-MIT). See the root [LICENSE](LICENSE) index.

---

Thank you for helping keep Tironian and its users safe.
