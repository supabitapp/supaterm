import { useAtomValue } from "@effect/atom-react";
import {
  parseScopedThreadKey,
  scopeThreadRef,
  scopedThreadKey,
} from "@supaterm/client-runtime/environment";
import { type EnvironmentId, type ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import {
  applyPreviewServerEvent,
  previewStateAtom,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
} from "~/previewStateStore";
import { isElectron } from "~/env";
import { previewEnvironment } from "~/state/preview";

class PreviewSessionThreadKeyParseError extends Schema.TaggedError<PreviewSessionThreadKeyParseError>()(
  "PreviewSessionThreadKeyParseError",
  { threadKey: Schema.String },
) {
  override get message() {
    return `Invalid scoped preview thread key: ${this.threadKey}`;
  }
}

const previewSessionSyncAtom = Atom.family((threadKey: string) => {
  const threadRef = parseScopedThreadKey(threadKey);
  if (threadRef === null) {
    throw new PreviewSessionThreadKeyParseError({ threadKey });
  }

  const sessionsAtom = previewEnvironment.list({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId },
  });
  const eventsAtom = previewEnvironment.events({
    environmentId: threadRef.environmentId,
    input: {},
  });

  return Atom.make((get) => {
    let disposed = false;
    let eventsVersion = 0;

    const reconcileSessions = (result: Atom.Type<typeof sessionsAtom>) => {
      if (result.waiting || !AsyncResult.isSuccess(result)) return;
      reconcilePreviewServerSessions(threadRef, result.value);
      if (!readThreadPreviewState(threadRef).listLoaded) {
        queueMicrotask(() => {
          if (!disposed) get.refresh(sessionsAtom);
        });
      }
    };

    const applyLatestEvent = (result: Atom.Type<typeof eventsAtom>) => {
      if (!AsyncResult.isSuccess(result) || result.value.threadId !== threadRef.threadId) return;
      const currentEpoch = readThreadPreviewState(threadRef).serverEpoch;
      if (currentEpoch !== null && currentEpoch !== result.value.serverEpoch) {
        get.refresh(sessionsAtom);
        return;
      }
      applyPreviewServerEvent(threadRef, result.value);
    };

    get.addFinalizer(() => {
      disposed = true;
    });
    const initialEvent = get.once(eventsAtom);

    get.once(sessionsAtom);
    get.subscribe(sessionsAtom, (result) => {
      reconcileSessions(result);
    });
    get.subscribe(eventsAtom, (result) => {
      eventsVersion += 1;
      applyLatestEvent(result);
    });
    get.mount(sessionsAtom);
    get.mount(eventsAtom);
    queueMicrotask(() => {
      if (disposed) return;
      const current = get.once(sessionsAtom);
      if (!AsyncResult.isInitial(current) && !current.waiting) get.refresh(sessionsAtom);
      if (eventsVersion === 0) applyLatestEvent(initialEvent);
    });
  }).pipe(Atom.setIdleTTL(1_000), Atom.withLabel(`preview:session-sync:${threadKey}`));
});

export function usePreviewSession(threadRef: ScopedThreadRef) {
  useAtomValue(previewSessionSyncAtom(scopedThreadKey(threadRef)));
}

const inactiveAtom = Atom.make(() => undefined);

const desktopHostedPreviewSyncAtom = Atom.family((environmentId: EnvironmentId) => {
  const eventsAtom = previewEnvironment.events({ environmentId, input: {} });
  return Atom.make((get) => {
    const releaseByThreadId = new Map<string, () => void>();
    get.addFinalizer(() => {
      for (const release of releaseByThreadId.values()) release();
    });
    get.subscribe(
      eventsAtom,
      (result) => {
        if (!AsyncResult.isSuccess(result) || result.value.type === "closed") return;
        const threadId = result.value.threadId;
        if (releaseByThreadId.has(threadId)) return;
        const threadKey = scopedThreadKey(scopeThreadRef(environmentId, ThreadId.make(threadId)));
        const unmount = get.registry.mount(previewSessionSyncAtom(threadKey));
        let hadSessions = false;
        const unwatch = get.registry.subscribe(
          previewStateAtom(threadKey),
          (state) => {
            if (Object.keys(state.sessions).length > 0) hadSessions = true;
            else if (hadSessions && state.suppressedTabIds.size === 0) release();
          },
          { immediate: true },
        );
        function release() {
          unwatch();
          unmount();
          releaseByThreadId.delete(threadId);
        }
        releaseByThreadId.set(threadId, release);
      },
      { immediate: true },
    );
  }).pipe(Atom.withLabel(`preview:desktop-hosted-sync:${environmentId}`));
});

export function useDesktopHostedPreviewSessions(environmentId: EnvironmentId | null) {
  useAtomValue(
    isElectron && environmentId !== null
      ? desktopHostedPreviewSyncAtom(environmentId)
      : inactiveAtom,
  );
}
