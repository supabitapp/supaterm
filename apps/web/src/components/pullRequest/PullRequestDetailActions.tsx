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
import { InlineConfirmIcon, InlineConfirmLabel, InlineConfirmTooltip } from "../InlineConfirm";
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
import { Branch, T, useGT } from "gt-react";
import { changeRequestTermKind } from "./changeRequestTerm";

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
  term,
}: {
  handoff: string | null;
  checkoutRoot: string | null;
  canPrepareWorktree: boolean;
  canCheckoutHere: boolean;
  onCheckout: (mode: "worktree" | "local") => void;
  pickableEnvironments: ReadonlyArray<PickableEnvironment>;
  actingEnvironmentId: EnvironmentId;
  onActingEnvironmentChange: (environmentId: EnvironmentId) => void;
  /** The host's word for a change request, as in "pull request". */
  term: string;
}) {
  const gt = useGT();
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
                  aria-label={
                    handoff?.startsWith("checkout") ? gt("Checking out...") : gt("Check out")
                  }
                >
                  <GitBranchIcon aria-hidden className="size-3.5" />
                  <span className="@max-[35rem]/pr-header:hidden">
                    {handoff?.startsWith("checkout") ? gt("Checking out...") : gt("Check out")}
                  </span>
                  <ChevronDownIcon aria-hidden className="size-3.5 text-muted-foreground" />
                </Button>
              }
            />
          }
        />
        <TooltipPopup>
          <T>
            Check out this{" "}
            <Branch
              branch={changeRequestTermKind({ singular: term })}
              mr="merge request"
              cr="change request"
            >
              pull request
            </Branch>
          </T>
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom">
        <MenuItem disabled={!canPrepareWorktree} onClick={() => onCheckout("worktree")}>
          <GitBranchIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>
              <T>In a separate worktree</T>
            </span>
            <span className="text-xs text-muted-foreground">
              <T>Its own folder and thread. Nothing you have open moves.</T>
            </span>
          </span>
        </MenuItem>
        <MenuItem disabled={!canCheckoutHere} onClick={() => onCheckout("local")}>
          <FolderGitIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>
              <T>In this repository</T>
            </span>
            <span className="text-xs text-muted-foreground">
              <T>Switches the branch you are working in.</T>
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
  const gt = useGT();
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
              aria-label={handoff === "conflicts" ? gt("Preparing...") : gt("Resolve conflicts")}
            >
              <PullRequestGlyph.conflicting aria-hidden className="size-3.5" />
              <span className="@max-[30rem]/pr-header:hidden">
                {handoff === "conflicts" ? gt("Preparing...") : gt("Resolve conflicts")}
              </span>
            </Button>
          </span>
        }
      />
      <TooltipPopup side="top">
        {handoff === "conflicts" ? gt("Preparing...") : gt("Resolve conflicts")}
      </TooltipPopup>
    </Tooltip>
  );
}

/** The header's one prominent control, which depends on where the pull request stands. */
export function PullRequestPrimaryAction({
  pullRequestNumber,
  baseBranch,
  primaryAction,
  mergeBlockedReason,
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
  mergeBlockedReason: string | null;
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
  const gt = useGT();
  const confirm = useInlineConfirm<"merge" | "enable-auto-merge">();
  const actionPending = pendingAction !== null;
  const disableAutoMergeLabel =
    pendingAction === "disable-auto-merge" ? gt("Disabling...") : gt("Disable auto-merge");
  // The off switch doubles as the indicator, as on the host.
  const armedAutoMergeStatus = gt(
    "{label} is enabled: the host will merge this on its own once its requirements are met",
    { label: armedAutoMergeLabel },
  );
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
                  aria-label={gt("{label} enabled", { label: armedAutoMergeLabel })}
                >
                  <PullRequestGlyph.merged aria-hidden className="size-3.5" />
                  <span className="@max-[30rem]/pr-header:hidden">
                    <T>Auto-merge enabled</T>
                  </span>
                </Badge>
              )
            }
          />
          <TooltipPopup side="top">
            {!canDisableAutoMerge
              ? armedAutoMergeStatus
              : pendingAction === "disable-auto-merge"
                ? gt("Disabling...")
                : gt("{status}. Click to disable it.", { status: armedAutoMergeStatus })}
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
                  aria-label={gt("Ready for review")}
                >
                  <PullRequestGlyph.pullRequest aria-hidden className="size-3.5" />
                  <span className="@max-[30rem]/pr-header:hidden">
                    <T>Ready for review</T>
                  </span>
                </Button>
              </span>
            }
          />
          <TooltipPopup side="top">
            <T>Ready for review</T>
          </TooltipPopup>
        </Tooltip>
      ) : primaryAction === "enable-auto-merge" ? (
        <InlineConfirmTooltip
          armed={confirm.armed === "enable-auto-merge"}
          render={<span className="inline-flex shrink-0" />}
          tip={
            mergeBlockedReason ??
            (pendingAction === "enable-auto-merge" ? gt("Enabling...") : pendingAutoMergeLabel)
          }
          armedTip={gt(
            "Click again to enable auto-merge. The host may merge #{pullRequestNumber} right away.",
            { pullRequestNumber },
          )}
        >
          <Button
            size="xs"
            variant="default"
            disabled={actionPending}
            aria-disabled={mergeBlockedReason !== null || undefined}
            aria-description={mergeBlockedReason ?? undefined}
            {...(mergeBlockedReason === null
              ? confirm.bind(
                  "enable-auto-merge",
                  () => void perform("enable-auto-merge", selectedMergeMethod),
                )
              : {})}
            aria-label={
              pendingAction === "enable-auto-merge"
                ? gt("Enabling...")
                : confirm.armed === "enable-auto-merge"
                  ? gt("Confirm auto-merge")
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
                  pendingAction === "enable-auto-merge" ? gt("Enabling...") : pendingAutoMergeLabel
                }
                confirm={gt("Confirm auto-merge")}
              />
            </span>
          </Button>
        </InlineConfirmTooltip>
      ) : primaryAction === "merge" ? (
        <InlineConfirmTooltip
          armed={confirm.armed === "merge"}
          render={<span className="inline-flex shrink-0" />}
          tip={
            mergeBlockedReason ??
            (pendingAction === "merge" ? gt("Merging...") : selectedMergeMethodLabel)
          }
          armedTip={gt("Click again to {method} #{number} into {base}", {
            method: selectedMergeMethodLabel.toLowerCase(),
            number: pullRequestNumber,
            base: baseBranch,
          })}
        >
          <Button
            size="xs"
            variant="default"
            disabled={actionPending}
            aria-disabled={mergeBlockedReason !== null || undefined}
            aria-description={mergeBlockedReason ?? undefined}
            {...(mergeBlockedReason === null
              ? confirm.bind("merge", () => void perform("merge", selectedMergeMethod))
              : {})}
            aria-label={
              pendingAction === "merge"
                ? gt("Merging...")
                : confirm.armed === "merge"
                  ? gt("Confirm merge")
                  : selectedMergeMethodLabel
            }
          >
            <InlineConfirmIcon armed={confirm.armed === "merge"}>
              <PullRequestGlyph.merged aria-hidden className="size-3.5" />
            </InlineConfirmIcon>
            <span className="@max-[30rem]/pr-header:hidden">
              <InlineConfirmLabel
                armed={confirm.armed === "merge"}
                idle={pendingAction === "merge" ? gt("Merging...") : selectedMergeMethodLabel}
                confirm={gt("Confirm merge")}
              />
            </span>
          </Button>
        </InlineConfirmTooltip>
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
  const gt = useGT();
  const confirm = useInlineConfirm<"approve-workflows">();
  const actionPending = pendingAction !== null;
  const armed = confirm.armed === "approve-workflows";
  return (
    <InlineConfirmTooltip
      armed={armed}
      render={<span className="ml-auto inline-flex shrink-0" />}
      tip={
        pendingAction === "approve-workflows" ? gt("Approving...") : gt("Approve workflows to run")
      }
      armedTip={gt(
        "{count, plural, one {Click again to let {count} workflow from #{number} run. Review the code and workflow changes first.} other {Click again to let {count} workflows from #{number} run. Review the code and workflow changes first.}}",
        { count: workflowApprovalsRequired, number: pullRequestNumber },
      )}
    >
      <Button
        size="xs"
        variant="warning-outline"
        disabled={actionPending}
        {...confirm.bind("approve-workflows", () => void perform("approve-workflows"))}
        aria-label={
          pendingAction === "approve-workflows"
            ? gt("Approving...")
            : armed
              ? gt("Confirm approval")
              : gt("Approve workflows to run")
        }
      >
        <InlineConfirmIcon armed={armed}>
          <PlayIcon aria-hidden className="size-3.5" />
        </InlineConfirmIcon>
        <InlineConfirmLabel
          armed={armed}
          idle={
            pendingAction === "approve-workflows"
              ? gt("Approving...")
              : gt("Approve workflows to run")
          }
          confirm={gt("Confirm approval")}
        />
      </Button>
    </InlineConfirmTooltip>
  );
}
