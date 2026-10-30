import { RefreshCwIcon } from "@supaterm/icons";
import type { ReactNode } from "react";

import type { ThreadSyncPhase } from "../../threadSync";
import { cn } from "~/lib/utils";
import { NoticeText } from "./ComposerBannerStack";

export interface ThreadNowItem {
  readonly id: string;
  readonly icon: ReactNode;
  readonly iconInteractive?: boolean;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
}

const lineClassName = cn(
  "mx-auto flex w-full min-w-0 max-w-(--chat-content-max-width) items-center gap-1.5 px-1 pb-2 text-xs text-muted-foreground [&_svg]:size-3.5 [&_svg]:shrink-0",
  "[&_[data-slot=popover-trigger]]:-my-1.5",
  "pointer-coarse:[&_[data-slot=inline-button]]:relative pointer-coarse:[&_[data-slot=inline-button]]:after:absolute pointer-coarse:[&_[data-slot=inline-button]]:after:-inset-x-1.5 pointer-coarse:[&_[data-slot=inline-button]]:after:-inset-y-3.5",
  "transition-opacity duration-150 ease-out starting:opacity-0 motion-reduce:transition-none",
);

function ThreadNowLine({
  item,
  announce = false,
}: {
  readonly item: ThreadNowItem;
  readonly announce?: boolean;
}) {
  return (
    <div
      role={announce ? "alert" : undefined}
      className={lineClassName}
      data-thread-now-line="true"
    >
      <span
        aria-hidden={item.iconInteractive ? undefined : true}
        className="flex size-3.5 shrink-0 items-center justify-center"
      >
        {item.icon}
      </span>
      <NoticeText
        detailsLabel={
          typeof item.title === "string" ? `Show details: ${item.title}` : "Show details"
        }
        className="min-w-0 truncate"
      >
        {item.title}
        {item.description ? (
          <>
            {" "}
            <span className="ms-0.5 text-muted-foreground/60 light:text-muted-foreground/80">
              {item.description}
            </span>
          </>
        ) : null}
      </NoticeText>
      {item.actions ? (
        <span className="ms-1.5 flex shrink-0 items-center gap-2.5">{item.actions}</span>
      ) : null}
    </div>
  );
}

function ThreadSyncLine({ phase }: { readonly phase: ThreadSyncPhase }) {
  return (
    <div className={lineClassName} role="status" data-composer-sync-status={phase}>
      <RefreshCwIcon aria-hidden />
      <span className="truncate">
        {phase === "loading" ? "Loading messages..." : "Syncing messages..."}
      </span>
    </div>
  );
}

export function ThreadNow({
  attention,
  work,
  syncPhase,
  goal,
}: {
  readonly attention: ThreadNowItem | null;
  readonly work: ThreadNowItem | null;
  readonly syncPhase: ThreadSyncPhase | null;
  readonly goal: ThreadNowItem | null;
}): ReactNode {
  return (
    <>
      {attention ? <ThreadNowLine item={attention} announce /> : null}
      {work ? <ThreadNowLine item={work} /> : null}
      {syncPhase ? <ThreadSyncLine phase={syncPhase} /> : null}
      {goal ? <ThreadNowLine item={goal} /> : null}
    </>
  );
}
