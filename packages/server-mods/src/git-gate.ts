const tails = new Map<string, Promise<unknown>>();

/**
 * Runs `fn` after every earlier call with the same key has settled, so two git writes on one repo
 * (keyed by its common dir, shared by its worktrees) never race for `index.lock`. In-process only.
 */
export function withRepoGate<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.then(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return next;
}

/** Keys queued or running; for tests. */
export const gateSize = () => tails.size;
