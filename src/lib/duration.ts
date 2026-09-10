function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDuration(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  let result = "";
  if (h > 0) result += `${h}h`;
  if (h > 0 || m > 0) result += `${pad2(m)}m`;
  result += `${pad2(s)}s`;
  return result;
}

export function formatDurationMinutes(totalMinutes: number): string {
  return formatDuration(totalMinutes * 60);
}
