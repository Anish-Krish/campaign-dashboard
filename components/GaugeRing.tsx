export function GaugeRing({
  percent,
  size = 52,
  stroke = 5,
}: {
  percent: number;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={center} cy={center} r={r} stroke="var(--gridline)" strokeWidth={stroke} fill="none" />
      <circle
        cx={center}
        cy={center}
        r={r}
        stroke="var(--series-blue)"
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ filter: "drop-shadow(0 0 4px var(--series-blue))", transition: "stroke-dashoffset 300ms ease" }}
      />
    </svg>
  );
}
