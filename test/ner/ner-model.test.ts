/**
 * NER Model Integration Tests
 * Tests the full NER pipeline including model loading and inference
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createNERModel,
  NERModelStub,
  createNERModelStub,
  type INERModel,
} from '../../src/ner/ner-model.js';
import {
  isModelDownloaded,
  ensureModel,
  MODEL_REGISTRY,
} from '../../src/ner/model-manager.js';
import { createDefaultPolicy, PIIType } from '../../src/index.js';

describe('NER Model', () => {
  describe('NERModelStub', () => {
    it('should create stub with createNERModelStub', () => {
      const stub = createNERModelStub();
      expect(stub).toBeInstanceOf(NERModelStub);
    });

    it('should have correct version', () => {
      const stub = new NERModelStub();
      expect(stub.version).toBe('stub-1.0.0');
    });

    it('should report as loaded', () => {
      const stub = new NERModelStub();
      expect(stub.loaded).toBe(true);
    });

    it('should load without error', async () => {
      const stub = new NERModelStub();
      await expect(stub.load()).resolves.toBeUndefined();
    });

    it('should predict empty spans', async () => {
      const stub = new NERModelStub();
      const result = await stub.predict('Hello John Smith');
      
      expect(result.spans).toEqual([]);
      expect(result.processingTimeMs).toBe(0);
      expect(result.modelVersion).toBe('stub-1.0.0');
    });

    it('should dispose without error', async () => {
      const stub = new NERModelStub();
      await expect(stub.dispose()).resolves.toBeUndefined();
    });
  });

  describe('NERModel (real model)', () => {
    let model: INERModel | null = null;
    let modelAvailable = false;
    const isCI = process.env.CI === 'true';

    beforeAll(async () => {
      // Skip model loading in CI - model files are too large
      if (isCI) return;
      
      // Check if model is downloaded
      modelAvailable = await isModelDownloaded('quantized');
      
      if (modelAvailable) {
        const { modelPath, vocabPath } = await ensureModel('quantized', { autoDownload: false });
        
        model = createNERModel({
          modelPath,
          vocabPath,
          labelMap: MODEL_REGISTRY.quantized.labelMap,
          modelVersion: '1.0.0',
        });
        
        await model.load();
      }
    }, 60000); // 60s timeout for model loading

    afterAll(async () => {
      if (model) {
        await model.dispose();
      }
    });

    it('should load successfully if model available', async () => {
      if (isCI || !modelAvailable) return; // Skip in CI or if model not downloaded
      expect(model).not.toBeNull();
      expect(model!.loaded).toBe(true);
    });

    it('should have version', async () => {
      if (isCI || !modelAvailable) return;
      expect(model!.version).toBe('1.0.0');
    });

    describe('entity detection', () => {
      it('should detect PERSON entity', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('Hello, my name is John Smith.');
        
        expect(result.spans.length).toBeGreaterThanOrEqual(1);
        
        const personSpans = result.spans.filter(s => s.type === PIIType.PERSON);
        expect(personSpans.length).toBeGreaterThanOrEqual(1);
        
        const johnSmith = personSpans.find(s => s.text?.includes('John'));
        expect(johnSmith).toBeDefined();
        expect(johnSmith!.confidence).toBeGreaterThan(0.5);
      });

      it('should detect ORG entity', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('I work at Apple Inc.');
        
        const orgSpans = result.spans.filter(s => s.type === PIIType.ORG);
        expect(orgSpans.length).toBeGreaterThanOrEqual(1);
        
        const apple = orgSpans.find(s => s.text?.includes('Apple'));
        expect(apple).toBeDefined();
      });

      it('should detect LOCATION entity', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('I live in Berlin, Germany.');
        
        const locSpans = result.spans.filter(s => s.type === PIIType.LOCATION);
        expect(locSpans.length).toBeGreaterThanOrEqual(1);
        
        const berlin = locSpans.find(s => s.text?.includes('Berlin'));
        expect(berlin).toBeDefined();
      });

      it('should detect multiple entities', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict(
          'John Smith works at Microsoft in Seattle.'
        );
        
        expect(result.spans.length).toBeGreaterThanOrEqual(2);
        
        const types = new Set(result.spans.map(s => s.type));
        expect(types.has(PIIType.PERSON)).toBe(true);
      });

      it('should detect entities beyond the 512-token window (issue #82)', async () => {
        if (isCI || !modelAvailable) return;
        // Filler pushes "John Smith" far past the model's single-window
        // token limit; before windowing this leaked undetected
        const text =
          'This is neutral filler text. '.repeat(300) +
          'Meeting with John Smith tomorrow.';
        const nameOffset = text.indexOf('John Smith');

        const result = await model!.predict(text);

        const personSpans = result.spans.filter(s => s.type === PIIType.PERSON);
        const johnSmith = personSpans.find(
          s => s.start >= nameOffset && s.end <= nameOffset + 'John Smith'.length
        );
        expect(johnSmith).toBeDefined();
        expect(johnSmith!.text).toContain('John');
      }, 120000);

      it('should detect entities in the middle of a long input', async () => {
        if (isCI || !modelAvailable) return;
        const filler = 'This is neutral filler text. ';
        const text =
          filler.repeat(150) +
          'Please contact Maria Gonzalez in Barcelona. ' +
          filler.repeat(150);
        const nameOffset = text.indexOf('Maria Gonzalez');

        const result = await model!.predict(text);

        const personSpans = result.spans.filter(s => s.type === PIIType.PERSON);
        const maria = personSpans.find(
          s => s.start >= nameOffset && s.start < nameOffset + 'Maria'.length
        );
        expect(maria).toBeDefined();
      }, 120000);

      it('should handle text without entities', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('The weather is nice today.');
        
        // Should return without errors
        expect(result.spans).toBeDefined();
        expect(Array.isArray(result.spans)).toBe(true);
      });

      it('should handle empty text', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('');
        
        expect(result.spans).toEqual([]);
      });
    });

    describe('German text', () => {
      it('should detect German names', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('Mein Name ist Hans Müller.');
        
        const personSpans = result.spans.filter(s => s.type === PIIType.PERSON);
        expect(personSpans.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect German locations', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('Ich wohne in München.');
        
        const locSpans = result.spans.filter(s => s.type === PIIType.LOCATION);
        expect(locSpans.length).toBeGreaterThanOrEqual(1);
      });

      it('should detect German organizations', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('Ich arbeite bei der Deutschen Bank.');
        
        const orgSpans = result.spans.filter(s => s.type === PIIType.ORG);
        expect(orgSpans.length).toBeGreaterThanOrEqual(1);
      });
    });

    describe('case fallback', () => {
      let fallbackModel: INERModel | null = null;

      beforeAll(async () => {
        if (isCI || !modelAvailable) return;
        const { modelPath, vocabPath } = await ensureModel('quantized', { autoDownload: false });

        fallbackModel = createNERModel({
          modelPath,
          vocabPath,
          labelMap: MODEL_REGISTRY.quantized.labelMap,
          modelVersion: '1.0.0',
          caseFallback: true,
        });
        await fallbackModel.load();
      }, 60000);

      afterAll(async () => {
        if (fallbackModel) await fallbackModel.dispose();
      });

      it('should detect lowercase person names via case fallback', async () => {
        if (isCI || !modelAvailable) return;
        const result = await fallbackModel!.predict('Whats going on tom?');

        const personSpans = result.spans.filter(s => s.type === PIIType.PERSON);
        expect(personSpans.length).toBeGreaterThanOrEqual(1);

        const tom = personSpans.find(s => s.text?.toLowerCase().includes('tom'));
        expect(tom).toBeDefined();
        // Fallback detections should have the original (lowercase) text
        expect(tom!.text).toBe('tom');
      });

      it('should still detect capitalized names normally', async () => {
        if (isCI || !modelAvailable) return;
        const result = await fallbackModel!.predict('Whats going on Tom?');

        const personSpans = result.spans.filter(s => s.type === PIIType.PERSON);
        expect(personSpans.length).toBeGreaterThanOrEqual(1);

        const tom = personSpans.find(s => s.text?.includes('Tom'));
        expect(tom).toBeDefined();
      });

      it('should apply confidence penalty to fallback detections', async () => {
        if (isCI || !modelAvailable) return;
        const resultLower = await fallbackModel!.predict('Whats going on tom?');
        const resultUpper = await fallbackModel!.predict('Whats going on Tom?');

        const tomLower = resultLower.spans.find(s => s.text?.toLowerCase() === 'tom');
        const tomUpper = resultUpper.spans.find(s => s.text === 'Tom');

        if (tomLower && tomUpper) {
          // Fallback detection should have lower confidence due to penalty
          expect(tomLower.confidence).toBeLessThan(tomUpper.confidence);
        }
      });

      it('should not duplicate entities already found in primary pass', async () => {
        if (isCI || !modelAvailable) return;
        // "John Smith" should be detected in primary pass; fallback should not add a duplicate
        const result = await fallbackModel!.predict('Hello John Smith!');

        const personSpans = result.spans.filter(s => s.type === PIIType.PERSON);
        // Should have exactly 1, not 2
        const johnSpans = personSpans.filter(s => s.text?.includes('John'));
        expect(johnSpans.length).toBe(1);
      });

      it('should preserve correct character offsets for fallback detections', async () => {
        if (isCI || !modelAvailable) return;
        const text = 'hello tom, how are you?';
        const result = await fallbackModel!.predict(text);

        for (const span of result.spans) {
          expect(span.start).toBeGreaterThanOrEqual(0);
          expect(span.end).toBeLessThanOrEqual(text.length);
          if (span.text) {
            expect(span.text).toBe(text.slice(span.start, span.end));
          }
        }
      });

      it('should not detect lowercase names when disabled (default)', async () => {
        if (isCI || !modelAvailable) return;
        // The shared `model` has default config (caseFallback: false)
        const result = await model!.predict('Whats going on tom?');
        const personSpans = result.spans.filter(s => s.type === PIIType.PERSON);
        expect(personSpans.length).toBe(0);
      });
    });

    describe('confidence filtering', () => {
      it('should filter by policy thresholds', async () => {
        if (isCI || !modelAvailable) return;
        const policy = createDefaultPolicy();
        // Set very high threshold
        policy.confidenceThresholds.set(PIIType.PERSON, 0.99);
        
        const result = await model!.predict('Hello John Smith', undefined, policy);
        
        // With high threshold, some entities might be filtered
        expect(result.spans).toBeDefined();
      });
    });

    describe('character offsets', () => {
      it('should provide correct character offsets', async () => {
        if (isCI || !modelAvailable) return;
        const text = 'Hello John Smith!';
        const result = await model!.predict(text);
        
        for (const span of result.spans) {
          expect(span.start).toBeGreaterThanOrEqual(0);
          expect(span.end).toBeLessThanOrEqual(text.length);
          expect(span.start).toBeLessThan(span.end);
          
          // Verify text matches offset
          if (span.text) {
            expect(span.text).toBe(text.slice(span.start, span.end));
          }
        }
      });
    });

    describe('performance', () => {
      it('should report processing time', async () => {
        if (isCI || !modelAvailable) return;
        const result = await model!.predict('Hello John Smith');
        
        expect(result.processingTimeMs).toBeGreaterThan(0);
      });

      it('should handle longer text', async () => {
        if (isCI || !modelAvailable) return;
        const longText = `
          John Smith is a software engineer at Microsoft Corporation in Seattle, Washington.
          He works with Mary Johnson and Peter Williams on the Azure cloud platform.
          Their office is located at 123 Main Street, near the Space Needle.
          Contact them at team@microsoft.com or call +1-206-555-0123.
        `;
        
        const result = await model!.predict(longText);
        
        expect(result.spans.length).toBeGreaterThan(0);
        expect(result.processingTimeMs).toBeGreaterThan(0);
      }, 30000);
    });
  });

  describe('Model Manager', () => {
    it('should have quantized model in registry', () => {
      expect(MODEL_REGISTRY.quantized).toBeDefined();
      expect(MODEL_REGISTRY.quantized.labelMap).toBeDefined();
      expect(MODEL_REGISTRY.quantized.labelMap.length).toBeGreaterThan(0);
    });

    it('should have standard model in registry', () => {
      expect(MODEL_REGISTRY.standard).toBeDefined();
    });

    it('should check model availability', async () => {
      const result = await isModelDownloaded('quantized');
      expect(typeof result).toBe('boolean');
    });
  });
});

describe('NER with Anonymizer Integration', () => {
  let modelAvailable = false;
  const isCI = process.env.CI === 'true';

  beforeAll(async () => {
    if (isCI) return;
    modelAvailable = await isModelDownloaded('quantized');
  });

  it('should detect NER entities in full anonymization', async () => {
    if (isCI || !modelAvailable) return;
    const { createAnonymizer, InMemoryKeyProvider, PIIType } = await import('../../src/index.js');
    
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      ner: {
        mode: 'quantized',
        autoDownload: false,
      },
    });
    
    await anonymizer.initialize();
    
    const result = await anonymizer.anonymize(
      'Hello, my name is John Smith and I work at Apple Inc in Berlin.'
    );
    
    // Should detect PERSON, ORG, and LOCATION
    expect(result.stats.countsByType[PIIType.PERSON]).toBeGreaterThanOrEqual(1);
    expect(result.stats.countsByType[PIIType.ORG]).toBeGreaterThanOrEqual(1);
    expect(result.stats.countsByType[PIIType.LOCATION]).toBeGreaterThanOrEqual(1);
    
    // Should have PII tags in output
    expect(result.anonymizedText).toContain('<PII type="PERSON"');
    expect(result.anonymizedText).toContain('<PII type="ORG"');
    expect(result.anonymizedText).toContain('<PII type="LOCATION"');
    
    await anonymizer.dispose();
  }, 60000);

  it('should combine NER with regex detection', async () => {
    if (isCI || !modelAvailable) return;
    const { createAnonymizer, InMemoryKeyProvider, PIIType, DetectionSource } = await import('../../src/index.js');
    
    const keyProvider = new InMemoryKeyProvider();
    const anonymizer = createAnonymizer({
      keyProvider,
      ner: {
        mode: 'quantized',
        autoDownload: false,
      },
    });
    
    await anonymizer.initialize();
    
    const result = await anonymizer.anonymize(
      'Contact John Smith at john@example.com or call +49 30 123456789.'
    );
    
    // NER detected
    expect(result.stats.countsByType[PIIType.PERSON]).toBeGreaterThanOrEqual(1);
    
    // Regex detected
    expect(result.stats.countsByType[PIIType.EMAIL]).toBe(1);
    expect(result.stats.countsByType[PIIType.PHONE]).toBeGreaterThanOrEqual(1);
    
    // Check sources
    const nerEntities = result.entities.filter(e => e.source === DetectionSource.NER);
    const regexEntities = result.entities.filter(e => e.source === DetectionSource.REGEX);
    
    expect(nerEntities.length).toBeGreaterThan(0);
    expect(regexEntities.length).toBeGreaterThan(0);
    
    await anonymizer.dispose();
  }, 60000);
});

