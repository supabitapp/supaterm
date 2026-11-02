import { enabledEnvironmentIds } from "@supaterm/client-runtime/state/connections";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  createRunningThreadKeepAliveAtom,
  createOlderDoneThreadAtoms,
} from "@supaterm/client-runtime/state/threads";
import { withOptimisticThreadCreations } from "@supaterm/client-runtime/state/thread-creation";
import type { EnvironmentId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { directThreadEnvironment, threadFamilies } from "./threadCommands";
import { createThreadDetailReadiness } from "./threadDetailReadiness";
import { undeliveredCreationShell } from "./pendingThreadCreation";
import { webThreadOutbox } from "./threadOutbox";
import { environmentShell } from "./shell";

export { threadFamilies };
export const olderDoneThreads = createOlderDoneThreadAtoms(
  connectionAtomRuntime,
  environmentShell.stateAtom,
);
export const threadEnvironment = directThreadEnvironment;
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: threadEnvironment.snapshotAtom,
});

const threadDetailReadyAtom = createThreadDetailReadiness(environmentThreadShells.threadShellAtom);
const environmentThreads = createEnvironmentThreadStateAtoms(
  connectionAtomRuntime,
  (environmentId, threadId) => threadDetailReadyAtom({ environmentId, threadId }),
);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);
// A send waits on local storage before startTurn runs; its outbox entry shows the thread meanwhile.
const sidebarSnapshotAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) =>
    withOptimisticThreadCreations(
      get(threadEnvironment.sidebarSnapshotAtom(environmentId)),
      get(webThreadOutbox.entriesAtom).flatMap((entry) =>
        entry.payload.environmentId === environmentId
          ? (undeliveredCreationShell(entry) ?? [])
          : [],
      ),
    ),
  ),
);
export const sidebarThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: sidebarSnapshotAtom,
});

export const runningThreadKeepAliveAtom = createRunningThreadKeepAliveAtom({
  environmentIdsAtom: Atom.map(environmentCatalog.catalogValueAtom, (catalog) => [
    ...enabledEnvironmentIds(catalog),
  ]),
  threadsAtom: environmentThreadShells.environmentThreadsAtom,
  stateAtom: environmentThreads.stateAtom,
});
