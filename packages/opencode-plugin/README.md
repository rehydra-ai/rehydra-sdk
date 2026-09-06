# @rehydra/opencode

Scrub detected secrets from OpenCode messages before the main LLM request.

This plugin intercepts the conversation between [OpenCode](https://github.com/sst/opencode) and the LLM. Secrets from your `.env` files are replaced with placeholders before they leave your machine, and transparently restored before any tool (shell commands, file writes, etc.) executes locally.

Detected values are masked in requests that pass through the plugin hooks. Local tools receive the restored values. See the title-generation limitation below.

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

By default, the plugin discovers `**/.env*` under the OpenCode project directory, including files such as `packages/api/.env` and `apps/web/.env.local`. It skips `node_modules`, `.git`, and symbolic links. Secrets with values of 4+ characters are detected and scrubbed.

`envFiles` accepts exact paths and glob patterns, resolved against the project directory even when OpenCode starts elsewhere. Use `envFiles: [".env"]` for root-only loading, or `envFiles: []` to disable file loading. Files are loaded once when the plugin initializes; restart OpenCode after changing them. Missing files are ignored. An advanced `anonymizer` configuration keeps control of its own `secrets` settings, with relative paths still rooted at the project directory unless `secrets.envBaseDirectory` is set.

## Session title limitation

OpenCode also sends the first user message to a separate LLM call to generate a session title. That call bypasses `experimental.chat.messages.transform`, so the plugin cannot scrub it. The first message can reach the title model with secrets intact even when the main conversation is anonymized. This limitation is tracked in [OpenCode issue #46115](https://github.com/anomalyco/opencode/issues/46115).

To prevent that request, disable OpenCode's title agent in `opencode.json`:

```json
{
  "plugin": ["@rehydra/opencode"],
  "agent": {
    "title": { "disable": true }
  }
}
```

This turns off automatic session titles. Restart OpenCode after changing the configuration. The plugin protects requests that invoke its hooks; it cannot intercept other model calls made outside those hooks.

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

  // Disable detection of specific PII types
  disableTypes: ["URL", "IP_ADDRESS"],

  // Redact identities in Git and GitHub CLI output
  vcsIdentities: true,
});
```

`vcsIdentities` detects logins in `gh pr` and `gh api` output, plus author and
committer names in `git log`, `git show`, and `git blame` output. It redacts
every occurrence of those identities in the same tool output without touching
npm scopes or other `@` identifiers in unrelated commands. GitHub display names
outside these structured fields still require the optional local NER model.

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

Detection and rehydration run locally. The main conversation is scrubbed through the message hook before forwarding to the LLM provider. The separate title request described above needs its own opt-out.

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

VCS identity discovery supports direct `gh pr`, `gh api`, `git log`, `git show`, and `git blame` commands, including global options such as `git -C` and `gh --repo`. Commands hidden inside shell scripts or aliases need explicit integration or NER. GitHub discovery masks participant fields and mentions of those participants; it preserves JSON keys and npm scopes. `disableTypes` still takes precedence over identity detection.
