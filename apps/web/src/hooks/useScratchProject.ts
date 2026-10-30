import { RegistryContext } from "@effect/atom-react";
import { useContext } from "react";
import type { AtomRegistry } from "effect/reactivity";
import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { availableScratchWorkspaceRoot } from "@supaterm/client-runtime/operations/projects";
import {
  isAtomCommandInterrupted,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import type { EnvironmentId } from "@supaterm/contracts";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import {
  type EnvironmentPresentation,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { readProjects } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { type NewThreadHandler, useNewThreadHandler } from "./useHandleNewThread";

function reportScratchFailure(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

type ScratchEnvironment = Pick<EnvironmentPresentation, "connection" | "serverConfig"> & {
  readonly environmentId: EnvironmentId;
};

export function createScratchProjectActions(input: {
  readonly environments: () => Iterable<ScratchEnvironment>;
  readonly primaryEnvironmentId: () => EnvironmentId | null;
  readonly registry: AtomRegistry.AtomRegistry;
  readonly handleNewThread: NewThreadHandler;
}) {
  const scratchWorkspaceRootFor = (environmentId: EnvironmentId | null): string | null => {
    if (environmentId === null) return null;
    const environment = [...input.environments()].find(
      (entry) => entry.environmentId === environmentId,
    );
    return availableScratchWorkspaceRoot({
      environmentId,
      connectionPhase: environment?.connection.phase,
      serverConfig: environment?.serverConfig ?? null,
      projects: readProjects(),
    });
  };

  const scratchEnvironmentId = (current: EnvironmentId | null): EnvironmentId | null => {
    const primary = input.primaryEnvironmentId();
    if (primary !== null && scratchWorkspaceRootFor(primary) !== null) return primary;
    if (current !== null && scratchWorkspaceRootFor(current) !== null) return current;
    const offering = [...input.environments()].filter(
      (entry) => scratchWorkspaceRootFor(entry.environmentId) !== null,
    );
    return offering.length === 1 ? (offering[0]?.environmentId ?? null) : null;
  };

  const openScratchProject = async (
    environmentId: EnvironmentId,
    failureTitle = "Could not start without a project",
  ): Promise<EnvironmentProject | null> => {
    const command = projectEnvironment.openScratch;
    const result = await runAtomCommand(
      input.registry,
      command,
      { environmentId, input: {} },
      { label: command.label, reportFailure: false, reportDefect: true },
    );
    if (result._tag === "Success") return result.value;
    if (!isAtomCommandInterrupted(result)) {
      reportScratchFailure(failureTitle, squashAtomCommandFailure(result));
    }
    return null;
  };

  const startScratchThread = async (environmentId: EnvironmentId, prompt?: string) => {
    const project = await openScratchProject(environmentId);
    if (!project) return;
    const opened = await input
      .handleNewThread(scopeProjectRef(project.environmentId, project.id))
      .catch((error: unknown) => {
        reportScratchFailure("Could not start without a project", error);
        return null;
      });
    if (opened && prompt !== undefined) {
      useComposerDraftStore.getState().setPrompt(opened.draftId, prompt);
    }
  };

  return { scratchWorkspaceRootFor, scratchEnvironmentId, openScratchProject, startScratchThread };
}

export function useScratchProject() {
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const registry = useContext(RegistryContext);
  const handleNewThread = useNewThreadHandler();
  return createScratchProjectActions({
    environments: () => environments,
    primaryEnvironmentId: () => primaryEnvironmentId,
    registry,
    handleNewThread,
  });
}
