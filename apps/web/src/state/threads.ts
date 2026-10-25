import { enabledEnvironmentIds } from "@supaterm/client-runtime/state/connections";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  createRunningThreadKeepAliveAtom,
  createOlderDoneThreadAtoms,
} from "@supaterm/client-runtime/state/threads";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
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
/** Keeps the subagent tree under `rootThreadId` in the thread list while the caller shows it. */
export function useThreadFamily(
  environmentId: EnvironmentId | null,
  rootThreadId: ThreadId | null,
): void {
  useEffect(() => {
    if (environmentId === null || rootThreadId === null) return;
    return threadFamilies.mount(appAtomRegistry, environmentId, rootThreadId);
  }, [environmentId, rootThreadId]);
}

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
