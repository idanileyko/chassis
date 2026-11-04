import type { Profile, ProfileSummary, Severity } from '../types';

interface Props {
  profiles: ProfileSummary[];
  activeId: string | null;
  full: Profile | null;
  running: boolean;
  killSwitch: boolean;
  convening: boolean;
  onSelect: (id: string) => void;
  onRun: () => void;
  onHandshake: () => void;
  onConvene: () => void;
}

const SEV_COLOR: Record<Severity, string> = { info: 'var(--accent)', warning: 'var(--warn)', critical: 'var(--crit)' };

export default function ProfilePanel(p: Props) {
  return (
    <div className="panel" style={{ overflow: 'hidden' }}>
      <div className="panel-head">
        <span className="led accent" />
        PROJECT PROFILES
        <span className="spacer" />
        {p.profiles.length}
      </div>
      <div className="panel-body">
        {p.profiles.map((s) => (
          <div
            key={s.id}
            className={`radar-node ${p.activeId === s.id ? 'active' : ''}`}
            style={{ margin: '4px 6px', borderColor: p.activeId === s.id ? 'var(--accent)' : 'var(--border)' }}
            onClick={() => p.onSelect(s.id)}
          >
            <span className="radar-dot" />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.12em' }}>{s.name}</div>
              <div className="room-detail" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.kind} · {s.expectations} expectations
              </div>
            </div>
          </div>
        ))}

        {p.full && (
          <>
            <div className="panel-head" style={{ borderTop: '1px solid var(--border)', marginTop: 6 }}>
              EXPECTATIONS — ROOM A
            </div>
            {p.full.expectations.map((e) => (
              <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 10px' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: SEV_COLOR[e.severity], flex: 'none' }} />
                <span style={{ fontSize: 10.5 }}>{e.label}</span>
                <span className="spacer" style={{ flex: 1 }} />
                <span className="label" style={{ fontSize: 8 }}>{e.primitive}</span>
              </div>
            ))}

            <div className="panel-head" style={{ borderTop: '1px solid var(--border)', marginTop: 6 }}>
              ADVISOR POLICY
            </div>
            <div style={{ padding: '6px 10px', display: 'grid', gap: 4 }}>
              <PolicyRow k="max tools" v={String(p.full.advisorPolicy.maxTools)} />
              <PolicyRow k="budget / run" v={`${p.full.advisorPolicy.budgetPerRunTokens.toLocaleString()} tok`} />
              <PolicyRow k="scopes" v={p.full.advisorPolicy.scopes.join(', ') || '—'} />
              <PolicyRow k="forbidden" v={p.full.advisorPolicy.forbidden.join(', ') || '—'} warn />
            </div>

            <div style={{ padding: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="btn primary" onClick={p.onRun} disabled={p.running || p.killSwitch}>
                {p.killSwitch ? 'BLOCKED — KILL' : p.running ? 'SWEEPING…' : 'RUN PROBE SWEEP'}
              </button>
              <button className="btn" onClick={p.onHandshake} disabled={p.running}>
                MCP HANDSHAKE
              </button>
              <button className="btn" onClick={p.onConvene} disabled={p.running || p.convening}>
                {p.convening ? 'COUNCIL IN SESSION…' : 'CONVENE COUNCIL'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function PolicyRow({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, fontSize: 10 }}>
      <span className="label" style={{ width: 88, flex: 'none' }}>{k}</span>
      <span style={{ color: warn ? 'var(--crit)' : 'var(--text-dim)', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}
