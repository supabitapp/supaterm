import {
  createThreadFamilyAtoms,
  createOlderSettledThreadAtoms,
  createThreadEnvironmentAtoms,
} from "@supaterm/client-runtime/state/threads";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentShell } from "./shell";

export const threadFamilies = createThreadFamilyAtoms(
  connectionAtomRuntime,
  environmentShell.stateAtom,
);
export const olderSettledThreads = createOlderSettledThreadAtoms(
  connectionAtomRuntime,
  environmentShell.stateAtom,
);

export const directThreadEnvironment = createThreadEnvironmentAtoms(
  connectionAtomRuntime,
  threadFamilies.snapshotAtom,
);
