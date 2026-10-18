import { RefreshIcon } from "~/components/ui/refresh-icon";
import { scopeProjectRef } from "@supaterm/client-runtime/environment";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { LinkIcon, PlusIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { isElectron } from "../env";
import { NoProjectsHero } from "../components/NoProjectsHero";
import { sortScopedProjectsForSidebar } from "../components/Sidebar.logic";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { WorkspacePageHeader } from "../components/WorkspacePageHeader";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import {
  readProject,
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { useEnvironments } from "../state/environments";
import { APP_DISPLAY_NAME } from "~/branding";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();

  if (authGateState.status === "hosted-static") {
    if (!isReady) return null;
    if (environments.length === 0) return <HostedStaticOnboardingState />;
  }

  return <IndexDraftLanding />;
}

function IndexDraftLanding() {
  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const router = useRouter();
  // Read at effect time: this page stays mounted while a navigation away from
  // "/" is still loading, but the router already points at the new location.
  const isStillOnIndex = useEffectEvent(() => router.state.location.pathname === "/");
  const startingRef = useRef(false);
  const [startFailed, setStartFailed] = useState(false);
  const [retryRequest, setRetryRequest] = useState(0);

  const mostRecentProject = bootstrapped
    ? (sortScopedProjectsForSidebar(projects, threads, "updated_at")[0] ?? null)
    : null;

  const startDraft = (project: NonNullable<typeof mostRecentProject>) => {
    if (startingRef.current) {
      return;
    }
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    if (readProject(projectRef) === null) {
      return;
    }
    startingRef.current = true;
    void handleNewThread(projectRef, { replace: true })
      .then((opened) => {
        if (opened === null) {
          startingRef.current = false;
          setRetryRequest((request) => request + 1);
        }
      })
      .catch(() => {
        startingRef.current = false;
        setStartFailed(true);
      });
  };

  useEffect(() => {
    // Starting a draft after the user has left would replace the page they picked.
    if (mostRecentProject === null || !isStillOnIndex()) {
      return;
    }
    startDraft(mostRecentProject);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A draft abandoned for a removed project retries with the next one.
  }, [mostRecentProject, retryRequest, startDraft]);

  if (!bootstrapped) {
    return null;
  }
  if (mostRecentProject !== null) {
    return startFailed ? (
      <DraftStartError
        onRetry={() => {
          setStartFailed(false);
          startDraft(mostRecentProject);
        }}
      />
    ) : null;
  }
  return <NoProjectsHero />;
}

function DraftStartError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>Couldn’t start a new thread</EmptyTitle>
          <EmptyDescription>
            The project is still available. Try opening the draft again.
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RefreshIcon size="md" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

function HostedStaticOnboardingState() {
  const localEnvironmentOff = isLocalEnvironmentDisabled();
  const description = localEnvironmentOff
    ? "The local environment is turned off. Connect a remote environment, or turn the local environment back on in Connections."
    : "Open Connections and add that machine using its pairing link. This app must be able to reach it.";

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle>Connect to a computer running Supaterm</EmptyTitle>
              <EmptyDescription>
                This app connects to Supaterm running on your computer or a server. Start the
                Supaterm desktop app or command-line server on that machine and keep it running.
              </EmptyDescription>
              <EmptyDescription>{description}</EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<Link to="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  Open Connections
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
