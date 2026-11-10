import type {
  EnvironmentId,
  OrchestrationV2PendingBackgroundTask,
  ThreadId,
} from "@supaterm/contracts";
import { presentPendingBackgroundWork } from "@supaterm/client-runtime/state/thread-execution";
import { useState } from "react";

import { orchestrationEnvironment } from "../../state/orchestration";
import { Button, InlineButton } from "../ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { CommandOutputPanel } from "./CommandOutputPanel";
import { ShellCommandBlock } from "./ShellCommandBlock";

export function BackgroundWorkDetails(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly tasks: ReadonlyArray<OrchestrationV2PendingBackgroundTask>;
  readonly onOpenThread: (threadId: ThreadId) => void;
}) {
  const [open, setOpen] = useState(false);
  const withOutput = new Set(
    presentPendingBackgroundWork(props.tasks)
      ?.items.filter((item) => item.hasOutput)
      .map((item) => item.taskId),
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="xs" variant="ghost" />}>Details</DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Background work</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-5">
            {props.tasks.map((task) => {
              const command = task.command;
              const description = task.description?.trim();
              const title =
                description && description !== command?.trim()
                  ? description
                  : command
                    ? "Command"
                    : task.kind.replaceAll("_", " ");
              const childThreadId = task.kind === "subagent" ? task.childThreadId : undefined;
              return (
                <section key={task.taskId} className="space-y-2 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="font-medium">{title}</h3>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {task.awaited ? "Waiting" : "Running"}
                    </span>
                  </div>
                  {command ? (
                    <div className="rounded-md border border-border bg-muted/20 p-3 font-mono text-xs whitespace-pre-wrap break-words">
                      <ShellCommandBlock command={command} />
                    </div>
                  ) : null}
                  {withOutput.has(task.taskId) ? (
                    <div className="font-mono text-xs whitespace-pre-wrap break-words">
                      <CommandOutputPanel
                        output={orchestrationEnvironment.v2.backgroundTaskOutput({
                          environmentId: props.environmentId,
                          input: { threadId: props.threadId, taskId: task.taskId },
                        })}
                        waitingLabel="No output yet."
                      />
                    </div>
                  ) : null}
                  {childThreadId ? (
                    <InlineButton
                      onClick={() => {
                        setOpen(false);
                        props.onOpenThread(childThreadId);
                      }}
                    >
                      Open thread
                    </InlineButton>
                  ) : null}
                </section>
              );
            })}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
