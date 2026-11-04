import type { Grade, Profile, ReportCard } from '../types';

interface Props {
  profile: Profile | null;
  probeState: Record<string, { state: 'running' | 'done'; ok?: boolean }>;
  cards: Record<string, ReportCard>;
  openGates: number;
  running: boolean;
}

/**
 * The Floor — animated map of the chassis: Room A readers (left), the Wall
 * (center, only SPEC crosses), Room B advisors (right), Oracle gauge (bottom).
 */
export default function Floor({ profile, probeState, cards, openGates, running }: Props) {
  const readers = profile?.rooms.readers ?? [];
  const advisors = profile?.rooms.advisors ?? [];
  const W = 760, H = 480;

  const readerYs = readers.map((_, i) => 70 + i * 90);
  const advisorYs = advisors.map((_, i) => 130 + i * 110);
  const wallX = W * 0.47;
  const oracle = { x: W * 0.78, y: H - 80 };

  const avgGrade: Grade | null = (() => {
    const list = Object.values(cards);
    if (!list.length) return null;
    const order: Grade[] = ['F', 'D', 'C', 'B', 'A'];
    return list.reduce<Grade>((w, c) => (order.indexOf(c.grade) < order.indexOf(w) ? c.grade : w), 'A');
  })();

  const oracleColor = avgGrade === null ? 'var(--text-faint)' : avgGrade === 'A' ? 'var(--ok)' : avgGrade === 'B' ? 'var(--accent)' : avgGrade === 'C' ? 'var(--warn)' : 'var(--crit)';

  return (
    <div className="panel" style={{ flex: 1, minHeight: 0 }}>
      <div className="panel-head">
        <span className="led accent" />
        THE FLOOR — {profile ? profile.name : 'NO PROFILE LOADED'}
        <span className="spacer" />
        <span style={{ letterSpacing: '0.1em' }}>
          {running ? 'SWEEP IN PROGRESS' : 'STANDBY'}
        </span>
      </div>
      <div className="panel-body" style={{ overflow: 'hidden', position: 'relative' }}>
        {!profile && (
          <div style={{ padding: 30, color: 'var(--text-dim)' }} className="label">
            SELECT A PROFILE TO LOAD THE FLOOR
          </div>
        )}
        <svg className="floor-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
          {/* radar sweep decor */}
          <g style={{ transformOrigin: '70px 362px', animation: 'sweep 4.2s linear infinite' }} opacity="0.3">
            <line x1="70" y1="362" x2="104" y2="362" stroke="var(--accent)" strokeWidth="1" />
          </g>
          <circle cx="70" cy="362" r="34" fill="none" stroke="var(--border-strong)" strokeWidth="1" />
          <circle cx="70" cy="362" r="20" fill="none" stroke="var(--border-strong)" strokeWidth="0.7" />
          <circle cx="70" cy="362" r="2" fill="var(--accent)" opacity="0.6" />

          {/* ROOM A — readers */}
          <text x="30" y="34" className="room-label">ROOM A — READERS</text>
          <text x="30" y="46" className="room-detail">see everything · decide nothing</text>
          {readers.map((r, i) => {
            const y = readerYs[i];
            const st = probeState[r.id];
            const stroke = st?.state === 'running' ? 'var(--warn)' : st?.ok === false ? 'var(--crit)' : st?.ok === true ? 'var(--ok)' : 'var(--border-strong)';
            return (
              <g key={r.id} className="rise-in">
                <rect x="24" y={y - 22} width="190" height="52" rx="3" className="room-box" stroke={stroke} strokeWidth={st ? 1.6 : 1} style={{ transition: 'stroke 0.3s ease' }} />
                <circle cx="40" cy={y - 6} r="3.5" fill={st?.state === 'running' ? 'var(--warn)' : st?.ok === false ? 'var(--crit)' : st?.ok === true ? 'var(--ok)' : 'var(--text-faint)'} style={{ animation: st?.state === 'running' ? 'led-pulse 0.8s ease-in-out infinite' : undefined }} />
                <text x="52" y={y - 3} className="room-label" fill="var(--text)">{r.label}</text>
                <text x="52" y={y + 10} className="room-detail">{r.detail ?? r.kind ?? ''}</text>
              </g>
            );
          })}

          {/* THE WALL */}
          <rect x={wallX - 14} y="40" width="28" height={H - 140} rx="4" className="wall-bar" />
          <text x={wallX} y="30" textAnchor="middle" className="wall-label">THE WALL</text>
          <text x={wallX} y={H - 88} textAnchor="middle" className="room-detail">SPEC CROSSES · NOTHING ELSE</text>

          {/* flow lines reader -> wall */}
          {readers.map((r, i) => {
            const y = readerYs[i];
            const st = probeState[r.id];
            const color = st?.ok === false ? 'var(--crit)' : st?.state === 'running' ? 'var(--warn)' : 'var(--accent)';
            return (
              <path
                key={`fl-${r.id}`}
                d={`M 214 ${y} C ${wallX - 60} ${y}, ${wallX - 40} ${y}, ${wallX - 14} ${y}`}
                className="flow-line"
                stroke={color}
                opacity={st ? 0.9 : 0.35}
                style={{ animationDuration: st?.state === 'running' ? '0.9s' : '2.2s' }}
              />
            );
          })}

          {/* wall -> advisors (SPEC only) */}
          {advisors.map((a, i) => {
            const y = advisorYs[i];
            const srcY = readerYs[0] ?? 80;
            return (
              <path
                key={`wl-${a.id}`}
                d={`M ${wallX + 14} ${srcY} C ${wallX + 60} ${srcY}, ${W * 0.64} ${y}, ${W * 0.68} ${y}`}
                className="flow-line"
                stroke="var(--mag)"
                opacity="0.7"
                strokeDasharray="2 10"
              />
            );
          })}

          {/* ROOM B — advisors */}
          <text x={W * 0.7} y="60" className="room-label">ROOM B — ADVISORS</text>
          <text x={W * 0.7} y="72" className="room-detail">report cards in · proposals out</text>
          {advisors.map((a, i) => {
            const y = advisorYs[i];
            const tools = (a.tools ?? []).join(' · ');
            const t1 = tools.slice(0, 30);
            const t2 = tools.slice(30, 60);
            return (
              <g key={a.id} className="rise-in">
                <rect x={W * 0.68} y={y - 24} width="212" height="66" rx="3" className="room-box" stroke="var(--mag)" strokeWidth="1" strokeDasharray="5 3" />
                <circle cx={W * 0.68 + 16} cy={y - 8} r="3.5" fill="var(--mag)" style={{ animation: 'led-pulse 1.6s ease-in-out infinite' }} />
                <text x={W * 0.68 + 28} y={y - 5} className="room-label" fill="var(--text)">{a.label}</text>
                <text x={W * 0.68 + 12} y={y + 10} className="room-detail">tools: {t1}</text>
                {t2 && <text x={W * 0.68 + 12} y={y + 21} className="room-detail">{t2}</text>}
                <text x={W * 0.68 + 12} y={y + 32} className="room-detail" fill="var(--crit)">forbidden: execution path · credentials</text>
              </g>
            );
          })}

          {/* ORACLE */}
          <g>
            <circle cx={oracle.x} cy={oracle.y} r="34" className="oracle-ring" />
            <circle cx={oracle.x} cy={oracle.y} r="26" fill="none" stroke="var(--panel-2)" strokeWidth="6" />
            {avgGrade && (
              <path
                d={arc(oracle.x, oracle.y, 26, -90, gradeAngle(avgGrade))}
                className="oracle-arc"
                stroke={oracleColor}
              />
            )}
            <text x={oracle.x} y={oracle.y + 7} textAnchor="middle" className="oracle-grade" fill={oracleColor}>
              {avgGrade ?? '—'}
            </text>
            <text x={oracle.x} y={oracle.y + 52} textAnchor="middle" className="room-label">ORACLE</text>
            <text x={oracle.x} y={oracle.y + 63} textAnchor="middle" className="room-detail">
              {openGates > 0 ? `${openGates} GATE${openGates > 1 ? 'S' : ''} OPEN` : 'no gates open'}
            </text>
          </g>

          {/* wall -> oracle evidence flow */}
          <path
            d={`M ${wallX} ${H - 110} C ${wallX + 80} ${H - 60}, ${oracle.x - 120} ${oracle.y}, ${oracle.x - 36} ${oracle.y}`}
            className="flow-line"
            stroke="var(--ok)"
            opacity="0.5"
          />
        </svg>
      </div>
    </div>
  );
}

function arc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = ((startDeg - 90) * Math.PI) / 180;
  const e = ((endDeg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s);
  const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function gradeAngle(g: Grade) {
  return { A: 300, B: 240, C: 180, D: 120, F: 60 }[g];
}
