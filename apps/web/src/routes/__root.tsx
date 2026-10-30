import { type ServerLifecycleWelcomePayload } from "@supaterm/contracts";
import {
  Outlet,
  Link,
  redirect,
  createRootRoute,
  type ErrorComponentProps,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { Check, Copy } from "@supaterm/icons/nodes";
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from "react";

import { APP_DISPLAY_NAME, APP_VERSION } from "../branding";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { CommandPalette } from "../components/CommandPalette";
import { GuestShareDialogHost } from "../components/chat/GuestShareControls";
import { CustomSnoozeDialogHost } from "../components/CustomSnoozeDialog";
import { AddProjectToMachineDialogHost } from "../components/AddProjectToMachineDialog";
import { ConfirmDialogHost } from "../components/ConfirmDialogHost";
import { FirstRunGate } from "../components/onboarding/FirstRunGate";
import { SshPasswordPromptDialog } from "../components/desktop/SshPasswordPromptDialog";
import { SnapShotCoordinator } from "../components/desktop/SnapShotCoordinator";
import { DesktopWebLinkCoordinator } from "../components/desktop/DesktopWebLinkCoordinator";
import { DesktopAppActivationCoordinator } from "../components/desktop/DesktopAppActivationCoordinator";
import { RunningThreadKeepAlive } from "../components/desktop/RunningThreadKeepAlive";
import { DesktopUpdateLaunchNotice } from "../components/sidebar/updateEverythingRun";
import { getCodexMicroBridge } from "../components/codexMicro/codexMicroBridge";
import { ReopenClosedViewShortcut } from "../components/ReopenClosedViewShortcut";
import { ProjectCloneToastCoordinator } from "../components/ProjectCloneToastCoordinator";
import { ChatGptWelcomeCoordinator } from "../components/settings/ChatGptWelcomeCoordinator";
import { ThemeEditorHost } from "../components/settings/ThemeEditorHost";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { Button } from "../components/ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { StandalonePage, StandalonePageHeader } from "../components/ui/standalone-page";
import { AnchoredToastProvider, ToastProvider } from "../components/ui/toast";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { configureClientTracing } from "../observability/clientTracing";
import { resolveInitialServerAuthGateState } from "../environments/primary";
import { hasHostedPairingRequest, isHostedStaticApp } from "../hostedPairing";
import { useHostedPromptLinkLanding } from "../components/promptLinks/HostedPromptLinkLanding";
import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { useAtomValue } from "@effect/atom-react";
import { useEnvironments } from "../state/environments";
import { primaryServerConfigAtom, primaryServerWelcomeAtom } from "../state/server";
import { setActiveEnvironmentId, useActiveEnvironmentId } from "../state/entities";

import { getDesktopSnapShotBridge } from "../lib/desktopSnapShot";
import { shouldResumeSnapShotSetupOnStartup } from "../lib/snapShotSetupResume";

const CodexMicroCoordinator = lazy(() =>
  import("../components/codexMicro/CodexMicroCoordinator").then((module) => ({
    default: module.CodexMicroCoordinator,
  })),
);

const DevReplayHost = import.meta.env.DEV
  ? lazy(() =>
      import("../components/DevReplayHost").then((module) => ({ default: module.DevReplayHost })),
    )
  : null;

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/pair" && hasHostedPairingRequest(new URL(window.location.href))) {
      return {
        authGateState: {
          status: "hosted-pairing",
        } as const,
      };
    }

    if (isLocalEnvironmentDisabled() || isHostedStaticApp(new URL(window.location.href))) {
      return {
        authGateState: {
          status: "hosted-static",
        } as const,
      };
    }

    const authGateState = await resolveInitialServerAuthGateState();
    if (
      authGateState.status === "authenticated" &&
      getDesktopSnapShotBridge() &&
      shouldResumeSnapShotSetupOnStartup() &&
      location.pathname !== "/settings/snap-shot"
    ) {
      throw redirect({ to: "/settings/snap-shot", replace: true });
    }
    return {
      authGateState,
    };
  },
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  notFoundComponent: RootRouteNotFoundView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteNotFoundView() {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 className="text-lg font-medium text-foreground">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          This link doesn't point to a page in {APP_DISPLAY_NAME}. Go home to choose a project or
          start a thread.
        </p>
        <Button render={<Link to="/" replace />}>Go home</Button>
      </div>
    </main>
  );
}

function RootRouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { authGateState } = Route.useRouteContext();
  const primaryEnvironmentAuthenticated = authGateState.status === "authenticated";
  const hostedPromptLinkLanding = useHostedPromptLinkLanding(
    authGateState.status === "hosted-static",
  );
  const [returningFromWelcome, setReturningFromWelcome] = useState(pathname === "/welcome");
  if (pathname === "/welcome" && !returningFromWelcome) {
    setReturningFromWelcome(true);
  }

  if (pathname === "/pair" || pathname === "/connect-agent") {
    return (
      <>
        <Outlet />
      </>
    );
  }

  // Ahead of first-run onboarding, which would otherwise send a new visitor to the welcome
  // wizard and lose the link.
  if (hostedPromptLinkLanding !== null) {
    return <>{hostedPromptLinkLanding}</>;
  }

  if (pathname === "/welcome") {
    return (
      <ToastProvider>
        <AnchoredToastProvider>
          <CustomSnoozeDialogHost />
          <GuestShareDialogHost />
          {DevReplayHost ? (
            <Suspense>
              <DevReplayHost />
            </Suspense>
          ) : null}
          <CommandPalette>
            <AppSidebarLayout>
              <Outlet />
            </AppSidebarLayout>
          </CommandPalette>
        </AnchoredToastProvider>
      </ToastProvider>
    );
  }

  if (authGateState.status !== "authenticated" && authGateState.status !== "hosted-static") {
    return (
      <>
        <Outlet />
      </>
    );
  }

  const appShell = (
    <CommandPalette>
      {getCodexMicroBridge() === null ? null : (
        <Suspense fallback={null}>
          <CodexMicroCoordinator />
        </Suspense>
      )}
      <AppSidebarLayout>
        <Outlet />
      </AppSidebarLayout>
    </CommandPalette>
  );

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <ChatGptWelcomeCoordinator />
        <FirstRunGate
          enabled={primaryEnvironmentAuthenticated}
          hostedStatic={authGateState.status === "hosted-static"}
        >
          {primaryEnvironmentAuthenticated ? <AuthenticatedTracingBootstrap /> : null}
          {primaryEnvironmentAuthenticated ? <DesktopAppActivationCoordinator /> : null}
          {primaryEnvironmentAuthenticated ? <DesktopWebLinkCoordinator /> : null}
          {isElectron ? <RunningThreadKeepAlive /> : null}
          <SshPasswordPromptDialog />
          <SnapShotCoordinator />
          <ReopenClosedViewShortcut />
          <ConfirmDialogHost />
          <CustomSnoozeDialogHost />
          <GuestShareDialogHost />
          {DevReplayHost ? (
            <Suspense>
              <DevReplayHost />
            </Suspense>
          ) : null}

          <ProjectCloneToastCoordinator />
          <AddProjectToMachineDialogHost />
          <HostedStaticEnvironmentBootstrap />
          {primaryEnvironmentAuthenticated ? (
            <EventRouter skipInitialBootstrapNavigation={returningFromWelcome} />
          ) : null}
          {isElectron ? <DesktopUpdateLaunchNotice /> : null}
          {/* Hosted Nightly is "hosted-static", not authenticated, and needs it too. */}
          {appShell}
          {/* Above the router: a theme draft is judged by walking the app, so the
              editor has to survive navigation away from settings. */}
          <ThemeEditorHost />
        </FirstRunGate>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function HostedStaticEnvironmentBootstrap() {
  const { environments } = useEnvironments();
  const activeEnvironmentId = useActiveEnvironmentId();

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- selects a connected environment for the mounted static app entry
  useEffect(() => {
    if (
      environments.some(
        (environment) => environment.entry.target._tag === "PrimaryConnectionTarget",
      )
    ) {
      return;
    }

    if (activeEnvironmentId) {
      return;
    }

    const firstSavedEnvironment = environments[0];
    if (!firstSavedEnvironment) {
      return;
    }

    setActiveEnvironmentId(firstSavedEnvironment.environmentId);
  }, [activeEnvironmentId, environments]);

  return null;
}

function RootRouteErrorView({ error }: ErrorComponentProps) {
  const router = useRouter();
  const message = errorMessage(error);
  // Router pathname rather than window.location: desktop uses hash history, where the window path is always "/".
  const pathname = useLocation({ select: (location) => location.pathname });
  const report = errorReport(error, pathname);

  return (
    <StandalonePage tone="error">
      <StandalonePageHeader eyebrow="Error" title="Something went wrong." description={message} />

      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void router.invalidate()}>
          Try again
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Reload app
        </Button>
        <CopyErrorButton report={report} />
      </div>

      <div className="mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
        <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Error report</p>
        <pre className="max-h-64 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs whitespace-pre-wrap text-foreground/85">
          {report}
        </pre>
      </div>
    </StandalonePage>
  );
}

function CopyErrorButton({ report }: { report: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "error-report" });

  return (
    <Button size="sm" variant="outline" onClick={() => copyToClipboard(report)}>
      <MorphIcon className={cn(isCopied && "text-success")} icon={isCopied ? Check : Copy} />
      {isCopied ? "Copied" : "Copy error"}
    </Button>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

const MAX_ERROR_CAUSE_DEPTH = 5;

/**
 * Takes the pathname only so tokens in the query never land on the clipboard.
 */
function errorReport(error: unknown, pathname: string): string {
  const lines = [
    `${APP_DISPLAY_NAME} ${APP_VERSION}`,
    `Path: ${pathname}`,
    `Time: ${new Date().toISOString()}`,
    "",
    errorDetails(error),
  ];
  let cause = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; cause !== undefined && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    lines.push("", "Caused by:", errorDetails(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return lines.join("\n");
}

function AuthenticatedTracingBootstrap() {
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- starts tracing after the authenticated application mounts
  useEffect(() => {
    void configureClientTracing();
  }, []);

  return null;
}

function EventRouter({
  skipInitialBootstrapNavigation,
}: {
  readonly skipInitialBootstrapNavigation: boolean;
}) {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);
  const readPathname = useEffectEvent(() => pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);
  const skipInitialBootstrapNavigationRef = useRef(skipInitialBootstrapNavigation);
  const handleWelcome = useEffectEvent((payload: ServerLifecycleWelcomePayload | null) => {
    if (!payload) return;

    setActiveEnvironmentId(payload.environment.environmentId);
    void (async () => {
      if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
        return;
      }
      if (readPathname() !== "/") {
        return;
      }
      if (skipInitialBootstrapNavigationRef.current) {
        skipInitialBootstrapNavigationRef.current = false;
        handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
        return;
      }
      if (handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
        return;
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: {
          environmentId: payload.environment.environmentId,
          threadId: payload.bootstrapThreadId,
        },
        replace: true,
      });
      handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
    })().catch(() => undefined);
  });

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- expands the bootstrap project in the UI store and navigates the router on a server welcome
  useEffect(() => {
    if (!serverConfig) {
      return;
    }

    setActiveEnvironmentId(serverConfig.environment.environmentId);
  }, [serverConfig]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- delivers server welcome navigation to the mounted router
  useEffect(() => {
    handleWelcome(serverWelcome);
  }, [serverWelcome]);

  return null;
}
