/**
 * Anonymizer Comparison Benchmark
 * Compares: Regex-only, NER (CPU), NER (GPU)
 */

import { describe, bench } from 'vitest';
import { createAnonymizer, type Anonymizer } from '../../src/core/anonymizer.js';
import { isModelDownloaded } from '../../src/ner/model-manager.js';
import { InferenceServerClient } from '../../src/ner/inference-server-client.js';

// =============================================================================
// Configuration
// =============================================================================

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

const ENTITY_DENSE_TEXT = `
John Smith from Berlin called Mary Johnson in Munich about the Acme Corp deal.
Contact hans.mueller@example.com or maria.schmidt@company.de for details.
The meeting with Peter Brown and Sarah Wilson from TechCorp GmbH is confirmed.
Attendees: Dr. Thomas Weber, Prof. Anna Fischer, and CEO Michael Schmidt.
`;

// =============================================================================
// Lazy-loaded Anonymizers
// =============================================================================

let _regexAnonymizer: Anonymizer | null = null;
let _cpuAnonymizer: Anonymizer | null = null;
let _gpuAnonymizer: Anonymizer | null = null;
let _cpuError: string | null = null;
let _gpuError: string | null = null;

async function getRegexAnonymizer(): Promise<Anonymizer> {
  if (!_regexAnonymizer) {
    _regexAnonymizer = createAnonymizer({ ner: { mode: 'disabled' } });
    await _regexAnonymizer.initialize();
  }
  return _regexAnonymizer;
}

async function getCPUAnonymizer(): Promise<Anonymizer | null> {
  if (_cpuAnonymizer) return _cpuAnonymizer;
  if (_cpuError) return null;

  try {
    const downloaded = await isModelDownloaded('quantized');
    if (!downloaded) {
      _cpuError = 'Model not downloaded. Run: npm run setup:ner';
      return null;
    }

    _cpuAnonymizer = createAnonymizer({
      ner: { mode: 'quantized', autoDownload: false },
    });
    await _cpuAnonymizer.initialize();
    return _cpuAnonymizer;
  } catch (e) {
    _cpuError = String(e);
    return null;
  }
}

async function getGPUAnonymizer(): Promise<Anonymizer | null> {
  if (_gpuAnonymizer) return _gpuAnonymizer;
  if (_gpuError) return null;

  try {
    const client = new InferenceServerClient({ url: INFERENCE_SERVER_URL, timeout: 2000 });
    const health = await client.health();
    if (!health.model_loaded) {
      _gpuError = 'Inference server model not loaded';
      return null;
    }

    _gpuAnonymizer = createAnonymizer({
      ner: {
        mode: 'quantized',
        backend: 'inference-server',
        inferenceServerUrl: INFERENCE_SERVER_URL,
      },
    });
    await _gpuAnonymizer.initialize();
    return _gpuAnonymizer;
  } catch (e) {
    _gpuError = `Server not available at ${INFERENCE_SERVER_URL}: ${e}`;
    return null;
  }
}

// =============================================================================
// Benchmarks
// =============================================================================

describe('Regex Only', () => {
  bench('short text (~40 chars)', async () => {
    const anon = await getRegexAnonymizer();
    await anon.anonymize(SHORT_TEXT);
  });

  bench('medium text (~500 chars)', async () => {
    const anon = await getRegexAnonymizer();
    await anon.anonymize(MEDIUM_TEXT);
  });

  bench('long text (~2000 chars)', async () => {
    const anon = await getRegexAnonymizer();
    await anon.anonymize(LONG_TEXT);
  });

  bench('entity-dense text', async () => {
    const anon = await getRegexAnonymizer();
    await anon.anonymize(ENTITY_DENSE_TEXT);
  });
});

describe('NER CPU (quantized)', () => {
  bench('short text (~40 chars)', async () => {
    const anon = await getCPUAnonymizer();
    if (!anon) throw new Error(_cpuError!);
    await anon.anonymize(SHORT_TEXT);
  });

  bench('medium text (~500 chars)', async () => {
    const anon = await getCPUAnonymizer();
    if (!anon) throw new Error(_cpuError!);
    await anon.anonymize(MEDIUM_TEXT);
  });

  bench('long text (~2000 chars)', async () => {
    const anon = await getCPUAnonymizer();
    if (!anon) throw new Error(_cpuError!);
    await anon.anonymize(LONG_TEXT);
  });

  bench('entity-dense text', async () => {
    const anon = await getCPUAnonymizer();
    if (!anon) throw new Error(_cpuError!);
    await anon.anonymize(ENTITY_DENSE_TEXT);
  });
});

describe('NER GPU (inference server)', () => {
  bench('short text (~40 chars)', async () => {
    const anon = await getGPUAnonymizer();
    if (!anon) throw new Error(_gpuError!);
    await anon.anonymize(SHORT_TEXT);
  });

  bench('medium text (~500 chars)', async () => {
    const anon = await getGPUAnonymizer();
    if (!anon) throw new Error(_gpuError!);
    await anon.anonymize(MEDIUM_TEXT);
  });

  bench('long text (~2000 chars)', async () => {
    const anon = await getGPUAnonymizer();
    if (!anon) throw new Error(_gpuError!);
    await anon.anonymize(LONG_TEXT);
  });

  bench('entity-dense text', async () => {
    const anon = await getGPUAnonymizer();
    if (!anon) throw new Error(_gpuError!);
    await anon.anonymize(ENTITY_DENSE_TEXT);
  });
});

