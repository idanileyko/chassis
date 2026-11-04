export type Severity = 'info' | 'warning' | 'critical';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';
export type Primitive = 'http' | 'sql' | 'cli' | 'file' | 'metric';

export interface RoomNode {
  id: string;
  label: string;
  detail?: string;
  kind?: string;
  persona?: string;
  tools?: string[];
}

export interface Expectation {
  id: string;
  primitive: Primitive;
  label: string;
  target?: string;
  assert?: Record<string, unknown>;
  severity: Severity;
  schedule?: string;
}

export interface Profile {
  id: string;
  name: string;
  kind: string;
  description?: string;
  rooms: { readers: RoomNode[]; advisors: RoomNode[] };
  expectations: Expectation[];
  advisorPolicy: {
    maxTools: number;
    scopes: string[];
    forbidden: string[];
    budgetPerRunTokens: number;
  };
  gates: { criticalRequiresHuman: boolean; maxOpen: number };
  oracle: { rubrics: { id: string; label: string; gradeBands: Record<string, number> }[] };
}

export interface ProfileSummary {
  id: string;
  name: string;
  kind: string;
  description?: string;
  expectations: number;
  readers: number;
  advisors: number;
}

export interface ProbeResult {
  id: string;
  label: string;
  primitive: Primitive;
  severity: Severity;
  at: string;
  ok: boolean;
  value?: number | string | null;
  latencyMs?: number;
  detail: string;
  band: 'pass' | 'warn' | 'hard';
  skipped?: boolean;
  state?: string;
}

export interface ReportCard extends ProbeResult {
  grade: Grade;
  score: number;
  rubric: string;
}

export interface Gate {
  id: string;
  profileId: string | null;
  expectationId: string | null;
  label: string;
  detail: string;
  status: 'open' | 'approve' | 'deny';
  raisedAt: string;
  decidedAt: string | null;
  decision: string | null;
  note: string | null;
}

export interface AuditEntry {
  at: string;
  type: string;
  [k: string]: unknown;
}

export interface ChassisState {
  gates: Gate[];
  killSwitch: boolean;
  runs: number;
  audit: AuditEntry[];
  reportCards: Record<string, Record<string, ReportCard>>;
  mcpManifests: Record<string, { hash: string; tools: number; at: string }>;
}

export type ChassisEvent =
  | { type: 'meta'; profileId: string; name: string; at: string; event_v?: number }
  | { type: 'status'; text: string }
  | ({ type: 'probe'; state: 'running' } & Partial<ProbeResult>)
  | ({ type: 'probe'; state: 'done' } & ProbeResult)
  | { type: 'canary'; ok: boolean; expected: boolean; detail: string; label: string }
  | { type: 'gate' } & Gate
  | { type: 'oracle'; cards: ReportCard[] }
  | { type: 'done'; blocked: boolean; elapsedMs: number; gatesRaised?: number; runs?: number }
  | { type: 'error'; message: string };

export type ThemeName = 'intelligence' | 'tactical' | 'light';
