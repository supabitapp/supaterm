import type { EnvironmentId, ThreadId } from "@supaterm/contracts";

import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";

import { Popover, type PopoverCreateHandle, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { CommandOutputPanel } from "./CommandOutputPanel";

/**
 * The background-work banner's dot. Only work that will wake the agent shows at full strength,
 * since a dev server can run for hours after the agent is done.
 */
export function BackgroundWorkIcon({ waiting }: { waiting: boolean }) {
  return (
    <span
      className={cn("size-1.5 rounded-full", waiting ? "bg-foreground" : "bg-muted-foreground")}
      aria-hidden="true"
    />
  );
}

export interface BackgroundTaskOutputTarget {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly taskId: string;
  readonly label: string;
}

export type BackgroundTaskOutputHandle = ReturnType<
  typeof PopoverCreateHandle<BackgroundTaskOutputTarget>
>;

const titleTriggerClassName =
  "cursor-pointer rounded-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

/**
 * The banner's one output popover. Its triggers sit in the banner's text and name the task;
 * the root stays outside that text, which measures itself for overflow.
 */
export function BackgroundTaskOutputPopover({ handle }: { handle: BackgroundTaskOutputHandle }) {
  return (
    <Popover handle={handle}>
      {({ payload }) =>
        payload === undefined ? null : (
          <PopoverPopup side="top" align="start" width="xl" aria-label={`Output: ${payload.label}`}>
            <div className="mb-2 truncate font-medium text-xs">{payload.label}</div>
            {/* Fixed, so the popover keeps its place while output streams in. */}
            <div className="h-80 font-mono text-(length:--font-size-code,var(--text-2xs)) leading-relaxed whitespace-pre-wrap break-words select-text [&_*]:[scrollbar-width:none] [&_*::-webkit-scrollbar]:hidden">
              <CommandOutputPanel
                output={orchestrationEnvironment.v2.backgroundTaskOutput({
                  environmentId: payload.environmentId,
                  input: { threadId: payload.threadId, taskId: payload.taskId },
                })}
                waitingLabel="No output yet."
              />
            </div>
          </PopoverPopup>
        )
      }
    </Popover>
  );
}

/** The banner's title. It opens the output of the one command it names. */
export function BackgroundWorkTitle({
  title,
  output,
}: {
  title: string;
  output: { handle: BackgroundTaskOutputHandle; target: BackgroundTaskOutputTarget } | null;
}) {
  return output === null ? (
    title
  ) : (
    <PopoverTrigger
      handle={output.handle}
      payload={output.target}
      nativeButton={false}
      render={<span role="button" tabIndex={0} className={titleTriggerClassName} />}
    >
      {title}
    </PopoverTrigger>
  );
}
