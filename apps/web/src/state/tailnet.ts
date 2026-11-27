import { createTailnetEnvironmentAtoms } from "@supaterm/client-runtime/tailnet/atoms";

import { connectionAtomRuntime } from "../connection/runtime";

export const tailnetEnvironment = createTailnetEnvironmentAtoms(connectionAtomRuntime);
