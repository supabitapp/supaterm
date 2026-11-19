class PendingDraftWork {
  private readonly counts = new Map<string, number>();
  private readonly settledWaiters = new Map<string, Array<() => void>>();

  begin(draftKey: string) {
    this.counts.set(draftKey, (this.counts.get(draftKey) ?? 0) + 1);
  }

  end(draftKey: string) {
    const remaining = (this.counts.get(draftKey) ?? 0) - 1;
    if (remaining > 0) {
      this.counts.set(draftKey, remaining);
      return;
    }
    this.counts.delete(draftKey);
    const waiters = this.settledWaiters.get(draftKey) ?? [];
    this.settledWaiters.delete(draftKey);
    for (const resolve of waiters) resolve();
  }

  whenSettled(draftKey: string) {
    if (!this.has(draftKey)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.settledWaiters.set(draftKey, [...(this.settledWaiters.get(draftKey) ?? []), resolve]);
    });
  }

  has(draftKey: string) {
    return (this.counts.get(draftKey) ?? 0) > 0;
  }
}

export const pendingDraftWork = new PendingDraftWork();
