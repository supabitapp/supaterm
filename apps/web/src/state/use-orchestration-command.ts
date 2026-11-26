import type {
  AtomCommand,
  AtomCommandOptions,
  AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  type EnvironmentId,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { readEnvironmentScope } from "./session";
import { useAtomCommand } from "./use-atom-command";
import { msg } from "gt-react";
import { m } from "../i18n/messages";

const ORCHESTRATION_OPERATE_DENIED_MESSAGE = msg(
  "This connection cannot change threads or projects.",
);

export function useOrchestrationCommand<W extends { readonly environmentId: EnvironmentId }, A, E>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E | EnvironmentAuthorizationError>> {
  const run = useAtomCommand(command, options);
  return async (value: W): Promise<AtomCommandResult<A, E | EnvironmentAuthorizationError>> => {
    if (!readEnvironmentScope(value.environmentId, AuthOrchestrationOperateScope)) {
      return AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: AuthOrchestrationOperateScope,
            message: m(ORCHESTRATION_OPERATE_DENIED_MESSAGE),
          }),
        ),
      );
    }
    return run(value);
  };
}
