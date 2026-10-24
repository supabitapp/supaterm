import { enabledEnvironmentIds } from "@supaterm/client-runtime/state/connections";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  createRunningThreadKeepAliveAtom,
} from "@supaterm/client-runtime/state/threads";
import type { EnvironmentId } from "@supaterm/contracts";
import { threadNotificationAttentionByThread } from "@supaterm/shared/threadNotificationAttention";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { directThreadEnvironment } from "./threadCommands";
import { createThreadDetailReadiness } from "./threadDetailReadiness";

export const threadEnvironment = directThreadEnvironment;
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: threadEnvironment.snapshotAtom,
});
export const environmentThreadAttentionAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.map(environmentThreadShells.environmentThreadsAtom(environmentId), (threads) =>
    threadNotificationAttentionByThread(threads),
  ).pipe(Atom.withLabel(`web-environment-thread-attention:${environmentId}`)),
);
const threadDetailReadyAtom = createThreadDetailReadiness(environmentThreadShells.threadShellAtom);
const environmentThreads = createEnvironmentThreadStateAtoms(
  connectionAtomRuntime,
  (environmentId, threadId) => threadDetailReadyAtom({ environmentId, threadId }),
);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);
export const sidebarThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: threadEnvironment.sidebarSnapshotAtom,
});

export const runningThreadKeepAliveAtom = createRunningThreadKeepAliveAtom({
  environmentIdsAtom: Atom.map(environmentCatalog.catalogValueAtom, (catalog) => [
    ...enabledEnvironmentIds(catalog),
  ]),
  threadsAtom: environmentThreadShells.environmentThreadsAtom,
  stateAtom: environmentThreads.stateAtom,
});
