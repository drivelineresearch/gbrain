import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';

interface Node { id: number; title: string; slug: string; type: string; source_id: string; degree: number }
interface Edge { id: number; source: number; target: number; type: string }
interface GraphData { nodes: Node[]; edges: Edge[]; truncated: boolean; limit: number }
interface PositionedNode extends Node { x: number; y: number }

const sourceColors = ['#FFA300', '#4E79A7', '#59A14F', '#E15759', '#B07AA1', '#76B7B2'];
function hash(value: string) {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return Math.abs(n);
}

export function BrainGraphPage() {
  const [data, setData] = useState<GraphData>({ nodes: [], edges: [], truncated: false, limit: 350 });
  const [source, setSource] = useState('');
  const [type, setType] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Node | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: '350' });
      if (source) params.set('source', source);
      if (type) params.set('type', type);
      if (query) params.set('query', query);
      api.brainGraph(params).then(setData);
    }, 200);
    return () => clearTimeout(timer);
  }, [source, type, query]);

  const sources = useMemo(() => Array.from(new Set(data.nodes.map(n => n.source_id))).sort(), [data.nodes]);
  const colors = useMemo(() => new Map(sources.map((s, i) => [s, sourceColors[i % sourceColors.length]])), [sources]);
  const nodes = useMemo<PositionedNode[]>(() => {
    const groups = new Map<string, Node[]>();
    data.nodes.forEach(node => groups.set(node.source_id, [...(groups.get(node.source_id) ?? []), node]));
    const positioned: PositionedNode[] = [];
    Array.from(groups.entries()).forEach(([key, group], groupIndex) => {
      const angle = (groupIndex / Math.max(groups.size, 1)) * Math.PI * 2 - Math.PI / 2;
      const centerRadius = groups.size === 1 ? 0 : 310;
      const cx = 600 + Math.cos(angle) * centerRadius;
      const cy = 410 + Math.sin(angle) * centerRadius;
      group.forEach((node, i) => {
        const seed = hash(`${key}:${node.slug}`);
        const localAngle = (seed % 3600) / 3600 * Math.PI * 2;
        const localRadius = 28 + Math.sqrt(i + 1) * 19 + (seed % 23);
        positioned.push({ ...node, x: cx + Math.cos(localAngle) * localRadius, y: cy + Math.sin(localAngle) * localRadius });
      });
    });
    return positioned;
  }, [data.nodes]);
  const byId = useMemo(() => new Map(nodes.map(n => [Number(n.id), n])), [nodes]);

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    setView(v => ({ ...v, scale: Math.max(.35, Math.min(3.2, v.scale * (event.deltaY > 0 ? .9 : 1.1))) }));
  };

  return <div className="graph-page">
    <div className="page-header">
      <div><div className="eyebrow">Connected knowledge</div><h1>Knowledge graph</h1></div>
      <div className="page-count">{data.nodes.length} nodes · {data.edges.length} visible links</div>
    </div>
    <div className="toolbar graph-toolbar">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a page" />
      <input value={source} onChange={e => setSource(e.target.value)} placeholder="Filter source" />
      <input value={type} onChange={e => setType(e.target.value)} placeholder="Filter type" />
      <button className="btn btn-secondary" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>Reset view</button>
    </div>
    <div className="graph-shell">
      <svg viewBox="0 0 1200 820" onWheel={onWheel}
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; (e.currentTarget as SVGElement).setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (drag.current) setView(v => ({ ...v, x: drag.current!.vx + (e.clientX - drag.current!.x) / v.scale, y: drag.current!.vy + (e.clientY - drag.current!.y) / v.scale })); }}
        onPointerUp={() => { drag.current = null; }}>
        <rect width="1200" height="820" className="graph-bg" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {data.edges.map(edge => {
            const a = byId.get(Number(edge.source)); const b = byId.get(Number(edge.target));
            return a && b ? <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="graph-edge" /> : null;
          })}
          {nodes.map(node => {
            const radius = Math.max(3.5, Math.min(13, 3 + Math.sqrt(Number(node.degree)) * .65));
            return <g key={node.id} className="graph-node" transform={`translate(${node.x} ${node.y})`}
              onPointerDown={e => e.stopPropagation()} onClick={() => setSelected(node)}>
              <circle r={radius + (selected?.id === node.id ? 4 : 0)} fill={colors.get(node.source_id)} className={selected?.id === node.id ? 'selected' : ''} />
              {(Number(node.degree) > 18 || selected?.id === node.id) && <text x={radius + 5} y="4">{node.title.slice(0, 34)}</text>}
            </g>;
          })}
        </g>
      </svg>
      <div className="graph-legend">{sources.map(s => <span key={s}><i style={{ background: colors.get(s) }} />{s}</span>)}</div>
      <div className="graph-help">Drag to pan · Scroll to zoom · Node size = link degree</div>
      {selected && <aside className="graph-inspector">
        <button onClick={() => setSelected(null)}>×</button>
        <div className="eyebrow">{selected.source_id} / {selected.type}</div>
        <h2>{selected.title}</h2><div className="slug">{selected.slug}</div>
        <dl className="detail-grid"><div><dt>Link degree</dt><dd>{selected.degree}</dd></div></dl>
        <a href={`#content`} className="btn btn-primary">Open content browser</a>
      </aside>}
    </div>
  </div>;
}
