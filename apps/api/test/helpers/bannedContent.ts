/**
 * Patterns that must never appear anywhere in the public `/status` response (body or headers).
 * Whole-word matches where a substring would hit legitimate words ("sha" vs "publishing",
 * "version" vs nothing we emit, "host" vs "ghost"); `bd_` and clock-time stay substring/shape
 * matches because any occurrence is a leak. Add to this list when a new kind of leak is thought of.
 */
export const BANNED: { name: string; re: RegExp }[] = [
  { name: 'memory figures', re: /\b(rss|peak|mib|gib|memory|mem|oom|heap)\b/i },
  { name: 'retry/attempt', re: /\b(attempts?|retry|retries)\b/i },
  { name: 'build identity', re: /\b(sha|versions?|commit|build)\b|\b[0-9a-f]{7,40}\b/i },
  { name: 'internal phase', re: /bd_|serving_profile|train_profile|row_counts|feature_|val_scoring|metrics_online/i },
  { name: 'host/infra names', re: /\b(hosts?|hostname|containers?|docker|compose|asharpc|tailscale|localhost)\b/i },
  { name: 'stack', re: /\b(postgres(ql)?|timescale(db)?|pg|cloudflare|cloudflared|tunnel|caddy|node|express|linux|ubuntu|windows|darwin)\b/i },
  { name: 'errors', re: /\b(error|exception|traceback|stack|enoent|econn\w*)\b/i },
  { name: 'rate limit', re: /\bratelimit|retry-after|\b429\b/i },
  { name: 'time of day', re: /\d{1,2}:\d{2}/ },
  { name: 'schedule', re: /\bcron|\b(0?3:30)\b|\bAmerica\/|\b[ECMP][SD]T\b|\bUTC\b/i },
];

export function bannedHits(text: string): string[] {
  return BANNED.filter((b) => b.re.test(text)).map((b) => `${b.name}: ${text.match(b.re)?.[0]}`);
}
