import type { MessageId, ScopedThreadRef } from "@supaterm/contracts";
import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { MessageJump } from "@supaterm/client-runtime/message-jump";

export interface ThreadMessageNavigation extends MessageJump {
  readonly threadRef: ScopedThreadRef;
  readonly query: string;
}

let sequence = 0;
const pending = new Map<string, ThreadMessageNavigation>();
const listeners = new Set<(request: ThreadMessageNavigation) => void>();

export function requestThreadMessageNavigation(
  threadRef: ScopedThreadRef,
  messageId: MessageId,
  query: string,
): void {
  const request = { threadRef, messageId, query, key: ++sequence };
  const key = scopedThreadKey(threadRef);
  pending.delete(key);
  pending.set(key, request);
  if (pending.size > 32) pending.delete(pending.keys().next().value!);
  for (const listener of listeners) listener(request);
}

export function takeThreadMessageNavigation(
  threadRef: ScopedThreadRef,
): ThreadMessageNavigation | null {
  const key = scopedThreadKey(threadRef);
  const request = pending.get(key) ?? null;
  pending.delete(key);
  return request;
}

export function subscribeThreadMessageNavigation(
  listener: (request: ThreadMessageNavigation) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
