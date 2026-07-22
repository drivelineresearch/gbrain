import React, { useEffect, useState } from 'react';
import { api } from '../api';

function Status({ value }: { value: string }) {
  const good = ['healthy', 'active', 'enabled', 'completed', 'success'].includes(value);
  const bad = ['unhealthy', 'failed', 'dead', 'inactive'].includes(value);
  return <span className={`status-label ${good ? 'good' : bad ? 'bad' : 'warn'}`}><i />{value}</span>;
}

export function OperationsPage() {
  const [ops, setOps] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [watch, setWatch] = useState<any>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [nextOps, nextJobs, nextWatch] = await Promise.all([api.operations(), api.jobHistory(status), api.jobsWatch()]);
      if (alive) { setOps(nextOps); setJobs(nextJobs); setWatch(nextWatch); }
    };
    tick();
    const timer = setInterval(tick, 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [status]);

  return <div>
    <div className="page-header">
      <div><div className="eyebrow">Runtime control plane</div><h1>Operations</h1></div>
      {ops && <Status value={ops.operational_status} />}
    </div>
    <div className="ops-grid">
      <section className="data-panel"><div className="panel-heading"><h2>Services</h2><span>systemd truth</span></div>
        <table><thead><tr><th>Service</th><th>State</th><th>Boot</th></tr></thead><tbody>
          {ops?.services.map((s: any) => <tr key={s.unit}><td><strong>{s.label}</strong><div className="slug">{s.unit}</div></td><td><Status value={s.active} /></td><td>{s.enabled}</td></tr>)}
        </tbody></table>{ops?.services.length === 0 && <div className="panel-state">Host snapshot is not connected.</div>}
      </section>
      <section className="data-panel"><div className="panel-heading"><h2>Providers</h2><span>live probes</span></div>
        <table><thead><tr><th>Provider</th><th>Status</th><th>Latency</th></tr></thead><tbody>
          {ops?.providers.map((p: any) => <tr key={p.name}><td><strong>{p.name}</strong><div className="slug">{p.detail}</div></td><td><Status value={p.status} /></td><td className="mono">{p.latency_ms != null ? `${p.latency_ms} ms` : '—'}</td></tr>)}
        </tbody></table>
      </section>
    </div>
    <section className="data-panel schedule-panel"><div className="panel-heading"><h2>Schedules</h2><span>last and next execution</span></div>
      <table><thead><tr><th>Schedule</th><th>State</th><th>Last result</th><th>Last run</th><th>Next run</th></tr></thead><tbody>
        {ops?.schedules.map((s: any) => <tr key={s.unit}><td><strong>{s.label}</strong><div className="slug">{s.unit}</div></td><td><Status value={s.active} /></td><td><Status value={s.last_result || 'unknown'} /></td><td>{s.last_run ? new Date(s.last_run).toLocaleString() : '—'}</td><td>{s.next_run ? new Date(s.next_run).toLocaleString() : '—'}</td></tr>)}
      </tbody></table>
    </section>
    <div className="ops-grid">
      <section className="data-panel"><div className="panel-heading"><h2>Queue</h2><span>current state</span></div>
        <div className="queue-strip"><div><strong>{watch?.queue_health.waiting ?? '—'}</strong><span>waiting</span></div><div><strong>{watch?.queue_health.active ?? '—'}</strong><span>active</span></div><div><strong>{watch?.queue_health.stalled ?? '—'}</strong><span>stalled</span></div><div><strong>{watch?.lease_pressure_1h ?? '—'}</strong><span>lease bounces</span></div></div>
      </section>
      <section className="data-panel"><div className="panel-heading"><h2>Host run log</h2><span>recent warnings and completions</span></div>
        <div className="run-log">{ops?.recent_runs.slice(0, 12).map((r: any, i: number) => <div key={`${r.unit}-${r.at}-${i}`}><time>{new Date(r.at).toLocaleString()}</time><strong>{r.unit}</strong><span>{r.message}</span></div>)}{ops?.recent_runs.length === 0 && <div className="panel-state">No host events in the snapshot window.</div>}</div>
      </section>
    </div>
    <section className="data-panel job-history-panel"><div className="panel-heading"><h2>Job history</h2><select aria-label="Filter job status" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option><option>completed</option><option>failed</option><option>dead</option><option>active</option><option>waiting</option></select></div>
      <table><thead><tr><th>ID</th><th>Job</th><th>Status</th><th>Attempts</th><th>Duration</th><th>Started</th><th>Error</th></tr></thead><tbody>
        {jobs.map((j: any) => <tr key={j.id}><td className="mono">{j.id}</td><td><strong>{j.name}</strong><div className="slug">{j.queue}</div></td><td><Status value={j.status} /></td><td className="mono">{j.attempts_made}/{j.max_attempts}</td><td className="mono">{j.duration_ms == null ? '—' : `${j.duration_ms} ms`}</td><td>{j.started_at ? new Date(j.started_at).toLocaleString() : '—'}</td><td className="error-cell">{j.error_text || '—'}</td></tr>)}
      </tbody></table>
    </section>
  </div>;
}
