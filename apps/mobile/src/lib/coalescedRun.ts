export function coalescedRun(run: () => Promise<void>): () => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const start = (): Promise<void> => {
    if (inFlight) {
      queued ??= inFlight
        .catch(() => undefined)
        .then(() => {
          queued = null;
          return start();
        });
      return queued;
    }
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
  return start;
}
