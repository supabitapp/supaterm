import { enabledEnvironmentIds } from "@supaterm/client-runtime/state/connections";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  createRunningThreadKeepAliveAtom,
  createOlderDoneThreadAtoms,
} from "@supaterm/client-runtime/state/threads";
import { Atom } from "effect/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { directThreadEnvironment, threadFamilies } from "./threadCommands";
import { createThreadDetailReadiness } from "./threadDetailReadiness";
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
