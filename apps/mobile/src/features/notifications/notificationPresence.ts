const visibleThreads = new Map<string, number>();

const threadKey = (environmentId: string, threadId: string) =>
  JSON.stringify([environmentId, threadId]);

/** Foreground alerts for a thread already on screen are dropped instead of shown as banners. */
export function markPushThreadVisible(environmentId: string, threadId: string): () => void {
  const key = threadKey(environmentId, threadId);
  visibleThreads.set(key, (visibleThreads.get(key) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (visibleThreads.get(key) ?? 1) - 1;
    if (count <= 0) visibleThreads.delete(key);
    else visibleThreads.set(key, count);
  };
}

export function isPushThreadVisible(environmentId: string, threadId: string): boolean {
  return visibleThreads.has(threadKey(environmentId, threadId));
}
