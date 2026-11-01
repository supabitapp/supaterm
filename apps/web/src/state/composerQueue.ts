import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  sessionGrantsScope,
} from "@supaterm/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentPresentations } from "./presentation";
import { environmentSession } from "./session";

export const canQueueComposerMessageAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get) => {
    const presentation = get(environmentPresentations.presentationAtom(environmentId));
    if (presentation === null) return false;
    const result = get(environmentSession.sessionStateAtom(environmentId));
    const session = AsyncResult.getOrElse(result, () => null);
    if (session !== null && !sessionGrantsScope(session, AuthOrchestrationOperateScope))
      return false;
    return (
      presentation.connection.phase !== "connected" ||
      (result._tag !== "Failure" && session !== null)
    );
  }),
);

export function readCanQueueComposerMessage(environmentId: EnvironmentId) {
  return appAtomRegistry.get(canQueueComposerMessageAtom(environmentId));
}
