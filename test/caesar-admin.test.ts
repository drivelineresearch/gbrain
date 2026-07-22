import { describe, it, expect } from 'bun:test';
import {
  CLAIM_TTL_MS,
  CLIENT_NAME,
  ClaimStore,
  issueUnifiedClient,
  mergeUnifiedClients,
  parseCallLogTail,
  revokeUnifiedClient,
} from '../src/core/caesar-admin.ts';

/** Tagged-template SQL stub: records normalized statements, returns queued rows. */
function fakeSql(results: Array<Array<Record<string, unknown>>> = []) {
  const statements: string[] = [];
  const queue = [...results];
  const sql = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    statements.push(strings.join('?').replace(/\s+/g, ' ').trim());
    return Promise.resolve(queue.shift() ?? []);
  };
  return { sql: sql as any, statements };
}

/**
 * Unified Caesar+DBrain client administration — pure logic surface.
 *
 * Pinned behaviors:
 *   - Claim codes are single-use, TTL-bound, and invalidated by re-issue
 *   - The plaintext token is returned exactly once, never listed
 *   - Registry/DB merge reports per-side status without dropping either side
 *   - Call-log tail skips torn lines and returns newest-first
 */

describe('ClaimStore', () => {
  it('redeems a code exactly once', () => {
    const store = new ClaimStore();
    const { code } = store.create('coach-a', 't'.repeat(48), 1_000);
    const first = store.claim(code, 2_000);
    expect(first).toEqual({ clientName: 'coach-a', token: 't'.repeat(48) });
    expect(store.claim(code, 3_000)).toBeNull();
  });

  it('expires codes after the TTL and audits them as expired', () => {
    const store = new ClaimStore();
    const { code } = store.create('coach-b', 't'.repeat(48), 1_000);
    expect(store.claim(code, 1_000 + CLAIM_TTL_MS + 1)).toBeNull();
    expect(store.recent(1_000 + CLAIM_TTL_MS + 1)[0]).toMatchObject({
      clientName: 'coach-b',
      status: 'expired',
    });
  });

  it('re-issuing for the same client invalidates the previous code', () => {
    const store = new ClaimStore();
    const first = store.create('coach-c', 'a'.repeat(48), 1_000);
    const second = store.create('coach-c', 'b'.repeat(48), 2_000);
    expect(store.claim(first.code, 3_000)).toBeNull();
    expect(store.claim(second.code, 3_000)?.token).toBe('b'.repeat(48));
  });

  it('normalizes case and whitespace on redemption', () => {
    const store = new ClaimStore();
    const { code } = store.create('coach-d', 't'.repeat(48), 1_000);
    expect(store.claim(`  ${code.toLowerCase()} `, 2_000)?.clientName).toBe('coach-d');
  });

  it('audit entries never contain the token', () => {
    const store = new ClaimStore();
    store.create('coach-e', 'supersecrettoken'.repeat(3), 1_000);
    expect(JSON.stringify(store.recent(1_000))).not.toContain('supersecrettoken');
  });

  it('invalidateClient kills the pending code and its audit row', () => {
    const store = new ClaimStore();
    const { code } = store.create('coach-f', 't'.repeat(48), 1_000);
    store.invalidateClient('coach-f');
    expect(store.claim(code, 2_000)).toBeNull();
    expect(store.recent(2_000)[0]).toMatchObject({ clientName: 'coach-f', status: 'expired' });
  });

  it('re-issue marks the superseded audit row expired, not stuck pending', () => {
    const store = new ClaimStore();
    store.create('coach-g', 'a'.repeat(48), 1_000);
    store.create('coach-g', 'b'.repeat(48), 2_000);
    const statuses = store.recent(2_000).map((entry) => entry.status);
    expect(statuses).toEqual(['pending', 'expired']);
  });
});

describe('mergeUnifiedClients', () => {
  it('reports per-side status and excludes legacy DBrain-only API keys', () => {
    const rows = mergeUnifiedClients(
      { clients: { 'coach-a': { enabled: true }, 'caesar-revoked': { enabled: false } } },
      [
        { name: 'coach-a', status: 'active', created_at: '2026-07-22', last_used_at: '2026-07-22' },
        { name: 'legacy-gbrain-key', status: 'active' },
      ],
    );
    expect(rows).toEqual([
      {
        name: 'caesar-revoked',
        caesar: 'revoked',
        dbrain: 'missing',
        created_at: null,
        last_used_at: null,
      },
      {
        name: 'coach-a',
        caesar: 'active',
        dbrain: 'active',
        created_at: '2026-07-22',
        last_used_at: '2026-07-22',
      },
    ]);
  });

  it('one active row wins over revoked rotation history for the same name', () => {
    const rows = mergeUnifiedClients({ clients: { 'coach-a': { enabled: true } } }, [
      { name: 'coach-a', status: 'revoked', last_used_at: '2026-07-01' },
      { name: 'coach-a', status: 'active', last_used_at: '2026-07-22' },
    ]);
    expect(rows[0].dbrain).toBe('active');
    expect(rows[0].last_used_at).toBe('2026-07-22');
  });
});

describe('issueUnifiedClient', () => {
  const registry = async () => ({ clients: { 'coach-a': { enabled: true } } });

  it('revokes prior rows only AFTER Caesar registration succeeds', async () => {
    const { sql, statements } = fakeSql();
    const cliCalls: string[][] = [];
    const token = await issueUnifiedClient(sql, 'coach-a', {
      cli: async (args) => { cliCalls.push(args); },
      loadRegistry: registry,
    });
    expect(token.startsWith('dl_')).toBe(true);
    expect(cliCalls).toEqual([['register', 'coach-a']]);
    expect(statements[0]).toStartWith('INSERT INTO access_tokens');
    expect(statements[1]).toContain('id <> ?');
    expect(statements).toHaveLength(2);
  });

  it('a Caesar failure rolls back the new row and leaves the previous token untouched', async () => {
    const { sql, statements } = fakeSql();
    await expect(
      issueUnifiedClient(sql, 'coach-a', {
        cli: async () => { throw new Error('caesar down'); },
        loadRegistry: registry,
      }),
    ).rejects.toThrow('caesar down');
    expect(statements[0]).toStartWith('INSERT INTO access_tokens');
    expect(statements[1]).toContain('WHERE id = ?');
    // Critically: no name-wide revoke ran, so the previous token stays valid everywhere.
    expect(statements).toHaveLength(2);
  });

  it('refuses to adopt a name owned by an active legacy DBrain API key', async () => {
    const { sql, statements } = fakeSql([[{ id: 'legacy-row' }]]);
    await expect(
      issueUnifiedClient(sql, 'legacy-key', {
        cli: async () => { throw new Error('must not be called'); },
        loadRegistry: async () => ({ clients: {} }),
      }),
    ).rejects.toThrow('already names an active DBrain API key');
    expect(statements).toHaveLength(1); // the existence check only — no insert
  });
});

describe('revokeUnifiedClient', () => {
  it('refuses names that are not unified Caesar clients', async () => {
    const { sql, statements } = fakeSql();
    const result = await revokeUnifiedClient(sql, 'legacy-key', {
      cli: async () => { throw new Error('must not be called'); },
      loadRegistry: async () => ({ clients: {} }),
    });
    expect(result).toMatchObject({ dbrain: false, caesar: false });
    expect(result.errors[0]).toContain('not a unified Caesar client');
    expect(statements).toHaveLength(0);
  });

  it('revokes both stores for a unified client', async () => {
    const { sql, statements } = fakeSql();
    const cliCalls: string[][] = [];
    const result = await revokeUnifiedClient(sql, 'coach-a', {
      cli: async (args) => { cliCalls.push(args); },
      loadRegistry: async () => ({ clients: { 'coach-a': { enabled: true } } }),
    });
    expect(result).toEqual({ dbrain: true, caesar: true, errors: [] });
    expect(cliCalls).toEqual([['revoke', 'coach-a']]);
    expect(statements[0]).toContain('SET revoked_at = now()');
  });
});

describe('parseCallLogTail', () => {
  it('returns newest-first and skips torn lines', () => {
    const text = [
      '{"tool":"search_athlete","client":"a"}',
      '{"tool":"query_driveline","client":"b"}',
      '{"tool":"query_precedent","cli',
      '',
    ].join('\n');
    expect(parseCallLogTail(text, 10)).toEqual([
      { tool: 'query_driveline', client: 'b' },
      { tool: 'search_athlete', client: 'a' },
    ]);
  });

  it('honors the limit', () => {
    const text = Array.from({ length: 5 }, (_, index) => `{"n":${index}}`).join('\n');
    expect(parseCallLogTail(text, 2)).toEqual([{ n: 4 }, { n: 3 }]);
  });
});

describe('CLIENT_NAME', () => {
  it('matches the caesar-mcp-admin client id contract', () => {
    expect(CLIENT_NAME.test('shredder-hermes')).toBe(true);
    expect(CLIENT_NAME.test('coach.le_01')).toBe(true);
    expect(CLIENT_NAME.test('-leading-dash')).toBe(false);
    expect(CLIENT_NAME.test('a'.repeat(65))).toBe(false);
    expect(CLIENT_NAME.test('bad name')).toBe(false);
  });
});
