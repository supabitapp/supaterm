import { useEffect } from "react";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { threadFamilies } from "./threadCommands";
export { threadFamilies, olderSettledThreads } from "./threadCommands";
import { enabledEnvironmentIds } from "@supaterm/client-runtime/state/connections";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  createRunningThreadKeepAliveAtom,
} from "@supaterm/client-runtime/state/threads";
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

export function useThreadFamily(
  environmentId: EnvironmentId | null,
  rootThreadId: ThreadId | null,
): void {
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- retains the visible pane's remote thread family until the pane leaves
  useEffect(() => {
    if (environmentId === null || rootThreadId === null) return;
    return threadFamilies.mount(appAtomRegistry, environmentId, rootThreadId);
  }, [environmentId, rootThreadId]);
}
