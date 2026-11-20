import { createFileRoute, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EnvironmentId } from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

import { NoProjectsHero } from "../components/NoProjectsHero";
import { WelcomePage } from "../components/onboarding/WelcomePage";
import { WelcomePairing } from "../components/onboarding/WelcomePairing";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { resolveWelcomeTarget } from "../onboarding/welcomePage.logic";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";

const decodeEnvironmentId = Schema.decodeOption(EnvironmentId);

export const Route = createFileRoute("/welcome")({
  beforeLoad: ({ context }) => {
    const { authGateState } = context;
    if (authGateState.status !== "authenticated" && authGateState.status !== "hosted-static") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: WelcomeRouteView,
});

function WelcomeRouteView() {
  const navigate = useNavigate();
  const hash = useLocation({ select: (location) => location.hash });
  // A ChatGPT sign-in returns here with the computer it set up.
  const resumeEnvironmentId = hash.startsWith("agents:")
    ? Option.getOrUndefined(decodeEnvironmentId(hash.slice("agents:".length)))
    : undefined;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments, isReady } = useEnvironments();
  const [pairedEnvironmentId, setPairedEnvironmentId] = useState<EnvironmentId | null>(null);
  const target = resolveWelcomeTarget({
    resumeEnvironmentId,
    primaryEnvironmentId,
    pairedEnvironmentId,
    knownEnvironmentIds: environments.map((environment) => environment.environmentId),
    catalogReady: isReady,
  });
  // The root can remount this pending outlet after navigation; do not reopen setup.
  const isWelcomeRoute = useLocation({ select: (location) => location.pathname === "/welcome" });
  const [dismissed, setDismissed] = useState(false);
  const openNewThread = useNewThreadHandler();
  if (target._tag === "loading") return null;
  if (!isWelcomeRoute || dismissed) return <NoProjectsHero />;
  if (target._tag === "pair") return <WelcomePairing onPaired={setPairedEnvironmentId} />;
  return (
    <WelcomePage
      key={target.environmentId}
      environmentId={target.environmentId}
      onDone={async (projectRef) => {
        setDismissed(true);
        if (projectRef !== undefined) {
          await openNewThread(projectRef, { replace: true }).catch(() =>
            navigate({ to: "/", replace: true }),
          );
          return;
        }
        await navigate({ to: "/", replace: true });
      }}
    />
  );
}
