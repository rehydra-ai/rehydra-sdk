# @rehydra/opencode

Prevent your coding agent from leaking secrets to LLM providers.

This plugin intercepts the conversation between [OpenCode](https://github.com/sst/opencode) and the LLM. Secrets from your `.env` files are replaced with placeholders before they leave your machine, and transparently restored before any tool (shell commands, file writes, etc.) executes locally.

```
You                          LLM Provider
 |                                |
 |  "set key AKIA4EXA..."        |
 |  ───────────────────►         |
 |        ┌─────────┐            |
 |        │ rehydra │            |
 |        └────┬────┘            |
 |             │                 |
 |  "set key <PII id="1"/>"     |
 |  ─────────────────────────►   |
 |                                |
 |  "$ zwrm set KEY <PII .../>"  |
 |  ◄─────────────────────────   |
 |        ┌─────────┐            |
 |        │ rehydra │            |
 |        └────┬────┘            |
 |             ▼                 |
 |  $ zwrm set KEY AKIA4EXA...  |
```

The LLM never sees real secret values. Your tools run with them.

## Install

```bash
npm install @rehydra/opencode
```

Add to `opencode.json`:

```json
{
  "plugin": ["@rehydra/opencode"]
}
```

By default, the plugin reads `.env` in your project root. Secrets with values of 4+ characters are detected and scrubbed.

## Configuration

For custom settings, create `.opencode/plugins/rehydra.ts`:

```typescript
import { createRehydraPlugin } from "@rehydra/opencode";

export default createRehydraPlugin({
  // Scan multiple env files
  envFiles: [".env", ".env.local", ".env.production"],

  // Always redact these values, even if not in .env
  redactValues: ["sk-live-abc123..."],

  // Minimum value length to consider a secret (default: 4)
  minValueLength: 6,
});
```

## What gets detected

- Environment variable values from `.env` files
- API keys, tokens, and credentials (pattern-based)
- AWS access keys and secret keys
- JWTs, private keys, connection strings
- Any values passed via `redactValues`

## How it works

The plugin uses five OpenCode hooks:

| Hook | What it does |
|---|---|
| `messages.transform` | Scrubs secrets from all message text before it reaches the LLM |
| `system.transform` | Tells the LLM to treat placeholders as real values |
| `tool.execute.before` | Restores real values in tool arguments before local execution |
| `tool.execute.after` | Restores real values in displayed tool output |
| `text.complete` | Restores real values in LLM response text shown to you |

Everything runs locally. No data leaves your machine except the scrubbed conversation sent to the LLM provider.

## Logging

Plugin activity is logged to OpenCode's log directory (`~/.local/share/opencode/log/`). Run with `--log-level DEBUG` for detailed output.

```
INFO service=rehydra scrubbed={"ENV_VAR_SECRET":2} messageCount=3 scrubbed 2 secret(s) from messages
INFO service=rehydra tool=bash callID=call_abc123 rehydrated PII tags in tool args
```

## Rehydra

This plugin is part of [Rehydra](https://github.com/rehydra-ai/rehydra-sdk), an open-source SDK for PII anonymization and rehydration. Rehydra combines regex-based pattern matching with NER-based detection and supports any LLM provider via fetch wrappers, proxy servers, or framework plugins.

Full documentation at [docs.rehydra.ai](https://docs.rehydra.ai).

## License

MIT
