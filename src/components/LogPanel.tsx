import { useEffect, useRef } from 'react';

export interface LogLine {
  ts: string;
  kind: 'run' | 'gate' | 'ok' | 'audit' | 'info';
  text: string;
}

export default function LogPanel({ lines, title }: { lines: LogLine[]; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="panel" style={{ height: 190, flex: 'none' }}>
      <div className="panel-head">
        <span className="led accent" />
        {title}
        <span className="spacer" />
        {lines.length} EVENTS
      </div>
      <div className="panel-body" ref={ref} style={{ overflowY: 'auto', padding: '4px 0' }}>
        {lines.map((l, i) => (
          <div className="log-line" key={i}>
            <span className="ts">{l.ts}</span>
            <span className={`t-${l.kind}`}>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
