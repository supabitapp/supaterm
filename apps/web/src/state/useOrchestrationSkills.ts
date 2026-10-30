import { useEffect, useRef, useState } from "react";
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
  const [results, setResults] = useState<Awaited<ReturnType<typeof runOrchestrationSkillsAction>>>(
    [],
  );
  const [pending, setPending] = useState<"Status" | "Install" | "Uninstall" | null>("Status");
  const busy = useRef(false);
  const request = async (action: "Status" | "Install" | "Uninstall") => {
    if (busy.current) return;
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
  useEffect(() => {
    let active = true;
    busy.current = true;
    void runOrchestrationSkillsAction(selection, async (environmentId) => {
      const result = await read({ environmentId, input: {} });
      return result._tag === "Success" ? result.value : null;
    }).then((next) => {
      if (!active) return;
      busy.current = false;
      setPending(null);
      setResults(next);
    });
    return () => {
      active = false;
    };
  }, [selection, read]);
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
