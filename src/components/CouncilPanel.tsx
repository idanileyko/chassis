import type { CouncilResult } from '../types';

const VERDICT_COLOR: Record<string, string> = { green: 'var(--ok)', amber: 'var(--warn)', red: 'var(--crit)' };

/**
 * Council feed — the Room B verdicts. Compact by design: verdict chips, risk
 * levels, convergent flags, and the disagreements that prove the council
 * isn't an echo chamber.
 */
export default function CouncilPanel({ council }: { council: CouncilResult | null }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <span className={`led ${council && council.consensus_verdict !== 'green' ? 'warn' : 'accent'}`} />
        COUNCIL FEED — ROOM B VERDICTS
        <span className="spacer" />
        {council ? council.consensus_verdict.toUpperCase() : '—'}
      </div>
      <div className="panel-body">
        {!council && (
          <div style={{ padding: 16, color: 'var(--text-faint)' }} className="label">
            NO COUNCIL CONVENED — RUN ONE FROM THE PROFILE PANEL
          </div>
        )}
        {council && (
          <>
            <div style={{ padding: '6px 10px', fontSize: 9.5, color: 'var(--text-dim)', borderBottom: '1px solid var(--border)' }}>
              {council.at.slice(11, 19)} UTC · brain: {council.brain} · spread {council.risk_spread}/10
              {council.convergence_gates > 0 && <span style={{ color: 'var(--crit)' }}> · {council.convergence_gates} advisory gate(s) raised</span>}
            </div>
            {council.opinions.map((o) => (
              <div key={o.advisor_id} style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span className="pill" style={{ color: VERDICT_COLOR[o.verdict], borderColor: VERDICT_COLOR[o.verdict] }}>
                    <span className="dot" />
                    {o.role}
                  </span>
                  <span className="label" style={{ fontSize: 8 }}>
                    risk {o.risk_level}/10 · conf {(o.confidence * 100).toFixed(0)}%
                  </span>
                  <span className="spacer" style={{ flex: 1 }} />
                  {o.offline && <span className="label" style={{ color: 'var(--crit)' }}>OFFLINE</span>}
                </div>
                {o.anomalies.slice(0, 2).map((a) => (
                  <div key={a.id} style={{ fontSize: 9.5, marginTop: 4, color: a.severity === 'critical' ? 'var(--crit)' : a.severity === 'warning' ? 'var(--warn)' : 'var(--text-dim)' }}>
                    ⚑ {a.id} — {a.reasoning}
                  </div>
                ))}
                {o.action_items.slice(0, 2).map((i) => (
                  <div key={i.action} style={{ fontSize: 9.5, marginTop: 3, color: 'var(--text-dim)' }}>
                    ▸ P{i.priority} {i.action}
                  </div>
                ))}
                <div style={{ fontSize: 9, marginTop: 4, color: 'var(--text-faint)', fontStyle: 'italic' }}>
                  {o.disagreement}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
