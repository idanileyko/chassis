import { useEffect, useState } from 'react';
import type { ThemeName } from '../types';

interface Props {
  backend: boolean;
  profileName: string | null;
  openGates: number;
  killSwitch: boolean;
  demo: boolean;
  theme: ThemeName;
  onTheme: (t: ThemeName) => void;
  onKill: () => void;
  running: boolean;
}

const THEMES: { id: ThemeName; label: string }[] = [
  { id: 'intelligence', label: 'INTEL' },
  { id: 'tactical', label: 'TACTICAL' },
  { id: 'light', label: 'LIGHT' },
];

export default function Header(p: Props) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '8px 12px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        flex: 'none',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
          <circle cx="11" cy="11" r="10" fill="none" stroke="var(--accent)" strokeWidth="1" opacity="0.5" />
          <line x1="11" y1="1" x2="11" y2="21" stroke="var(--accent)" strokeWidth="0.7" opacity="0.35" />
          <line x1="1" y1="11" x2="21" y2="11" stroke="var(--accent)" strokeWidth="0.7" opacity="0.35" />
          <circle cx="11" cy="11" r="2.4" fill="var(--accent)" />
        </svg>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.28em' }}>CHASSIS</div>
          <div className="label" style={{ fontSize: 8 }}>AGENT OPERATIONS CONSOLE</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 8 }}>
        <Led label="BACKEND" state={p.backend ? 'on' : 'off'} />
        <Led label={p.profileName ? `PROFILE ${p.profileName}` : 'NO PROFILE'} state={p.profileName ? 'accent' : 'off'} />
        <Led label={`GATES ${p.openGates}`} state={p.openGates > 0 ? 'crit' : 'on'} />
        <Led label={p.running ? 'RUNNING' : 'IDLE'} state={p.running ? 'warn' : 'on'} />
      </div>

      <div style={{ flex: 1 }} />

      <span className="pill" style={p.demo ? { color: 'var(--warn)' } : { color: 'var(--ok)' }}>
        <span className="dot" />
        {p.demo ? 'SIMULATED' : 'LIVE'}
      </span>

      <div style={{ display: 'flex', gap: 2, border: '1px solid var(--border)', padding: 2 }}>
        {THEMES.map((t) => (
          <button
            key={t.id}
            className="btn"
            style={{
              padding: '3px 8px',
              fontSize: 8.5,
              border: 'none',
              color: p.theme === t.id ? 'var(--accent)' : 'var(--text-faint)',
              background: p.theme === t.id ? 'var(--accent-dim)' : 'transparent',
            }}
            onClick={() => p.onTheme(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <button className={`btn danger ${p.killSwitch ? 'armed' : ''}`} onClick={p.onKill}>
        {p.killSwitch ? '■ KILL ACTIVE' : '○ KILL SWITCH'}
      </button>

      <span className="label" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {now.toISOString().slice(11, 19)} UTC
      </span>
    </header>
  );
}

function Led({ label, state }: { label: string; state: 'on' | 'off' | 'accent' | 'warn' | 'crit' }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }} title={label}>
      <span className={`led ${state}`} />
      <span className="label" style={{ fontSize: 8 }}>{label}</span>
    </span>
  );
}
