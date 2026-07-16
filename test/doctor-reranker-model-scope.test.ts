import { describe, expect, test } from 'bun:test';
import type { RerankFailureEvent } from '../src/core/rerank-audit.ts';
import { failuresForConfiguredReranker } from '../src/commands/doctor.ts';

function event(model: string): RerankFailureEvent {
  return {
    ts: '2026-07-16T00:00:00.000Z',
    model,
    reason: 'auth',
    query_hash: 'deadbeef',
    doc_count: 5,
    error_summary: 'test-only',
    severity: 'warn',
  };
}

describe('reranker doctor model scoping', () => {
  test('inactive-provider failures do not penalize the configured reranker', () => {
    const failures = [
      event('zeroentropyai:zerank-2'),
      event('llama-server-reranker:qwen3-reranker-4b'),
    ];

    expect(failuresForConfiguredReranker(
      failures,
      'llama-server-reranker:qwen3-reranker-4b',
    )).toEqual([failures[1]]);
  });

  test('legacy brains without an explicit model retain all audit visibility', () => {
    const failures = [event('zeroentropyai:zerank-2'), event('unknown')];
    expect(failuresForConfiguredReranker(failures, undefined)).toEqual(failures);
  });
});
