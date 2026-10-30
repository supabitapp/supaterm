import { useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import { AuthProvidersManageScope } from "@supaterm/contracts";
import type { createServerEnvironmentAtoms } from "@supaterm/client-runtime/state/server";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { useAtomCommand } from "./use-atom-command";
import { readEnvironmentScope, useEnvironmentsWithScope } from "./session";
import {
  orchestrationSkillsView,
  runOrchestrationSkillsAction,
  type OrchestrationSkillsEnvironment,
} from "@supaterm/client-runtime/orchestrationSkills";

/** The caller keys this component by selection, isolating in-flight results after a scope change. */
export function useOrchestrationSkills(
  environments: readonly OrchestrationSkillsEnvironment[],
  commands: Pick<
    ReturnType<typeof createServerEnvironmentAtoms>,
    "orchestrationSkillsStatus" | "orchestrationSkillsInstall" | "orchestrationSkillsUninstall"
  >,
) {
  const [selection] = useState(environments);
  const permitted = useEnvironmentsWithScope(selection, AuthProvidersManageScope);
  const read = useAtomCommand(commands.orchestrationSkillsStatus, { reportFailure: false });
  const install = useAtomCommand(commands.orchestrationSkillsInstall, { reportFailure: false });
  const uninstall = useAtomCommand(commands.orchestrationSkillsUninstall, { reportFailure: false });
  const [initialStatusAtom] = useState(() =>
    Atom.make(
      Effect.promise(() =>
        runOrchestrationSkillsAction(selection, async (environmentId) => {
          const result = await read({ environmentId, input: {} });
          return result._tag === "Success" ? result.value : null;
        }),
      ),
    ),
  );
  const initialStatus = useAtomValue(initialStatusAtom);
  const [updatedResults, setResults] = useState<Awaited<
    ReturnType<typeof runOrchestrationSkillsAction>
  > | null>(null);
  const results = updatedResults ?? AsyncResult.getOrElse(initialStatus, () => []);
  const [pendingAction, setPending] = useState<"Status" | "Install" | "Uninstall" | null>(null);
  const pending = initialStatus.waiting ? "Status" : pendingAction;
  const busy = useRef(false);
  const request = async (action: "Status" | "Install" | "Uninstall") => {
    if (initialStatus.waiting || busy.current) return;
    busy.current = true;
    setPending(action);
    const execute = action === "Status" ? read : action === "Install" ? install : uninstall;
    const settled = await settlePromise(() =>
      runOrchestrationSkillsAction(selection, async (environmentId) => {
        const previousStatus =
          results.find((entry) => entry.environmentId === environmentId)?.status ?? null;
        if (action !== "Status" && !readEnvironmentScope(environmentId, AuthProvidersManageScope)) {
          return previousStatus;
        }
        const result = await execute({ environmentId, input: {} });
        if (result._tag === "Success") return result.value;
        return action !== "Status" && !readEnvironmentScope(environmentId, AuthProvidersManageScope)
          ? previousStatus
          : null;
      }),
    );
    busy.current = false;
    setPending(null);
    if (settled._tag === "Failure") throw squashAtomCommandFailure(settled);
    setResults(settled.value);
  };
  const entries = results.map((result) => ({
    ...result,
    ...orchestrationSkillsView(result.status),
    canManage: permitted.has(result.environmentId),
  }));
  const notices = entries.flatMap((entry) => {
    const prefix = selection.length > 1 ? `${entry.label}: ` : "";
    if (!entry.status)
      return [
        `${prefix}Could not manage skills. Check the connection and provider folder permissions, then retry.`,
      ];
    return [
      ...(!entry.canManage
        ? [`${prefix}This connection does not have permission to manage provider skills.`]
        : []),
      ...(entry.status.targets.length === 0
        ? [`${prefix}No providers support native skill installation.`]
        : []),
      ...(entry.status.unsupportedProviders.length > 0
        ? [`${prefix}Not supported: ${entry.status.unsupportedProviders.join(", ")}.`]
        : []),
    ];
  });
  return {
    pending,
    request,
    notices,
    error: entries.some((entry) => entry.status === null),
    installed:
      entries.length === selection.length &&
      entries.length > 0 &&
      entries.every((entry) => entry.installed),
    canInstall: entries.some((entry) => entry.canManage && entry.canInstall),
    canUninstall: entries.some((entry) => entry.canManage && entry.canUninstall),
  };
}
