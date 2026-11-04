import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  checkBackend, fetchChassisState, fetchProfile, fetchProfiles,
  runProbes, setKillSwitch,
} from './api';
import type {
  ChassisEvent, ChassisState, Gate, Profile, ProfileSummary,
  ReportCard, ThemeName,
} from './types';
import Header from './components/Header';
import Ticker from './components/Ticker';
import Floor from './components/Floor';
import ProfilePanel from './components/ProfilePanel';
import Inbox from './components/Inbox';
import ReportCards from './components/ReportCards';
import LogPanel, { type LogLine } from './components/LogPanel';

const DEMO_PROFILE: Profile = {
  id: 'demo', name: 'DEMO_CRAFT', kind: 'illustrative',
  description: 'Scripted demonstration — figures are simulated.',
  rooms: {
    readers: [
      { id: 'r1', label: 'SOURCE MIRROR', detail: 'reference feed', kind: 'mcp' },
      { id: 'r2', label: 'WORKSPACE', detail: 'artifact store', kind: 'mcp' },
      { id: 'r3', label: 'LINT RIG', detail: 'static checks', kind: 'probes' },
    ],
    advisors: [{ id: 'a1', label: 'STRATEGIST', tools: ['read_report_cards', 'draft_proposal'], persona: 'advisory only' }],
  },
  expectations: [
    { id: 'r1', primitive: 'http', label: 'Reference feed reachable', severity: 'critical' },
    { id: 'r2', primitive: 'file', label: 'Artifact store mounted', severity: 'warning' },
    { id: 'r3', primitive: 'metric', label: 'Headroom above floor', severity: 'info' },
  ],
  advisorPolicy: { maxTools: 3, scopes: ['read:report_cards'], forbidden: ['execution_path'], budgetPerRunTokens: 20000 },
  gates: { criticalRequiresHuman: true, maxOpen: 5 },
  oracle: { rubrics: [{ id: 'demo', label: 'DEMO', gradeBands: {} }] },
};

export default function App() {
  const [backend, setBackend] = useState(false);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [full, setFull] = useState<Profile | null>(null);
  const [state, setState] = useState<ChassisState | null>(null);
  const [cards, setCards] = useState<ReportCard[]>([]);
  const [running, setRunning] = useState(false);
  const [theme, setTheme] = useState<ThemeName>('intelligence');
  const [kill, setKill] = useState(false);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [probeState, setProbeState] = useState<Record<string, { state: 'running' | 'done'; ok?: boolean }>>({});
  const [gates, setGates] = useState<Gate[]>([]);
  const [handshakeNote, setHandshakeNote] = useState<string | null>(null);

  const demo = !backend;
  const pushLog = useCallback((kind: LogLine['kind'], text: string) => {
    setLines((l) => [...l.slice(-300), { ts: new Date().toISOString().slice(11, 19), kind, text }]);
  }, []);

  /* ---------- boot: detect backend, load profiles ---------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      const h = await checkBackend().catch(() => ({ ok: false }));
      if (!alive) return;
      setBackend(h.ok);
      if (h.ok) {
        const { profiles: ps } = await fetchProfiles().catch(() => ({ profiles: [] as ProfileSummary[] }));
        setProfiles(ps);
        if (ps.length) setActiveId(ps[0].id);
        const st = await fetchChassisState().catch(() => null);
        if (st) { setState(st); setGates(st.gates); setKill(st.killSwitch); }
        pushLog('audit', 'chassis backend linked — profiles loaded');
      } else {
        setProfiles([{ id: 'demo', name: DEMO_PROFILE.name, kind: DEMO_PROFILE.kind, description: DEMO_PROFILE.description, expectations: 3, readers: 3, advisors: 1 }]);
        setActiveId('demo');
        setFull(DEMO_PROFILE);
        pushLog('info', 'no backend — SIMULATED demo mode, all figures illustrative');
      }
    })();
    return () => { alive = false; };
  }, [pushLog]);

  /* ---------- load full profile ---------- */
  useEffect(() => {
    if (!activeId || demo) return;
    fetchProfile(activeId)
      .then((r) => {
        setFull(r.profile);
        setCards(Object.values((r.reportCards ?? {}) as Record<string, ReportCard>));
        pushLog('info', `profile loaded: ${r.profile.name}`);
      })
      .catch(() => pushLog('gate', `failed to load profile ${activeId}`));
  }, [activeId, demo, pushLog]);

  /* ---------- theme ---------- */
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  /* ---------- SSE event consumer ---------- */
  const onEvent = useCallback((e: ChassisEvent) => {
    switch (e.type) {
      case 'meta':
        pushLog('run', `sweep started — ${e.name}`);
        break;
      case 'status':
        pushLog('info', e.text);
        break;
      case 'probe':
        if (e.state === 'running') {
          setProbeState((s) => ({ ...s, [e.id ?? '']: { state: 'running' } }));
          pushLog('run', `probe → ${e.label}`);
        } else {
          setProbeState((s) => ({ ...s, [e.id]: { state: 'done', ok: e.ok } }));
          pushLog(e.ok ? 'ok' : 'gate', `${e.ok ? 'pass' : 'FAIL'} — ${e.label}: ${e.detail}`);
        }
        break;
      case 'gate':
        setGates((g) => [...g, e]);
        pushLog('gate', `GATE RAISED — ${e.label}: ${e.detail}`);
        break;
      case 'oracle':
        setCards(e.cards);
        pushLog('ok', `oracle scored ${e.cards.length} report cards`);
        break;
      case 'done':
        setRunning(false);
        pushLog(e.blocked ? 'gate' : 'ok', e.blocked ? 'run blocked by kill switch' : `sweep complete in ${e.elapsedMs}ms`);
        fetchChassisState().then((st) => { setState(st); setGates(st.gates); }).catch(() => {});
        break;
      case 'error':
        pushLog('gate', `error: ${e.message}`);
        setRunning(false);
        break;
    }
  }, [pushLog]);

  /* ---------- run sweep ---------- */
  const run = useCallback(async () => {
    if (!activeId) return;
    setRunning(true);
    setProbeState({});
    pushLog('run', `operator initiated sweep — ${activeId}`);
    if (demo) {
      // scripted simulation, clearly labeled
      await new Promise((r) => setTimeout(r, 400));
      for (const e of DEMO_PROFILE.expectations) {
        onEvent({ type: 'probe', state: 'running', id: e.id, label: e.label, primitive: e.primitive, severity: e.severity } as ChassisEvent);
        await new Promise((r) => setTimeout(r, 700));
        const ok = e.id !== 'r2';
        onEvent({ type: 'probe', state: 'done', id: e.id, label: e.label, primitive: e.primitive, severity: e.severity, at: new Date().toISOString(), ok, value: ok ? 200 : null, latencyMs: 180 + Math.floor(Math.random() * 300), detail: ok ? 'SIMULATED pass (illustrative)' : 'SIMULATED failure (illustrative)', band: ok ? 'pass' : 'hard' } as ChassisEvent);
      }
      const simCards: ReportCard[] = DEMO_PROFILE.expectations.map((e, i) => ({
        id: e.id, label: e.label, primitive: e.primitive, severity: e.severity, at: new Date().toISOString(),
        ok: i !== 1, value: i !== 1 ? 200 : null, latencyMs: 240, detail: 'SIMULATED (illustrative)',
        band: i !== 1 ? 'pass' : 'hard', grade: i !== 1 ? 'A' : 'D', score: i !== 1 ? 0 : 2, rubric: 'demo',
      }));
      onEvent({ type: 'oracle', cards: simCards });
      if (!kill) {
        const g: Gate = { id: 'gate-demo', profileId: 'demo', expectationId: 'r2', label: 'SIMULATED GATE — Workspace drift', detail: 'Illustrative only. In live mode this gate would require your decision.', status: 'open', raisedAt: new Date().toISOString(), decidedAt: null, decision: null, note: null };
        setGates((prev) => [...prev, g]);
        pushLog('gate', 'SIMULATED gate raised (illustrative)');
      }
      onEvent({ type: 'done', blocked: kill, elapsedMs: 2100 });
      return;
    }
    try {
      await runProbes(activeId, onEvent);
    } catch (err) {
      pushLog('gate', `sweep failed: ${String(err)}`);
      setRunning(false);
    }
  }, [activeId, demo, kill, onEvent, pushLog]);

  /* ---------- kill switch ---------- */
  const toggleKill = useCallback(async () => {
    if (demo) {
      setKill((k) => { pushLog('gate', k ? 'kill switch disarmed (simulated)' : 'KILL SWITCH ARMED (simulated) — sweeps blocked'); return !k; });
      return;
    }
    try {
      const r = await setKillSwitch(!kill);
      setKill(r.killSwitch);
      pushLog('gate', r.killSwitch ? 'KILL SWITCH ARMED — all runs blocked' : 'kill switch disarmed');
      fetchChassisState().then((st) => { setState(st); setGates(st.gates); }).catch(() => {});
    } catch { pushLog('gate', 'kill switch toggle failed'); }
  }, [demo, kill, pushLog]);

  /* ---------- MCP handshake ---------- */
  const handshake = useCallback(async () => {
    setHandshakeNote('handshake not configured in hosted preview — wire local MCP servers via /api/mcp/handshake');
    pushLog('info', 'MCP handshake: no servers configured on this host');
  }, [pushLog]);

  const openGates = gates.filter((g) => g.status === 'open').length;

  const tickerItems = useMemo(() => {
    const items = cards.map((c) => ({
      key: c.id,
      html: `<b>${c.label}</b> grade <span class="t-${c.grade === 'A' || c.grade === 'B' ? 'ok' : c.grade === 'C' ? 'warn' : 'crit'}">${c.grade}</span>${typeof c.latencyMs === 'number' ? ` · ${c.latencyMs}ms` : ''}`,
    }));
    items.push({ key: 'gates', html: `<b>GATES</b> <span class="${openGates ? 't-crit' : 't-ok'}">${openGates} open</span>` });
    items.push({ key: 'audit', html: `<b>AUDIT</b> ${state?.runs ?? 0} sweeps on record · append-only` });
    if (kill) items.push({ key: 'kill', html: `<b class="t-crit">KILL SWITCH ARMED</b>` });
    if (demo) items.push({ key: 'demo', html: `<b>SIMULATED MODE</b> — figures illustrative` });
    if (handshakeNote) items.push({ key: 'hs', html: `<b>MCP</b> ${handshakeNote}` });
    return items;
  }, [cards, openGates, state?.runs, kill, demo, handshakeNote]);

  return (
    <div className="app-shell">
      <Header
        backend={backend}
        profileName={full?.name ?? null}
        openGates={openGates}
        killSwitch={kill}
        demo={demo}
        theme={theme}
        onTheme={setTheme}
        onKill={toggleKill}
        running={running}
      />
      {kill && <div className="kill-banner">KILL SWITCH ARMED — ALL SWEEPS BLOCKED</div>}
      <Ticker items={tickerItems} />

      <div className="main-grid">
        <ProfilePanel
          profiles={profiles}
          activeId={activeId}
          full={full}
          running={running}
          killSwitch={kill}
          onSelect={setActiveId}
          onRun={run}
          onHandshake={handshake}
        />

        <div className="center-col">
          <Floor profile={full} probeState={probeState} cards={Object.fromEntries(cards.map((c) => [c.id, c]))} openGates={openGates} running={running} />
          <LogPanel lines={lines} title={demo ? 'EVENT LOG — SIMULATED' : 'EVENT LOG — AUDIT STREAM'} />
        </div>

        <div className="right-col">
          <Inbox gates={gates} demo={demo} onDecided={() => fetchChassisState().then((st) => { setGates(st.gates); setState(st); pushLog('audit', 'gate decided by operator'); }).catch(() => {})} />
          <ReportCards cards={cards} />
        </div>
      </div>
    </div>
  );
}
