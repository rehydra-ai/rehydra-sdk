# @rehydra/opencode

Scrub detected secrets from OpenCode messages before the main LLM request.

This plugin intercepts the conversation between [OpenCode](https://github.com/anomalyco/opencode) and the LLM. Secrets from your `.env` files are replaced with placeholders before they leave your machine, and transparently restored before any tool (shell commands, file writes, etc.) executes locally.

Detected values are masked in requests that pass through the plugin hooks. Local tools receive the restored values.

**OpenCode compatibility:** the default entrypoint supports both OpenCode 2 (V2 plugin API, which reads `id` and `setup()`) and OpenCode 1 (1.18.29 and later call `server()` on object entrypoints; older releases should import the `rehydra` function export or pin `@rehydra/opencode@0.14`). OpenCode 2 also accepts the old singular `plugin` config key. The same package ships both implementations:

- OpenCode 2 — `Plugin.define({ id: "rehydra", setup(ctx) })` via `createRehydraPluginV2()`
- OpenCode 1 — classic hooks object via `createRehydraPlugin()`

## Install

```bash
npm install @rehydra/opencode
```

Add to `opencode.json` — **OpenCode 2** uses the plural `plugins` key:

```json
{
  "plugins": ["@rehydra/opencode"]
}
```

**OpenCode 1** uses the singular `plugin` key:

```json
{
  "plugin": ["@rehydra/opencode"]
}
```

By default, the plugin discovers `**/.env*` under the OpenCode project directory, including files such as `packages/api/.env` and `apps/web/.env.local`. It skips `node_modules`, `.git`, and symbolic links. Secrets with values of 4+ characters are detected and scrubbed.

`envFiles` accepts exact paths and glob patterns, resolved against the project directory even when OpenCode starts elsewhere. Use `envFiles: [".env"]` for root-only loading, or `envFiles: []` to disable file loading. Before a model request, the plugin checks the files again if at least `envRefreshInterval` milliseconds (default 2000) have passed since the last check, so new or changed secrets are picked up without restarting OpenCode. Set `envRefreshInterval: false` to load them only at startup. Missing files are ignored. An advanced `anonymizer` configuration keeps control of its own `secrets` settings, with relative paths still rooted at the project directory unless `secrets.envBaseDirectory` is set.

## Configuration

### OpenCode 2 — plugin options

OpenCode 2 passes options natively, with no local plugin file needed:

```json
{
  "plugins": [
    {
      "package": "@rehydra/opencode",
      "options": {
        "envFiles": [".env", ".env.local", ".env.production"],
        "redactValues": ["sk-live-abc123..."],
        "minValueLength": 6,
        "disableTypes": ["URL", "IP_ADDRESS"],
        "redactTools": ["webfetch", "websearch", "*image_generate", "exa_*"],
        "vcsIdentities": true
      }
    }
  ]
}
```

Options in the config object map 1:1 to `RehydraPluginOptions`. When both config options and factory options are given, factory options win per key.

### OpenCode 1 — plugin options

OpenCode 1 takes options as the second element of a `[package, options]` entry:

```json
{
  "plugin": [
    ["@rehydra/opencode", { "disableTypes": ["URL", "IP_ADDRESS", "DATE"] }]
  ]
}
```

`disableTypes` replaces the default list, so keep `URL` and `IP_ADDRESS` in it if they should stay disabled.

### Local plugin file

For custom settings via a local plugin file (`.opencode/plugins/rehydra.ts`), use the factory matching your OpenCode version:

```typescript
import { createRehydraPluginV2 } from "@rehydra/opencode";

export default createRehydraPluginV2({
  // Scan multiple env files
  envFiles: [".env", ".env.local", ".env.production"],

  // Always redact these values, even if not in .env
  redactValues: ["sk-live-abc123..."],

  // Minimum value length to consider a secret (default: 4)
  minValueLength: 6,

  // Disable detection of specific PII types
  disableTypes: ["URL", "IP_ADDRESS"],

  // Keep placeholders in the arguments of tools that call external services
  redactTools: ["webfetch", "websearch", "*image_generate", "exa_*"],

  // Redact identities in Git and GitHub CLI output
  vcsIdentities: true,
});
```

On OpenCode 1, import `createRehydraPlugin` instead (it returns the callable V1 plugin).

`vcsIdentities` detects logins in `gh pr` and `gh api` output, plus author and committer names in `git log`, `git show`, and `git blame` output. It redacts every occurrence of those identities in the same tool output without touching npm scopes or other `@` identifiers in unrelated commands. GitHub display names outside these structured fields still require the optional local NER model.

`redactTools` lists tools whose arguments keep their placeholders. The plugin normally restores real values before a tool runs. For these tools it leaves the placeholders in place and redacts any other detected values in the arguments, so secrets and PII don't reach external services through tools such as `webfetch`, `websearch`, or OpenCode 2's `experimental_image_generate`, which sends its prompt to an image model. `*` matches any characters, which helps with MCP tools: `"exa_*"`. The default is `["webfetch", "websearch", "*image_generate"]`. Setting `redactTools` replaces it, so keep those in your list, or pass `[]` to restore real values for every tool.

## What gets detected

- Environment variable values from `.env` files
- API keys, tokens, and credentials (pattern-based)
- AWS access keys and secret keys
- JWTs, private keys, connection strings
- Any values passed via `redactValues`

## How it works

### OpenCode 2 hooks

| Hook                                                            | What it does                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| `session.hook("context" / "compaction" / "generate" / "title")` | Scrubs secrets from all message text before each model request |
| `event.system.push(...)`                                        | Tells the LLM to treat placeholders as real values             |
| `tool.hook("execute.before")`                                   | Restores real values in tool arguments before local execution, except for `redactTools` |
| `tool.hook("execute.after")`                                    | Restores real values in displayed tool output                  |

The scrubber is registered on all four session-request kinds, so title generation, checkpoint compaction, and transient generates are protected too.

### OpenCode 1 hooks

| Hook                                   | What it does                                                   |
| -------------------------------------- | -------------------------------------------------------------- |
| `experimental.chat.messages.transform` | Scrubs secrets from all message text before it reaches the LLM |
| `experimental.chat.system.transform`   | Tells the LLM to treat placeholders as real values             |
| `tool.execute.before`                  | Restores real values in tool arguments before local execution, except for `redactTools` |
| `tool.execute.after`                   | Restores real values in displayed tool output                  |
| `experimental.text.complete`           | Restores real values in LLM response text shown to you         |

Detection and rehydration run locally. No data leaves your machine except the scrubbed conversation sent to the LLM provider.

## Known limitations

### Session titles — fixed on OpenCode 2

OpenCode 1 sends the first user message to a separate LLM call to generate a session title. That call bypasses `experimental.chat.messages.transform`, so the V1 plugin cannot scrub it ([OpenCode issue #46115](https://github.com/anomalyco/opencode/issues/46115)). On OpenCode 1, disable the title agent:

```json
{
  "plugin": ["@rehydra/opencode"],
  "agent": {
    "title": { "disable": true }
  }
}
```

On OpenCode 2 this workaround is unnecessary — the plugin registers a `title` session hook and scrubs the request.

### Final response text on OpenCode 2

OpenCode 2 removed the `experimental.text.complete` hook with no replacement. Tool execution and outgoing conversation history stay protected; assistant responses that echo a PII placeholder into chat text will display the placeholder (`<PII type="…" id="…"/>`) instead of the real value. Tool arguments referencing the placeholder still receive real values before local execution.

## Logging

Plugin activity is logged to OpenCode's log directory (`~/.local/share/opencode/log/`). OpenCode 2 plugins log through the console (captured by OpenCode's log service); OpenCode 1 plugins log through the internal log API. Run with `--log-level DEBUG` for detailed output.

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
