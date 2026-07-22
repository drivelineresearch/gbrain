import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

interface FeedEvent { agent: string; operation: string; scopes: string; latency_ms: number; status: string; timestamp: string }

function Score({ value, label }: { value: number; label: string }) {
  const tone = value >= 90 ? 'good' : value >= 75 ? 'warn' : 'bad';
  return <div className={`score score-${tone}`}><strong>{value}</strong><span>/100</span><small>{label}</small></div>;
}

export function DashboardPage() {
  const [access, setAccess] = useState<any>({ connected_agents: 0, requests_today: 0, active_tokens: 0 });
  const [health, setHealth] = useState<any>(null);
  const [ops, setOps] = useState<any>(null);
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [sseStatus, setSseStatus] = useState('connecting');
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const refresh = () => Promise.all([
      api.stats().then(setAccess), api.brainHealth().then(setHealth), api.operations().then(setOps),
    ]).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 30_000);
    const es = new EventSource('/admin/events');
    eventSourceRef.current = es;
    es.onopen = () => setSseStatus('connected');
    es.onmessage = event => { try { setEvents(prev => [JSON.parse(event.data), ...prev].slice(0, 30)); } catch {} };
    es.onerror = () => setSseStatus('disconnected');
    return () => { clearInterval(timer); es.close(); };
  }, []);

  const doctor = ops?.doctor?.health_score != null ? ops.doctor : health?.doctor;
  const brain = health?.brain;
  const stats = health?.stats;
  const warnings = doctor?.checks?.filter((c: any) => c.status !== 'ok') ?? [];
  const embedPct = brain ? (brain.embed_coverage * 100).toFixed(1) : '—';

  return <div>
    <div className="page-header overview-header">
      <div><div className="eyebrow">Driveline knowledge infrastructure</div><h1>Brain overview</h1><p>One view of retrieval quality, operational readiness, and active consumers.</p></div>
      <div className="live-state"><span className={`live-dot ${ops?.operational_status === 'healthy' ? 'good' : 'warn'}`} />{ops?.operational_status ?? 'checking'}</div>
    </div>

    <section className="scoreboard">
      <Score value={brain?.brain_score ?? 0} label="Data quality" />
      <Score value={doctor?.health_score ?? 0} label="Full doctor" />
      <Score value={doctor?.category_scores?.ops ?? 0} label="Operations" />
      <div className="headline-stat"><strong>{stats?.page_count?.toLocaleString() ?? '—'}</strong><span>pages</span></div>
      <div className="headline-stat"><strong>{stats?.chunk_count?.toLocaleString() ?? '—'}</strong><span>chunks</span></div>
      <div className="headline-stat"><strong>{stats?.link_count?.toLocaleString() ?? '—'}</strong><span>links</span></div>
    </section>

    <div className="overview-grid">
      <section className="data-panel quality-panel">
        <div className="panel-heading"><h2>Knowledge quality</h2><a href="#content">Inspect content →</a></div>
        <div className="quality-row"><span>Embedding coverage</span><div className="meter"><i style={{ width: `${embedPct}%` }} /></div><strong>{embedPct}%</strong></div>
        <div className="quality-row"><span>Link density</span><div className="meter"><i style={{ width: `${((brain?.link_density_score ?? 0) / 25) * 100}%` }} /></div><strong>{brain?.link_density_score ?? '—'}/25</strong></div>
        <div className="quality-row"><span>Timeline coverage</span><div className="meter"><i style={{ width: `${((brain?.timeline_coverage_score ?? 0) / 15) * 100}%` }} /></div><strong>{brain?.timeline_coverage_score ?? '—'}/15</strong></div>
        <div className="quality-facts">
          <div><strong>{brain?.orphan_pages ?? '—'}</strong><span>orphan pages</span></div>
          <div><strong>{brain?.dead_links ?? '—'}</strong><span>dead links</span></div>
          <div><strong>{brain?.missing_embeddings ?? '—'}</strong><span>missing embeddings</span></div>
          <div><strong>{brain?.stale_pages ?? '—'}</strong><span>stale pages</span></div>
        </div>
      </section>
      <section className="data-panel warning-panel">
        <div className="panel-heading"><h2>Doctor findings</h2><span>{warnings.length} open</span></div>
        <div className="finding-list">{warnings.slice(0, 8).map((finding: any) => <div key={finding.name}>
          <span className={`finding-severity ${finding.status}`}>{finding.status}</span><div><strong>{finding.name.replaceAll('_', ' ')}</strong><p>{finding.message}</p></div>
        </div>)}{warnings.length === 0 && <div className="panel-state">All checks are clear.</div>}</div>
      </section>
    </div>

    <section className="data-panel source-panel">
      <div className="panel-heading"><h2>Content composition</h2><span>page types</span></div>
      <div className="type-bars">{Object.entries(stats?.pages_by_type ?? {}).slice(0, 10).map(([name, count]: any) => <div key={name}><span>{name}</span><div className="meter"><i style={{ width: `${Math.max(1, count / Math.max(stats.page_count, 1) * 100)}%` }} /></div><strong>{Number(count).toLocaleString()}</strong></div>)}</div>
    </section>

    <div className="overview-grid lower-grid">
      <section className="data-panel"><div className="panel-heading"><h2>Agent activity</h2><span className={`connection ${sseStatus}`}>{sseStatus}</span></div>
        <div className="access-strip"><div><strong>{access.connected_agents}</strong><span>registered agents</span></div><div><strong>{access.requests_today}</strong><span>requests / 24h</span></div><div><strong>{access.active_tokens}</strong><span>active tokens</span></div></div>
        <table><thead><tr><th>Agent</th><th>Operation</th><th>Latency</th><th>Status</th><th>Time</th></tr></thead><tbody>{events.slice(0, 8).map((e, i) => <tr key={i}><td className="mono">{e.agent}</td><td>{e.operation}</td><td className="mono">{e.latency_ms} ms</td><td><span className={`status-label ${e.status === 'success' ? 'good' : 'bad'}`}><i />{e.status}</span></td><td>{new Date(e.timestamp).toLocaleTimeString()}</td></tr>)}</tbody></table>
        {events.length === 0 && <div className="panel-state">Waiting for the next MCP request.</div>}
      </section>
      <section className="data-panel"><div className="panel-heading"><h2>Most connected</h2><a href="#graph">Open graph →</a></div>
        <ol className="connected-list">{brain?.most_connected?.map((node: any) => <li key={node.slug}><span>{node.slug}</span><strong>{node.link_count} links</strong></li>)}</ol>
      </section>
    </div>
  </div>;
}
