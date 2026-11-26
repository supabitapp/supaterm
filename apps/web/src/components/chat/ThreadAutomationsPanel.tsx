import { useAtomValue } from "@effect/atom-react";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { useNavigate } from "@tanstack/react-router";
import { CalendarClockIcon, PencilIcon, PlayIcon, SlidersHorizontalIcon } from "@supaterm/icons";
import { useState } from "react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type ScheduledTask,
  type ThreadId,
} from "@supaterm/contracts";
import type { TimestampFormat } from "@supaterm/contracts/settings";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";

import { ThreadDetailsSection } from "./ThreadDetailsSection";
import { cn } from "../../lib/utils";
import { useNowMinuteMs } from "../../hooks/useNowMinute";
import { useClientSettings } from "../../hooks/useSettings";
import { lastRunLabel, nextRunLabel, scheduleLabel } from "../automations/automations.logic";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

import { readEnvironmentScope } from "../../state/session";
import { Switch } from "../ui/switch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
  THREAD_DETAILS_PANEL_ROW_HEIGHT_CLASS,
} from "./threadDetailsPanelStyles";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import type { MessageResolver } from "../../i18n/messages";

const STATUS_DOT_CLASS: Record<ScheduledTask["lastRunStatus"], string> = {
  never: "bg-muted-foreground/40",
  running: "bg-sky-500",
  succeeded: "bg-emerald-500",
  failed: "bg-destructive",
};

/** The automation icon with a last-run status dot, labelled for hover and screen readers. */
function AutomationStatusIcon({ task, now }: { task: ScheduledTask; now: number }) {
  const gt = useGT();
  const m = useMessages();
  const label = lastRunLabel(task, now, m) ?? gt("Not run yet");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center" />
        }
      >
        <CalendarClockIcon className={THREAD_DETAILS_PANEL_ICON_CLASS} />
        <span
          className={cn(
            "absolute -right-1 -top-1 size-1.5 rounded-full",
            STATUS_DOT_CLASS[task.lastRunStatus],
          )}
          aria-hidden
        />
        <span className="sr-only">{label}</span>
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}

function taskScheduleLine(
  task: ScheduledTask,
  now: number,
  timestampFormat: TimestampFormat,
  timeZone: string | undefined,
  resolve: MessageResolver,
) {
  const schedule = scheduleLabel(task.schedule, timestampFormat, timeZone, task.nextRunAt, resolve);
  if (!task.enabled) return resolve(msg("{schedule} · paused", { schedule }));
  if (task.nextRunAt === null) return schedule;
  return `${schedule} · ${nextRunLabel(task, now, resolve)}`;
}

export function ThreadAutomationsPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const gt = useGT();
  const m = useMessages();
  const canOperate = useAtomValue(
    serverEnvironment.runScheduledTaskNow.permissionAtom(props.environmentId),
  );
  const tasksQuery = useEnvironmentQuery(
    serverEnvironment.scheduledTasksLive({ environmentId: props.environmentId, input: {} }),
  );
  const setTaskEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "thread automation toggle",
  });
  const runTaskNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "thread automation run now",
  });
  const navigate = useNavigate();
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const now = useNowMinuteMs();
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);

  const boundTasks = (tasksQuery.data?.tasks ?? []).filter(
    (task) => task.threadId === props.threadId,
  );

  if (tasksQuery.error === null && boundTasks.length === 0) return null;

  const reportFailure = (title: string, error: unknown) => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title,
        description: error instanceof Error ? error.message : String(error),
      }),
    );
  };

  const toggleEnabled = async (task: ScheduledTask, enabled: boolean) => {
    if (
      busyTaskId !== null ||
      !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    setBusyTaskId(task.id);
    // Partial update: only the enabled flag changes, so a toggle can never
    // revert concurrent edits made to the task elsewhere.
    const result = await setTaskEnabled({
      environmentId: props.environmentId,
      input: { id: task.id, enabled },
    });
    setBusyTaskId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(gt("Could not update automation"), squashAtomCommandFailure(result));
    }
  };

  const runNow = async (task: ScheduledTask) => {
    if (
      busyTaskId !== null ||
      !readEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope)
    )
      return;
    setBusyTaskId(task.id);
    const result = await runTaskNow({
      environmentId: props.environmentId,
      input: { id: task.id },
    });
    setBusyTaskId(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportFailure(gt("Could not run automation"), squashAtomCommandFailure(result));
    }
  };

  return (
    <ThreadDetailsSection
      headingId="thread-details-automations-heading"
      title={gt("Automations")}
      data-thread-automations-panel
      actions={
        <Tooltip>
          <TooltipTrigger
            render={
              <ThreadDetailsControl
                size="icon-xs"
                variant="ghost"
                part="icon"
                aria-label={gt("Manage automations")}
                onClick={() => void navigate({ to: "/automations" })}
              >
                <SlidersHorizontalIcon className="size-3.5" />
              </ThreadDetailsControl>
            }
          />
          <TooltipPopup>
            <T>Manage automations</T>
          </TooltipPopup>
        </Tooltip>
      }
    >
      <ul className="m-0 max-h-[13.5rem] list-none overflow-y-auto p-0">
        {boundTasks.map((task) => (
          <li
            key={task.id}
            className={cn(
              "group flex items-center rounded-lg",
              THREAD_DETAILS_PANEL_ROW_HEIGHT_CLASS,
              THREAD_DETAILS_PANEL_ROW_CONTENT_CLASS,
              "h-auto min-h-8",
            )}
          >
            <AutomationStatusIcon task={task} now={now} />
            <Tooltip>
              <TooltipTrigger render={<div className="min-w-0 flex-1" />}>
                <span className="block truncate text-xs font-medium text-foreground/80">
                  {task.title}
                </span>
                <p className="truncate text-2xs text-muted-foreground">
                  {taskScheduleLine(task, now, timestampFormat, tasksQuery.data?.timeZone, m)}
                </p>
              </TooltipTrigger>
              <TooltipPopup side="left">
                <p className="font-medium">{task.title}</p>
                <p className="text-muted-foreground">
                  {taskScheduleLine(task, now, timestampFormat, tasksQuery.data?.timeZone, m)}
                </p>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="icon-xs"
                    variant="ghost"
                    part="icon"
                    aria-label={gt("Edit {title}", { title: task.title })}
                    onClick={() =>
                      void navigate({
                        to: "/automations",
                        search: { environmentId: props.environmentId, taskId: task.id },
                      })
                    }
                  >
                    <PencilIcon className="size-3.5" />
                  </ThreadDetailsControl>
                }
              />
              <TooltipPopup>
                <T>Edit automation</T>
              </TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <ThreadDetailsControl
                    size="icon-xs"
                    variant="ghost"
                    part="icon"
                    aria-label={gt("Run {title} now", { title: task.title })}
                    disabled={
                      !canOperate || busyTaskId !== null || task.lastRunStatus === "running"
                    }
                    onClick={() => void runNow(task)}
                  >
                    <PlayIcon className="size-3.5" />
                  </ThreadDetailsControl>
                }
              />
              <TooltipPopup>
                <T>Run now</T>
              </TooltipPopup>
            </Tooltip>
            <Switch
              checked={task.enabled}
              disabled={!canOperate || busyTaskId !== null}
              aria-label={
                task.enabled
                  ? gt("Pause {title}", { title: task.title })
                  : gt("Resume {title}", { title: task.title })
              }
              onCheckedChange={(enabled) => void toggleEnabled(task, enabled)}
            />
          </li>
        ))}
      </ul>
      {/* Kept last: the details card treats a section whose last child is empty as empty. */}
      {tasksQuery.error !== null ? (
        <p className="px-2.5 py-1.5 text-2xs text-destructive">
          <T>
            Could not load automations: <Var>{tasksQuery.error}</Var>
          </T>
        </p>
      ) : null}
    </ThreadDetailsSection>
  );
}
