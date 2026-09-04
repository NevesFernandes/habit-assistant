// Hand-rolled completion-% ring (no charting library — see §17 in Roadmap.md,
// user-confirmed 2026-09-02: the chart surface area here doesn't justify a dependency).
interface MeterProps {
  percentage: number; // 0-100
  label: string;
  size?: number;
}

export default function Meter({ percentage, label, size = 96 }: MeterProps) {
  const clamped = Math.min(100, Math.max(0, percentage));
  const radius = size / 2 - 8;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  const center = size / 2;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth={8} className="text-slate-700" />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="text-violet-500"
        />
        <text
          x={center}
          y={center}
          textAnchor="middle"
          dominantBaseline="middle"
          className="rotate-90 fill-slate-100 text-lg font-medium"
          style={{ transformOrigin: "center", transformBox: "fill-box" }}
        >
          {clamped}%
        </text>
      </svg>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
