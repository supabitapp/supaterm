import {
  createThreadEnvironmentAtoms,
  createThreadFamilyAtoms,
} from "@supaterm/client-runtime/state/threads";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentShell } from "./shell";

export const threadFamilies = createThreadFamilyAtoms(
  connectionAtomRuntime,
  environmentShell.stateAtom,
);
export const directThreadEnvironment = createThreadEnvironmentAtoms(
  connectionAtomRuntime,
  threadFamilies.snapshotAtom,
);
