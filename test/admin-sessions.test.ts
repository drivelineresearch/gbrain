import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdminSessionStore } from '../src/core/admin-sessions.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function storePath(): string {
  const root = mkdtempSync(join(tmpdir(), 'gbrain-admin-sessions-'));
  roots.push(root);
  return join(root, 'state', 'admin-sessions.json');
}

describe('AdminSessionStore', () => {
  test('recognizes a browser after a process restart without persisting its cookie', () => {
    const path = storePath();
    const rawSession = 'operator-browser-cookie-value';
    const expiresAt = Date.now() + 60_000;

    const firstProcess = new AdminSessionStore(path, 'bootstrap-fingerprint');
    firstProcess.add(rawSession, expiresAt);

    const stored = readFileSync(path, 'utf8');
    expect(stored).not.toContain(rawSession);
    expect(statSync(path).mode & 0o777).toBe(0o600);

    const restartedProcess = new AdminSessionStore(path, 'bootstrap-fingerprint');
    expect(restartedProcess.validate(rawSession)).toBe(true);
    expect(restartedProcess.validate('different-cookie')).toBe(false);
  });

  test('fails closed for expired or corrupt session state', () => {
    const path = storePath();
    const store = new AdminSessionStore(path, 'bootstrap-fingerprint');
    store.add('expired-cookie', Date.now() - 1);
    expect(new AdminSessionStore(path, 'bootstrap-fingerprint').validate('expired-cookie')).toBe(false);

    writeFileSync(path, '{not-json', { mode: 0o600 });
    expect(new AdminSessionStore(path, 'bootstrap-fingerprint').validate('anything')).toBe(false);
  });

  test('sign out everywhere remains durable across restarts', () => {
    const path = storePath();
    const store = new AdminSessionStore(path, 'bootstrap-fingerprint');
    store.add('browser-a', Date.now() + 60_000);
    store.add('browser-b', Date.now() + 60_000);
    expect(store.clear()).toBe(2);

    const restartedProcess = new AdminSessionStore(path, 'bootstrap-fingerprint');
    expect(restartedProcess.validate('browser-a')).toBe(false);
    expect(restartedProcess.validate('browser-b')).toBe(false);
  });

  test('rotating the bootstrap secret revokes previously remembered browsers', () => {
    const path = storePath();
    const store = new AdminSessionStore(path, 'old-bootstrap-fingerprint');
    store.add('browser-cookie', Date.now() + 60_000);

    const rotatedProcess = new AdminSessionStore(path, 'new-bootstrap-fingerprint');
    expect(rotatedProcess.validate('browser-cookie')).toBe(false);
  });
});
