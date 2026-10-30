import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";
import { useState } from "react";
import { paneTargetKey } from "../chatPanes/layout";
import { ChatPaneWorkspace } from "../components/chatPanes/ChatPaneWorkspace";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useThreadRouteTarget } from "../hooks/useThreadRouteTarget";

function ChatRouteLayout() {
  // Both thread routes render here, not in their own leaf components, so the
  // draft-to-thread promotion keeps one ChatView mounted across the swap.
  const threadTarget = useThreadRouteTarget();
  const pathname = useLocation({ select: (location) => location.pathname });
  const modal =
    pathname === "/usage" || pathname === "/settings" || pathname.startsWith("/settings/");
  const [retainedTarget, setRetainedTarget] = useState(threadTarget);
  if (
    threadTarget &&
    (!retainedTarget || paneTargetKey(threadTarget) !== paneTargetKey(retainedTarget))
  )
    setRetainedTarget(threadTarget);
  const workspaceTarget = threadTarget ?? (modal ? retainedTarget : null);
  return (
    <>
      {threadTarget?.kind === "server" ? (
        <ThreadLinkPrompt threadRef={threadTarget.threadRef} />
      ) : null}
      {workspaceTarget ? <ChatPaneWorkspace target={workspaceTarget} active={!modal} /> : null}
      {modal || !workspaceTarget ? <Outlet /> : null}
    </>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ChatRouteLayout,
});
