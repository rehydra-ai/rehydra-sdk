# Rehydra

![License](https://img.shields.io/github/license/rehydra-ai/rehydra)
![Issues](https://img.shields.io/github/issues/rehydra-ai/rehydra)
[![codecov](https://codecov.io/github/rehydra-ai/rehydra/graph/badge.svg?token=WX5RI0ZZJG)](https://codecov.io/github/rehydra-ai/rehydra)

On-device PII anonymization module for high-privacy AI workflows. Detects and replaces Personally Identifiable Information (PII) with placeholder tags while maintaining an encrypted mapping for later rehydration.

```bash
npm install rehydra
```

**Works in Node.js, Bun, and browsers**

## Features

- **Structured PII Detection**: Regex-based detection for emails, phones, IBANs, credit cards, IPs, URLs
- **Soft PII Detection**: ONNX-powered NER model for names, organizations, locations (auto-downloads on first use if enabled)
- **Semantic Enrichment**: AI/MT-friendly tags with gender/location attributes for better translations
- **Secure PII Mapping**: AES-256-GCM encrypted storage of original PII values
- **Cross-Platform**: Works identically in Node.js, Bun, and browsers
- **Configurable Policies**: Customizable detection rules, thresholds, and allowlists
- **Validation & Leak Scanning**: Built-in validation and optional leak detection

## Installation

### Node.js / Bun

```bash
npm install rehydra
```

### Browser (with bundler)

```bash
npm install rehydra onnxruntime-web
```

When using Vite, webpack, or other bundlers, the browser-safe entry point is automatically selected via [conditional exports](https://nodejs.org/api/packages.html#conditional-exports). This entry point excludes Node.js-specific modules like SQLite storage.

### Browser (without bundler)

```html
<script type="module">
  // Import directly from your dist folder or CDN
  import { createAnonymizer } from './node_modules/rehydra/dist/index.js';
  
  // onnxruntime-web is automatically loaded from CDN when needed
</script>
```

## Quick Start

### Regex-Only Mode (No Downloads Required)

For structured PII like emails, phones, IBANs, credit cards:

```typescript
import { anonymizeRegexOnly } from 'rehydra';

const result = await anonymizeRegexOnly(
  'Contact john@example.com or call +49 30 123456. IBAN: DE89370400440532013000'
);

console.log(result.anonymizedText);
// "Contact <PII type="EMAIL" id="1"/> or call <PII type="PHONE" id="2"/>. IBAN: <PII type="IBAN" id="3"/>"
```

### Full Mode with NER (Detects Names, Organizations, Locations)

The NER model is automatically downloaded on first use (~280 MB for quantized):

```typescript
import { createAnonymizer } from 'rehydra';

const anonymizer = createAnonymizer({
  ner: { 
    mode: 'quantized',  // or 'standard' for full model (~1.1 GB)
    onStatus: (status) => console.log(status),
  }
});

await anonymizer.initialize();  // Downloads model if needed

const result = await anonymizer.anonymize(
  'Hello John Smith from Acme Corp in Berlin!'
);

console.log(result.anonymizedText);
// "Hello <PII type="PERSON" id="1"/> from <PII type="ORG" id="2"/> in <PII type="LOCATION" id="3"/>!"

// Clean up when done
await anonymizer.dispose();
```

### With Semantic Enrichment

Add gender and location scope for better machine translation:

```typescript
import { createAnonymizer } from 'rehydra';

const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  semantic: { 
    enabled: true,  // Downloads ~12 MB of semantic data on first use
    onStatus: (status) => console.log(status),
  }
});

await anonymizer.initialize();

const result = await anonymizer.anonymize(
  'Hello Maria Schmidt from Berlin!'
);

console.log(result.anonymizedText);
// "Hello <PII type="PERSON" gender="female" id="1"/> from <PII type="LOCATION" scope="city" id="2"/>!"
```

## Example: Translation Workflow (Anonymize → Translate → Rehydrate)

The full workflow for privacy-preserving translation:

```typescript
import { 
  createAnonymizer, 
  decryptPIIMap, 
  rehydrate,
  InMemoryKeyProvider 
} from 'rehydra';

// 1. Create a key provider (required to decrypt later)
const keyProvider = new InMemoryKeyProvider();

// 2. Create anonymizer with key provider
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  keyProvider: keyProvider
});

await anonymizer.initialize();

// 3. Anonymize before translation
const original = 'Hello John Smith from Acme Corp in Berlin!';
const result = await anonymizer.anonymize(original);

console.log(result.anonymizedText);
// "Hello <PII type="PERSON" id="1"/> from <PII type="ORG" id="2"/> in <PII type="LOCATION" id="3"/>!"

// 4. Translate (or do other AI workloads that preserve placeholders)
const translated = await yourAIWorkflow(result.anonymizedText, { from: 'en', to: 'de' });
// "Hallo <PII type="PERSON" id="1"/> von <PII type="ORG" id="2"/> in <PII type="LOCATION" id="3"/>!"

// 5. Decrypt the PII map using the same key
const encryptionKey = await keyProvider.getKey();
const piiMap = await decryptPIIMap(result.piiMap, encryptionKey);

// 6. Rehydrate - replace placeholders with original values
const rehydrated = rehydrate(translated, piiMap);

console.log(rehydrated);
// "Hallo John Smith von Acme Corp in Berlin!"

// 7. Clean up
await anonymizer.dispose();
```

### Key Points

- **Save the encryption key** - You need the same key to decrypt the PII map
- **Placeholders are XML-like** - Most translation services preserve them automatically
- **PII stays local** - Original values never leave your system during translation

## API Reference

### Configuration Options

```typescript
import { createAnonymizer, InMemoryKeyProvider } from 'rehydra';

const anonymizer = createAnonymizer({
  // NER configuration
  ner: {
    mode: 'quantized',              // 'standard' | 'quantized' | 'disabled' | 'custom'
    autoDownload: true,             // Auto-download model if not present
    onStatus: (status) => {},       // Status messages callback
    onDownloadProgress: (progress) => {
      console.log(`${progress.file}: ${progress.percent}%`);
    },
    
    // For 'custom' mode only:
    modelPath: './my-model.onnx',
    vocabPath: './vocab.txt',
  },
  
  // Semantic enrichment (adds gender/scope attributes)
  semantic: {
    enabled: true,                  // Enable MT-friendly attributes
    autoDownload: true,             // Auto-download semantic data (~12 MB)
    onStatus: (status) => {},
    onDownloadProgress: (progress) => {},
  },
  
  // Encryption key provider
  keyProvider: new InMemoryKeyProvider(),
  
  // Custom policy (optional)
  defaultPolicy: { /* see Policy section */ },
});

await anonymizer.initialize();
```

### NER Modes

| Mode | Description | Size | Auto-Download |
|------|-------------|------|---------------|
| `'disabled'` | No NER, regex only | 0 | N/A |
| `'quantized'` | Smaller model, ~95% accuracy | ~280 MB | Yes |
| `'standard'` | Full model, best accuracy | ~1.1 GB | Yes |
| `'custom'` | Your own ONNX model | Varies | No |

### ONNX Session Options

Fine-tune ONNX Runtime performance with session options:

```typescript
const anonymizer = createAnonymizer({
  ner: {
    mode: 'quantized',
    sessionOptions: {
      // Graph optimization level: 'disabled' | 'basic' | 'extended' | 'all'
      graphOptimizationLevel: 'all',  // default
      
      // Threading (Node.js only)
      intraOpNumThreads: 4,   // threads within operators
      interOpNumThreads: 1,   // threads between operators
      
      // Memory optimization
      enableCpuMemArena: true,
      enableMemPattern: true,
    }
  }
});
```

#### Execution Providers

By default, Rehydra uses:
- **Node.js**: CPU (fastest for quantized models)
- **Browsers**: WebGPU with WASM fallback

To enable **CoreML on macOS** (for non-quantized models):

```typescript
const anonymizer = createAnonymizer({
  ner: {
    mode: 'standard',  // CoreML works better with FP32 models
    sessionOptions: {
      executionProviders: ['coreml', 'cpu'],
    }
  }
});
```

> **Note:** CoreML provides minimal speedup for quantized (INT8) models since they're already optimized for CPU. Use CoreML with the standard FP32 model for best results.

Available execution providers:
| Provider | Platform | Best For |
|----------|----------|----------|
| `'cpu'` | All | Quantized models (default) |
| `'coreml'` | macOS | Standard (FP32) models on Apple Silicon |
| `'cuda'` | Linux (NVIDIA) | GPU acceleration |
| `'webgpu'` | Browsers | GPU acceleration in Chrome 113+ |
| `'wasm'` | Browsers | Fallback for all browsers |

### Main Functions

#### `createAnonymizer(config?)`

Creates a reusable anonymizer instance:

```typescript
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' }
});

await anonymizer.initialize();
const result = await anonymizer.anonymize('text');
await anonymizer.dispose();
```

#### `anonymize(text, locale?, policy?)`

One-off anonymization (regex-only by default):

```typescript
import { anonymize } from 'rehydra';

const result = await anonymize('Contact test@example.com');
```

#### `anonymizeWithNER(text, nerConfig, policy?)`

One-off anonymization with NER:

```typescript
import { anonymizeWithNER } from 'rehydra';

const result = await anonymizeWithNER(
  'Hello John Smith',
  { mode: 'quantized' }
);
```

#### `anonymizeRegexOnly(text, policy?)`

Fast regex-only anonymization:

```typescript
import { anonymizeRegexOnly } from 'rehydra';

const result = await anonymizeRegexOnly('Card: 4111111111111111');
```

### Rehydration Functions

#### `decryptPIIMap(encryptedMap, key)`

Decrypts the PII map for rehydration:

```typescript
import { decryptPIIMap } from 'rehydra';

const piiMap = await decryptPIIMap(result.piiMap, encryptionKey);
// Returns Map<string, string> where key is "PERSON:1" and value is "John Smith"
```

#### `rehydrate(text, piiMap)`

Replaces placeholders with original values:

```typescript
import { rehydrate } from 'rehydra';

const original = rehydrate(translatedText, piiMap);
```

### Result Structure

```typescript
interface AnonymizationResult {
  // Text with PII replaced by placeholder tags
  anonymizedText: string;
  
  // Detected entities (without original text for safety)
  entities: Array<{
    type: PIIType;
    id: number;
    start: number;
    end: number;
    confidence: number;
    source: 'REGEX' | 'NER';
  }>;
  
  // Encrypted PII mapping (for later rehydration)
  piiMap: {
    ciphertext: string;  // Base64
    iv: string;          // Base64
    authTag: string;     // Base64
  };
  
  // Processing statistics
  stats: {
    countsByType: Record<PIIType, number>;
    totalEntities: number;
    processingTimeMs: number;
    modelVersion: string;
    leakScanPassed?: boolean;
  };
}
```

## Supported PII Types

| Type | Description | Detection | Semantic Attributes |
|------|-------------|-----------|---------------------|
| `EMAIL` | Email addresses | Regex | - |
| `PHONE` | Phone numbers (international) | Regex | - |
| `IBAN` | International Bank Account Numbers | Regex + Checksum | - |
| `BIC_SWIFT` | Bank Identifier Codes | Regex | - |
| `CREDIT_CARD` | Credit card numbers | Regex + Luhn | - |
| `IP_ADDRESS` | IPv4 and IPv6 addresses | Regex | - |
| `URL` | Web URLs | Regex | - |
| `CASE_ID` | Case/ticket numbers | Regex (configurable) | - |
| `CUSTOMER_ID` | Customer identifiers | Regex (configurable) | - |
| `PERSON` | Person names | NER | `gender` (male/female/neutral) |
| `ORG` | Organization names | NER | - |
| `LOCATION` | Location/place names | NER | `scope` (city/country/region) |
| `ADDRESS` | Physical addresses | NER | - |
| `DATE_OF_BIRTH` | Dates of birth | NER | - |

## Configuration

### Anonymization Policy

```typescript
import { createAnonymizer, PIIType } from 'rehydra';

const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  defaultPolicy: {
    // Which PII types to detect
    enabledTypes: new Set([PIIType.EMAIL, PIIType.PHONE, PIIType.PERSON]),
    
    // Confidence thresholds per type (0.0 - 1.0)
    confidenceThresholds: new Map([
      [PIIType.PERSON, 0.8],
      [PIIType.EMAIL, 0.5],
    ]),
    
    // Terms to never treat as PII
    allowlistTerms: new Set(['Customer Service', 'Help Desk']),
    
    // Enable semantic enrichment (gender/scope)
    enableSemanticMasking: true,
    
    // Enable leak scanning on output
    enableLeakScan: true,
  },
});
```

### Custom Recognizers

Add domain-specific patterns:

```typescript
import { createCustomIdRecognizer, PIIType, createAnonymizer } from 'rehydra';

const customRecognizer = createCustomIdRecognizer([
  {
    name: 'Order Number',
    pattern: /\bORD-[A-Z0-9]{8}\b/g,
    type: PIIType.CASE_ID,
  },
]);

const anonymizer = createAnonymizer();
anonymizer.getRegistry().register(customRecognizer);
```

## Data & Model Storage

Models and semantic data are cached locally for offline use.

### Node.js Cache Locations

| Data | macOS | Linux | Windows |
|------|-------|-------|---------|
| NER Models | `~/Library/Caches/rehydra/models/` | `~/.cache/rehydra/models/` | `%LOCALAPPDATA%/rehydra/models/` |
| Semantic Data | `~/Library/Caches/rehydra/semantic-data/` | `~/.cache/rehydra/semantic-data/` | `%LOCALAPPDATA%/rehydra/semantic-data/` |

### Browser Cache

In browsers, data is stored using:
- **IndexedDB**: For semantic data and smaller files
- **Origin Private File System (OPFS)**: For large model files (~280 MB)

Data persists across page reloads and browser sessions.

### Manual Data Management

```typescript
import { 
  // Model management
  isModelDownloaded, 
  downloadModel, 
  clearModelCache,
  listDownloadedModels,
  
  // Semantic data management
  isSemanticDataDownloaded,
  downloadSemanticData,
  clearSemanticDataCache,
} from 'rehydra';

// Check if model is downloaded
const hasModel = await isModelDownloaded('quantized');

// Manually download model with progress
await downloadModel('quantized', (progress) => {
  console.log(`${progress.file}: ${progress.percent}%`);
});

// Check semantic data
const hasSemanticData = await isSemanticDataDownloaded();

// List downloaded models
const models = await listDownloadedModels();

// Clear caches
await clearModelCache('quantized');  // or clearModelCache() for all
await clearSemanticDataCache();
```

## Encryption & Security

The PII map is encrypted using **AES-256-GCM** via the Web Crypto API (works in both Node.js and browsers).

### Key Providers

```typescript
import { 
  InMemoryKeyProvider,    // For development/testing
  ConfigKeyProvider,      // For production with pre-configured key
  KeyProvider,            // Interface for custom implementations
  generateKey,
} from 'rehydra';

// Development: In-memory key (generates random key, lost on page refresh)
const devKeyProvider = new InMemoryKeyProvider();

// Production: Pre-configured key
// Generate key: openssl rand -base64 32
const keyBase64 = process.env.PII_ENCRYPTION_KEY;  // or read from config
const prodKeyProvider = new ConfigKeyProvider(keyBase64);

// Custom: Implement KeyProvider interface
class SecureKeyProvider implements KeyProvider {
  async getKey(): Promise<Uint8Array> {
    // Retrieve from secure storage, HSM, keychain, etc.
    return await getKeyFromSecureStorage();
  }
}
```

### Security Best Practices

- **Never log the raw PII map** - Always use encrypted storage
- **Persist the encryption key securely** - Use platform keystores (iOS Keychain, Android Keystore, etc.)
- **Rotate keys** - Implement key rotation for long-running applications
- **Enable leak scanning** - Catch any missed PII in output

## PII Map Storage

For applications that need to persist encrypted PII maps (e.g., chat applications where you need to rehydrate later), use sessions with built-in storage providers.

### Storage Providers

| Provider | Environment | Persistence | Use Case |
|----------|-------------|-------------|----------|
| `InMemoryPIIStorageProvider` | All | None (lost on restart) | Development, testing |
| `SQLitePIIStorageProvider` | Node.js, Bun only* | File-based | Server-side applications |
| `IndexedDBPIIStorageProvider` | Browser | Browser storage | Client-side applications |

*\*Not available in browser builds. Use `IndexedDBPIIStorageProvider` for browser applications.*

### Important: Storage Only Works with Sessions

> **Note:** The `piiStorageProvider` is only used when you call `anonymizer.session()`. 
> Calling `anonymizer.anonymize()` directly does NOT save to storage - the encrypted PII map 
> is only returned in the result for you to handle manually.

```typescript
// ❌ Storage NOT used - you must handle the PII map yourself
const result = await anonymizer.anonymize('Hello John!');
// result.piiMap is returned but NOT saved to storage

// ✅ Storage IS used - auto-saves and auto-loads
const session = anonymizer.session('conversation-123');
const result = await session.anonymize('Hello John!');
// result.piiMap is automatically saved to storage
```

### Example: Without Storage (Simple One-Off Usage)

For simple use cases where you don't need persistence:

```typescript
import { createAnonymizer, decryptPIIMap, rehydrate, InMemoryKeyProvider } from 'rehydra';

const keyProvider = new InMemoryKeyProvider();
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  keyProvider,
});
await anonymizer.initialize();

// Anonymize
const result = await anonymizer.anonymize('Hello John Smith!');

// Translate (or other processing)
const translated = await translateAPI(result.anonymizedText);

// Rehydrate manually using the returned PII map
const key = await keyProvider.getKey();
const piiMap = await decryptPIIMap(result.piiMap, key);
const original = rehydrate(translated, piiMap);
```

### Example: With Storage (Persistent Sessions)

For applications that need to persist PII maps across requests/restarts:

```typescript
import { 
  createAnonymizer,
  InMemoryKeyProvider,
  SQLitePIIStorageProvider,
} from 'rehydra';

// 1. Setup storage (once at app start)
const storage = new SQLitePIIStorageProvider('./pii-maps.db');
await storage.initialize();

// 2. Create anonymizer with storage and key provider
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  keyProvider: new InMemoryKeyProvider(),
  piiStorageProvider: storage,
});
await anonymizer.initialize();

// 3. Create a session for each conversation
const session = anonymizer.session('conversation-123');

// 4. Anonymize - auto-saves to storage
const result = await session.anonymize('Hello John Smith from Acme Corp!');
console.log(result.anonymizedText);
// "Hello <PII type="PERSON" id="1"/> from <PII type="ORG" id="1"/>!"

// 5. Later (even after app restart): rehydrate - auto-loads and decrypts
const translated = await translateAPI(result.anonymizedText);
const original = await session.rehydrate(translated);
console.log(original);
// "Hello John Smith from Acme Corp!"

// 6. Optional: check existence or delete
await session.exists();  // true
await session.delete();  // removes from storage
```

### Example: Multiple Conversations

Each session ID maps to a separate stored PII map:

```typescript
// Different chat sessions
const chat1 = anonymizer.session('user-alice-chat');
const chat2 = anonymizer.session('user-bob-chat');

await chat1.anonymize('Alice: Contact me at alice@example.com');
await chat2.anonymize('Bob: My number is +49 30 123456');

// Each session has independent storage
await chat1.rehydrate(translatedText1);  // Uses Alice's PII map
await chat2.rehydrate(translatedText2);  // Uses Bob's PII map
```

### Multi-Message Conversations

Within a session, entity IDs are consistent across multiple `anonymize()` calls:

```typescript
const session = anonymizer.session('chat-123');

// Message 1: User provides contact info
const msg1 = await session.anonymize('Contact me at user@example.com');
// → "Contact me at <PII type="EMAIL" id="1"/>"

// Message 2: References same email + new one  
const msg2 = await session.anonymize('CC: user@example.com and admin@example.com');
// → "CC: <PII type="EMAIL" id="1"/> and <PII type="EMAIL" id="2"/>"
//        ↑ Same ID (reused)                ↑ New ID

// Message 3: No PII
await session.anonymize('Please translate to German');
// Previous PII preserved

// All messages can be rehydrated correctly
await session.rehydrate(msg1.anonymizedText); // ✓
await session.rehydrate(msg2.anonymizedText); // ✓
```

This ensures that follow-up messages referencing the same PII produce consistent placeholders, and rehydration works correctly across the entire conversation.

### SQLite Provider (Node.js + Bun only)

The SQLite provider works on both Node.js and Bun with automatic runtime detection.

> **Note:** `SQLitePIIStorageProvider` is **not available in browser builds**. When bundling for browser with Vite/webpack, use `IndexedDBPIIStorageProvider` instead. The browser-safe build automatically excludes SQLite to avoid bundling Node.js dependencies.

```typescript
// Node.js / Bun only
import { SQLitePIIStorageProvider } from 'rehydra';
// Or explicitly: import { SQLitePIIStorageProvider } from 'rehydra/storage/sqlite';

// File-based database
const storage = new SQLitePIIStorageProvider('./data/pii-maps.db');
await storage.initialize();

// Or in-memory for testing
const testStorage = new SQLitePIIStorageProvider(':memory:');
await testStorage.initialize();
```

**Dependencies:**
- **Bun**: Uses built-in `bun:sqlite` (no additional install needed)
- **Node.js**: Requires `better-sqlite3`:

```bash
npm install better-sqlite3
```

### IndexedDB Provider (Browser)

```typescript
import { 
  createAnonymizer,
  InMemoryKeyProvider,
  IndexedDBPIIStorageProvider,
} from 'rehydra';

// Custom database name (defaults to 'rehydra-pii-storage')
const storage = new IndexedDBPIIStorageProvider('my-app-pii');

const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  keyProvider: new InMemoryKeyProvider(),
  piiStorageProvider: storage,
});
await anonymizer.initialize();

// Use sessions as usual
const session = anonymizer.session('browser-chat-123');
const result = await session.anonymize('Hello John!');
const original = await session.rehydrate(result.anonymizedText);
```

### Session Interface

The session object provides these methods:

```typescript
interface AnonymizerSession {
  readonly sessionId: string;
  anonymize(text: string, locale?: string, policy?: Partial<AnonymizationPolicy>): Promise<AnonymizationResult>;
  rehydrate(text: string): Promise<string>;
  load(): Promise<StoredPIIMap | null>;
  delete(): Promise<boolean>;
  exists(): Promise<boolean>;
}
```

### Data Retention

**Entries persist forever by default.** Use `cleanup()` on the storage provider to remove old entries:

```typescript
// Delete entries older than 7 days
const count = await storage.cleanup(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));

// Or delete specific sessions
await session.delete();

// List all stored sessions
const sessionIds = await storage.list();
```

## Browser Usage

The library works seamlessly in browsers without any special configuration.

### Basic Browser Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>PII Anonymization</title>
</head>
<body>
  <script type="module">
    import { 
      createAnonymizer, 
      InMemoryKeyProvider,
      decryptPIIMap,
      rehydrate
    } from './node_modules/rehydra/dist/index.js';
    
    async function demo() {
      // Create anonymizer
      const keyProvider = new InMemoryKeyProvider();
      const anonymizer = createAnonymizer({
        ner: { 
          mode: 'quantized',
          onStatus: (s) => console.log('NER:', s),
          onDownloadProgress: (p) => console.log(`Download: ${p.percent}%`)
        },
        semantic: { enabled: true },
        keyProvider
      });
      
      // Initialize (downloads models on first use)
      await anonymizer.initialize();
      
      // Anonymize
      const result = await anonymizer.anonymize(
        'Contact Maria Schmidt at maria@example.com in Berlin.'
      );
      
      console.log('Anonymized:', result.anonymizedText);
      // "Contact <PII type="PERSON" gender="female" id="1"/> at <PII type="EMAIL" id="2"/> in <PII type="LOCATION" scope="city" id="3"/>."
      
      // Rehydrate
      const key = await keyProvider.getKey();
      const piiMap = await decryptPIIMap(result.piiMap, key);
      const original = rehydrate(result.anonymizedText, piiMap);
      
      console.log('Rehydrated:', original);
      
      await anonymizer.dispose();
    }
    
    demo().catch(console.error);
  </script>
</body>
</html>
```

### Browser Notes

- **First-use downloads**: NER model (~280 MB) and semantic data (~12 MB) are downloaded on first use
- **ONNX runtime**: Automatically loaded from CDN if not bundled
- **Offline support**: After initial download, everything works offline
- **Storage**: Uses IndexedDB and OPFS - data persists across sessions

### Bundler Support (Vite, webpack, esbuild)

The package uses [conditional exports](https://nodejs.org/api/packages.html#conditional-exports) to automatically provide a browser-safe build when bundling for the web. This means:

- **Automatic**: Vite, webpack, esbuild, and other modern bundlers will automatically use `dist/browser.js`
- **No Node.js modules**: The browser build excludes `SQLitePIIStorageProvider` and other Node.js-specific code
- **Tree-shakable**: Only the code you use is included in your bundle

```json
// package.json exports (simplified)
{
  "exports": {
    ".": {
      "browser": "./dist/browser.js",
      "node": "./dist/index.js",
      "default": "./dist/index.js"
    }
  }
}
```

**Explicit imports** (if needed):

```typescript
// Browser-only build (excludes SQLite, Node.js fs, etc.)
import { createAnonymizer } from 'rehydra/browser';

// Node.js build (includes everything)
import { createAnonymizer, SQLitePIIStorageProvider } from 'rehydra/node';

// SQLite storage only (Node.js only)
import { SQLitePIIStorageProvider } from 'rehydra/storage/sqlite';
```

**Browser build excludes:**
- `SQLitePIIStorageProvider` (use `IndexedDBPIIStorageProvider` instead)
- Node.js `fs`, `path`, `os` modules

**Browser build includes:**
- All recognizers (email, phone, IBAN, etc.)
- NER model support (with `onnxruntime-web`)
- Semantic enrichment
- `InMemoryPIIStorageProvider`
- `IndexedDBPIIStorageProvider`
- All crypto utilities

## Bun Support

This library works with [Bun](https://bun.sh). Since `onnxruntime-node` is a native Node.js addon, Bun uses `onnxruntime-web`:

```bash
bun add rehydra onnxruntime-web
```

Usage is identical - the library auto-detects the runtime.

## Performance

Benchmarks on Apple M3. Run `npm run benchmark` to measure on your hardware.

### End-to-End Latency

| Mode | Short (~50 chars) | Medium (~500 chars) | Long (~2K chars) |
|------|-------------------|---------------------|------------------|
| **Regex-only** | 0.04 ms | 0.07 ms | 0.15 ms |
| **With NER** | 53 ms | 387 ms | 1,505 ms |

### Pipeline Breakdown (2K chars)

| Component | Time | Notes |
|-----------|------|-------|
| Regex recognizers | 0.07 ms | All 9 built-in patterns |
| NER inference | ~1,500 ms | Quantized model, CPU |
| Entity resolution | 0.002 ms | Merge & deduplicate |
| Semantic enrichment | <0.001 ms | Pre-loaded data |
| Tagging & encryption | 0.2 ms | AES-256-GCM |

### Model Downloads

| Model | Size | First-Use Download |
|-------|------|-------------------|
| Quantized NER | ~265 MB | ~30s on fast connection |
| Standard NER | ~1.1 GB | ~2min on fast connection |
| Semantic Data | ~12 MB | ~5s on fast connection |

### Scaling

| Input Size | Regex-Only | With NER |
|------------|------------|----------|
| ~50 chars | 0.04 ms | 53 ms |
| ~500 chars | 0.07 ms | 387 ms |
| ~2K chars | 0.15 ms | 1,505 ms |
| ~20K chars | 0.6 ms | ~15,000 ms* |

*Estimated based on linear scaling

> **Note:** NER inference time scales with input length due to transformer attention complexity. For latency-sensitive applications with long text, consider using regex-only mode or chunking the input.

## Requirements

| Environment | Version | Notes |
|-------------|---------|-------|
| Node.js | >= 18.0.0 | Uses native `onnxruntime-node` |
| Bun | >= 1.0.0 | Requires `onnxruntime-web` |
| Browsers | Chrome 86+, Firefox 89+, Safari 15.4+, Edge 86+ | Uses OPFS for model storage |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build

# Lint
npm run lint
```

### Building Custom Models

For development or custom models:

```bash
# Requires Python 3.8+
npm run setup:ner              # Standard model
npm run setup:ner:quantized    # Quantized model
```

## License

MIT
