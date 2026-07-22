import React, { useState, useEffect } from 'react';
import { api } from '../api';

interface UnifiedClient {
  name: string;
  caesar: 'active' | 'revoked' | 'missing';
  dbrain: 'active' | 'revoked' | 'missing';
  created_at: string | null;
  last_used_at: string | null;
}

interface EnrollmentEntry {
  clientName: string;
  createdAt: number;
  claimedAt: number | null;
  expiresAt: number;
  status: 'pending' | 'claimed' | 'expired';
}

interface CallEntry {
  ts?: string;
  client?: string;
  tool?: string;
  success?: boolean;
  elapsed_ms?: number;
  response_bytes?: number;
}

interface IssueResult {
  name: string;
  claim_code?: string;
  expires_at?: string;
  token?: string;
}

const sideBadge = (side: string) => (
  <span className={`badge ${side === 'active' ? 'badge-success' : side === 'revoked' ? 'badge-error' : ''}`}
        style={side === 'missing' ? { color: 'var(--text-muted)' } : undefined}>
    {side}
  </span>
);

export function CaesarPage() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [clients, setClients] = useState<UnifiedClient[]>([]);
  const [enrollment, setEnrollment] = useState<EnrollmentEntry[]>([]);
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [newName, setNewName] = useState('');
  const [issued, setIssued] = useState<IssueResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    api.caesarHealth().then(setHealth).catch(() => setHealth(null));
    api.caesarClients()
      .then((data) => { setClients(data.clients || []); setEnrollment(data.enrollment || []); })
      .catch(() => {});
    api.caesarCalls().then((data) => setCalls(data.calls || [])).catch(() => {});
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, []);

  const issue = async (delivery: 'claim' | 'token') => {
    if (!newName.trim()) return;
    setBusy(true);
    setError('');
    try {
      setIssued(await api.caesarIssue(newName.trim(), delivery));
      setNewName('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'issue failed');
    } finally {
      setBusy(false);
    }
  };

  const rotate = async (name: string) => {
    if (!confirm(`Rotate ${name}? Its current token stops working in both systems immediately.`)) return;
    setBusy(true);
    setError('');
    try {
      setIssued(await api.caesarIssue(name, 'claim'));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'rotate failed');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (name: string) => {
    if (!confirm(`Revoke ${name} in BOTH DBrain and Caesar? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await api.caesarRevoke(name);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'revoke failed');
    } finally {
      setBusy(false);
    }
  };

  const timeAgo = (ts?: string | number | null) => {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString();
  };

  const healthy = health?.reachable === true && health?.status === 'ok';
  const installOneLiner = issued?.claim_code
    ? `uvx --from git+https://github.com/drivelineresearch/caesar-mcp caesar-mcp-install --claim ${issued.claim_code}`
    : '';

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Caesar MCP</h1>
        <span className={`badge ${healthy ? 'badge-success' : 'badge-error'}`}>
          {healthy
            ? `ok · v${String(health?.version ?? '?')} · ${String(health?.contract_version ?? '')}`
            : String(health?.status ?? 'unreachable')}
        </span>
      </div>

      {error && (
        <div style={{ color: 'var(--error, #ff6b6b)', marginBottom: 16, fontSize: 13 }}>{error}</div>
      )}

      <div className="section-title">Unified clients — one token across DBrain + Caesar</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="client name (e.g. coach-le)"
          style={{
            background: 'var(--bg-input, #0f0f1a)', color: 'var(--text-primary)',
            border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 260,
          }}
        />
        <button className="btn btn-primary" disabled={busy || !newName.trim()} onClick={() => issue('claim')}>
          Issue claim code
        </button>
        <button className="btn btn-secondary" disabled={busy || !newName.trim()} onClick={() => issue('token')}
                title="Returns the plaintext token once — for service secret stores, not humans">
          Issue service token
        </button>
      </div>

      {issued && (
        <div style={{
          border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16,
          background: 'var(--bg-secondary, #12121a)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <strong>{issued.name}</strong>
            <button className="btn btn-secondary" onClick={() => setIssued(null)}>Dismiss</button>
          </div>
          {issued.claim_code ? (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                One-time claim code (single use, expires {issued.expires_at ? new Date(issued.expires_at).toLocaleTimeString() : 'in 15 min'}).
                Send the code or the full command — both are worthless after redemption.
              </div>
              <div className="mono" style={{ fontSize: 18, marginBottom: 8 }}>{issued.claim_code}</div>
              <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, userSelect: 'all' }}>
                {installOneLiner}
              </pre>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
                Service token — shown exactly once. Store it in the consuming system's secret store now.
              </div>
              <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, userSelect: 'all' }}>
                {issued.token}
              </pre>
            </>
          )}
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>DBrain</th>
            <th>Caesar</th>
            <th>Created</th>
            <th>Last used</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {clients.length === 0 && (
            <tr><td colSpan={6} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>No clients yet.</td></tr>
          )}
          {clients.map((client) => (
            <tr key={client.name}>
              <td className="mono">{client.name}</td>
              <td>{sideBadge(client.dbrain)}</td>
              <td>{sideBadge(client.caesar)}</td>
              <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{timeAgo(client.created_at)}</td>
              <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{timeAgo(client.last_used_at)}</td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                <button className="btn btn-secondary" disabled={busy} onClick={() => rotate(client.name)}>Rotate</button>{' '}
                <button className="btn btn-secondary" disabled={busy} onClick={() => revoke(client.name)}
                        style={{ color: 'var(--error, #ff6b6b)' }}>Revoke</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {enrollment.length > 0 && (
        <>
          <div className="section-title">Enrollment codes</div>
          <table>
            <thead>
              <tr><th>Client</th><th>Issued</th><th>Status</th><th>Claimed</th></tr>
            </thead>
            <tbody>
              {enrollment.map((entry, index) => (
                <tr key={`${entry.clientName}-${index}`}>
                  <td className="mono">{entry.clientName}</td>
                  <td style={{ color: 'var(--text-secondary)' }}>{timeAgo(entry.createdAt)}</td>
                  <td>
                    <span className={`badge ${entry.status === 'claimed' ? 'badge-success' : entry.status === 'expired' ? 'badge-error' : ''}`}>
                      {entry.status}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{entry.claimedAt ? timeAgo(entry.claimedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <div className="section-title">Recent Caesar calls</div>
      {calls.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', padding: 24, textAlign: 'center' }}>
          No calls recorded yet. The call log starts once the 0.3.0 container is deployed.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Client</th>
              <th>Tool</th>
              <th>Latency</th>
              <th>Size</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((call, index) => (
              <tr key={index}>
                <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{timeAgo(call.ts)}</td>
                <td className="mono">{call.client ?? 'unknown'}</td>
                <td className="mono">{call.tool}</td>
                <td className="mono">{call.elapsed_ms}ms</td>
                <td className="mono">{((call.response_bytes ?? 0) / 1024).toFixed(1)}kb</td>
                <td>
                  <span className={`badge ${call.success ? 'badge-success' : 'badge-error'}`}>
                    {call.success ? 'success' : 'error'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
