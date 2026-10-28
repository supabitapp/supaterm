import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId } from "@supaterm/contracts";
import { useParams, useRouter } from "@tanstack/react-router";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useComposerDraftStore } from "~/composerDraftStore";
import { currentClientMetadata } from "~/connection/platform";
import { pickTriageEnvironment } from "~/lib/triageTarget";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { projectEnvironment } from "~/state/projects";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { resolveThreadRouteTarget } from "~/threadRoutes";
import { writeTextToClipboard } from "./useCopyToClipboard";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useScratchProject } from "./useScratchProject";

const TRIAGE_CLI_COMMAND = "npx supaterm triage";

const copyTriageCliCommand = () =>
  writeTextToClipboard(TRIAGE_CLI_COMMAND, "command").catch(() =>
    toastManager.add({
      type: "error",
      title: `Could not copy. Type ${TRIAGE_CLI_COMMAND} instead.`,
    }),
  );

/** The machine "Triage an issue" runs on, or null when no machine offers it to this client. */
export function useTriageEnvironmentId(): EnvironmentId | null {
  const target = resolveThreadRouteTarget(useParams({ strict: false }));
  const draftEnvironmentId = useComposerDraftStore((store) =>
    target?.kind === "draft"
      ? (store.getDraftSession(target.draftId)?.environmentId ?? null)
      : null,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const supportsTriage = (environmentId: EnvironmentId | null) =>
    environments.find((environment) => environment.environmentId === environmentId)?.serverConfig
      ?.environment.capabilities.triage === true;
  const environmentId = pickTriageEnvironment({
    onScreen: target?.kind === "server" ? target.threadRef.environmentId : draftEnvironmentId,
    primary: primaryEnvironmentId,
    connected: environments
      .filter((environment) => environment.connection.phase === "connected")
      .map((environment) => environment.environmentId),
    supportsTriage,
  });
  const permitted = useAtomValue(serverEnvironment.prepareTriage.permissionAtom(environmentId));
  return permitted && supportsTriage(environmentId) ? environmentId : null;
}

/**
 * In-app `supaterm triage`: the server writes the session files and starts cloning
 * the matching source, then a No project draft opens with the playbook linked.
 * The draft hero explains the rest; the user picks a provider and describes
 * the problem.
 */
export function useStartTriage() {
  const router = useRouter();
  const { scratchWorkspaceRootFor } = useScratchProject();
  const handleNewThread = useNewThreadHandler();
  const prepare = useAtomCommand(serverEnvironment.prepareTriage, { reportFailure: false });
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });

  // With no draft to show, a toast is the only place to point at the CLI.
  const fail = (description: string) =>
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not start triage",
        description: `${description} Run ${TRIAGE_CLI_COMMAND} in a terminal on that machine instead.`,
        timeout: 0,
        actionProps: { children: "Copy command", onClick: () => void copyTriageCliCommand() },
        // "Copy command" is the copy that helps here, not the error text.
        data: { hideCopyButton: true },
      }),
    );
  const failWith = (
    result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
  ) => {
    if (isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    fail(error instanceof Error ? error.message : "An error occurred.");
  };

  // `routeChanged` tells the steps the user went elsewhere while they waited;
  // the draft then stays closed instead of pulling them away.
  const openTriageDraft = async (environmentId: EnvironmentId, routeChanged: () => boolean) => {
    const prepared = await prepare({
      environmentId,
      input: { client: currentClientMetadata() },
    });
    if (prepared._tag === "Failure") return failWith(prepared);
    const project = await openScratch({ environmentId, input: {} });
    if (project._tag === "Failure") return failWith(project);
    if (routeChanged()) return;
    // A null result means the user went elsewhere; only a throw is a failure.
    await handleNewThread(scopeProjectRef(project.value.environmentId, project.value.id), {
      prompt: prepared.value.prompt,
    }).catch(() => fail("Supaterm could not open a new thread."));
  };

  return async (environmentId: EnvironmentId) => {
    if (scratchWorkspaceRootFor(environmentId) === null) {
      fail("This machine cannot start threads without a project.");
      return;
    }
    const requestingRouteHref = router.state.location.href;
    // The palette is already closed, and a slow network can hold up the source
    // lookup, so say something when the draft does not open at once.
    let pendingToastId: ReturnType<typeof toastManager.add> | undefined;
    const pendingTimer = setTimeout(() => {
      pendingToastId = toastManager.add({
        type: "loading",
        title: "Starting triage…",
        timeout: 0,
      });
    }, 400);
    await openTriageDraft(
      environmentId,
      () => router.state.location.href !== requestingRouteHref,
    ).finally(() => {
      clearTimeout(pendingTimer);
      if (pendingToastId !== undefined) toastManager.close(pendingToastId);
    });
  };
}
