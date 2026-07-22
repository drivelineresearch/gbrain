import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface PageRow {
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
}

interface PageList { rows: PageRow[]; total: number; pages: number; filters: { page: number; limit: number } }

export function ContentPage() {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PageList | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (query) params.set('query', query);
      if (source) params.set('source', source);
      if (type) params.set('type', type);
      api.brainPages(params).then(setData).finally(() => setLoading(false));
    }, 180);
    return () => clearTimeout(timer);
  }, [query, source, type, page]);

  const selectPage = async (id: number) => setDetail(await api.brainPage(id));

  return (
    <div>
      <div className="page-header">
        <div><div className="eyebrow">Knowledge inventory</div><h1>Content</h1></div>
        <div className="page-count">{data ? data.total.toLocaleString() : '—'} pages</div>
      </div>

      <div className="toolbar">
        <input aria-label="Search title or slug" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Search title or slug" />
        <input aria-label="Filter source" value={source} onChange={e => { setSource(e.target.value); setPage(1); }} placeholder="Source, e.g. programming-brain" />
        <input aria-label="Filter type" value={type} onChange={e => { setType(e.target.value); setPage(1); }} placeholder="Type, e.g. knowledge" />
      </div>

      <div className="data-panel">
        <table>
          <thead><tr><th>Page</th><th>Source</th><th>Type</th><th>Chunks</th><th>Links in / out</th><th>Updated</th></tr></thead>
          <tbody>
            {data?.rows.map(row => (
              <tr key={row.id} onClick={() => selectPage(row.id)} className="click-row">
                <td><strong>{row.title}</strong><div className="slug">{row.slug}</div></td>
                <td><span className="source-pill">{row.source_id}</span></td>
                <td>{row.type}</td>
                <td className="mono">{row.chunk_count}</td>
                <td className="mono">{row.inbound_links} / {row.outbound_links}</td>
                <td>{new Date(row.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="panel-state">Loading inventory…</div>}
        {!loading && data?.rows.length === 0 && <div className="panel-state">No pages match those filters.</div>}
      </div>

      <div className="pagination">
        <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
        <span>Page {page} of {data?.pages ?? 1}</span>
        <button className="btn btn-secondary" disabled={page >= (data?.pages ?? 1)} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>

      {detail && <>
        <div className="drawer-overlay" onClick={() => setDetail(null)} />
        <aside className="drawer content-drawer">
          <button className="drawer-close" onClick={() => setDetail(null)} aria-label="Close">×</button>
          <div className="eyebrow">{detail.page.source_id} / {detail.page.type}</div>
          <h2>{detail.page.title}</h2>
          <div className="slug">{detail.page.slug}</div>
          <dl className="detail-grid">
            <div><dt>Added</dt><dd>{new Date(detail.page.created_at).toLocaleString()}</dd></div>
            <div><dt>Updated</dt><dd>{new Date(detail.page.updated_at).toLocaleString()}</dd></div>
            <div><dt>Content</dt><dd>{Number(detail.page.content_length).toLocaleString()} characters</dd></div>
            <div><dt>Embedding</dt><dd>{detail.chunks.length} shown chunks</dd></div>
          </dl>
          <h3>Page content</h3>
          <pre className="page-content">{detail.page.compiled_truth || 'No compiled content.'}</pre>
          <h3>Linked pages <span className="subtle">({detail.links.length})</span></h3>
          <div className="link-list">
            {detail.links.map((link: any) => <button key={link.id} onClick={() => selectPage(link.page_id)}>
              <span className={`direction direction-${link.direction}`}>{link.direction === 'inbound' ? '←' : '→'}</span>
              <span><strong>{link.title}</strong><small>{link.source_id} · {link.link_type || link.link_source || 'link'}</small></span>
            </button>)}
          </div>
        </aside>
      </>}
    </div>
  );
}
