import { useAtomValue } from "@effect/atom-react";
import { enabledEnvironmentIds } from "@supaterm/client-runtime/state/connections";
import { parseThreadKey, threadKey } from "@supaterm/client-runtime/state/entities";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  createRunningThreadKeepAliveAtom,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  createThreadEnvironmentAtoms,
} from "@supaterm/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { scopedThreadKey } from "../lib/scopedEntities";
import { pendingThreadCreationOutcomesAtom } from "./pending-thread-creation";
import { environmentSnapshotAtom } from "./shell";
import { threadOutboxManager } from "./thread-outbox";

export const threadEnvironment = createThreadEnvironmentAtoms(
  connectionAtomRuntime,
  environmentSnapshotAtom,
);
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: threadEnvironment.snapshotAtom,
});

const creationReadyAtom = Atom.family((key: string) => {
  const ref = parseThreadKey(key);
  const creationKey = scopedThreadKey(ref.environmentId, ref.threadId);
  return Atom.make((get) => {
    if (get(environmentThreadShells.threadShellAtom(ref)) !== null) return true;
    const outcome = get(pendingThreadCreationOutcomesAtom)[creationKey];
    if (outcome?.kind === "delivered") return true;
    const queued = get(threadOutboxManager.queuedMessagesByThreadKeyAtom)[creationKey];
    return outcome === undefined && !queued?.some((message) => message.creation !== undefined);
  }).pipe(Atom.setIdleTTL(0));
});

export const environmentThreads = createEnvironmentThreadStateAtoms(
  connectionAtomRuntime,
  (environmentId, threadId) => creationReadyAtom(threadKey({ environmentId, threadId })),
);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);

export const runningThreadKeepAliveAtom = createRunningThreadKeepAliveAtom({
  environmentIdsAtom: Atom.map(environmentCatalog.catalogValueAtom, (catalog) => [
    ...enabledEnvironmentIds(catalog),
  ]),
  threadsAtom: environmentThreadShells.environmentThreadsAtom,
  stateAtom: environmentThreads.stateAtom,
});

const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)).pipe(
  Atom.withLabel("mobile-environment-thread:empty"),
);

export function useEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? environmentThreads.stateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  const state = Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
  return state;
}
