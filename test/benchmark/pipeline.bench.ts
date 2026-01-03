/**
 * Pipeline Step Benchmarks
 * Measures latency for individual anonymization pipeline steps
 */

import { describe, bench } from 'vitest';
import { prenormalize } from '../../src/pipeline/prenormalize.js';
import { resolveEntities } from '../../src/pipeline/resolver.js';
import { tagEntities, rehydrate, extractTags } from '../../src/pipeline/tagger.js';
import { validateOutput } from '../../src/pipeline/validator.js';
import { enrichSemantics } from '../../src/pipeline/semantic-enricher.js';
import {
  WordPieceTokenizer,
  createTestVocab,
} from '../../src/ner/tokenizer.js';
import {
  decodeBIOTags,
  convertToSpanMatches,
  cleanupSpanBoundaries,
  mergeAdjacentSpans,
} from '../../src/ner/bio-decoder.js';
import { createNERModel, type INERModel } from '../../src/ner/ner-model.js';
import {
  isModelDownloaded,
  ensureModel,
  MODEL_REGISTRY,
} from '../../src/ner/model-manager.js';
import { encryptPIIMap, decryptPIIMap, generateKey } from '../../src/crypto/pii-map-crypto.js';
import {
  createDefaultPolicy,
  PIIType,
  DetectionSource,
  type SpanMatch,
  type AnonymizationPolicy,
  type DetectedEntity,
} from '../../src/types/index.js';
import {
  createAnonymizer,
  type Anonymizer,
} from '../../src/core/anonymizer.js';
import {
  InferenceServerClient,
} from '../../src/ner/inference-server-client.js';
import type { Token } from '../../src/ner/tokenizer.js';
import type { RawPIIMap } from '../../src/pipeline/tagger.js';

// Inference server configuration
const INFERENCE_SERVER_URL = process.env.INFERENCE_SERVER_URL || 'http://localhost:8080';

// =============================================================================
// Test Data
// =============================================================================

const SHORT_TEXT = 'Contact john@example.com for details.';

const MEDIUM_TEXT = `
Dear Mr. Smith,

Thank you for reaching out regarding your account inquiry. We have reviewed 
your request and found the following information:

Customer: John Smith
Email: john.smith@example.com
Phone: +1-555-123-4567
Account: DE89370400440532013000

Your order #ORD-2024-001234 has been processed. Please contact our support 
team at support@acme-corp.com if you have any questions.

Best regards,
Jane Doe
Customer Service
Acme Corporation
Berlin, Germany
`;

const LONG_TEXT = `
CONFIDENTIAL - CUSTOMER SERVICE RECORD

Customer Information:
- Name: Dr. Hans Müller
- Email: hans.mueller@techcorp.de
- Phone: +49 30 12345678
- Mobile: +49 170 1234567
- Address: Friedrichstraße 123, 10117 Berlin, Germany

Account Details:
- IBAN: DE89370400440532013000
- BIC: COBADEFFXXX
- Credit Card: 4532-1234-5678-9012 (Visa)
- Customer ID: CUST-2024-789456

Order History:
1. Order #ORD-2024-001234 - Shipped to Berlin
2. Order #ORD-2024-001235 - Delivered to Munich
3. Order #ORD-2024-001236 - Processing

Support Contacts:
- Primary: support@techcorp.de
- Secondary: help@techcorp.de
- Emergency: +49 800 1234567

Internal Notes:
Spoke with customer regarding issue #CASE-2024-456789. Customer mentioned 
colleague Maria Schmidt (maria.schmidt@techcorp.de) may also need access. 
Previous agent John Doe handled initial request from IP 192.168.1.100.

Follow-up scheduled with Team Lead Sarah Johnson in Munich office.
Customer prefers contact via email to hans.mueller@techcorp.de.

Additional contacts provided:
- Work: hans.mueller@work.example.com
- Personal: hansm@personal.example.org
- Backup phone: +49 89 9876543

Payment Information:
- Alternative card: 5425-2334-3010-9903 (Mastercard)
- PayPal: hans.paypal@example.com

Location History:
- Frankfurt, Germany (2024-01)
- Paris, France (2024-02)
- London, United Kingdom (2024-03)

End of Record
`;

// Sample regex matches for resolver benchmarks
function createSampleRegexMatches(text: string): SpanMatch[] {
  const matches: SpanMatch[] = [];
  
  // Find emails
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  let match;
  while ((match = emailRegex.exec(text)) !== null) {
    matches.push({
      type: PIIType.EMAIL,
      start: match.index,
      end: match.index + match[0].length,
      confidence: 0.95,
      source: DetectionSource.REGEX,
      text: match[0],
    });
  }
  
  return matches;
}

// Sample NER matches for resolver benchmarks
function createSampleNERMatches(): SpanMatch[] {
  return [
    {
      type: PIIType.PERSON,
      start: 10,
      end: 20,
      confidence: 0.85,
      source: DetectionSource.NER,
      text: 'John Smith',
    },
    {
      type: PIIType.ORG,
      start: 50,
      end: 66,
      confidence: 0.78,
      source: DetectionSource.NER,
      text: 'Acme Corporation',
    },
    {
      type: PIIType.LOCATION,
      start: 100,
      end: 106,
      confidence: 0.92,
      source: DetectionSource.NER,
      text: 'Berlin',
    },
  ];
}

// Create sample tokens for BIO decoder benchmarks
function createSampleTokens(count: number): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i < count; i++) {
    tokens.push({
      id: i,
      token: `token${i}`,
      start: i * 6,
      end: (i + 1) * 6,
      isContinuation: false,
      isSpecial: i === 0 || i === count - 1,
    });
  }
  return tokens;
}

// Create sample BIO labels
function createSampleBIOLabels(count: number): string[] {
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    if (i === 0 || i === count - 1) {
      labels.push('O');
    } else if (i % 10 === 1) {
      labels.push('B-PER');
    } else if (i % 10 === 2) {
      labels.push('I-PER');
    } else if (i % 10 === 5) {
      labels.push('B-ORG');
    } else {
      labels.push('O');
    }
  }
  return labels;
}

// Create sample confidences
function createSampleConfidences(count: number): number[] {
  return Array(count).fill(0.9);
}

// Create sample PII map
function createSamplePIIMap(size: number): RawPIIMap {
  const map: RawPIIMap = new Map();
  for (let i = 1; i <= size; i++) {
    map.set(`EMAIL_${i}`, `user${i}@example.com`);
    map.set(`PERSON_${i}`, `Person Name ${i}`);
  }
  return map;
}

// Create sample entities for validator
function createSampleEntities(count: number): DetectedEntity[] {
  const entities: DetectedEntity[] = [];
  for (let i = 0; i < count; i++) {
    entities.push({
      type: PIIType.EMAIL,
      id: i + 1,
      start: i * 50,
      end: i * 50 + 20,
      confidence: 0.95,
      source: DetectionSource.REGEX,
      original: `user${i}@example.com`,
    });
  }
  return entities;
}

// =============================================================================
// Benchmarks
// =============================================================================

describe('Pipeline Steps - Prenormalize', () => {
  bench('prenormalize - short text', () => {
    prenormalize(SHORT_TEXT);
  });

  bench('prenormalize - medium text', () => {
    prenormalize(MEDIUM_TEXT);
  });

  bench('prenormalize - long text', () => {
    prenormalize(LONG_TEXT);
  });

  bench('prenormalize - with CRLF normalization', () => {
    const textWithCRLF = MEDIUM_TEXT.replace(/\n/g, '\r\n');
    prenormalize(textWithCRLF);
  });
});

describe('Pipeline Steps - Tokenization', () => {
  const vocab = createTestVocab();
  const tokenizer = new WordPieceTokenizer(vocab);

  bench('tokenize - short text', () => {
    tokenizer.tokenize(SHORT_TEXT);
  });

  bench('tokenize - medium text', () => {
    tokenizer.tokenize(MEDIUM_TEXT);
  });

  bench('tokenize - long text', () => {
    tokenizer.tokenize(LONG_TEXT);
  });
});

describe('Pipeline Steps - BIO Decoding', () => {
  const tokens50 = createSampleTokens(50);
  const labels50 = createSampleBIOLabels(50);
  const confidences50 = createSampleConfidences(50);
  
  const tokens200 = createSampleTokens(200);
  const labels200 = createSampleBIOLabels(200);
  const confidences200 = createSampleConfidences(200);
  
  const tokens512 = createSampleTokens(512);
  const labels512 = createSampleBIOLabels(512);
  const confidences512 = createSampleConfidences(512);

  bench('decodeBIOTags - 50 tokens', () => {
    decodeBIOTags(tokens50, labels50, confidences50, SHORT_TEXT);
  });

  bench('decodeBIOTags - 200 tokens', () => {
    decodeBIOTags(tokens200, labels200, confidences200, MEDIUM_TEXT);
  });

  bench('decodeBIOTags - 512 tokens', () => {
    decodeBIOTags(tokens512, labels512, confidences512, LONG_TEXT);
  });

  bench('convertToSpanMatches - 10 entities', () => {
    const rawEntities = Array(10).fill(null).map((_, i) => ({
      type: 'PER',
      start: i * 20,
      end: i * 20 + 10,
      confidence: 0.85,
      text: `Person ${i}`,
      tokenIndices: [i],
    }));
    convertToSpanMatches(rawEntities, 0.5);
  });

  bench('cleanupSpanBoundaries - 10 spans', () => {
    const spans = createSampleNERMatches();
    cleanupSpanBoundaries(spans, MEDIUM_TEXT);
  });

  bench('mergeAdjacentSpans - 10 spans', () => {
    const spans = createSampleNERMatches();
    mergeAdjacentSpans(spans, MEDIUM_TEXT);
  });
});

// =============================================================================
// NER Inference Benchmarks (requires model to be downloaded)
// Run `npm run setup:ner` first to download the quantized model
// =============================================================================

// Lazy-loaded NER model for benchmarks
let _nerModel: INERModel | null = null;
let _nerModelLoaded = false;
let _nerModelError: string | null = null;

async function getNERModel(): Promise<INERModel | null> {
  if (_nerModelLoaded) return _nerModel;
  _nerModelLoaded = true;

  try {
    const isDownloaded = await isModelDownloaded('quantized');
    if (!isDownloaded) {
      _nerModelError = 'NER model not downloaded. Run `npm run setup:ner` first.';
      return null;
    }

    const { modelPath, vocabPath } = await ensureModel('quantized', {
      autoDownload: false,
    });

    _nerModel = createNERModel({
      modelPath,
      vocabPath,
      labelMap: MODEL_REGISTRY.quantized.labelMap,
      modelVersion: '1.0.0',
    });

    await _nerModel.load();
    return _nerModel;
  } catch (e) {
    _nerModelError = String(e);
    return null;
  }
}

// Entity-dense text for worst-case scenario
const ENTITY_DENSE_TEXT = `
  John Smith from Berlin called Mary Johnson in Munich about the Acme Corp deal.
  Contact hans.mueller@example.com or maria.schmidt@company.de for details.
  The meeting with Peter Brown and Sarah Wilson from TechCorp GmbH is confirmed.
  Attendees: Dr. Thomas Weber, Prof. Anna Fischer, and CEO Michael Schmidt.
`;

describe('Pipeline Steps - NER Inference (quantized model)', () => {
  const policy = createDefaultPolicy();

  bench('NER inference - short text (~50 chars)', async () => {
    const model = await getNERModel();
    if (!model) throw new Error(_nerModelError ?? 'Model not available');
    await model.predict(SHORT_TEXT, policy);
  });

  bench('NER inference - medium text (~500 chars)', async () => {
    const model = await getNERModel();
    if (!model) throw new Error(_nerModelError ?? 'Model not available');
    await model.predict(MEDIUM_TEXT, policy);
  });

  bench('NER inference - long text (~2000 chars)', async () => {
    const model = await getNERModel();
    if (!model) throw new Error(_nerModelError ?? 'Model not available');
    await model.predict(LONG_TEXT, policy);
  });

  bench('NER inference - entity-dense text', async () => {
    const model = await getNERModel();
    if (!model) throw new Error(_nerModelError ?? 'Model not available');
    await model.predict(ENTITY_DENSE_TEXT, policy);
  });
});

describe('Pipeline Steps - Entity Resolution', () => {
  const policy = createDefaultPolicy();
  const regexMatchesShort = createSampleRegexMatches(SHORT_TEXT);
  const regexMatchesMedium = createSampleRegexMatches(MEDIUM_TEXT);
  const regexMatchesLong = createSampleRegexMatches(LONG_TEXT);
  const nerMatches = createSampleNERMatches();

  bench('resolveEntities - short text (few matches)', () => {
    resolveEntities(regexMatchesShort, nerMatches, policy, SHORT_TEXT);
  });

  bench('resolveEntities - medium text', () => {
    resolveEntities(regexMatchesMedium, nerMatches, policy, MEDIUM_TEXT);
  });

  bench('resolveEntities - long text (many matches)', () => {
    resolveEntities(regexMatchesLong, nerMatches, policy, LONG_TEXT);
  });
});

describe('Pipeline Steps - Semantic Enrichment', () => {
  const personSpans: SpanMatch[] = [
    { type: PIIType.PERSON, start: 0, end: 10, confidence: 0.9, source: DetectionSource.NER, text: 'John Smith' },
    { type: PIIType.PERSON, start: 20, end: 30, confidence: 0.9, source: DetectionSource.NER, text: 'Jane Doe' },
    { type: PIIType.PERSON, start: 40, end: 52, confidence: 0.9, source: DetectionSource.NER, text: 'Dr. Mueller' },
  ];

  const locationSpans: SpanMatch[] = [
    { type: PIIType.LOCATION, start: 0, end: 6, confidence: 0.9, source: DetectionSource.NER, text: 'Berlin' },
    { type: PIIType.LOCATION, start: 10, end: 17, confidence: 0.9, source: DetectionSource.NER, text: 'Germany' },
    { type: PIIType.LOCATION, start: 20, end: 26, confidence: 0.9, source: DetectionSource.NER, text: 'Munich' },
  ];

  const mixedSpans: SpanMatch[] = [...personSpans, ...locationSpans];

  bench('enrichSemantics - 3 PERSON spans', () => {
    enrichSemantics(personSpans);
  });

  bench('enrichSemantics - 3 LOCATION spans', () => {
    enrichSemantics(locationSpans);
  });

  bench('enrichSemantics - 6 mixed spans', () => {
    enrichSemantics(mixedSpans);
  });
});

describe('Pipeline Steps - Entity Tagging', () => {
  const policy = createDefaultPolicy();
  const matchesShort = createSampleRegexMatches(SHORT_TEXT);
  const matchesMedium = createSampleRegexMatches(MEDIUM_TEXT);
  const matchesLarge = createSampleRegexMatches(LONG_TEXT);

  bench('tagEntities - short text (1-2 entities)', () => {
    tagEntities(SHORT_TEXT, matchesShort, policy);
  });

  bench('tagEntities - medium text (5-10 entities)', () => {
    tagEntities(MEDIUM_TEXT, matchesMedium, policy);
  });

  bench('tagEntities - long text (20+ entities)', () => {
    tagEntities(LONG_TEXT, matchesLarge, policy);
  });

  bench('tagEntities - with ID reuse enabled', () => {
    const reusePolicy = { ...policy, reuseIdsForRepeatedPII: true };
    tagEntities(LONG_TEXT, matchesLarge, reusePolicy);
  });
});

describe('Pipeline Steps - Tag Extraction & Rehydration', () => {
  const anonymizedShort = 'Contact <PII type="EMAIL" id="1"/> for details.';
  const anonymizedMedium = `
    Dear <PII type="PERSON" gender="male" id="1"/>,
    Your order <PII type="CUSTOM_ID" id="2"/> has shipped.
    Contact <PII type="EMAIL" id="3"/> or call <PII type="PHONE" id="4"/>.
    Account: <PII type="IBAN" id="5"/>
  `;
  const anonymizedLong = Array(20).fill(null)
    .map((_, i) => `Entity ${i}: <PII type="EMAIL" id="${i + 1}"/>`)
    .join('\n');

  const piiMapSmall = createSamplePIIMap(5);
  const piiMapLarge = createSamplePIIMap(20);

  bench('extractTags - short (1 tag)', () => {
    extractTags(anonymizedShort);
  });

  bench('extractTags - medium (5 tags)', () => {
    extractTags(anonymizedMedium);
  });

  bench('extractTags - long (20 tags)', () => {
    extractTags(anonymizedLong);
  });

  bench('rehydrate - short text', () => {
    rehydrate(anonymizedShort, piiMapSmall);
  });

  bench('rehydrate - medium text', () => {
    rehydrate(anonymizedMedium, piiMapSmall);
  });

  bench('rehydrate - long text', () => {
    rehydrate(anonymizedLong, piiMapLarge);
  });
});

describe('Pipeline Steps - Validation', () => {
  const policy = createDefaultPolicy();
  const entitiesSmall = createSampleEntities(5);
  const entitiesLarge = createSampleEntities(20);
  const piiMapKeysSmall = entitiesSmall.map(e => `${e.type}_${e.id}`);
  const piiMapKeysLarge = entitiesLarge.map(e => `${e.type}_${e.id}`);

  bench('validateOutput - 5 entities', () => {
    validateOutput(
      'Anonymized text with <PII type="EMAIL" id="1"/>',
      entitiesSmall,
      piiMapKeysSmall,
      policy
    );
  });

  bench('validateOutput - 20 entities', () => {
    validateOutput(
      'Anonymized text with many entities',
      entitiesLarge,
      piiMapKeysLarge,
      policy
    );
  });

  bench('validateOutput - with leak scan enabled', () => {
    const leakScanPolicy = { ...policy, enableLeakScan: true };
    validateOutput(
      'Anonymized text without leaks',
      entitiesSmall,
      piiMapKeysSmall,
      leakScanPolicy
    );
  });
});

describe('Pipeline Steps - Encryption', () => {
  const key = generateKey();
  const piiMapSmall = createSamplePIIMap(5);
  const piiMapMedium = createSamplePIIMap(20);
  const piiMapLarge = createSamplePIIMap(100);

  bench('encryptPIIMap - 10 entries', async () => {
    await encryptPIIMap(piiMapSmall, key);
  });

  bench('encryptPIIMap - 40 entries', async () => {
    await encryptPIIMap(piiMapMedium, key);
  });

  bench('encryptPIIMap - 200 entries', async () => {
    await encryptPIIMap(piiMapLarge, key);
  });

  bench('decryptPIIMap - 10 entries', async () => {
    const encrypted = await encryptPIIMap(piiMapSmall, key);
    await decryptPIIMap(encrypted, key);
  });

  bench('decryptPIIMap - 40 entries', async () => {
    const encrypted = await encryptPIIMap(piiMapMedium, key);
    await decryptPIIMap(encrypted, key);
  });

  bench('generateKey', () => {
    generateKey();
  });
});

// =============================================================================
// Full Anonymizer Benchmarks (End-to-End)
// =============================================================================

// Lazy-loaded anonymizers for benchmarks
let _regexOnlyAnonymizer: Anonymizer | null = null;
let _nerAnonymizer: Anonymizer | null = null;
let _nerAnonymizerError: string | null = null;

async function getRegexOnlyAnonymizer(): Promise<Anonymizer> {
  if (!_regexOnlyAnonymizer) {
    _regexOnlyAnonymizer = createAnonymizer({ ner: { mode: 'disabled' } });
    await _regexOnlyAnonymizer.initialize();
  }
  return _regexOnlyAnonymizer;
}

async function getNERAnonymizer(): Promise<Anonymizer | null> {
  if (_nerAnonymizer) return _nerAnonymizer;
  if (_nerAnonymizerError) return null;

  try {
    const isDownloaded = await isModelDownloaded('quantized');
    if (!isDownloaded) {
      _nerAnonymizerError = 'NER model not downloaded. Run `npm run setup:ner` first.';
      return null;
    }

    _nerAnonymizer = createAnonymizer({
      ner: { mode: 'quantized', autoDownload: false },
    });
    await _nerAnonymizer.initialize();
    return _nerAnonymizer;
  } catch (e) {
    _nerAnonymizerError = String(e);
    return null;
  }
}

describe('Full Anonymizer - Regex Only', () => {
  bench('anonymize (regex-only) - short text', async () => {
    const anonymizer = await getRegexOnlyAnonymizer();
    await anonymizer.anonymize(SHORT_TEXT);
  });

  bench('anonymize (regex-only) - medium text', async () => {
    const anonymizer = await getRegexOnlyAnonymizer();
    await anonymizer.anonymize(MEDIUM_TEXT);
  });

  bench('anonymize (regex-only) - long text', async () => {
    const anonymizer = await getRegexOnlyAnonymizer();
    await anonymizer.anonymize(LONG_TEXT);
  });

  bench('anonymize (regex-only) - entity-dense text', async () => {
    const anonymizer = await getRegexOnlyAnonymizer();
    await anonymizer.anonymize(ENTITY_DENSE_TEXT);
  });
});

describe('Full Anonymizer - With NER (quantized model)', () => {
  bench('anonymize (with NER) - short text', async () => {
    const anonymizer = await getNERAnonymizer();
    if (!anonymizer) throw new Error(_nerAnonymizerError ?? 'NER anonymizer not available');
    await anonymizer.anonymize(SHORT_TEXT);
  });

  bench('anonymize (with NER) - medium text', async () => {
    const anonymizer = await getNERAnonymizer();
    if (!anonymizer) throw new Error(_nerAnonymizerError ?? 'NER anonymizer not available');
    await anonymizer.anonymize(MEDIUM_TEXT);
  });

  bench('anonymize (with NER) - long text', async () => {
    const anonymizer = await getNERAnonymizer();
    if (!anonymizer) throw new Error(_nerAnonymizerError ?? 'NER anonymizer not available');
    await anonymizer.anonymize(LONG_TEXT);
  });

  bench('anonymize (with NER) - entity-dense text', async () => {
    const anonymizer = await getNERAnonymizer();
    if (!anonymizer) throw new Error(_nerAnonymizerError ?? 'NER anonymizer not available');
    await anonymizer.anonymize(ENTITY_DENSE_TEXT);
  });
});

// =============================================================================
// GPU Inference Server Benchmarks
// Requires the inference server to be running:
//   cd docker/inference-server && sudo docker-compose up -d
// =============================================================================

// Check if inference server is available
let _inferenceServerAvailable: boolean | null = null;
let _inferenceServerError: string | null = null;
let _gpuAnonymizer: Anonymizer | null = null;

async function isInferenceServerAvailable(): Promise<boolean> {
  if (_inferenceServerAvailable !== null) return _inferenceServerAvailable;
  
  try {
    const client = new InferenceServerClient({ url: INFERENCE_SERVER_URL, timeout: 2000 });
    const health = await client.health();
    _inferenceServerAvailable = health.model_loaded;
    if (!_inferenceServerAvailable) {
      _inferenceServerError = 'Inference server model not loaded';
    }
    return _inferenceServerAvailable;
  } catch (e) {
    _inferenceServerAvailable = false;
    _inferenceServerError = `Inference server not available at ${INFERENCE_SERVER_URL}`;
    return false;
  }
}

async function getGPUAnonymizer(): Promise<Anonymizer | null> {
  if (_gpuAnonymizer) return _gpuAnonymizer;
  
  const available = await isInferenceServerAvailable();
  if (!available) return null;
  
  try {
    _gpuAnonymizer = createAnonymizer({
      ner: {
        mode: 'quantized',
        backend: 'inference-server',
        inferenceServerUrl: INFERENCE_SERVER_URL,
        autoDownload: false,
      },
    });
    await _gpuAnonymizer.initialize();
    return _gpuAnonymizer;
  } catch (e) {
    _inferenceServerError = String(e);
    return null;
  }
}

describe('Full Anonymizer - GPU Inference Server', () => {
  bench('anonymize (GPU) - short text', async () => {
    const anonymizer = await getGPUAnonymizer();
    if (!anonymizer) throw new Error(_inferenceServerError ?? 'GPU anonymizer not available');
    await anonymizer.anonymize(SHORT_TEXT);
  });

  bench('anonymize (GPU) - medium text', async () => {
    const anonymizer = await getGPUAnonymizer();
    if (!anonymizer) throw new Error(_inferenceServerError ?? 'GPU anonymizer not available');
    await anonymizer.anonymize(MEDIUM_TEXT);
  });

  bench('anonymize (GPU) - long text', async () => {
    const anonymizer = await getGPUAnonymizer();
    if (!anonymizer) throw new Error(_inferenceServerError ?? 'GPU anonymizer not available');
    await anonymizer.anonymize(LONG_TEXT);
  });

  bench('anonymize (GPU) - entity-dense text', async () => {
    const anonymizer = await getGPUAnonymizer();
    if (!anonymizer) throw new Error(_inferenceServerError ?? 'GPU anonymizer not available');
    await anonymizer.anonymize(ENTITY_DENSE_TEXT);
  });
});

