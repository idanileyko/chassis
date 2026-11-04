import type { ChassisEvent, ChassisState, Profile, ProfileSummary } from './types';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) throw new Error(`${r.status} ${await r.text().catch(() => '')}`);
  return r.json() as Promise<T>;
}

export function checkBackend(): Promise<{ ok: boolean }> {
  return req<{ ok: boolean }>('/api/health').catch(() => ({ ok: false }));
}

export function fetchProfiles(): Promise<{ profiles: ProfileSummary[] }> {
  return req('/api/profiles');
}

export function fetchProfile(id: string): Promise<{ profile: Profile; reportCards: Record<string, unknown>; gates: unknown[] }> {
  return req(`/api/profiles/${id}`);
}

export function fetchChassisState(): Promise<ChassisState> {
  return req('/api/chassis/state');
}

export function respondGate(id: string, decision: 'approve' | 'deny', note?: string): Promise<{ ok: boolean }> {
  return req(`/api/chassis/gates/${id}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision, note }),
  });
}

export function setKillSwitch(armed: boolean): Promise<{ ok: boolean; killSwitch: boolean }> {
  return req<{ ok: boolean; killSwitch: boolean }>('/api/chassis/killswitch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ armed }),
  });
}

export async function runProbes(profileId: string, onEvent: (e: ChassisEvent) => void): Promise<void> {
  const r = await fetch('/api/chassis/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId }),
  });
  if (!r.ok || !r.body) throw new Error(`run failed: ${r.status}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop() || '';
    for (const f of frames) {
      const lines = f.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        const payload = JSON.parse(dataLine.slice(6));
        payload.type = eventLine ? eventLine.slice(7) : payload.type;
        onEvent(payload);
      } catch { /* ignore malformed frame */ }
    }
  }
}
