interface Item {
  key: string;
  html: string;
}

export default function Ticker({ items }: { items: Item[] }) {
  const row = items.map((i) => (
    <span className="ticker-item" key={i.key} dangerouslySetInnerHTML={{ __html: i.html }} />
  ));
  return (
    <div className="ticker">
      <div className="ticker-track">
        {row}
        {row.map((r, i) => (
          <span key={`dup-${i}`} style={{ display: 'contents' }}>{r}</span>
        ))}
      </div>
    </div>
  );
}
