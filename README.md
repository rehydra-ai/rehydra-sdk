# Rehydra

![Rehydra Logo](https://framerusercontent.com/images/NT4xWP34VHd2Wlrk197je5BUi4.png?scale-down-to=512&width=6516&height=1752)

![License](https://img.shields.io/github/license/rehydra-ai/rehydra)
![Issues](https://img.shields.io/github/issues/rehydra-ai/rehydra)
[![codecov](https://codecov.io/github/rehydra-ai/rehydra/graph/badge.svg?token=WX5RI0ZZJG)](https://codecov.io/github/rehydra-ai/rehydra)

On-device PII anonymization for AI workflows. Detects names, emails, phones, IBANs, and more — replaces them with encrypted placeholder tags — and rehydrates them back after processing.

```bash
npm install rehydra
```

**Works in Node.js, Bun, and browsers.** No data leaves your machine.

## OpenCode Plugin

Protect your coding agent from leaking secrets to LLM providers. Secrets from `.env` files are scrubbed before they leave your machine and restored before tools execute locally.

```bash
npm install @rehydra/opencode
```

```json
{ "plugin": ["@rehydra/opencode"] }
```

See [@rehydra/opencode](packages/opencode-plugin/) for configuration and details.

## CLI

Anonymize and rehydrate text from the terminal:

```bash
npx @rehydra/cli anonymize "Email john@example.com about the meeting"
# Email <PII type="EMAIL" id="1"/> about the meeting

npx @rehydra/cli rehydrate --pii-map ./pii-map.json "Email <PII type=\"EMAIL\" id=\"1\"/> about the meeting"
# Email john@example.com about the meeting
```

See [@rehydra/cli](packages/cli/) for all commands.

## Quick Start

```typescript
import { createAnonymizer, decryptPIIMap, rehydrate, InMemoryKeyProvider } from 'rehydra';

const keyProvider = new InMemoryKeyProvider();
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },  // ~280 MB model, auto-downloads on first use
  keyProvider,
});

const result = await anonymizer.anonymize(
  'Email john.smith@acme-corp.com or call John at +41 79 123 45 67'
);

console.log(result.anonymizedText);
// "Email <PII type="EMAIL" id="1"/> or call <PII type="PERSON" id="2"/> at <PII type="PHONE" id="3"/>"

// Rehydrate after translation or other processing
const key = await keyProvider.getKey();
const piiMap = await decryptPIIMap(result.piiMap!, key);
const original = rehydrate(result.anonymizedText, piiMap);
// "Email john.smith@acme-corp.com or call John at +41 79 123 45 67"

await anonymizer.dispose();
```

## LLM Proxy

Drop-in middleware that anonymizes prompts before they leave your machine and rehydrates responses. Works with OpenAI, Anthropic, and any OpenAI-compatible API.

### Wrap any fetch-based client

```typescript
import OpenAI from 'openai';
import { createRehydraFetch, InMemoryKeyProvider, InMemoryPIIStorageProvider } from 'rehydra';

const openai = new OpenAI({
  fetch: createRehydraFetch({
    anonymizer: { ner: { mode: 'quantized' } },
    keyProvider: new InMemoryKeyProvider(),
    piiStorageProvider: new InMemoryPIIStorageProvider(),
  }),
});

// PII is anonymized before leaving your machine, response is rehydrated automatically
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Draft a reply to john@example.com about the meeting' }],
});
```

### Or use wrapLLMClient for even less code

```typescript
import OpenAI from 'openai';
import { wrapLLMClient, InMemoryKeyProvider, InMemoryPIIStorageProvider } from 'rehydra';

const openai = wrapLLMClient(new OpenAI(), {
  keyProvider: new InMemoryKeyProvider(),
  piiStorageProvider: new InMemoryPIIStorageProvider(),
});
```

### Standalone proxy server

Point any LLM client at a local proxy — zero code changes needed:

```typescript
import { createRehydraProxyServer, InMemoryKeyProvider, InMemoryPIIStorageProvider } from 'rehydra';

const proxy = await createRehydraProxyServer({
  port: 8080,
  upstream: 'https://api.openai.com',
  keyProvider: new InMemoryKeyProvider(),
  piiStorageProvider: new InMemoryPIIStorageProvider(),
});

// Point your client at the proxy
const openai = new OpenAI({ baseURL: 'http://localhost:8080/v1' });
```

Supports non-streaming and streaming (SSE) responses for both OpenAI and Anthropic APIs.

## Streaming

Process text chunk-by-chunk with constant memory. Works as a Node.js Transform stream.

```typescript
import { createReadStream, createWriteStream } from 'fs';
import { createAnonymizerStream, InMemoryKeyProvider } from 'rehydra';

const stream = await createAnonymizerStream({
  anonymizer: { ner: { mode: 'quantized' } },
  keyProvider: new InMemoryKeyProvider(),
  sessionId: 'batch-job-001',
  piiStorageProvider: storage,
});

createReadStream('input.txt').pipe(stream).pipe(createWriteStream('anonymized.txt'));
```

### Low-latency mode for LLM token streams

Regex-only, smaller buffers, flushes aggressively — designed for real-time token streams:

```typescript
const stream = await createAnonymizerStream({
  buffer: { lowLatency: true },
});

llmTokenStream.pipe(stream).on('data', (chunk) => {
  ws.send(chunk.toString());
});
```

### Stream from a session

```typescript
const session = anonymizer.session('chat-123');
const stream = await session.createStream();
input.pipe(stream).pipe(output);
```

## Sessions

For multi-message conversations where PII IDs need to stay consistent and PII maps need to persist:

```typescript
import {
  createAnonymizer,
  InMemoryKeyProvider,
  SQLitePIIStorageProvider,  // or InMemoryPIIStorageProvider, IndexedDBPIIStorageProvider
} from 'rehydra';

const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  keyProvider: new InMemoryKeyProvider(),
  piiStorageProvider: new SQLitePIIStorageProvider('./pii.db'),
});

const session = anonymizer.session('chat-123');

// Message 1
await session.anonymize('Contact me at user@example.com');
// → "Contact me at <PII type="EMAIL" id="1"/>"

// Message 2 — same email gets the same ID
await session.anonymize('CC: user@example.com and admin@example.com');
// → "CC: <PII type="EMAIL" id="1"/> and <PII type="EMAIL" id="2"/>"

// Rehydrate any message — auto-loads the PII map from storage
const original = await session.rehydrate(translatedText);
```

### Storage Providers

| Provider | Environment | Persistence |
|----------|-------------|-------------|
| `InMemoryPIIStorageProvider` | All | None (lost on restart) |
| `SQLitePIIStorageProvider` | Node.js, Bun | File-based (`better-sqlite3` on Node, `bun:sqlite` on Bun) |
| `IndexedDBPIIStorageProvider` | Browser | Browser storage |

## Supported PII Types

| Type | Detection | Notes |
|------|-----------|-------|
| `PERSON` | NER | Names, with optional `gender` attribute |
| `ORG` | NER | Organization names |
| `LOCATION` | NER | Places, with optional `scope` attribute (city/country/region) |
| `ADDRESS` | NER | Physical addresses |
| `DATE_OF_BIRTH` | NER | Dates of birth |
| `EMAIL` | Regex | Email addresses |
| `PHONE` | Regex | International phone numbers |
| `IBAN` | Regex + checksum | International Bank Account Numbers |
| `BIC_SWIFT` | Regex | Bank Identifier Codes |
| `CREDIT_CARD` | Regex + Luhn | Credit card numbers |
| `IP_ADDRESS` | Regex | IPv4 and IPv6 |
| `URL` | Regex | Web URLs |
| `CASE_ID` | Regex | Configurable case/ticket patterns |
| `CUSTOMER_ID` | Regex | Configurable customer ID patterns |

## Configuration

### NER Modes

| Mode | Size | Description |
|------|------|-------------|
| `'disabled'` | 0 | Regex only — no model download |
| `'quantized'` | ~280 MB | Recommended — good accuracy, smaller download |
| `'standard'` | ~1.1 GB | Best accuracy |
| `'custom'` | Varies | Bring your own ONNX model |

### Semantic Enrichment

Adds gender/scope attributes for better machine translation:

```typescript
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  semantic: { enabled: true },  // Downloads ~12 MB of name/location data
});

// "Hello <PII type="PERSON" gender="female" id="1"/> from <PII type="LOCATION" scope="city" id="2"/>!"
```

### Anonymization Policy

```typescript
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  defaultPolicy: {
    enabledTypes: new Set([PIIType.EMAIL, PIIType.PHONE, PIIType.PERSON]),
    confidenceThresholds: new Map([[PIIType.PERSON, 0.8]]),
    allowlistTerms: new Set(['Customer Service']),
    enableLeakScan: true,
  },
});
```

### Anonymization Modes

```typescript
// Pseudonymize (default): reversible, returns encrypted PII map
const anonymizer = createAnonymizer({ mode: 'pseudonymize' });

// Anonymize: irreversible, no PII map returned
const anonymizer = createAnonymizer({ mode: 'anonymize' });
```

### Custom Recognizers

```typescript
import { createCustomIdRecognizer, PIIType } from 'rehydra';

const recognizer = createCustomIdRecognizer([{
  name: 'Order Number',
  pattern: /\bORD-[A-Z0-9]{8}\b/g,
  type: PIIType.CASE_ID,
}]);

anonymizer.getRegistry().register(recognizer);
```

### GPU Acceleration

For high-throughput batch processing, use a remote inference server with GPU:

```typescript
const anonymizer = createAnonymizer({
  ner: {
    backend: 'inference-server',
    inferenceServerUrl: 'http://localhost:8080',
  },
});
```

## Encryption

PII maps are encrypted with **AES-256-GCM** via the Web Crypto API.

```typescript
// Development: random key, lost on restart
const keyProvider = new InMemoryKeyProvider();

// Production: persistent key (generate with: openssl rand -base64 32)
const keyProvider = new ConfigKeyProvider(process.env.PII_ENCRYPTION_KEY!);
```

## Platform Support

| Environment | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 18.0.0 | Uses native `onnxruntime-node` |
| Bun | >= 1.0.0 | Install `onnxruntime-web`: `bun add rehydra onnxruntime-web` |
| Browsers | Chrome 86+, Firefox 89+, Safari 15.4+ | Uses OPFS for model storage |

The browser build (`rehydra/browser`) automatically excludes Node.js dependencies. Modern bundlers (Vite, webpack, esbuild) select the right entry point via conditional exports.

## Development

```bash
npm install              # Install dependencies
npm run build            # Compile TypeScript
npm test                 # Run tests (watch mode)
npm run test:run         # Run tests once
npm run lint             # ESLint
npm run setup:ner        # Pre-download NER model (~280 MB)
npm run benchmark        # Run benchmarks

# Integration tests (require API keys)
npm run test:streaming                                      # No API key needed
OPENAI_API_KEY=... npm run test:proxy:openai -- --ner       # OpenAI with NER
ANTHROPIC_API_KEY=... npm run test:proxy:anthropic -- --ner # Anthropic with NER
```

## License

MIT
