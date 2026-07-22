import { createHash, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

export const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const STORE_VERSION = 1;
const MAX_SESSIONS = 256;
const MAX_STORE_BYTES = 64 * 1024;

interface StoredAdminSessions {
  version: 1;
  binding: string;
  sessions: Array<{ hash: string; expires_at: number }>;
}

function sessionHash(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex');
}

/**
 * Small durable store for browser admin sessions.
 *
 * Only hashes of the random cookie values are persisted. The file is written
 * atomically with mode 0600 so a GBrain restart does not log every operator out,
 * while deleting the file or calling clear() still fails closed immediately.
 * The store is bound to the bootstrap-secret fingerprint, so rotating that
 * operator secret also revokes every remembered browser.
 */
export class AdminSessionStore {
  private sessions = new Map<string, number>();

  constructor(
    private readonly path: string,
    private readonly binding: string,
  ) {
    this.load();
  }

  get size(): number {
    return this.sessions.size;
  }

  add(sessionId: string, expiresAt: number): void {
    this.prune();
    this.sessions.set(sessionHash(sessionId), expiresAt);

    if (this.sessions.size > MAX_SESSIONS) {
      const newest = [...this.sessions.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_SESSIONS);
      this.sessions = new Map(newest);
    }
    this.persist();
  }

  validate(sessionId: string, now = Date.now()): boolean {
    const hash = sessionHash(sessionId);
    const expiresAt = this.sessions.get(hash);
    if (expiresAt === undefined) return false;
    if (expiresAt <= now) {
      this.sessions.delete(hash);
      this.persist();
      return false;
    }
    return true;
  }

  clear(): number {
    const count = this.sessions.size;
    this.sessions.clear();
    this.persist();
    return count;
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      if (statSync(this.path).size > MAX_STORE_BYTES) return;
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as StoredAdminSessions;
      if (
        parsed?.version !== STORE_VERSION
        || parsed.binding !== this.binding
        || !Array.isArray(parsed.sessions)
      ) return;
      const now = Date.now();
      for (const session of parsed.sessions.slice(0, MAX_SESSIONS)) {
        if (
          typeof session?.hash === 'string'
          && /^[a-f0-9]{64}$/.test(session.hash)
          && Number.isSafeInteger(session.expires_at)
          && session.expires_at > now
        ) {
          this.sessions.set(session.hash, session.expires_at);
        }
      }
    } catch {
      // Corrupt or unreadable state fails closed; the next login replaces it.
      this.sessions.clear();
    }
  }

  private prune(now = Date.now()): void {
    for (const [hash, expiresAt] of this.sessions) {
      if (expiresAt <= now) this.sessions.delete(hash);
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const payload: StoredAdminSessions = {
      version: STORE_VERSION,
      binding: this.binding,
      sessions: [...this.sessions.entries()].map(([hash, expires_at]) => ({ hash, expires_at })),
    };
    const tmp = `${this.path}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    writeFileSync(tmp, `${JSON.stringify(payload)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
    chmodSync(this.path, 0o600);
  }
}
