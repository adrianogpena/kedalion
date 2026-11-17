// Idea from filebrowser's pathCoalescer (https://github.com/gtsteffaniak/filebrowser,
// backend/pkg/indexing/coalesce.go), Apache-2.0. Changes: TypeScript, promise based, merges queued arguments,
// and the key is always released (try/finally) so a throwing job doesn't block later ones.

/**
 * Runs `job` at most once at a time per key; calls made while it runs collapse into one more run after it,
 * with their arguments merged by `merge` (default: the latest wins). Each call resolves when the run that
 * covers it has finished; it rejects when that run throws.
 */
export function coalescer<A>(job: (arg: A, key: string) => Promise<void>, merge: (queued: A, next: A) => A = (_q, next) => next) {
  const slots = new Map<string, { queued?: { arg: A; done: Promise<void>; release: () => void; fail: (e: unknown) => void } }>();

  const drain = async (key: string, arg: A) => {
    const slot = slots.get(key)!;
    try {
      await job(arg, key);
    } finally {
      const next = slot.queued;
      slot.queued = undefined;
      if (next) {
        drain(key, next.arg).then(next.release, next.fail);
      } else slots.delete(key);
    }
  };

  return (arg: A, key = ''): Promise<void> => {
    const slot = slots.get(key);
    if (!slot) {
      slots.set(key, {});
      return drain(key, arg);
    }
    if (slot.queued) {
      slot.queued.arg = merge(slot.queued.arg, arg);
      return slot.queued.done;
    }
    let release!: () => void;
    let fail!: (e: unknown) => void;
    const done = new Promise<void>((res, rej) => {
      release = res;
      fail = rej;
    });
    slot.queued = { arg, done, release, fail };
    return done;
  };
}
