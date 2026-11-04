import type { ReportCard } from '../types';

export default function ReportCards({ cards }: { cards: ReportCard[] }) {
  const list = [...cards].sort((a, b) => a.grade.localeCompare(b.grade)).reverse();
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="led on" />
        ORACLE REPORT CARDS
        <span className="spacer" />
        {list.length} ISSUED
      </div>
      <div className="panel-body">
        {list.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-faint)' }} className="label">
            NO EVIDENCE SCORED YET — RUN A SWEEP
          </div>
        )}
        {list.map((c) => (
          <div key={c.id} className={`card-sev ${c.grade === 'A' || c.grade === 'B' ? 'ok' : c.grade === 'C' ? 'warn' : 'crit'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`grade-chip grade-${c.grade}`}>{c.grade}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 10.5, fontWeight: 600 }}>{c.label}</div>
                <div className="room-detail">{c.id} · {c.primitive} · {c.severity}</div>
              </div>
              <span className="spacer" style={{ flex: 1 }} />
              {typeof c.latencyMs === 'number' && (
                <span className="label" style={{ fontSize: 8 }}>{c.latencyMs}ms</span>
              )}
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--text-dim)', marginTop: 4 }}>{c.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
