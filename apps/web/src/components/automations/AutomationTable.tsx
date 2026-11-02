import {
  CircleAlertIcon,
  EllipsisIcon,
  FolderIcon,
  MessageSquareIcon,
  PencilIcon,
  PlayIcon,
  SendIcon,
  TrashIcon,
} from "@supaterm/icons";
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
import { useNowMinuteMs } from "../../hooks/useNowMinute";
import { cn } from "../../lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProjectFavicon } from "../ProjectFavicon";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { lastRunLabel, nextRunLabel, relativeLabel, scheduleSummary } from "./automations.logic";

const RUN_STATUS_BADGE = {
  failed: { Icon: CircleAlertIcon, variant: "error" },
  running: { Icon: SendIcon, variant: "info" },
} as const;

const WIDE_COLUMN = "hidden @4xl/automations:table-cell";

export interface AutomationTableEntry {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string;
  readonly task: ScheduledTask;
  readonly project: SidebarProjectSnapshot | null;
}

export function AutomationTable({
  entries,
  showProject,
  showEnvironment,
  onEdit,
}: {
  readonly entries: readonly AutomationTableEntry[];
  readonly showProject: boolean;
  readonly showEnvironment: boolean;
  readonly onEdit: (environmentId: EnvironmentId, task: ScheduledTask) => void;
}) {
  const now = useNowMinuteMs();
  return (
    <div className="@container/automations overflow-hidden rounded-[inherit]">
      <Table aria-label="Automations">
        <TableHeader>
          <TableRow>
            <TableHead className="w-full">
              <span className="ms-2">Automation</span>
            </TableHead>
            {showProject ? <TableHead className={WIDE_COLUMN}>Project</TableHead> : null}
            {showEnvironment ? <TableHead className={WIDE_COLUMN}>Environment</TableHead> : null}
            <TableHead className={WIDE_COLUMN}>
              <Popover>
                <PopoverTrigger
                  openOnHover
                  delay={250}
                  closeDelay={100}
                  render={
                    <button
                      type="button"
                      className="cursor-help rounded-sm underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    />
                  }
                >
                  Schedule
                </PopoverTrigger>
                <PopoverPopup side="top" tooltipStyle>
                  Fixed times use the environment's time zone.
                </PopoverPopup>
              </Popover>
            </TableHead>
            <TableHead className={WIDE_COLUMN}>Last run</TableHead>
            <TableHead>Next run</TableHead>
            <TableHead>
              <span className="sr-only">Enabled</span>
            </TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((entry) => (
            <AutomationRow
              key={`${entry.environmentId}:${entry.task.id}`}
              entry={entry}
              showProject={showProject}
              showEnvironment={showEnvironment}
              now={now}
              onEdit={() => onEdit(entry.environmentId, entry.task)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function AutomationRow({
  entry: { environmentId, environmentLabel, task, project },
  showProject,
  showEnvironment,
  now,
  onEdit,
}: {
  readonly entry: AutomationTableEntry;
  readonly showProject: boolean;
  readonly showEnvironment: boolean;
  readonly now: number;
  readonly onEdit: () => void;
}) {
  const navigate = useNavigate();
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const threadRef = task.threadId ? scopeThreadRef(environmentId, task.threadId) : null;
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
  const titleTone = task.enabled ? "text-foreground" : "text-muted-foreground";
  const projectLabel = project?.displayName ?? "Project removed";
  const schedule = scheduleSummary(task.schedule);
  const details = [
    showProject ? projectLabel : null,
    showEnvironment ? environmentLabel : null,
    schedule,
  ].filter((detail) => detail !== null);

  return (
    <TableRow
      className={cn(canOperate && "cursor-pointer")}
      onClick={(event) => {
        // Controls in the row and its portaled menu handle their own clicks.
        if (
          !(event.target instanceof Element) ||
          !event.currentTarget.contains(event.target) ||
          event.target.closest("button, input, [role=switch]")
        ) {
          return;
        }
        edit();
      }}
    >
      <TableCell className="max-w-0">
        <div className="ms-2">
          {canOperate ? (
            <button
              type="button"
              onClick={edit}
              className={cn(
                "block max-w-full cursor-pointer truncate rounded-sm text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                titleTone,
              )}
            >
              {task.title}
            </button>
          ) : (
            <span className={cn("block truncate text-sm", titleTone)}>{task.title}</span>
          )}
          <span className="block truncate text-muted-foreground @4xl/automations:hidden">
            {details.join(" · ")}
          </span>
          {task.lastRunError ? (
            <Popover>
              <PopoverTrigger
                openOnHover
                delay={250}
                closeDelay={100}
                render={
                  <button
                    type="button"
                    className="block max-w-full cursor-help truncate rounded-sm text-left text-destructive outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  />
                }
              >
                {task.lastRunError}
              </PopoverTrigger>
              <PopoverPopup side="bottom" align="start" tooltipStyle className="w-max max-w-sm">
                <p className="max-h-60 overflow-y-auto whitespace-normal wrap-anywhere">
                  {task.lastRunError}
                </p>
              </PopoverPopup>
            </Popover>
          ) : null}
        </div>
      </TableCell>
      {showProject ? (
        <TableCell className={WIDE_COLUMN}>
          <span className="flex max-w-40 items-center gap-1.5 text-muted-foreground">
            {project ? (
              <ProjectFavicon project={project} className="pointer-events-none" />
            ) : (
              <FolderIcon aria-hidden className="size-3.5 shrink-0" />
            )}
            <span className="truncate">{projectLabel}</span>
          </span>
        </TableCell>
      ) : null}
      {showEnvironment ? (
        <TableCell className={WIDE_COLUMN}>
          <span className="block max-w-36 truncate text-muted-foreground">{environmentLabel}</span>
        </TableCell>
      ) : null}
      <TableCell className={WIDE_COLUMN}>
        <span className="tabular-nums text-muted-foreground">{schedule}</span>
      </TableCell>
      <TableCell className={WIDE_COLUMN}>
        <LastRunStatus task={task} now={now} />
      </TableCell>
      <TableCell>
        <span className="tabular-nums text-muted-foreground">
          {task.enabled && task.nextRunAt
            ? relativeLabel(task.nextRunAt, now)
            : nextRunLabel(task, now)}
        </span>
      </TableCell>
      <TableCell>
        <span className="flex items-center">
          <Switch
            checked={task.enabled}
            disabled={busy || !canOperate}
            hitArea="comfortable"
            aria-label={task.enabled ? `Pause ${task.title}` : `Resume ${task.title}`}
            onCheckedChange={() => void act("toggle")}
          />
        </span>
      </TableCell>
      <TableCell>
        <Menu>
          <MenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost-muted"
                className="me-1"
                disabled={busy}
                aria-label={`Actions for ${task.title}`}
              />
            }
          >
            <EllipsisIcon />
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
              <TrashIcon />
              {confirm.armed === "delete" ? "Confirm delete" : "Delete"}
            </MenuItem>
          </MenuPopup>
        </Menu>
      </TableCell>
    </TableRow>
  );
}

export function AutomationTableSkeleton() {
  return (
    <div aria-hidden className="divide-y divide-border/50">
      <div className="flex h-10 items-center px-4">
        <div className="h-3 w-20 rounded bg-muted/60" />
      </div>
      {[0, 1].map((index) => (
        <div key={index} className="flex h-12 items-center gap-4 px-4 sm:h-11">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="ms-auto h-3 w-12 rounded bg-muted/60" />
          <div className="h-4.5 w-7.5 rounded-full bg-muted/60" />
          <div className="size-4 rounded bg-muted/60" />
        </div>
      ))}
    </div>
  );
}

function LastRunStatus({ task, now }: { readonly task: ScheduledTask; readonly now: number }) {
  const status = task.lastRunStatus;
  const label = lastRunLabel(task, now);
  if (status === "never" || status === "succeeded") {
    return <span className="tabular-nums text-muted-foreground">{label ?? "Never"}</span>;
  }
  const { Icon, variant } = RUN_STATUS_BADGE[status];
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {label}
    </Badge>
  );
}
