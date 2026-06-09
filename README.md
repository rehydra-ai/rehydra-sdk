<p align="center">
  <img src="https://framerusercontent.com/images/NT4xWP34VHd2Wlrk197je5BUi4.png?scale-down-to=512" width="400" alt="Rehydra" />
</p>

<p align="center">
  PII security for AI workflows, coding agents and browser workloads.<br/>
  Detects, replaces, encrypts, and <strong>rehydrates</strong> back when needed.
</p>

<p align="center">
  <a href="https://docs.rehydra.ai">Documentation</a> · <a href="https://github.com/rehydra-ai/rehydra-sdk/issues">Issues</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/rehydra"><img src="https://img.shields.io/npm/v/rehydra?color=blue" alt="npm" /></a>
  <a href="https://github.com/rehydra-ai/rehydra-sdk/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rehydra-ai/rehydra-sdk" alt="license" /></a>
  <a href="https://codecov.io/github/rehydra-ai/rehydra"><img src="https://codecov.io/github/rehydra-ai/rehydra/graph/badge.svg?token=WX5RI0ZZJG" alt="codecov" /></a>
</p>

<p align="center">
  <code>npm i rehydra</code> · <code>npm i <a href="packages/cli/">@rehydra/cli</a></code> · <code>npm i <a href="packages/opencode-plugin/">@rehydra/opencode</a></code>
</p>

## The Problem

When you send code, messages, or documents through an LLM, real names, emails, and API keys go with them. Existing anonymizers strip PII permanently but that breaks the conversation. The LLM can't reason about "John" if it never sees "John," and it can't write a file referencing `john@acme.com` if that address was permanently removed.

You need pseudonyms that the LLM can work with, and that your tools can reverse.

## How Rehydra Solves It

1. **Detect** — Regex patterns catch structured PII (emails, phones, IBANs, credit cards). An on-device NER model (ONNX, no cloud calls) catches soft PII (names, organizations, locations).
2. **Replace** — Each PII value gets a stable placeholder: `<PII type="PERSON" id="1"/>`. The LLM works with these instead of real data.
3. **Persist** — The same entity always gets the same ID, across every message in the session. The LLM maintains relational coherence without ever seeing real PII.
4. **Rehydrate** — When a response needs to become real again (a file write, a bash command, a final answer), Rehydra restores the original values from its encrypted map.

## Quick Start

### Proxy — protect your AI coding tools

Run a local proxy that anonymizes PII before it reaches the LLM and rehydrates responses. Works with Claude Code, Cursor, and any OpenAI/Anthropic-compatible client.

```bash
npx @rehydra/cli proxy claude --api-key sk-ant-...
```

```
  rehydra proxy

  Provider   anthropic (https://api.anthropic.com)
  Listening  http://127.0.0.1:8787
  NER        quantized

  Configure your tools:

  Claude Code
    ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
```

Names, emails, phone numbers, and secrets are replaced with placeholders in transit. Tool results (file reads, bash output) are anonymized on the way out. Tool call arguments (file writes, bash commands) are rehydrated on the way back. The LLM never sees real PII — but your tools always get real values.

> **Note:** The proxy requires an [Anthropic API key](https://console.anthropic.com/settings/keys). Claude Max/Pro subscriptions use OAuth which `api.anthropic.com` does not support through proxies.

### Browser extension — anonymize ChatGPT and Gemini

Install the [Rehydra Chrome extension](https://chromewebstore.google.com/detail/rehydra-%E2%80%93-ki-privacy-date/oaiimlliicjbmgmamiahhnafpcenpohh) to protect PII directly in your browser. It replaces names, emails, phone numbers, and secrets with placeholders before your messages reach ChatGPT or Gemini, and rehydrates the responses back to real values in the UI. Detection runs on-device — no data leaves your machine.

### OpenCode plugin

```bash
npm install @rehydra/opencode
```

```json
{ "plugin": ["@rehydra/opencode"] }
```

Intercepts the conversation between [OpenCode](https://github.com/sst/opencode) and the LLM. Secrets from `.env` files are replaced with placeholders before they leave your machine and restored before tools execute.

### CLI

For automation and server-side use.

<p align="center">
  <img src="demo.gif" alt="Rehydra Demo" />
</p>

### Library — embed PII anonymization in your app

Highly customizable backbone of the implementations above. Supports custom NER models, encryption key providers, session storage providers, tag formats and many more tweaks.

```typescript
import { anonymize } from 'rehydra';

const { anonymizedText } = await anonymize(
  'Email john.smith@acme-corp.com or call John at +41 79 123 45 67'
);
```

Works in **Node.js**, **Bun**, and **browsers**. No data leaves your machine.

## Why Rehydra?

### Reversible, not destructive

Most PII libraries mask or redact permanently. Rehydra encrypts the original values with AES-256-GCM and restores them on demand. Anonymize for the LLM, rehydrate for your tools — a full round-trip, not a one-way street.

### Session-persistent identity

`PERSON_1` stays `PERSON_1` across every message in the conversation. When John Smith comes up in message 1, message 5, and message 20, the LLM sees the same placeholder every time. It can track relationships, reference earlier context, and produce coherent multi-turn output — without ever seeing real PII. Sessions persist to SQLite (server), IndexedDB (browser), or in-memory, so identity mappings survive restarts.

### Zero-trust, on-device

NER inference runs locally via ONNX Runtime (~280 MB quantized model). No API calls to external services. Works offline. PII never leaves your machine.

### LLM proxy with tool-call rehydration

The CLI proxy sits between your coding agent and the API. It anonymizes outbound messages and — critically — rehydrates tool-call arguments before they execute. When the LLM says "write `<PII type="EMAIL" id="1"/>` to config.yaml," the proxy restores the real email before the file is written. Your agent works normally. Your data stays private.

### Secrets, not just PII

Beyond names, emails, and phone numbers, Rehydra detects API keys (OpenAI, Anthropic, Stripe, AWS, GitHub...), JWTs, private keys, database connection strings, and `.env` secrets.

### Streaming-aware

Purpose-built for LLM token streams. A sentence-buffered chunking system with NER overlap preservation ensures accurate detection even when PII spans chunk boundaries — with a low-latency mode for real-time streaming.

### Semantic enrichment for machine translation

Optional gender and scope attributes on PII tags (`<PII type="PERSON" gender="male" id="1"/>`, `<PII type="LOCATION" scope="city" id="2"/>`) preserve grammatical context for downstream systems.

## Example: Full Round-Trip with Sessions

```typescript
import {
  createAnonymizer,
  InMemoryKeyProvider,
  SQLitePIIStorageProvider,
} from 'rehydra';

const keyProvider = new InMemoryKeyProvider();
const anonymizer = createAnonymizer({
  ner: {
    mode: 'quantized',              // ~280 MB model, auto-downloads on first use
    caseFallback: true,             // detect lowercase names like "tom"
    thresholds: { PERSON: 0.8 },   // require higher confidence for names
    onStatus: console.log,          // log model download progress
  },
  semantic: { enabled: true },      // adds gender/scope attributes for MT
  secrets: { enabled: true },       // detect API keys, JWTs, connection strings
  keyProvider,
  piiStorageProvider: new SQLitePIIStorageProvider('./pii.db'),
});

const session = anonymizer.session('chat-123');

// Message 1 — NER detects names and orgs, regex catches emails
const r1 = await session.anonymize(
  'Tell John Smith at Acme Corp (john.smith@acme-corp.com) we accept the offer'
);
// → "Tell <PII type="PERSON" gender="male" id="1"/> at <PII type="ORG" id="2"/>
//    (<PII type="EMAIL" id="3"/>) we accept the offer"

// Message 2 — same entities keep their IDs across messages
const r2 = await session.anonymize(
  'CC john.smith@acme-corp.com and loop in admin@acme-corp.com'
);
// → "CC <PII type="EMAIL" id="3"/> and loop in <PII type="EMAIL" id="4"/>"

// Rehydrate any message — PII map is loaded from SQLite automatically
const original = await session.rehydrate(r2.anonymizedText);
// → "CC john.smith@acme-corp.com and loop in admin@acme-corp.com"

await anonymizer.dispose();
```

## Packages

| Package | Description |
|---------|-------------|
| [`rehydra`](https://www.npmjs.com/package/rehydra) | Core SDK — detect, anonymize, rehydrate |
| [`@rehydra/cli`](packages/cli/) | CLI proxy and terminal anonymization |
| [`@rehydra/opencode`](packages/opencode-plugin/) | OpenCode plugin — scrubs secrets before they reach LLM providers |

## Documentation

For API reference, configuration, guides, and examples, visit **[docs.rehydra.ai](https://docs.rehydra.ai)**.

## License

[MIT](LICENSE)
