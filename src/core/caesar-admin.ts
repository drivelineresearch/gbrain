/**
 * Unified Driveline MCP client administration — one token across DBrain + Caesar.
 *
 * DBrain validates bearers against `access_tokens` (SHA-256 hash rows). Caesar MCP
 * validates the same way against its file registry (`runtime/client_tokens.json`),
 * owned by the audited `caesar-mcp-admin` CLI. This module issues ONE secret and
 * registers its hash in both stores under the same client name; revoke flips both.
 *
 * Plaintext handling: a freshly issued token lives only (a) in the HTTP response
 * when delivery='token' (service accounts), or (b) inside the in-memory ClaimStore
 * until a single-use enrollment code redeems it or the TTL sweeps it. Nothing
 * plaintext is written to disk or the database, and a server restart voids all
 * pending claims by construction.
 */

import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { SqlQuery } from './sql-query.ts';
import { generateToken, hashToken } from './utils.ts';

export const CLAIM_TTL_MS = 15 * 60 * 1000;
export const CLAIM_MAX_PENDING = 200;
/** Mirrors caesar-mcp-admin's CLIENT_ID rule so one name is valid in both stores. */
export const CLIENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const CAESAR_HOME = process.env.CAESAR_MCP_HOME ?? '/home/andrew/kitchen/caesar-mcp';
const CAESAR_REGISTRY =
  process.env.CAESAR_MCP_REGISTRY ?? `${CAESAR_HOME}/runtime/client_tokens.json`;
const CAESAR_CALL_LOG =
  process.env.CAESAR_MCP_CALL_LOG_PATH ?? `${CAESAR_HOME}/runtime/world-model/calls.jsonl`;
const CAESAR_HEALTH_URL = process.env.CAESAR_MCP_HEALTH_URL ?? 'http://127.0.0.1:8802/health';
// The venv console script directly — NOT `uv run`, which wants to write
// ~/.cache/uv and fails under the service's ProtectHome=read-only sandbox.
const CAESAR_ADMIN_BIN =
  process.env.CAESAR_MCP_ADMIN_BIN ?? `${CAESAR_HOME}/.venv/bin/caesar-mcp-admin`;

// Claim codes avoid 0/O/1/I so they survive being read aloud or handwritten.
const CLAIM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function claimCode(): string {
  const bytes = randomBytes(8);
  let raw = '';
  for (const byte of bytes) raw += CLAIM_ALPHABET[byte % CLAIM_ALPHABET.length];
  return `DL-${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export interface PendingClaim {
  clientName: string;
  token: string;
  createdAt: number;
  expiresAt: number;
}

export interface ClaimAuditEntry {
  clientName: string;
  createdAt: number;
  claimedAt: number | null;
  expiresAt: number;
  status: 'pending' | 'claimed' | 'expired';
}

/** In-memory single-use enrollment codes. Deliberately not persisted. */
export class ClaimStore {
  private pending = new Map<string, PendingClaim>();
  private audit: ClaimAuditEntry[] = [];

  create(clientName: string, token: string, now = Date.now()): { code: string; expiresAt: number } {
    this.sweep(now);
    if (this.pending.size >= CLAIM_MAX_PENDING) {
      throw new Error('too many pending enrollment codes; revoke or wait for expiry');
    }
    // Re-issuing for the same client invalidates its previous unclaimed code.
    this.invalidateClient(clientName);
    const code = claimCode();
    const expiresAt = now + CLAIM_TTL_MS;
    this.pending.set(code, { clientName, token, createdAt: now, expiresAt });
    this.audit.unshift({ clientName, createdAt: now, claimedAt: null, expiresAt, status: 'pending' });
    this.audit = this.audit.slice(0, 100);
    return { code, expiresAt };
  }

  /** Single use: a successful claim deletes the code and returns the token exactly once. */
  claim(code: string, now = Date.now()): { clientName: string; token: string } | null {
    this.sweep(now);
    const entry = this.pending.get(code.trim().toUpperCase());
    if (!entry) return null;
    this.pending.delete(code.trim().toUpperCase());
    const record = this.audit.find(
      (item) => item.clientName === entry.clientName && item.status === 'pending',
    );
    if (record) {
      record.claimedAt = now;
      record.status = 'claimed';
    }
    return { clientName: entry.clientName, token: entry.token };
  }

  sweep(now = Date.now()): void {
    for (const [code, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(code);
    }
    for (const record of this.audit) {
      if (record.status === 'pending' && record.expiresAt <= now) record.status = 'expired';
    }
  }

  /** Kill any outstanding code for a client (revocation, or re-issue superseding it). */
  invalidateClient(clientName: string): void {
    for (const [code, entry] of this.pending) {
      if (entry.clientName === clientName) this.pending.delete(code);
    }
    for (const record of this.audit) {
      if (record.clientName === clientName && record.status === 'pending') {
        record.status = 'expired';
      }
    }
  }

  recent(now = Date.now()): ClaimAuditEntry[] {
    this.sweep(now);
    return this.audit;
  }
}

/**
 * Run the audited caesar-mcp-admin CLI against the production registry.
 * The optional stdin line carries the plaintext token so it never appears in argv.
 */
export function caesarAdminCli(args: string[], stdinLine?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CAESAR_ADMIN_BIN,
      ['--registry', CAESAR_REGISTRY, ...args],
      { cwd: CAESAR_HOME, stdio: ['pipe', 'ignore', 'pipe'], timeout: 30_000 },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    // Without this, an EPIPE from a process that dies before reading stdin
    // (e.g. wrong UV_BIN path) becomes an uncaught stream error that would
    // take down the whole server instead of failing this one request.
    child.stdin.on('error', reject);
    child.on('close', (exitCode) => {
      if (exitCode === 0) resolve();
      else reject(new Error(`caesar-mcp-admin ${args[0]} failed (${exitCode}): ${stderr.slice(0, 300)}`));
    });
    if (stdinLine !== undefined && child.stdin.writable) child.stdin.write(`${stdinLine}\n`);
    child.stdin.end();
  });
}

export interface UnifiedClientRow {
  name: string;
  caesar: 'active' | 'revoked' | 'missing';
  dbrain: 'active' | 'revoked' | 'missing';
  created_at: string | null;
  last_used_at: string | null;
}

/**
 * Pure merge of the Caesar file registry and DBrain access_tokens rows, by client name.
 *
 * The Caesar registry is the authoritative roster of UNIFIED clients. DBrain rows whose
 * name is not in the registry are legacy `gbrain_` API keys owned by the Agents page —
 * they are deliberately excluded so this surface can never revoke one by mistake.
 */
export function mergeUnifiedClients(
  caesarRegistry: { clients?: Record<string, { enabled?: boolean }> },
  rawDbrainRows: Array<Record<string, unknown>>,
): UnifiedClientRow[] {
  const rows = new Map<string, UnifiedClientRow>();
  for (const [name, record] of Object.entries(caesarRegistry.clients ?? {})) {
    rows.set(name, {
      name,
      caesar: record.enabled === false ? 'revoked' : 'active',
      dbrain: 'missing',
      created_at: null,
      last_used_at: null,
    });
  }
  for (const raw of rawDbrainRows) {
    if (typeof raw.name !== 'string' || !raw.name) continue;
    const existing = rows.get(raw.name);
    if (!existing) continue; // legacy DBrain-only API key — not a unified client
    // Duplicate rows per name can exist (rotation history); one active row wins.
    if (existing.dbrain !== 'active') {
      existing.dbrain = String(raw.status ?? 'active') === 'revoked' ? 'revoked' : 'active';
    }
    existing.created_at = raw.created_at ? String(raw.created_at) : existing.created_at;
    if (raw.last_used_at) {
      const candidate = String(raw.last_used_at);
      if (!existing.last_used_at || candidate > existing.last_used_at) {
        existing.last_used_at = candidate;
      }
    }
  }
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function readCaesarRegistry(): Promise<{ clients?: Record<string, { enabled?: boolean }> }> {
  try {
    return JSON.parse(await readFile(CAESAR_REGISTRY, 'utf8'));
  } catch {
    return { clients: {} };
  }
}

/** Parse the newest `limit` JSONL call records; malformed lines are skipped, newest first. */
export function parseCallLogTail(text: string, limit: number): Array<Record<string, unknown>> {
  const entries: Array<Record<string, unknown>> = [];
  const lines = text.split('\n');
  for (let index = lines.length - 1; index >= 0 && entries.length < limit; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') entries.push(parsed);
    } catch {
      // Skip a torn or malformed line rather than failing the whole read.
    }
  }
  return entries;
}

export async function readCaesarCallLog(limit: number): Promise<Array<Record<string, unknown>>> {
  let text = '';
  try {
    text = await readFile(CAESAR_CALL_LOG, 'utf8');
  } catch {
    return [];
  }
  const entries = parseCallLogTail(text, limit);
  if (entries.length < limit) {
    try {
      const rotated = await readFile(`${CAESAR_CALL_LOG}.1`, 'utf8');
      entries.push(...parseCallLogTail(rotated, limit - entries.length));
    } catch {
      // No rotated file yet.
    }
  }
  return entries;
}

export async function fetchCaesarHealth(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(CAESAR_HEALTH_URL, { signal: AbortSignal.timeout(3000) });
    const body = (await response.json()) as Record<string, unknown>;
    return { reachable: true, http_status: response.status, ...body };
  } catch (error) {
    return {
      reachable: false,
      status: 'unreachable',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface IssueDeps {
  cli?: typeof caesarAdminCli;
  loadRegistry?: typeof readCaesarRegistry;
}

/**
 * Issue one Driveline token registered in both stores.
 *
 * Ordering is the safety property: the new DBrain row is inserted FIRST, then Caesar's
 * registry entry is atomically replaced, and only after Caesar succeeds are the prior
 * DBrain rows revoked. A Caesar-side failure therefore rolls back the fresh row and
 * leaves the previous token fully valid in BOTH stores — a failed rotation changes
 * nothing, and can never strand a leaked token half-revoked.
 */
export async function issueUnifiedClient(
  sql: SqlQuery,
  name: string,
  deps: IssueDeps = {},
): Promise<string> {
  const cli = deps.cli ?? caesarAdminCli;
  const loadRegistry = deps.loadRegistry ?? readCaesarRegistry;
  if (!CLIENT_NAME.test(name)) {
    throw new Error('client name must use 1-64 letters, numbers, dot, underscore, or dash');
  }
  // Legacy `gbrain_` API keys share the access_tokens namespace. Refuse to adopt a name
  // that already has an active DBrain row but no Caesar registry entry — issuing would
  // silently revoke someone's unrelated key on rotation.
  const registry = await loadRegistry();
  if (!registry.clients?.[name]) {
    const existing = await sql`
      SELECT id FROM access_tokens WHERE name = ${name} AND revoked_at IS NULL LIMIT 1
    `;
    if (existing.length > 0) {
      throw new Error(
        `'${name}' already names an active DBrain API key; pick a different client name ` +
        'or revoke the legacy key on the Agents page first',
      );
    }
  }
  const token = generateToken('dl_');
  const hash = hashToken(token);
  const id = randomUUID();
  await sql`INSERT INTO access_tokens (id, name, token_hash) VALUES (${id}, ${name}, ${hash})`;
  try {
    await cli(['register', name], token);
  } catch (error) {
    await sql`UPDATE access_tokens SET revoked_at = now() WHERE id = ${id}`;
    throw error;
  }
  await sql`
    UPDATE access_tokens SET revoked_at = now()
    WHERE name = ${name} AND id <> ${id} AND revoked_at IS NULL
  `;
  return token;
}

export async function revokeUnifiedClient(
  sql: SqlQuery,
  name: string,
  deps: IssueDeps = {},
): Promise<{ dbrain: boolean; caesar: boolean; errors: string[] }> {
  const cli = deps.cli ?? caesarAdminCli;
  const loadRegistry = deps.loadRegistry ?? readCaesarRegistry;
  // Same namespace guard as issue: only clients in the Caesar registry are unified
  // clients; legacy DBrain-only API keys are managed on the Agents page.
  const registry = await loadRegistry();
  if (!registry.clients?.[name]) {
    return {
      dbrain: false,
      caesar: false,
      errors: [`'${name}' is not a unified Caesar client; legacy API keys live on the Agents page`],
    };
  }
  const errors: string[] = [];
  let dbrain = false;
  let caesar = false;
  try {
    await sql`UPDATE access_tokens SET revoked_at = now() WHERE name = ${name} AND revoked_at IS NULL`;
    dbrain = true;
  } catch (error) {
    errors.push(`dbrain: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    await cli(['revoke', name]);
    caesar = true;
  } catch (error) {
    errors.push(`caesar: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { dbrain, caesar, errors };
}
