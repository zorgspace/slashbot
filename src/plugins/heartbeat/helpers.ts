export function parseInterval(value: string): number {
  const match = value.match(/^(\d+)\s*(m|min|h|hr|s|sec)?$/i);
  if (!match) return 30 * 60_000; // default 30m
  const num = Number(match[1]);
  const unit = (match[2] ?? 'm').toLowerCase();
  if (unit.startsWith('h')) return num * 60 * 60_000;
  if (unit.startsWith('s')) return num * 1000;
  return num * 60_000;
}

export function formatIntervalHuman(ms: number): string {
  if (ms >= 3_600_000) {
    const h = ms / 3_600_000;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  if (ms >= 60_000) {
    const m = ms / 60_000;
    return m === 1 ? '1 minute' : `${m} minutes`;
  }
  const s = ms / 1000;
  return s === 1 ? '1 second' : `${s} seconds`;
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) {
    const absDiff = -diff;
    if (absDiff < 60_000) return `in ${Math.round(absDiff / 1000)}s`;
    if (absDiff < 3_600_000) return `in ${Math.round(absDiff / 60_000)}m`;
    return `in ${Math.round(absDiff / 3_600_000)}h`;
  }
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

export function classifyResponse(response: string): 'ok' | 'alert' | 'warning' {
  const first = response.slice(0, 30).toUpperCase();
  if (first.startsWith('[OK]')) return 'ok';
  if (first.startsWith('[ALERT]')) return 'alert';
  if (first.startsWith('[WARNING]')) return 'warning';
  // Keyword fallback
  if (/\b(error|critical|fail|down|outage)\b/i.test(response)) return 'alert';
  if (/\b(warn|degrad|slow|attention)\b/i.test(response)) return 'warning';
  return 'ok';
}
