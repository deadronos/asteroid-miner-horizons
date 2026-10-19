// Duration and countdown text shared by the sim, HUD and balance report.

export interface DurationOptions {
  /** Show a seconds component when the value is under an hour. Default false. */
  seconds?: boolean;
}

/** `3h 05m`, `12m`, `0m`, or with `seconds` `12m 30s` / `45s`. Hours always drop seconds. */
export function formatDuration(sec: number, opts: DurationOptions = {}): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (opts.seconds) return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
  return `${m}m`;
}

/** `m:ss`, rounding seconds up and clamping at zero. */
export function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
