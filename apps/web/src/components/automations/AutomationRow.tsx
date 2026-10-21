import {
  CheckIcon,
  CircleAlertIcon,
  Clock3Icon,
  FolderIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlayIcon,
  SendIcon,
  Trash2Icon,
} from "lucide-react";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentId, ScheduledTask } from "@supaterm/contracts";
import { AuthOrchestrationOperateScope } from "@supaterm/contracts";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";

import { useInlineConfirm } from "../../hooks/useInlineConfirm";
import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useThreadShell } from "../../state/entities";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProjectFavicon } from "../ProjectFavicon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Switch } from "../ui/switch";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { lastRunLabel, nextRunLabel, scheduleLabel } from "./automations.logic";

const RUN_STATUS_BADGE = {
  failed: { Icon: CircleAlertIcon, variant: "error" },
  running: { Icon: SendIcon, variant: "info" },
} as const;

export function AutomationRow({
  environmentId,
  task,
  project,
  now,
  onEdit,
}: {
  readonly environmentId: EnvironmentId;
  readonly task: ScheduledTask;
  readonly project: SidebarProjectSnapshot | null;
  readonly now: number;
  readonly onEdit: () => void;
}) {
  const navigate = useNavigate();
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const threadRef = task.threadId ? scopeThreadRef(environmentId, task.threadId) : null;
  const thread = useThreadShell(threadRef);
  const [busy, setBusy] = useState(false);
  const confirm = useInlineConfirm<"delete">();
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    label: "scheduled task enabled",
  });
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    label: "scheduled task run now",
  });
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    label: "scheduled task delete",
  });
  const edit = () => {
    if (readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) onEdit();
  };
  const act = async (action: "toggle" | "run" | "delete") => {
    if (busy || !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope)) return;
    setBusy(true);
    const result =
      action === "toggle"
        ? await toggle({ environmentId, input: { id: task.id, enabled: !task.enabled } })
        : action === "run"
          ? await run({ environmentId, input: { id: task.id } })
          : await remove({ environmentId, input: { id: task.id } });
    setBusy(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not update automation",
          description: String(squashAtomCommandFailure(result)),
        }),
      );
    }
  };
  const target = threadRef ? (thread?.title ?? "Its thread") : "New thread each run";
  return (
    <article className="flex min-w-0 flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h3
            className={cn(
              "text-sm leading-5 font-medium text-balance wrap-anywhere",
              !task.enabled && "text-muted-foreground",
            )}
          >
            {task.title}
          </h3>
          <p className="line-clamp-2 max-w-[72ch] text-xs leading-5 text-muted-foreground wrap-anywhere">
            {task.prompt}
          </p>
        </div>
        <div className="-mt-3 flex shrink-0 items-center gap-1 sm:-mt-2.5">
          <div className="flex size-11 items-center justify-center sm:size-10">
            <Switch
              checked={task.enabled}
              disabled={busy || !canOperate}
              hitArea="comfortable"
              aria-label={task.enabled ? `Pause ${task.title}` : `Resume ${task.title}`}
              onCheckedChange={() => void act("toggle")}
            />
          </div>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-xl"
                  variant="ghost-muted"
                  disabled={busy}
                  aria-label={`Actions for ${task.title}`}
                />
              }
            >
              <MoreHorizontalIcon className="size-4" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem disabled={!canOperate} onClick={edit}>
                <PencilIcon />
                Edit
              </MenuItem>
              <MenuItem
                disabled={!canOperate || task.lastRunStatus === "running"}
                onClick={() => void act("run")}
              >
                <PlayIcon />
                Run now
              </MenuItem>
              {threadRef ? (
                <MenuItem
                  onClick={() =>
                    void navigate({
                      to: "/$environmentId/$threadId",
                      params: buildThreadRouteParams(threadRef),
                    })
                  }
                >
                  <MessageSquareIcon />
                  Open thread
                </MenuItem>
              ) : null}
              <MenuSeparator />
              <MenuItem
                disabled={!canOperate}
                {...confirm.bind("delete", () => void act("delete"))}
                variant="destructive"
              >
                <Trash2Icon />
                {confirm.armed === "delete" ? "Confirm delete" : "Delete"}
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <Tooltip>
          <TooltipTrigger render={<span className="flex min-w-0 max-w-full items-center gap-2" />}>
            {project ? (
              <ProjectFavicon project={project} className="pointer-events-none size-4" />
            ) : (
              <FolderIcon aria-hidden className="size-4 shrink-0" />
            )}
            <span className="truncate text-foreground/80">
              {project?.displayName ?? "Project removed"}
            </span>
          </TooltipTrigger>
          <TooltipPopup>{project?.displayName ?? "Project removed"}</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<span className="flex min-w-0 max-w-full items-center gap-2" />}>
            <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
            <span className="truncate">{target}</span>
          </TooltipTrigger>
          <TooltipPopup>{target}</TooltipPopup>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-xs tabular-nums">
        <p className="flex min-w-0 items-start gap-2 text-muted-foreground">
          <Clock3Icon aria-hidden className="size-4 shrink-0" />
          <span>{scheduleLabel(task.schedule)}</span>
        </p>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5">
          <LastRunStatus task={task} now={now} />
          <Badge variant="secondary">{nextRunLabel(task, now)}</Badge>
        </div>
      </div>
      {task.lastRunError ? (
        <p className="flex items-start gap-1.5 text-xs leading-5 text-destructive wrap-anywhere">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {task.lastRunError}
        </p>
      ) : null}
    </article>
  );
}

export function AutomationRowSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4 px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-col gap-2">
        <div className="h-5 w-1/3 rounded bg-muted" />
        <div className="h-10 w-4/5 rounded bg-muted/60" />
      </div>
      <div className="h-4 w-1/2 rounded bg-muted/60" />
      <div className="flex items-center justify-between gap-4">
        <div className="h-4 w-1/3 rounded bg-muted/60" />
        <div className="h-5.5 w-24 rounded-sm bg-muted/60 sm:h-4.5" />
      </div>
    </div>
  );
}

function LastRunStatus({ task, now }: { readonly task: ScheduledTask; readonly now: number }) {
  const status = task.lastRunStatus;
  if (status === "never") return null;
  const label = lastRunLabel(task, now);
  if (status === "succeeded") {
    return (
      <span className="flex items-center gap-2 text-muted-foreground">
        <CheckIcon aria-hidden className="size-4 shrink-0" />
        {label}
      </span>
    );
  }
  const { Icon, variant } = RUN_STATUS_BADGE[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
