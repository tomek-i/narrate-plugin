# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, report privately via GitHub's
[**Report a vulnerability**](https://github.com/tomek-i/narrate-plugin/security/advisories/new)
button (Security → Advisories), or email tomek.iwainski@gmail.com.

Include steps to reproduce and the affected version/commit. You'll get an
acknowledgement within a few days, and a fix or mitigation plan once triaged.

## Scope & notes

- This tool runs a **local** headless browser and shells out to **ffmpeg**;
  it does not run a network service.
- `eval` steps and the `apiKeyEnv` config execute/resolve values from **local,
  trusted** scene/config files. Don't run scenes you don't trust.
- TTS API keys live in `.env.narrate` (gitignored) — never commit real keys.
