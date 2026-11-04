import { useState } from 'react';
import type { Gate } from '../types';
import { respondGate } from '../api';

export default function Inbox({ gates, demo, onDecided }: { gates: Gate[]; demo: boolean; onDecided: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = [...gates].reverse().slice(0, 12);

  const decide = async (id: string, decision: 'approve' | 'deny') => {
    setBusy(id);
    try {
      await respondGate(id, decision);
      onDecided();
    } catch { /* surfaced via state refresh */ }
    finally { setBusy(null); }
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <span className={`led ${gates.filter((g) => g.status === 'open').length ? 'crit' : 'on'}`} />
        GATE INBOX — HUMAN AUTHORITY
        <span className="spacer" />
        {gates.filter((g) => g.status === 'open').length} OPEN
      </div>
      <div className="panel-body">
        {sorted.length === 0 && (
          <div style={{ padding: 16, color: 'var(--text-faint)' }} className="label">
            NO GATES RAISED — THE CREW IS QUIET
          </div>
        )}
        {sorted.map((g) => (
          <div key={g.id} className={`card-sev ${g.status === 'open' ? 'crit' : g.status === 'deny' ? 'warn' : 'ok'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="pill" style={g.status === 'open' ? { color: 'var(--crit)' } : {}}>
                <span className="dot" />
                {g.status === 'open' ? 'AWAITING HUMAN' : g.status.toUpperCase()}
              </span>
              <span className="label" style={{ fontSize: 8 }}>{g.raisedAt.slice(11, 19)} UTC</span>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, margin: '5px 0 3px' }}>{g.label}</div>
            <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5, wordBreak: 'break-all' }}>{g.detail}</div>
            {g.status === 'open' && (
              <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                <button className="btn primary" disabled={busy === g.id || demo} onClick={() => decide(g.id, 'approve')}>
                  APPROVE
                </button>
                <button className="btn danger" disabled={busy === g.id || demo} onClick={() => decide(g.id, 'deny')}>
                  DENY
                </button>
                {demo && <span className="label" style={{ alignSelf: 'center' }}>demo — read only</span>}
              </div>
            )}
            {g.note && <div style={{ fontSize: 9.5, color: 'var(--text-faint)', marginTop: 5 }}>note: {g.note}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
