import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { availableScratchWorkspaceRoot } from "@supaterm/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId } from "@supaterm/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { useProjects } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { useNewThreadHandler } from "./useHandleNewThread";

function reportScratchFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/** The primary (local) environment wins; `fallback` only applies when it offers no scratch root. */
export function pickScratchEnvironmentId(input: {
  readonly primary: EnvironmentId | null;
  readonly fallback: EnvironmentId | null;
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly scratchWorkspaceRootFor: (environmentId: EnvironmentId) => string | null;
}): EnvironmentId | null {
  const { primary, fallback, scratchWorkspaceRootFor } = input;
  if (primary !== null && scratchWorkspaceRootFor(primary) !== null) return primary;
  if (fallback !== null && scratchWorkspaceRootFor(fallback) !== null) return fallback;
  const offering = input.environmentIds.filter((id) => scratchWorkspaceRootFor(id) !== null);
  return offering.length === 1 ? (offering[0] ?? null) : null;
}

export function useScratchProject() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();

  const scratchWorkspaceRoots = new Map(
    environments.map((environment) => [
      environment.environmentId,
      availableScratchWorkspaceRoot({
        environmentId: environment.environmentId,
        connectionPhase: environment.connection.phase,
        serverConfig: environment.serverConfig,
        projects,
      }),
    ]),
  );
  const scratchWorkspaceRootFor = (environmentId: EnvironmentId | null): string | null =>
    environmentId === null ? null : (scratchWorkspaceRoots.get(environmentId) ?? null);

  const scratchEnvironmentId = (fallback: EnvironmentId | null): EnvironmentId | null =>
    pickScratchEnvironmentId({
      primary: primaryEnvironmentId,
      fallback,
      environmentIds: environments.map((environment) => environment.environmentId),
      scratchWorkspaceRootFor,
    });

  const openScratchProject = async (
    environmentId: EnvironmentId,
    failureTitle = "Could not start without a project",
  ): Promise<EnvironmentProject | null> => {
    const result = await openScratch({ environmentId, input: {} });
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      reportScratchFailure(failureTitle, squashAtomCommandFailure(result));
    }
    return null;
  };

  const startScratchThread = async (environmentId: EnvironmentId, prompt?: string) => {
    const project = await openScratchProject(environmentId);
    if (!project) return;
    const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id)).catch(
      (error: unknown) => {
        reportScratchFailure("Could not start without a project", error);
        return null;
      },
    );
    if (opened && prompt !== undefined) {
      useComposerDraftStore.getState().setPrompt(opened.draftId, prompt);
    }
  };

  return { scratchWorkspaceRootFor, scratchEnvironmentId, openScratchProject, startScratchThread };
}
