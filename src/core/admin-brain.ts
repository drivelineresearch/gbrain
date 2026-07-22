import { readFile, stat } from 'node:fs/promises';
import type { BrainEngine } from './engine.ts';

const MAX_QUERY_LENGTH = 160;
const MAX_PAGE_SIZE = 100;
const MAX_GRAPH_NODES = 600;
const MAX_SNAPSHOT_BYTES = 256 * 1024;

export interface AdminPageFilters {
  query?: unknown;
  source?: unknown;
  type?: unknown;
  page?: unknown;
  limit?: unknown;
}

export interface NormalizedAdminPageFilters {
  query: string;
  source: string | null;
  type: string | null;
  page: number;
  limit: number;
}

export interface OperationsSnapshot {
  schema_version: 1;
  generated_at: string;
  operational_status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  services: Array<{
    unit: string;
    label: string;
    active: string;
    sub: string;
    enabled: string;
    since?: string | null;
  }>;
  schedules: Array<{
    unit: string;
    label: string;
    active: string;
    enabled: string;
    last_run?: string | null;
    next_run?: string | null;
    last_result?: string | null;
  }>;
  recent_runs: Array<{
    unit: string;
    at: string;
    priority: string;
    message: string;
  }>;
  providers: Array<{
    name: string;
    status: 'healthy' | 'unhealthy' | 'unknown';
    latency_ms?: number | null;
    detail?: string;
  }>;
  doctor?: Record<string, unknown>;
}

function boundedText(value: unknown, max = MAX_QUERY_LENGTH): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export function normalizeAdminPageFilters(input: AdminPageFilters): NormalizedAdminPageFilters {
  return {
    query: boundedText(input.query),
    source: boundedText(input.source, 80) || null,
    type: boundedText(input.type, 80) || null,
    page: boundedInteger(input.page, 1, 1, 100_000),
    limit: boundedInteger(input.limit, 40, 1, MAX_PAGE_SIZE),
  };
}

export async function listAdminPages(engine: BrainEngine, input: AdminPageFilters) {
  const filters = normalizeAdminPageFilters(input);
  const offset = (filters.page - 1) * filters.limit;
  const search = filters.query ? `%${filters.query}%` : null;

  const rows = await engine.executeRaw<{
    id: number;
    slug: string;
    title: string;
    type: string;
    page_kind: string;
    source_id: string;
    updated_at: string;
    chunk_count: number;
    inbound_links: number;
    outbound_links: number;
  }>(
    `SELECT p.id, p.slug, p.title, p.type, p.page_kind, p.source_id, p.updated_at,
            COALESCE(cc.chunk_count, 0)::int AS chunk_count,
            COALESCE(li.inbound_links, 0)::int AS inbound_links,
            COALESCE(lo.outbound_links, 0)::int AS outbound_links
       FROM pages p
       LEFT JOIN (
         SELECT page_id, count(*)::int AS chunk_count FROM content_chunks GROUP BY page_id
       ) cc ON cc.page_id = p.id
       LEFT JOIN (
         SELECT to_page_id, count(*)::int AS inbound_links FROM links GROUP BY to_page_id
       ) li ON li.to_page_id = p.id
       LEFT JOIN (
         SELECT from_page_id, count(*)::int AS outbound_links FROM links GROUP BY from_page_id
       ) lo ON lo.from_page_id = p.id
      WHERE p.deleted_at IS NULL
        AND ($1::text IS NULL OR p.source_id = $1)
        AND ($2::text IS NULL OR p.type = $2)
        AND ($3::text IS NULL OR p.title ILIKE $3 OR p.slug ILIKE $3)
      ORDER BY p.updated_at DESC, p.id DESC
      LIMIT $4 OFFSET $5`,
    [filters.source, filters.type, search, filters.limit, offset],
  );

  const [count] = await engine.executeRaw<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM pages p
      WHERE p.deleted_at IS NULL
        AND ($1::text IS NULL OR p.source_id = $1)
        AND ($2::text IS NULL OR p.type = $2)
        AND ($3::text IS NULL OR p.title ILIKE $3 OR p.slug ILIKE $3)`,
    [filters.source, filters.type, search],
  );

  return {
    filters,
    rows,
    total: Number(count?.total ?? 0),
    pages: Math.max(1, Math.ceil(Number(count?.total ?? 0) / filters.limit)),
  };
}

export async function getAdminPage(engine: BrainEngine, pageId: number) {
  if (!Number.isSafeInteger(pageId) || pageId < 1) return null;
  const [page] = await engine.executeRaw<Record<string, unknown>>(
    `SELECT id, slug, title, type, page_kind, source_id, frontmatter,
            left(compiled_truth, 30000) AS compiled_truth,
            char_length(compiled_truth)::int AS content_length,
            created_at, updated_at, effective_date, last_retrieved_at,
            links_extracted_at, contextual_retrieval_mode
       FROM pages
      WHERE id = $1 AND deleted_at IS NULL`,
    [pageId],
  );
  if (!page) return null;

  const [chunks, links] = await Promise.all([
    engine.executeRaw<Record<string, unknown>>(
      `SELECT id, chunk_index, chunk_source, token_count, modality,
              left(chunk_text, 700) AS excerpt, embedded_at
         FROM content_chunks
        WHERE page_id = $1
        ORDER BY chunk_index ASC
        LIMIT 40`,
      [pageId],
    ),
    engine.executeRaw<Record<string, unknown>>(
      `SELECT l.id, l.link_type, l.link_source, l.context,
              CASE WHEN l.from_page_id = $1 THEN 'outbound' ELSE 'inbound' END AS direction,
              other.id AS page_id, other.slug, other.title, other.type, other.source_id
         FROM links l
         JOIN pages other ON other.id = CASE WHEN l.from_page_id = $1 THEN l.to_page_id ELSE l.from_page_id END
        WHERE (l.from_page_id = $1 OR l.to_page_id = $1)
          AND other.deleted_at IS NULL
        ORDER BY l.created_at DESC, l.id DESC
        LIMIT 200`,
      [pageId],
    ),
  ]);

  return { page, chunks, links };
}

export async function getAdminGraph(
  engine: BrainEngine,
  input: { source?: unknown; type?: unknown; query?: unknown; limit?: unknown },
) {
  const source = boundedText(input.source, 80) || null;
  const type = boundedText(input.type, 80) || null;
  const query = boundedText(input.query);
  const search = query ? `%${query}%` : null;
  const limit = boundedInteger(input.limit, 350, 25, MAX_GRAPH_NODES);

  const nodes = await engine.executeRaw<{
    id: number;
    slug: string;
    title: string;
    type: string;
    source_id: string;
    degree: number;
  }>(
    `WITH degrees AS (
       SELECT page_id, sum(n)::int AS degree
         FROM (
           SELECT from_page_id AS page_id, count(*)::int AS n FROM links GROUP BY from_page_id
           UNION ALL
           SELECT to_page_id AS page_id, count(*)::int AS n FROM links GROUP BY to_page_id
         ) d
        GROUP BY page_id
     )
     SELECT p.id, p.slug, p.title, p.type, p.source_id,
            COALESCE(d.degree, 0)::int AS degree
       FROM pages p
       LEFT JOIN degrees d ON d.page_id = p.id
      WHERE p.deleted_at IS NULL
        AND ($1::text IS NULL OR p.source_id = $1)
        AND ($2::text IS NULL OR p.type = $2)
        AND ($3::text IS NULL OR p.title ILIKE $3 OR p.slug ILIKE $3)
      ORDER BY COALESCE(d.degree, 0) DESC, p.updated_at DESC, p.id DESC
      LIMIT $4`,
    [source, type, search, limit],
  );

  if (nodes.length === 0) return { nodes: [], edges: [], truncated: false, limit };
  const ids = nodes.map((node) => Number(node.id));
  const placeholders = ids.map((_, index) => `$${index + 1}`).join(', ');
  const edges = await engine.executeRaw<{
    id: number;
    source: number;
    target: number;
    type: string;
    link_source: string | null;
  }>(
    `SELECT id, from_page_id AS source, to_page_id AS target,
            link_type AS type, link_source
       FROM links
      WHERE from_page_id IN (${placeholders})
        AND to_page_id IN (${placeholders})
      ORDER BY id DESC
      LIMIT 4000`,
    ids,
  );

  return { nodes, edges, truncated: nodes.length === limit, limit };
}

export async function listAdminJobHistory(engine: BrainEngine, input: { status?: unknown; limit?: unknown }) {
  const rawStatus = boundedText(input.status, 24);
  const allowed = new Set(['waiting', 'active', 'completed', 'failed', 'delayed', 'dead', 'cancelled', 'waiting-children', 'paused']);
  const status = allowed.has(rawStatus) ? rawStatus : null;
  const limit = boundedInteger(input.limit, 100, 1, 250);
  return engine.executeRaw<Record<string, unknown>>(
    `SELECT id, name, queue, status, attempts_made, max_attempts,
            created_at, started_at, finished_at, updated_at,
            CASE WHEN started_at IS NULL THEN NULL
                 ELSE round(extract(epoch FROM (COALESCE(finished_at, now()) - started_at)) * 1000)::int
            END AS duration_ms,
            left(COALESCE(error_text, ''), 1000) AS error_text
       FROM minion_jobs
      WHERE ($1::text IS NULL OR status = $1)
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [status, limit],
  );
}

export function unknownOperationsSnapshot(detail = 'Host operations snapshot is not configured'): OperationsSnapshot {
  return {
    schema_version: 1,
    generated_at: new Date(0).toISOString(),
    operational_status: 'unknown',
    services: [],
    schedules: [],
    recent_runs: [],
    providers: [{ name: 'host snapshot', status: 'unknown', detail }],
  };
}

export async function readOperationsSnapshot(path: string | undefined): Promise<OperationsSnapshot> {
  if (!path) return unknownOperationsSnapshot();
  try {
    const file = await stat(path);
    if (file.size > MAX_SNAPSHOT_BYTES) return unknownOperationsSnapshot('Host operations snapshot exceeded 256 KiB');
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as OperationsSnapshot;
    if (parsed?.schema_version !== 1 || !Array.isArray(parsed.services) || !Array.isArray(parsed.schedules)) {
      return unknownOperationsSnapshot('Host operations snapshot has an unsupported shape');
    }
    return parsed;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return unknownOperationsSnapshot(`Host operations snapshot unavailable: ${detail.slice(0, 180)}`);
  }
}
