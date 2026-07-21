/**
 * Model Manager Tests
 * Tests label map resolution for registry models
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLabelMap, MODEL_REGISTRY } from '../../src/ner/model-manager.js';

describe('loadLabelMap', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'rehydra-label-map-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('should load the label map from label_map.json when present', async () => {
    const customMap = ['O', 'B-PER', 'I-PER'];
    const path = join(dir, 'valid.json');
    await writeFile(path, JSON.stringify(customMap));

    const labelMap = await loadLabelMap('quantized', path);

    expect(labelMap).toEqual(customMap);
  });

  it('should fall back to the registry map when the file is missing', async () => {
    const labelMap = await loadLabelMap(
      'quantized',
      join(dir, 'does-not-exist.json')
    );

    expect(labelMap).toEqual(MODEL_REGISTRY.quantized.labelMap);
  });

  it('should fall back to the registry map for corrupted JSON', async () => {
    const path = join(dir, 'corrupt.json');
    await writeFile(path, '{not json');

    const labelMap = await loadLabelMap('standard', path);

    expect(labelMap).toEqual(MODEL_REGISTRY.standard.labelMap);
  });

  it('should fall back to the registry map for wrong-shaped content', async () => {
    for (const [name, content] of [
      ['object.json', '{"0": "O"}'],
      ['empty-array.json', '[]'],
      ['mixed-array.json', '["O", 1, "B-PER"]'],
    ] as const) {
      const path = join(dir, name);
      await writeFile(path, content);

      const labelMap = await loadLabelMap('quantized', path);

      expect(labelMap, name).toEqual(MODEL_REGISTRY.quantized.labelMap);
    }
  });

  it('registry maps must match the model head order (DATE before PER)', () => {
    // Both shipped models were trained with this exact head order; a
    // mismatched map silently misclassifies every entity (see issue #85)
    for (const mode of ['standard', 'quantized'] as const) {
      expect(MODEL_REGISTRY[mode].labelMap.slice(0, 4)).toEqual([
        'O',
        'B-DATE',
        'I-DATE',
        'B-PER',
      ]);
    }
  });
});
