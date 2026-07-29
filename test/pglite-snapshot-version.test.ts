import { describe, expect, test } from 'bun:test';
import { parseSnapshotVersion } from '../src/core/pglite-engine.ts';

describe('parseSnapshotVersion', () => {
  test('reads the schema hash and embedding dimensions', () => {
    expect(parseSnapshotVersion('abc123\nembedding_dimensions=1280\n')).toEqual({
      schemaHash: 'abc123',
      embeddingDimensions: 1280,
    });
  });

  test('treats hash-only legacy receipts as dimension-incompatible', () => {
    expect(parseSnapshotVersion('abc123\n')).toEqual({
      schemaHash: 'abc123',
      embeddingDimensions: null,
    });
  });

  test('rejects malformed or non-positive dimensions', () => {
    expect(parseSnapshotVersion('abc123\nembedding_dimensions=not-a-number\n')
      .embeddingDimensions).toBeNull();
    expect(parseSnapshotVersion('abc123\nembedding_dimensions=0\n')
      .embeddingDimensions).toBeNull();
  });
});
