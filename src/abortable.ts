// Both OAuth refresh dedup (auth.ts) and usage-fetch dedup (usage.ts) share one
// in-flight promise across concurrent callers. A caller awaiting with an
// AbortSignal must stop waiting when its signal fires, without disturbing the
// shared operation for other callers.
//
// `onAbort` decides the aborted caller's outcome: return a value to resolve
// with it, throw to reject. The shared promise itself is never cancelled.
export function waitForSharedPromise<T>(
  shared: Promise<T>,
  signal: AbortSignal | undefined,
  onAbort: () => T,
): Promise<T> {
  if (!signal) return shared;

  const pending = Promise.withResolvers<T>();
  let settled = false;
  const cleanup = () => signal.removeEventListener("abort", onAbortEvent);
  const finish = (value: T) => {
    if (settled) return;
    settled = true;
    cleanup();
    pending.resolve(value);
  };
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    cleanup();
    pending.reject(error);
  };
  const onAbortEvent = () => {
    try {
      finish(onAbort());
    } catch (error) {
      fail(error);
    }
  };

  if (signal.aborted) {
    onAbortEvent();
    return pending.promise;
  }

  signal.addEventListener("abort", onAbortEvent, { once: true });
  void shared.then(finish, fail);
  return pending.promise;
}
