import type { PullRequestStack } from "@supaterm/contracts";
import { cn } from "~/lib/utils";
import { resolvePullRequestState } from "./pullRequestPresentation";
import { useMessages } from "gt-react";

export function PullRequestStackLayerContent({
  layer,
}: {
  layer: PullRequestStack["layers"][number];
}) {
  const messages = useMessages();
  const state = resolvePullRequestState(
    {
      state: layer.state,
      isDraft: layer.isDraft ?? false,
    },
    messages,
  );
  return (
    <>
      <state.Icon aria-hidden className={cn("size-4 shrink-0", state.toneClassName)} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{layer.title || layer.headBranch}</span>
        <span className="block truncate text-xs font-normal text-muted-foreground">
          #{layer.number} · {layer.headBranch} · {state.label}
        </span>
      </span>
    </>
  );
}
