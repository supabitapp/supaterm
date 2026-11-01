import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
  createVcsStatusRevalidationAtomFamily,
} from "@supaterm/client-runtime/state/vcs";
import { createEnvironmentRpcCommand } from "@supaterm/client-runtime/state/runtime";
import { WS_METHODS } from "@supaterm/contracts";

import { connectionAtomRuntime } from "../connection/runtime";
import { subscribeDocumentReturn } from "../lib/documentActivity";

export const vcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);
export const fetchVcsRefs = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "web:vcs:fetch-refs",
  tag: WS_METHODS.vcsListRefs,
});

/**
 * Refreshes a checkout's status when the user comes back to the window, where
 * edits made in another app or terminal may be waiting.
 */
export const vcsStatusRevalidation = createVcsStatusRevalidationAtomFamily({
  refreshStatus: vcsEnvironment.refreshStatus,
  subscribeWake: subscribeDocumentReturn,
  wakeDebounceMs: 250,
});
