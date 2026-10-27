import type {
  EnvironmentId,
  PullRequestAction,
  PullRequestMergeMethod,
  PullRequestUpdateMethod,
} from "@supaterm/contracts";
import { ChevronDownIcon, FolderGitIcon, GitBranchIcon, PlayIcon } from "@supaterm/icons";
import type { ReactNode } from "react";

import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { cn } from "~/lib/utils";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { InlineConfirmIcon, InlineConfirmLabel } from "../InlineConfirm";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { resolvePullRequestPrimaryControl } from "./pullRequestDetail.logic";
import { PullRequestGlyph } from "./pullRequestIcons";
import type { resolvePullRequestState } from "./pullRequestPresentation";
import type { PickableEnvironment } from "./pullRequestProjectAssignment.logic";

export type PerformPullRequestAction = (
  action: PullRequestAction,
  method?: PullRequestMergeMethod,
  updateMethod?: PullRequestUpdateMethod,
) => Promise<boolean>;

export function ActOnEnvironmentPicker({
  environments,
  value,
  onChange,
  disabled,
}: {
  environments: ReadonlyArray<PickableEnvironment>;
  value: EnvironmentId;
  onChange: (environmentId: EnvironmentId) => void;
  disabled: boolean;
}) {
  return (
    <>
      <MenuSeparator />
      <MenuRadioGroup
        value={value}
        onValueChange={(environmentId) => onChange(environmentId as EnvironmentId)}
      >
        {environments.map((environment) => (
          <MenuRadioItem
            key={environment.environmentId}
            value={environment.environmentId}
            disabled={disabled}
          >
            <span className="flex min-w-0 items-center gap-2">
              <EnvironmentMachineIcon
                kind={environment.machine ?? "server"}
                className="size-3.5 shrink-0"
              />
              <span className="truncate">{environment.label}</span>
            </span>
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </>
  );
}

export function PullRequestCheckoutMenu({
  handoff,
  checkoutRoot,
  canPrepareWorktree,
  canCheckoutHere,
  onCheckout,
  pickableEnvironments,
  actingEnvironmentId,
  onActingEnvironmentChange,
}: {
  handoff: string | null;
  checkoutRoot: string | null;
  canPrepareWorktree: boolean;
  canCheckoutHere: boolean;
  onCheckout: (mode: "worktree" | "local") => void;
  pickableEnvironments: ReadonlyArray<PickableEnvironment>;
  actingEnvironmentId: EnvironmentId;
  onActingEnvironmentChange: (environmentId: EnvironmentId) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              disabled={handoff !== null || checkoutRoot === null}
              render={
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={handoff?.startsWith("checkout") ? "Checking out..." : "Check out"}
                >
                  <GitBranchIcon aria-hidden className="size-3.5" />
                  <span className="@max-[35rem]/pr-header:hidden">
                    {handoff?.startsWith("checkout") ? "Checking out..." : "Check out"}
                  </span>
                  <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup>Check out this pull request</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom">
        <MenuItem disabled={!canPrepareWorktree} onClick={() => onCheckout("worktree")}>
          <GitBranchIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>In a separate worktree</span>
            <span className="text-xs text-muted-foreground">
              Its own folder and thread. Nothing you have open moves.
            </span>
          </span>
        </MenuItem>
        <MenuItem disabled={!canCheckoutHere} onClick={() => onCheckout("local")}>
          <FolderGitIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>In this repository</span>
            <span className="text-xs text-muted-foreground">
              Switches the branch you are working in, like `gh pr checkout`.
            </span>
          </span>
        </MenuItem>
        {pickableEnvironments.length > 0 ? (
          <ActOnEnvironmentPicker
            environments={pickableEnvironments}
            value={actingEnvironmentId}
            onChange={onActingEnvironmentChange}
            disabled={handoff !== null}
          />
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

export function PullRequestResolveConflictsButton({
  handoff,
  unavailable,
  onResolve,
}: {
  handoff: string | null;
  unavailable: boolean;
  onResolve: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex shrink-0">
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={handoff !== null || unavailable}
              onClick={onResolve}
              aria-label={handoff === "conflicts" ? "Preparing..." : "Resolve conflicts"}
            >
              <PullRequestGlyph.conflicting aria-hidden className="size-3.5" />
              <span className="@max-[30rem]/pr-header:hidden">
                {handoff === "conflicts" ? "Preparing..." : "Resolve conflicts"}
              </span>
            </Button>
          </span>
        }
      />
      <TooltipPopup side="top">
        {handoff === "conflicts" ? "Preparing..." : "Resolve conflicts"}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The header's one prominent control, which depends on where the pull request stands. */
export function PullRequestPrimaryAction({
  pullRequestNumber,
  baseBranch,
  primaryAction,
  autoMergeArmed,
  canDisableAutoMerge,
  armedAutoMergeLabel,
  pendingAutoMergeLabel,
  selectedMergeMethod,
  selectedMergeMethodLabel,
  statePresentation,
  pendingAction,
  perform,
  resolveConflicts,
}: {
  pullRequestNumber: number;
  baseBranch: string;
  primaryAction: ReturnType<typeof resolvePullRequestPrimaryControl> | null;
  autoMergeArmed: boolean;
  canDisableAutoMerge: boolean;
  armedAutoMergeLabel: string;
  pendingAutoMergeLabel: string;
  selectedMergeMethod: PullRequestMergeMethod;
  selectedMergeMethodLabel: string;
  statePresentation: ReturnType<typeof resolvePullRequestState> | null;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
  resolveConflicts: ReactNode;
}) {
  const confirm = useInlineConfirm<"merge" | "enable-auto-merge">();
  const actionPending = pendingAction !== null;
  const disableAutoMergeLabel =
    pendingAction === "disable-auto-merge" ? "Disabling..." : "Disable auto-merge";
  // The off switch doubles as the indicator, as on the host.
  const armedAutoMergeStatus = `${armedAutoMergeLabel} is enabled: the host will merge this on its own once its requirements are met`;
  return (
    <>
      {/* Said where the Merge button is, because it is the answer to why nobody has
          pressed it: the merge is already asked for, and the host is holding it. It
          stays beside conflicts and drafts, which take the slot without disarming it. */}
      {autoMergeArmed ? (
        <Tooltip>
          <TooltipTrigger
            render={
              canDisableAutoMerge ? (
                <span className="inline-flex shrink-0">
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={actionPending}
                    onClick={() => void perform("disable-auto-merge")}
                    aria-label={disableAutoMergeLabel}
                  >
                    <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                    <span className="@max-[30rem]/pr-header:hidden">{disableAutoMergeLabel}</span>
                  </Button>
                </span>
              ) : (
                <Badge
                  size="control"
                  variant="info"
                  role="img"
                  aria-label={`${armedAutoMergeLabel} enabled`}
                >
                  <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                  <span className="@max-[30rem]/pr-header:hidden">Auto-merge enabled</span>
                </Badge>
              )
            }
          />
          <TooltipPopup side="top">
            {!canDisableAutoMerge
              ? armedAutoMergeStatus
              : pendingAction === "disable-auto-merge"
                ? "Disabling..."
                : `${armedAutoMergeStatus}. Click to disable it.`}
          </TooltipPopup>
        </Tooltip>
      ) : null}
      {primaryAction === "resolve" ? (
        resolveConflicts
      ) : primaryAction === "ready" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex shrink-0">
                <Button
                  size="xs"
                  variant="default"
                  disabled={actionPending}
                  onClick={() => void perform("ready")}
                  aria-label="Ready for review"
                >
                  <PullRequestGlyph.pullRequest aria-hidden className="size-3.5" />
                  <span className="@max-[30rem]/pr-header:hidden">Ready for review</span>
                </Button>
              </span>
            }
          />
          <TooltipPopup side="top">Ready for review</TooltipPopup>
        </Tooltip>
      ) : primaryAction === "enable-auto-merge" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex shrink-0">
                <Button
                  size="xs"
                  variant="default"
                  disabled={actionPending}
                  {...confirm.bind(
                    "enable-auto-merge",
                    () => void perform("enable-auto-merge", selectedMergeMethod),
                  )}
                  aria-label={
                    pendingAction === "enable-auto-merge"
                      ? "Enabling..."
                      : confirm.armed === "enable-auto-merge"
                        ? "Confirm auto-merge"
                        : pendingAutoMergeLabel
                  }
                >
                  <InlineConfirmIcon armed={confirm.armed === "enable-auto-merge"}>
                    <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                  </InlineConfirmIcon>
                  <span className="@max-[30rem]/pr-header:hidden">
                    <InlineConfirmLabel
                      armed={confirm.armed === "enable-auto-merge"}
                      idle={
                        pendingAction === "enable-auto-merge"
                          ? "Enabling..."
                          : pendingAutoMergeLabel
                      }
                      confirm="Confirm auto-merge"
                    />
                  </span>
                </Button>
              </span>
            }
          />
          <TooltipPopup side="top">
            {pendingAction === "enable-auto-merge"
              ? "Enabling..."
              : confirm.armed === "enable-auto-merge"
                ? `Click again to enable auto-merge. The host may merge #${pullRequestNumber} right away.`
                : pendingAutoMergeLabel}
          </TooltipPopup>
        </Tooltip>
      ) : primaryAction === "merge" ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex shrink-0">
                <Button
                  size="xs"
                  variant="default"
                  disabled={actionPending}
                  {...confirm.bind("merge", () => void perform("merge", selectedMergeMethod))}
                  aria-label={
                    pendingAction === "merge"
                      ? "Merging..."
                      : confirm.armed === "merge"
                        ? "Confirm merge"
                        : selectedMergeMethodLabel
                  }
                >
                  <InlineConfirmIcon armed={confirm.armed === "merge"}>
                    <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                  </InlineConfirmIcon>
                  <span className="@max-[30rem]/pr-header:hidden">
                    <InlineConfirmLabel
                      armed={confirm.armed === "merge"}
                      idle={pendingAction === "merge" ? "Merging..." : selectedMergeMethodLabel}
                      confirm="Confirm merge"
                    />
                  </span>
                </Button>
              </span>
            }
          />
          <TooltipPopup side="top">
            {pendingAction === "merge"
              ? "Merging..."
              : confirm.armed === "merge"
                ? `Click again to ${selectedMergeMethodLabel.toLowerCase()} #${pullRequestNumber} into ${baseBranch}`
                : selectedMergeMethodLabel}
          </TooltipPopup>
        </Tooltip>
      ) : (primaryAction === "merged" || primaryAction === "closed") &&
        statePresentation !== null ? (
        <Badge size="control" variant="outline">
          <span className={cn("flex items-center gap-1", statePresentation.toneClassName)}>
            <statePresentation.Icon className="size-3.5" />
            {statePresentation.label}
          </span>
        </Badge>
      ) : null}
    </>
  );
}

export function PullRequestApproveWorkflowsButton({
  pullRequestNumber,
  workflowApprovalsRequired,
  pendingAction,
  perform,
}: {
  pullRequestNumber: number;
  workflowApprovalsRequired: number;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
}) {
  const confirm = useInlineConfirm<"approve-workflows">();
  const actionPending = pendingAction !== null;
  const armed = confirm.armed === "approve-workflows";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="ml-auto inline-flex shrink-0">
            <Button
              size="xs"
              variant="warning-outline"
              disabled={actionPending}
              {...confirm.bind("approve-workflows", () => void perform("approve-workflows"))}
              aria-label={
                pendingAction === "approve-workflows"
                  ? "Approving..."
                  : armed
                    ? "Confirm approval"
                    : "Approve workflows to run"
              }
            >
              <InlineConfirmIcon armed={armed}>
                <PlayIcon aria-hidden className="size-3.5" />
              </InlineConfirmIcon>
              <InlineConfirmLabel
                armed={armed}
                idle={
                  pendingAction === "approve-workflows"
                    ? "Approving..."
                    : "Approve workflows to run"
                }
                confirm="Confirm approval"
              />
            </Button>
          </span>
        }
      />
      <TooltipPopup side="top">
        {pendingAction === "approve-workflows"
          ? "Approving..."
          : armed
            ? `Click again to let ${workflowApprovalsRequired} ${workflowApprovalsRequired === 1 ? "workflow" : "workflows"} from #${pullRequestNumber} run. Review the code and workflow changes first.`
            : "Approve workflows to run"}
      </TooltipPopup>
    </Tooltip>
  );
}
