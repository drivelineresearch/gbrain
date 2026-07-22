import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { BrainEngine } from '../src/core/engine.ts';
import {
  getAdminGraph,
  listAdminPages,
  normalizeAdminPageFilters,
  readOperationsSnapshot,
} from '../src/core/admin-brain.ts';

const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

describe('admin brain read models', () => {
  test('normalizes and bounds page filters', () => {
    expect(normalizeAdminPageFilters({
      query: `  ${'x'.repeat(300)}  `,
      source: ' programming-brain ',
      type: ' knowledge ',
      page: '-3',
      limit: '5000',
    })).toEqual({
      query: 'x'.repeat(160),
      source: 'programming-brain',
      type: 'knowledge',
      page: 1,
      limit: 100,
    });
  });

  test('keeps browser search text in SQL parameters', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const engine = {
      executeRaw: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return calls.length === 1 ? [] : [{ total: 0 }];
      },
    } as unknown as BrainEngine;

    const hostile = `anything' OR 1=1 --`;
    await listAdminPages(engine, { query: hostile, source: 'default' });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.sql).not.toContain(hostile);
    expect(calls[0]!.params).toContain(`%${hostile}%`);
    expect(calls[1]!.sql).not.toContain(hostile);
  });

  test('graph edge query is generated only from numeric database ids', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const engine = {
      executeRaw: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (calls.length === 1) return [
          { id: 7, slug: 'a', title: 'A', type: 'knowledge', subject: 'biomechanics', source_id: 'default', degree: 2 },
          { id: 12, slug: 'b', title: 'B', type: 'knowledge', subject: 'pitching', source_id: 'default', degree: 1 },
        ];
        return [];
      },
    } as unknown as BrainEngine;

    await getAdminGraph(engine, { query: `x'); DROP TABLE links; --`, limit: 5000 });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.sql).not.toContain('DROP TABLE');
    expect(calls[0]!.sql).toContain("frontmatter->>'subject'");
    expect(calls[1]!.sql).toContain('IN ($1, $2)');
    expect(calls[1]!.params).toEqual([7, 12]);
  });

  test('loads only the fixed, versioned operations snapshot shape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gbrain-admin-'));
    tempDirs.push(dir);
    const path = join(dir, 'operations.json');
    await writeFile(path, JSON.stringify({
      schema_version: 1,
      generated_at: '2026-07-22T12:00:00Z',
      operational_status: 'healthy',
      services: [],
      schedules: [],
      recent_runs: [],
      providers: [],
    }));

    const result = await readOperationsSnapshot(path);
    expect(result.operational_status).toBe('healthy');

    await writeFile(path, JSON.stringify({ schema_version: 999, services: [], schedules: [] }));
    const rejected = await readOperationsSnapshot(path);
    expect(rejected.operational_status).toBe('unknown');
  });

  test('graph canvas colors nodes by subject without rendering page labels', async () => {
    const source = await readFile(new URL('../admin/src/pages/BrainGraph.tsx', import.meta.url), 'utf8');
    expect(source).toContain('subjectColor(node.subject)');
    expect(source).toContain('groups.set(node.subject');
    expect(source).not.toContain('<text');
    expect(source).not.toContain('sourceColors');
  });

  test('keeps every brain operations route behind admin authentication', async () => {
    const source = await readFile(new URL('../src/commands/serve-http.ts', import.meta.url), 'utf8');
    for (const route of [
      '/admin/api/brain/health',
      '/admin/api/brain/pages',
      '/admin/api/brain/pages/:id',
      '/admin/api/brain/graph',
      '/admin/api/jobs/history',
      '/admin/api/operations',
    ]) {
      expect(source).toContain(`app.get('${route}', requireAdmin`);
    }
  });
});
