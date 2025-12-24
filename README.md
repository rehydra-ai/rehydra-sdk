# Bridge Anonymization

![License](https://img.shields.io/github/license/elanlanguages/bridge-anonymization)
![Issues](https://img.shields.io/github/issues/elanlanguages/bridge-anonymization)
[![codecov](https://codecov.io/github/elanlanguages/bridge-anonymization/graph/badge.svg?token=WX5RI0ZZJG)](https://codecov.io/github/elanlanguages/bridge-anonymization)

On-device PII anonymization module for high-privacy translation workflows. Detects and replaces Personally Identifiable Information (PII) with placeholder tags while maintaining an encrypted mapping for later rehydration.

## Features

- **Structured PII Detection**: Regex-based detection for emails, phones, IBANs, credit cards, IPs, URLs
- **Soft PII Detection**: ONNX-powered NER model for names, organizations, locations (auto-downloads on first use)
- **Secure PII Mapping**: AES-256-GCM encrypted storage of original PII values
- **Configurable Policies**: Customizable detection rules, thresholds, and allowlists
- **Validation & Leak Scanning**: Built-in validation and optional leak detection

## Installation

```bash
npm install @elanlanguages/bridge-anonymization
```

> **Bun users**: Install `onnxruntime-web` additionally: `bun add @elanlanguages/bridge-anonymization onnxruntime-web`

## Quick Start

### Regex-Only Mode (No Downloads Required)

For structured PII like emails, phones, IBANs, credit cards:

```typescript
import { anonymizeRegexOnly } from '@elanlanguages/bridge-anonymization';

const result = await anonymizeRegexOnly(
  'Contact john@example.com or call +49 30 123456. IBAN: DE89370400440532013000'
);

console.log(result.anonymizedText);
// "Contact <PII type="EMAIL" id="1"/> or call <PII type="PHONE" id="2"/>. IBAN: <PII type="IBAN" id="3"/>"
```

### Full Mode with NER (Detects Names, Organizations, Locations)

The NER model is automatically downloaded on first use (~280 MB for quantized):

```typescript
import { createAnonymizer } from '@elanlanguages/bridge-anonymization';

const anonymizer = createAnonymizer({
  ner: { 
    mode: 'quantized',  // or 'standard' for full model (~1.1 GB)
    onStatus: (status) => console.log(status),  // Optional progress
  }
});

await anonymizer.initialize();  // Downloads model if needed

const result = await anonymizer.anonymize(
  'Hello John Smith from Acme Corp in Berlin!'
);

console.log(result.anonymizedText);
// "Hello <PII type="PERSON" id="1"/> from <PII type="ORG" id="2"/> in <PII type="LOCATION" id="3"/>!"
```

### One-liner with NER

```typescript
import { anonymizeWithNER } from '@elanlanguages/bridge-anonymization';

const result = await anonymizeWithNER(
  'Contact John Smith at john@example.com',
  { mode: 'quantized', onStatus: console.log }
);
```

## Translation Workflow (Anonymize → Translate → Rehydrate)

The full workflow for privacy-preserving translation:

```typescript
import { 
  createAnonymizer, 
  decryptPIIMap, 
  rehydrate,
  InMemoryKeyProvider 
} from '@elanlanguages/bridge-anonymization';

// 1. Create a key provider (so you can decrypt later)
const keyProvider = new InMemoryKeyProvider();

// 2. Create anonymizer with key provider
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  keyProvider: keyProvider  // Important: keep reference to decrypt later!
});

await anonymizer.initialize();

// 3. Anonymize before translation
const original = 'Hello John Smith from Acme Corp in Berlin!';
const result = await anonymizer.anonymize(original);

console.log(result.anonymizedText);
// "Hello <PII type="PERSON" id="1"/> from <PII type="ORG" id="2"/> in <PII type="LOCATION" id="3"/>!"

// 4. Translate (the placeholders are preserved by translation services)
const translated = await bridgeTranslate(result.anonymizedText, { from: 'en', to: 'de' });
// "Hallo <PII type="PERSON" id="1"/> von <PII type="ORG" id="2"/> in <PII type="LOCATION" id="3"/>!"

// 5. Decrypt the PII map using the same key
const encryptionKey = await keyProvider.getKey();
const piiMap = decryptPIIMap(result.piiMap, encryptionKey);

// 6. Rehydrate - replace placeholders with original values
const rehydrated = rehydrate(translated, piiMap);

console.log(rehydrated);
// "Hallo John Smith von Acme Corp in Berlin!"
```

### Key Points

- **Save the encryption key** - You need the same key to decrypt the PII map
- **Placeholders are XML-like** - Most translation services preserve them automatically
- **PII stays local** - Original values never leave your system during translation

### Production Key Management

For production, use a proper key provider:

```typescript
import { EnvKeyProvider } from '@elanlanguages/bridge-anonymization';

// Generate and store key: openssl rand -base64 32
// Set environment variable: export PII_ENCRYPTION_KEY=<base64-key>

const keyProvider = new EnvKeyProvider('PII_ENCRYPTION_KEY');
const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' },
  keyProvider
});
```

## API Reference

### Configuration Options

```typescript
import { createAnonymizer, InMemoryKeyProvider } from '@elanlanguages/bridge-anonymization';

const anonymizer = createAnonymizer({
  // NER configuration
  ner: {
    mode: 'quantized',     // 'standard' | 'quantized' | 'disabled' | 'custom'
    autoDownload: true,    // Auto-download model if not present
    onStatus: (s) => {},   // Status messages callback
    onDownloadProgress: (p) => {},  // Download progress callback
    
    // For 'custom' mode only:
    modelPath: './my-model.onnx',
    vocabPath: './vocab.txt',
  },
  
  // Encryption key provider
  keyProvider: new InMemoryKeyProvider(),
  
  // Custom policy
  defaultPolicy: { /* ... */ },
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

### Main Functions

#### `createAnonymizer(config?)`

Creates an anonymizer instance:

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
const result = await anonymize('Contact test@example.com');
```

#### `anonymizeWithNER(text, nerConfig, policy?)`

One-off anonymization with NER:

```typescript
const result = await anonymizeWithNER(
  'Hello John Smith',
  { mode: 'quantized' }
);
```

#### `anonymizeRegexOnly(text, policy?)`

Fast regex-only anonymization:

```typescript
const result = await anonymizeRegexOnly('Card: 4111111111111111');
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

| Type | Description | Detection Method |
|------|-------------|------------------|
| `EMAIL` | Email addresses | Regex |
| `PHONE` | Phone numbers (international) | Regex |
| `IBAN` | International Bank Account Numbers | Regex + Checksum |
| `BIC_SWIFT` | Bank Identifier Codes | Regex |
| `CREDIT_CARD` | Credit card numbers | Regex + Luhn |
| `IP_ADDRESS` | IPv4 and IPv6 addresses | Regex |
| `URL` | Web URLs | Regex |
| `CASE_ID` | Case/ticket numbers | Regex (configurable) |
| `CUSTOMER_ID` | Customer identifiers | Regex (configurable) |
| `PERSON` | Person names | NER |
| `ORG` | Organization names | NER |
| `LOCATION` | Location/place names | NER |
| `ADDRESS` | Physical addresses | NER |
| `DATE_OF_BIRTH` | Dates of birth | NER |

## Configuration

### Anonymization Policy

```typescript
import { createAnonymizer, PIIType } from '@elanlanguages/bridge-anonymization';

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
    
    // Enable leak scanning on output
    enableLeakScan: true,
  },
});
```

### Custom Recognizers

Add domain-specific patterns:

```typescript
import { createCustomIdRecognizer, PIIType, createAnonymizer } from '@elanlanguages/bridge-anonymization';

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

## Model Management

Models are hosted on [Hugging Face Hub](https://huggingface.co/tjruesch/xlm-roberta-base-ner-hrl-onnx) and automatically downloaded on first use.

**Cache locations:**
- **macOS**: `~/Library/Caches/bridge-anonymization/models/`
- **Linux**: `~/.cache/bridge-anonymization/models/`
- **Windows**: `%LOCALAPPDATA%/bridge-anonymization/models/`

### Manual Model Management

```typescript
import { 
  isModelDownloaded, 
  downloadModel, 
  clearModelCache,
  listDownloadedModels,
  getModelCacheDir 
} from '@elanlanguages/bridge-anonymization';

// Check if model is downloaded
const hasModel = await isModelDownloaded('quantized');

// Manually download
await downloadModel('quantized', (progress) => {
  console.log(`${progress.file}: ${progress.percent}%`);
});

// List downloaded models
const models = await listDownloadedModels();

// Clear cache
await clearModelCache('quantized');  // or clearModelCache() for all
```

## Encryption & Security

The PII map is encrypted using AES-256-GCM:

```typescript
import { createAnonymizer, KeyProvider, generateKey } from '@elanlanguages/bridge-anonymization';

class SecureKeyProvider implements KeyProvider {
  async getKey(): Promise<Buffer> {
    // Retrieve from OS keychain, HSM, or secure storage
    return await getKeyFromSecureStorage();
  }
}

const anonymizer = createAnonymizer({
  keyProvider: new SecureKeyProvider(),
  ner: { mode: 'quantized' },
});
```

### Security Best Practices

- **Never log the raw PII map** - Always use encrypted storage
- **Rotate keys** - Implement key rotation for long-running applications
- **Use platform keystores** - iOS Keychain, Android Keystore, or OS credential managers
- **Enable leak scanning** - Catch any missed PII in output

## Bun Support

This library works with [Bun](https://bun.sh). Since `onnxruntime-node` is a native Node.js addon, Bun users need `onnxruntime-web`:

```bash
bun add @elanlanguages/bridge-anonymization onnxruntime-web
```

Usage is identical - the library auto-detects the runtime:

```typescript
import { createAnonymizer } from '@elanlanguages/bridge-anonymization';

const anonymizer = createAnonymizer({
  ner: { mode: 'quantized' }
});

await anonymizer.initialize();
const result = await anonymizer.anonymize('Hello John Smith');
```

## Performance

| Component | Time (2K chars) | Notes |
|-----------|-----------------|-------|
| Regex pass | ~5 ms | All regex recognizers |
| NER inference | ~100-150 ms | Quantized model |
| Total pipeline | ~150-200 ms | Full anonymization |

| Model | Size | First-Use Download |
|-------|------|-------------------|
| Quantized | ~280 MB | ~30s on fast connection |
| Standard | ~1.1 GB | ~2min on fast connection |

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

### Building Custom Models

For development or custom models, you can use the setup script:

```bash
# Requires Python 3.8+
npm run setup:ner              # Standard model
npm run setup:ner:quantized    # Quantized model
```

## Requirements

- Node.js >= 18.0.0 (ONNX runtime included automatically)
- Bun >= 1.0.0 (requires `onnxruntime-web`)

## License

MIT
