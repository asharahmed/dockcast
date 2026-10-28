/**
 * One value, recomputed at most once per `ttlMs`, shared by every caller. Concurrent callers during
 * a recompute share one in-flight promise (single-flight), so a burst of requests costs one set of
 * database queries. `compute` must not reject; callers turn failures into a value.
 */
export interface SnapshotCache<T> {
  get(): Promise<T>;
}

export function createSnapshotCache<T>(
  compute: () => Promise<T>,
  ttlMs: number,
  clock: () => number,
): SnapshotCache<T> {
  let value: { at: number; v: T } | null = null;
  let inflight: Promise<T> | null = null;
  return {
    get(): Promise<T> {
      if (value && clock() - value.at < ttlMs) return Promise.resolve(value.v);
      if (inflight) return inflight;
      const startedAt = clock();
      inflight = compute()
        .then((v) => {
          value = { at: startedAt, v };
          return v;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
