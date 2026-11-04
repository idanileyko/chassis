/**
 * CHASSIS — agent-operations console backend
 *
 * Run AFTER building the frontend:
 *   npm run build
 *   node server.mjs           (serves dist/ on http://localhost:4173)
 *
 * Provides (v1):
 *   GET  /api/health                 -> backend liveness
 *   GET  /api/ollama/models?baseUrl  -> proxied /api/tags model list
 *   POST /api/ollama/test            -> tiny generate call to verify LLM
 *   POST /api/mcp/connect            -> connect to MCP servers, list tools
 *   POST /api/run                    -> SSE-streamed agent loop (LLM + MCP tools)
 *
 * Provides (v2 — chassis):
 *   GET  /api/profiles               -> list project profiles
 *   GET  /api/profiles/:id           -> one profile
 *   POST /api/profiles/:id           -> save profile edits (schema-validated)
 *   POST /api/chassis/run            -> SSE-streamed expectation run -> oracle report cards
 *   GET  /api/chassis/state          -> gates, report cards, audit tail, kill switch
 *   POST /api/chassis/gates/:id/respond -> human decision on a gate (the inbox)
 *   POST /api/chassis/killswitch     -> arm/disarm
 *   POST /api/mcp/handshake          -> connect + hash tool schemas, detect drift
 *
 * Policy spine: CRITICAL failures raise gates; gates need a human; the audit
 * log is append-only; the kill switch halts all runs.
 */
import http from 'node:http';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, 'dist');
const PROFILES_DIR = path.join(__dirname, 'profiles');
const AUDIT_FILE = path.join(__dirname, 'chassis-audit.jsonl');
const STATE_FILE = path.join(__dirname, 'chassis-state.json');
const PORT = process.env.PORT || 4173;
const MAX_ROUNDS = 24;

/* ============================ CHASSIS STATE ============================ */
const chassis = {
  profiles: new Map(),     // id -> profile
  reportCards: {},         // profileId -> { expectationId -> card }
  gates: [],               // open + resolved gates
  audit: [],               // append-only, also persisted to AUDIT_FILE
  killSwitch: false,
  mcpManifests: {},        // serverKey -> { hash, tools, at }
  runs: 0,
  failStreaks: {},         // "profileId:expectationId" -> consecutive failure count
  lastRunAt: {},           // profileId -> epoch ms of last completed sweep
};

/** Persist safety-relevant state so a restart never silently forgets a gate. */
async function saveState() {
  try {
    await writeFile(STATE_FILE, JSON.stringify({
      gates: chassis.gates,
      killSwitch: chassis.killSwitch,
      failStreaks: chassis.failStreaks,
      lastRunAt: chassis.lastRunAt,
      runs: chassis.runs,
    }, null, 2));
  } catch { /* best effort; audit remains the durable record */ }
}

async function loadState() {
  try {
    const s = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    if (Array.isArray(s.gates)) chassis.gates = s.gates;
    if (typeof s.killSwitch === 'boolean') chassis.killSwitch = s.killSwitch;
    if (s.failStreaks && typeof s.failStreaks === 'object') chassis.failStreaks = s.failStreaks;
    if (s.lastRunAt && typeof s.lastRunAt === 'object') chassis.lastRunAt = s.lastRunAt;
    if (typeof s.runs === 'number') chassis.runs = s.runs;
  } catch { /* no prior state — fresh boot */ }
}

/** Monitoring canary: a probe guaranteed to fail. If it ever passes, the
 * probe runner itself is untrustworthy — that must raise a META gate. */
const CANARY = {
  id: '__canary__',
  primitive: 'http',
  label: 'Monitoring canary (self-test)',
  target: 'http://127.0.0.1:9/__canary__',
  assert: { status: 200 },
  severity: 'critical',
};

function parseScheduleMs(schedule, fallbackMs = 300_000) {
  const m = /^(\d+)\s*(s|m|h)?$/.exec(String(schedule || '').trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  return n * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000);
}

function audit(event) {
  const entry = { at: new Date().toISOString(), ...event };
  chassis.audit.push(entry);
  try {
    createWriteStream(AUDIT_FILE, { flags: 'a' }).end(JSON.stringify(entry) + '\n');
  } catch { /* best effort */ }
  if (chassis.audit.length > 500) chassis.audit.splice(0, chassis.audit.length - 500);
  return entry;
}

function hashTools(tools) {
  const canon = tools
    .map((t) => ({ n: t.name, s: t.inputSchema || {} }))
    .sort((a, b) => a.n.localeCompare(b.n));
  return crypto.createHash('sha256').update(JSON.stringify(canon)).digest('hex').slice(0, 16);
}

/* --------------------------- profile store --------------------------- */
function validateProfile(p) {
  const errors = [];
  if (!p || typeof p !== 'object') return ['profile must be an object'];
  if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) errors.push('id must be lowercase slug');
  if (!p.name) errors.push('name required');
  if (!Array.isArray(p.expectations)) errors.push('expectations must be an array');
  else {
    const primitives = new Set(['http', 'sql', 'cli', 'file', 'metric']);
    for (const e of p.expectations) {
      if (!e.id) errors.push('expectation missing id');
      if (!primitives.has(e.primitive)) errors.push(`expectation ${e.id}: unknown primitive "${e.primitive}"`);
      if (!['info', 'warning', 'critical'].includes(e.severity)) errors.push(`expectation ${e.id}: bad severity`);
    }
  }
  const pol = p.advisorPolicy || {};
  if (pol.maxTools > 8) errors.push('advisorPolicy.maxTools must be <= 8 (surfaces shrink, never grow)');
  return errors;
}

async function loadProfiles() {
  let files = [];
  try {
    const { readdir } = await import('node:fs/promises');
    files = (await readdir(PROFILES_DIR)).filter((f) => f.endsWith('.json'));
  } catch { return; }
  for (const f of files) {
    try {
      const p = JSON.parse(await readFile(path.join(PROFILES_DIR, f), 'utf8'));
      const errs = validateProfile(p);
      if (errs.length) {
        audit({ type: 'profile.rejected', file: f, errors: errs });
        continue;
      }
      chassis.profiles.set(p.id, p);
    } catch (e) {
      audit({ type: 'profile.load_failed', file: f, error: String(e.message || e) });
    }
  }
}

/* --------------------- expectation primitives (Room A) --------------------- */
async function runExpectation(e) {
  const t0 = Date.now();
  const base = { id: e.id, label: e.label, primitive: e.primitive, severity: e.severity, at: new Date().toISOString() };
  try {
    if (e.primitive === 'http') {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), e.assert?.maxLatencyMs ? Math.min(e.assert.maxLatencyMs + 2000, 15000) : 8000);
      let r;
      try { r = await fetch(e.target, { signal: ctrl.signal, redirect: 'follow' }); }
      finally { clearTimeout(timer); }
      const latency = Date.now() - t0;
      const wantStatus = e.assert?.status ?? 200;
      const ok = r.status === wantStatus;
      return { ...base, ok, value: r.status, latencyMs: latency,
        detail: `HTTP ${r.status} in ${latency}ms (want ${wantStatus})`,
        band: !ok ? 'hard' : latency > (e.assert?.maxLatencyMs || 3000) ? 'warn' : 'pass' };
    }
    if (e.primitive === 'file') {
      const st = await stat(path.join(__dirname, e.target));
      const okSize = !e.assert?.maxBytes || st.size <= e.assert.maxBytes;
      return { ...base, ok: okSize, value: st.size, detail: `${e.target} — ${st.size} bytes`,
        band: okSize ? 'pass' : 'hard' };
    }
    if (e.primitive === 'metric') {
      const kind = e.assert?.kind || 'mem';
      if (kind === 'disk') {
        const { statfs } = await import('node:fs/promises');
        const s = await statfs(e.target || '/');
        const free = Number(s.bavail) * Number(s.bsize);
        const ok = free >= (e.assert?.min || 0);
        return { ...base, ok, value: free, detail: `free disk ${(free / 1073741824).toFixed(2)} GB on ${e.target || '/'}`,
          band: ok ? 'pass' : 'hard' };
      }
      const os = await import('node:os');
      const free = os.freemem();
      const ok = free >= (e.assert?.min || 0);
      return { ...base, ok, value: free, detail: `free memory ${(free / 1048576).toFixed(1)} MB`,
        band: ok ? 'pass' : 'hard' };
    }
    return { ...base, ok: true, detail: `primitive "${e.primitive}" registered, no executor in hosted preview — skipped`, band: 'pass', skipped: true };
  } catch (err) {
    return { ...base, ok: false, value: null, detail: String(err.message || err), band: 'hard', latencyMs: Date.now() - t0 };
  }
}

/* ------------------------------ oracle ------------------------------ */
function gradeResult(profile, r) {
  // Grade against the profile's first rubric band table, keyed by band kind.
  const rubric = profile.oracle?.rubrics?.[0];
  const bands = rubric?.gradeBands || { A: 0, B: 0.5, C: 1.5, D: 4, F: 999 };
  if (r.ok && r.band === 'pass') return { grade: 'A', score: 0 };
  if (r.ok && r.band === 'warn') return { grade: 'B', score: bands.B };
  if (!r.ok && r.severity === 'info') return { grade: 'C', score: bands.C };
  if (!r.ok && r.severity === 'warning') return { grade: 'D', score: bands.D };
  return { grade: 'F', score: bands.F };
}

/* --------------------------- policy (the Wall) --------------------------- */
function raiseGate({ profileId, expectationId, label, detail }) {
  const open = chassis.gates.filter((g) => g.status === 'open');
  const existing = open.find((g) => g.expectationId === expectationId && g.profileId === profileId);
  if (existing || open.length >= 5) return null;
  const gate = {
    id: 'gate-' + crypto.randomBytes(4).toString('hex'),
    profileId: profileId ?? null,
    expectationId: expectationId ?? null,
    label,
    detail,
    status: 'open',
    raisedAt: new Date().toISOString(),
    decidedAt: null,
    decision: null,
    note: null,
  };
  chassis.gates.push(gate);
  audit({ type: 'gate.raised', gateId: gate.id, profileId, expectationId, detail });
  saveState();
  return gate;
}

function applyPolicy(profile, results) {
  const raised = [];
  for (const r of results) {
    const { grade, score } = gradeResult(profile, r);
    const card = { ...r, grade, score, rubric: profile.oracle?.rubrics?.[0]?.id || 'default' };
    chassis.reportCards[profile.id] = chassis.reportCards[profile.id] || {};
    chassis.reportCards[profile.id][r.id] = card;

    // Dual-signal rule: a CRITICAL gate needs a consecutive-failure streak of
    // 2+ (two time-separated derivations of the same signal). A single probe
    // failure — bug, blip, DNS — must not block a human.
    const key = `${profile.id}:${r.id}`;
    chassis.failStreaks[key] = r.ok ? 0 : (chassis.failStreaks[key] || 0) + 1;

    if (!r.ok && r.severity === 'critical' && profile.gates?.criticalRequiresHuman) {
      if (chassis.failStreaks[key] >= 2) {
        const gate = raiseGate({
          profileId: profile.id,
          expectationId: r.id,
          label: r.label,
          detail: `${r.detail} — confirmed across ${chassis.failStreaks[key]} consecutive sweeps`,
        });
        if (gate) raised.push(gate);
      }
    }
  }
  return raised;
}

/* --------------------------- SSE run handler --------------------------- */
async function handleChassisRun(req, res) {
  const { profileId } = await readBody(req);
  const profile = chassis.profiles.get(profileId);
  if (!profile) return send(res, 404, { error: `unknown profile "${profileId}"` });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const emit = (event, data) => sse(res, event, data);
  const started = Date.now();

  emit('meta', { event_v: 1, profileId: profile.id, name: profile.name, at: new Date().toISOString() });

  if (chassis.killSwitch) {
    emit('status', { text: 'KILL SWITCH ARMED — run blocked by policy' });
    audit({ type: 'run.blocked', profileId: profile.id, reason: 'kill_switch' });
    emit('done', { blocked: true, elapsedMs: Date.now() - started });
    return res.end();
  }

  // Monitoring canary first: it MUST fail. If it passes, the probe runner is
  // lying to us and that raises a META gate before any real results are trusted.
  const canary = await runExpectation(CANARY);
  if (canary.ok) {
    audit({ type: 'canary.alive', profileId: profile.id });
    const gate = raiseGate({
      profileId: profile.id,
      expectationId: '__canary__',
      label: 'MONITORING CANARY ALIVE — runner untrustworthy',
      detail: `The canary probe (${CANARY.target}) was expected to fail but passed. Probe results this sweep cannot be trusted.`,
    });
    if (gate) emit('gate', gate);
  }
  emit('canary', { ok: canary.ok, expected: false, detail: canary.detail });

  emit('status', { text: `Room A engaged — ${profile.expectations.length} expectations` });
  const results = [];
  for (const e of profile.expectations) {
    emit('probe', { id: e.id, label: e.label, primitive: e.primitive, state: 'running' });
    const r = await runExpectation(e);
    results.push(r);
    emit('probe', { ...r, state: 'done' });
  }

  emit('status', { text: 'Oracle scoring — report cards issuing' });
  const raised = applyPolicy(profile, results);
  for (const g of raised) emit('gate', g);
  chassis.runs += 1;
  chassis.lastRunAt[profile.id] = Date.now();
  audit({ type: 'run.complete', profileId: profile.id, results: results.map((r) => ({ id: r.id, ok: r.ok, band: r.band })) });
  saveState();

  const cards = Object.values(chassis.reportCards[profile.id] || {});
  emit('oracle', { cards });
  emit('done', { blocked: false, elapsedMs: Date.now() - started, gatesRaised: raised.length, runs: chassis.runs });
  res.end();
}

/* --------------------------- other handlers --------------------------- */
async function handleProfilesList(req, res) {
  const list = [...chassis.profiles.values()].map((p) => ({
    id: p.id, name: p.name, kind: p.kind, description: p.description,
    expectations: p.expectations.length,
    readers: p.rooms?.readers?.length || 0,
    advisors: p.rooms?.advisors?.length || 0,
  }));
  send(res, 200, { profiles: list });
}

async function handleProfileGet(req, res, id) {
  const p = chassis.profiles.get(id);
  if (!p) return send(res, 404, { error: 'not found' });
  send(res, 200, { profile: p, reportCards: chassis.reportCards[id] || {}, gates: chassis.gates.filter((g) => g.profileId === id) });
}

async function handleProfileSave(req, res, id) {
  const p = await readBody(req);
  if (p.id !== id) return send(res, 400, { error: 'body id must match path id' });
  const errors = validateProfile(p);
  if (errors.length) return send(res, 422, { errors });
  await writeFile(path.join(PROFILES_DIR, `${id}.json`), JSON.stringify(p, null, 2));
  chassis.profiles.set(id, p);
  audit({ type: 'profile.saved', profileId: id, by: 'operator' });
  send(res, 200, { ok: true });
}

function handleChassisState(req, res) {
  send(res, 200, {
    gates: chassis.gates.slice(-50),
    killSwitch: chassis.killSwitch,
    runs: chassis.runs,
    audit: chassis.audit.slice(-100),
    reportCards: chassis.reportCards,
    mcpManifests: chassis.mcpManifests,
  });
}

async function handleGateRespond(req, res, id) {
  const { decision, note } = await readBody(req);
  const gate = chassis.gates.find((g) => g.id === id);
  if (!gate) return send(res, 404, { error: 'gate not found' });
  if (gate.status !== 'open') return send(res, 409, { error: 'gate already decided' });
  if (!['approve', 'deny'].includes(decision)) return send(res, 400, { error: 'decision must be approve|deny' });
  gate.status = decision;
  gate.decidedAt = new Date().toISOString();
  gate.decision = decision;
  gate.note = note || null;
  audit({ type: 'gate.decided', gateId: id, profileId: gate.profileId, decision, note: note || null });
  await saveState();
  send(res, 200, { ok: true, gate });
}

async function handleKillSwitch(req, res) {
  const { armed } = await readBody(req);
  chassis.killSwitch = !!armed;
  audit({ type: 'killswitch', armed: chassis.killSwitch });
  await saveState();
  send(res, 200, { ok: true, killSwitch: chassis.killSwitch });
}

async function handleMcpHandshake(req, res) {
  const { servers = [] } = await readBody(req);
  const results = [];
  for (const def of servers) {
    const name = def.name || def.command || def.url || 'server';
    const key = name;
    try {
      const conn = await connectServer({ ...def, name });
      const hash = hashTools(conn.tools);
      const prev = chassis.mcpManifests[key];
      const drift = prev && prev.hash !== hash;
      chassis.mcpManifests[key] = { hash, tools: conn.tools.length, at: new Date().toISOString() };
      if (!prev) audit({ type: 'mcp.baseline', server: key, hash, tools: conn.tools.length });
      if (drift) {
        audit({ type: 'mcp.drift', server: key, from: prev.hash, to: hash });
        const gate = {
          id: 'gate-' + crypto.randomBytes(4).toString('hex'),
          profileId: null, expectationId: null,
          label: `SCHEMA DRIFT — ${name}`,
          detail: `tool surface hash changed ${prev.hash} → ${hash} (${conn.tools.length} tools). Possible rug pull — review before allowing agents.`,
          status: 'open', raisedAt: new Date().toISOString(), decidedAt: null, decision: null, note: null,
        };
        chassis.gates.push(gate);
      }
      results.push({ name, ok: true, hash, tools: conn.tools.length, drift: !!drift, first: !prev });
      await conn.client.close().catch(() => {});
    } catch (e) {
      results.push({ name, ok: false, error: String(e.message || e) });
    }
  }
  send(res, 200, { servers: results, manifests: chassis.mcpManifests });
}


const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      raw += c;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/** Connect to one MCP server definition and return {client, transport, tools}. */
async function connectServer(def) {
  let transport;
  if (def.transport === 'http') {
    transport = new StreamableHTTPClientTransport(new URL(def.url));
  } else {
    if (!def.command) throw new Error('stdio server requires a command');
    transport = new StdioClientTransport({
      command: def.command,
      args: def.args || [],
      env: { ...process.env, ...(def.env || {}) },
      stderr: 'pipe',
    });
  }
  const client = new Client({ name: 'cleanroom-console', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, transport, tools: tools || [], name: def.name || 'server' };
}

function toolPrefix(serverName, toolName) {
  return `${serverName}__${toolName}`;
}

/** Normalize an MCP call result into a short text preview. */
function previewResult(result, max = 600) {
  try {
    const parts = (result?.content || [])
      .map((c) => (typeof c === 'string' ? c : c?.text ?? JSON.stringify(c)))
      .filter(Boolean);
    const text = parts.join('\n') || JSON.stringify(result).slice(0, max);
    return text.length > max ? text.slice(0, max) + ` … [+${text.length - max} chars]` : text;
  } catch {
    return '[unserializable tool result]';
  }
}

async function handleOllamaModels(req, res, url) {
  const base = (url.searchParams.get('baseUrl') || 'http://localhost:11434').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`${base}/api/tags`, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
    const data = await r.json();
    send(res, 200, { ok: true, baseUrl: base, models: (data.models || []).map((m) => m.name) });
  } catch (e) {
    send(res, 200, { ok: false, baseUrl: base, models: [], error: String(e.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

async function handleOllamaTest(req, res) {
  const { baseUrl = 'http://localhost:11434', model } = await readBody(req);
  const base = String(baseUrl).replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({ model, prompt: 'Say "ok" and nothing else.', stream: false }),
    });
    if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
    const data = await r.json();
    send(res, 200, { ok: true, sample: String(data.response || '').slice(0, 120) });
  } catch (e) {
    send(res, 200, { ok: false, error: String(e.message || e) });
  } finally {
    clearTimeout(timer);
  }
}

async function handleMcpConnect(req, res) {
  const { servers = [] } = await readBody(req);
  const results = [];
  for (const def of servers) {
    const name = def.name || def.command || def.url || 'server';
    try {
      const conn = await connectServer({ ...def, name });
      results.push({
        name,
        ok: true,
        tools: conn.tools.map((t) => ({
          name: t.name,
          prefixed: toolPrefix(name, t.name),
          description: t.description || '',
          inputSchema: t.inputSchema || { type: 'object', properties: {} },
        })),
      });
      await conn.client.close().catch(() => {});
    } catch (e) {
      results.push({ name, ok: false, error: String(e.message || e), tools: [] });
    }
  }
  send(res, 200, { servers: results });
}

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function handleRun(req, res) {
  const body = await readBody(req);
  const {
    llm = {},
    servers = [],
    prompt = '',
    maxRounds = MAX_ROUNDS,
  } = body;
  const base = String(llm.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const model = llm.model;
  const temperature = typeof llm.temperature === 'number' ? llm.temperature : 0.1;

  if (!model) return send(res, 400, { error: 'llm.model is required' });
  if (!prompt.trim()) return send(res, 400, { error: 'prompt is required' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const started = Date.now();
  const connections = new Map(); // name -> {client, tools}
  let toolCalls = 0;

  const cleanup = async () => {
    for (const conn of connections.values()) {
      await conn.client.close().catch(() => {});
    }
  };

  try {
    sse(res, 'meta', {
      model,
      baseUrl: base,
      temperature,
      serverNames: servers.map((s) => s.name || s.command || s.url),
      startedAt: new Date().toISOString(),
    });

    // 1. Connect to MCP servers and collect tools
    const ollamaTools = [];
    for (const def of servers) {
      const name = def.name || def.command || def.url || 'server';
      sse(res, 'status', { text: `connecting MCP server "${name}"…` });
      try {
        const conn = await connectServer({ ...def, name });
        connections.set(name, conn);
        for (const t of conn.tools) {
          ollamaTools.push({
            type: 'function',
            function: {
              name: toolPrefix(name, t.name),
              description: `[${name}] ${t.description || ''}`.slice(0, 1024),
              parameters: t.inputSchema || { type: 'object', properties: {} },
            },
          });
        }
        sse(res, 'status', { text: `"${name}" connected — ${conn.tools.length} tools` });
      } catch (e) {
        sse(res, 'error', { message: `MCP server "${name}" failed: ${String(e.message || e)}` });
      }
    }
    sse(res, 'tools', { count: ollamaTools.length });

    // 2. Agent loop against Ollama (OpenAI-compatible tool calling over /api/chat)
    const messages = [{ role: 'system', content: 'You are an autonomous agent with access to MCP tools. Use tools when they help answer the user. Be concise.' }];
    messages.push({ role: 'user', content: prompt });

    let finalContent = '';
    for (let round = 1; round <= maxRounds; round++) {
      sse(res, 'round', { n: round });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120_000);
      let resp;
      try {
        resp = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctrl.signal,
          body: JSON.stringify({
            model,
            messages,
            tools: ollamaTools.length ? ollamaTools : undefined,
            stream: false,
            options: { temperature },
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`LLM request failed: ${resp.status} ${text.slice(0, 300)}`);
      }
      const data = await resp.json();
      const msg = data.message || {};
      const calls = msg.tool_calls || [];

      if (!calls.length) {
        finalContent = msg.content || '';
        sse(res, 'assistant_delta', { text: finalContent });
        break;
      }

      messages.push(msg);
      for (const call of calls) {
        toolCalls += 1;
        const fn = call.function || {};
        const fullName = fn.name || '';
        const args = (() => { try { return JSON.parse(fn.arguments || '{}'); } catch { return {}; } })();
        const sep = fullName.indexOf('__');
        const serverName = sep > 0 ? fullName.slice(0, sep) : '';
        const toolName = sep > 0 ? fullName.slice(sep + 2) : fullName;
        sse(res, 'tool_call', { server: serverName, name: toolName, args, round });
        const conn = connections.get(serverName);
        if (!conn) {
          const err = `no connection for server "${serverName}"`;
          sse(res, 'tool_result', { server: serverName, name: toolName, ok: false, preview: err });
          messages.push({ role: 'tool', name: fullName, content: `Error: ${err}` });
          continue;
        }
        try {
          const result = await conn.client.callTool({ name: toolName, arguments: args });
          const text = previewResult(result);
          sse(res, 'tool_result', { server: serverName, name: toolName, ok: !result?.isError, preview: text });
          messages.push({ role: 'tool', name: fullName, content: text });
        } catch (e) {
          const err = String(e.message || e);
          sse(res, 'tool_result', { server: serverName, name: toolName, ok: false, preview: err });
          messages.push({ role: 'tool', name: fullName, content: `Error: ${err}` });
        }
      }
    }

    sse(res, 'done', {
      rounds: Math.min(maxRounds, messages.length),
      toolCalls,
      elapsedMs: Date.now() - started,
      content: finalContent,
      reachedRoundLimit: !finalContent,
    });
  } catch (e) {
    sse(res, 'error', { message: String(e.message || e) });
    sse(res, 'done', { rounds: 0, toolCalls, elapsedMs: Date.now() - started, content: '', reachedRoundLimit: false });
  } finally {
    await cleanup();
    res.end();
  }
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = path.join(DIST, pathname);
  if (!file.startsWith(DIST)) return send(res, 403, { error: 'forbidden' });
  try {
    const st = await stat(file);
    if (st.isDirectory()) return send(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': file.includes('assets') ? 'max-age=31536000, immutable' : 'no-cache',
    });
    createReadStream(file).pipe(res);
  } catch {
    // SPA fallback
    try {
      const html = await readFile(path.join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      send(res, 404, { error: 'not found' });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, service: 'chassis-console', time: new Date().toISOString() });
    if (url.pathname === '/api/ollama/models') return await handleOllamaModels(req, res, url);
    if (url.pathname === '/api/ollama/test' && req.method === 'POST') return await handleOllamaTest(req, res);
    if (url.pathname === '/api/mcp/connect' && req.method === 'POST') return await handleMcpConnect(req, res);
    if (url.pathname === '/api/mcp/handshake' && req.method === 'POST') return await handleMcpHandshake(req, res);
    if (url.pathname === '/api/run' && req.method === 'POST') return await handleRun(req, res);
    if (url.pathname === '/api/profiles' && req.method === 'GET') return await handleProfilesList(req, res);
    const profileMatch = url.pathname.match(/^\/api\/profiles\/([a-z0-9-]+)$/);
    if (profileMatch && req.method === 'GET') return await handleProfileGet(req, res, profileMatch[1]);
    if (profileMatch && req.method === 'POST') return await handleProfileSave(req, res, profileMatch[1]);
    if (url.pathname === '/api/chassis/run' && req.method === 'POST') return await handleChassisRun(req, res);
    if (url.pathname === '/api/chassis/state' && req.method === 'GET') return handleChassisState(req, res);
    if (url.pathname === '/api/chassis/killswitch' && req.method === 'POST') return await handleKillSwitch(req, res);
    const gateMatch = url.pathname.match(/^\/api\/chassis\/gates\/([a-z0-9-]+)\/respond$/);
    if (gateMatch && req.method === 'POST') return await handleGateRespond(req, res, gateMatch[1]);
    if (req.method === 'GET') return await serveStatic(req, res, url);
    send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) send(res, 500, { error: String(e.message || e) });
    else res.end();
  }
});

await loadProfiles();
await loadState();
audit({ type: 'chassis.boot', profiles: [...chassis.profiles.keys()], restored: { gates: chassis.gates.length, killSwitch: chassis.killSwitch } });

/* --------------------- scheduler + dead-man's switch --------------------- */
// Scheduled sweeps: each profile runs at its shortest expectation schedule.
// The dead-man's switch raises a gate when a profile goes quiet beyond 2x its
// window — unless the kill switch is armed (blocked sweeps are intentional).
const SCHEDULER_TICK_MS = 30_000;
setInterval(() => {
  const now = Date.now();
  for (const p of chassis.profiles.values()) {
    const windowMs = Math.min(...p.expectations.map((e) => parseScheduleMs(e.schedule)));
    const last = chassis.lastRunAt[p.id] || 0;
    if (last && now - last > windowMs * 2 && !chassis.killSwitch) {
      raiseGate({
        profileId: p.id,
        expectationId: '__deadman__',
        label: `DEAD MAN'S SWITCH — ${p.name} silent`,
        detail: `No sweep completed for ${Math.round((now - last) / 1000)}s (window ${Math.round(windowMs / 1000)}s). The scheduler may be stuck.`,
      });
    }
    if (!last || now - last >= windowMs) {
      // fire a sweep without a client connection: reuse the same primitives
      audit({ type: 'run.scheduled', profileId: p.id });
      (async () => {
        const results = [];
        const canary = await runExpectation(CANARY);
        if (canary.ok) {
          raiseGate({
            profileId: p.id, expectationId: '__canary__',
            label: 'MONITORING CANARY ALIVE — runner untrustworthy',
            detail: `Canary probe was expected to fail but passed. Results this sweep cannot be trusted.`,
          });
          return;
        }
        for (const e of p.expectations) results.push(await runExpectation(e));
        applyPolicy(p, results);
        chassis.runs += 1;
        chassis.lastRunAt[p.id] = Date.now();
        audit({ type: 'run.complete', profileId: p.id, trigger: 'schedule', results: results.map((r) => ({ id: r.id, ok: r.ok })) });
        await saveState();
      })().catch((e) => audit({ type: 'run.scheduled_failed', profileId: p.id, error: String(e.message || e) }));
    }
  }
}, SCHEDULER_TICK_MS).unref();

server.listen(PORT, () => {
  console.log(`CHASSIS console backend: http://localhost:${PORT} — profiles: ${[...chassis.profiles.keys()].join(', ')}`);
});
