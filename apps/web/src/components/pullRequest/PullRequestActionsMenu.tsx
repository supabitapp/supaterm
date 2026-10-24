import { useAtomValue } from "@effect/atom-react";
import type { ChangeRequestTerminology } from "@supaterm/client-runtime/source-control-clients";
import type {
  EnvironmentId,
  PullRequestAction,
  PullRequestDetail,
  PullRequestMergeMethod,
  PullRequestRef,
  ScopedThreadRef,
} from "@supaterm/contracts";
import {
  ArrowUpRightIcon,
  BookOpenIcon,
  CopyIcon,
  EllipsisIcon,
  HammerIcon,
  LinkIcon,
  MessageCircleQuestionIcon,
  RotateCcwIcon,
  SparklesIcon,
  TrashIcon,
} from "@supaterm/icons";

import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { shortcutLabelForCommand } from "~/keybindings";
import { readLocalApi } from "~/localApi";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { InlineConfirmIcon, InlineConfirmLabel } from "../InlineConfirm";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ActOnEnvironmentPicker, type PerformPullRequestAction } from "./PullRequestDetailActions";
import {
  PULL_REQUEST_MERGE_METHOD_LABELS,
  type PullRequestMenuActions,
} from "./pullRequestDetail.logic";
import { PullRequestGlyph } from "./pullRequestIcons";
import type { PickableEnvironment } from "./pullRequestProjectAssignment.logic";
import { PullRequestThreadLinks } from "./PullRequestThreadLinks";

function deleteBranchHint(
  detail: Pick<PullRequestDetail, "headBranch" | "headRepositoryNameWithOwner" | "repository">,
  { connected, armed }: { readonly connected: boolean; readonly armed: boolean },
): string {
  if (!connected) return "Reconnect to delete this branch";
  if (armed) return "Local branches and worktrees are not changed";
  return `${detail.headBranch} in ${detail.headRepositoryNameWithOwner ?? detail.repository}`;
}

/**
 * The merge-area items both pull request menus offer. A conflicting branch cannot arm auto-merge
 * because nothing the host waits for will clear the conflict.
 */
export function PullRequestMergeMenuItems({
  isDraft,
  actions,
  allowedMergeMethods,
  selectedMergeMethod,
  onSelectMergeMethod,
  actionPending,
  perform,
}: {
  isDraft: boolean;
  actions: PullRequestMenuActions;
  allowedMergeMethods: ReadonlyArray<PullRequestMergeMethod>;
  selectedMergeMethod: PullRequestMergeMethod;
  onSelectMergeMethod: (method: PullRequestMergeMethod) => void;
  actionPending: boolean;
  perform: PerformPullRequestAction;
}) {
  const confirm = useInlineConfirm<"merge" | "enable-auto-merge">();
  const hasActions =
    actions.showsDraftToggle ||
    actions.showsMergeNow ||
    actions.showsAutoMerge ||
    actions.showsDisableAutoMerge;
  return (
    <>
      {actions.showsDraftToggle ? (
        <MenuItem
          disabled={actionPending}
          onClick={() => void perform(isDraft ? "ready" : "draft")}
        >
          {isDraft ? (
            <PullRequestGlyph.pullRequest className="size-3.5" />
          ) : (
            <PullRequestGlyph.draft className="size-3.5" />
          )}
          {isDraft ? "Ready for review" : "Convert to draft"}
        </MenuItem>
      ) : null}
      {actions.showsMergeNow ? (
        <MenuItem
          {...confirm.bind("merge", () => void perform("merge", selectedMergeMethod))}
          disabled={actionPending}
        >
          <PullRequestGlyph.merged className="size-3.5" />
          {confirm.armed === "merge" ? "Confirm merge" : "Merge now"}
        </MenuItem>
      ) : null}
      {actions.showsAutoMerge ? (
        <MenuItem
          {...confirm.bind(
            "enable-auto-merge",
            () => void perform("enable-auto-merge", selectedMergeMethod),
          )}
          disabled={actionPending}
        >
          <PullRequestGlyph.merged className="size-3.5" />
          {confirm.armed === "enable-auto-merge" ? "Confirm auto-merge" : "Enable auto-merge"}
        </MenuItem>
      ) : null}
      {actions.showsDisableAutoMerge ? (
        <MenuItem disabled={actionPending} onClick={() => void perform("disable-auto-merge")}>
          <PullRequestGlyph.merged className="size-3.5" />
          Disable auto-merge
        </MenuItem>
      ) : null}
      {actions.showsMergeMethods ? (
        <>
          {hasActions ? <MenuSeparator /> : null}
          <MenuRadioGroup
            value={selectedMergeMethod}
            onValueChange={(method) => onSelectMergeMethod(method as PullRequestMergeMethod)}
          >
            {allowedMergeMethods.map((method) => (
              <MenuRadioItem key={method} value={method} disabled={actionPending} closeOnClick>
                <span className="flex min-w-0 items-center gap-2">
                  <PullRequestGlyph.merged className="size-3.5" />
                  <span>{PULL_REQUEST_MERGE_METHOD_LABELS[method]}</span>
                </span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </>
      ) : null}
      {hasActions || actions.showsMergeMethods ? <MenuSeparator /> : null}
    </>
  );
}

/** Everything else the reader can do with the pull request, behind the header's overflow button. */
export function PullRequestActionsMenu({
  environmentId,
  reference,
  detail,
  terminology,
  linkThreadRef,
  onThreadPickerOpenChange,
  refreshing,
  refreshFromHost,
  handoff,
  attachesToComposer,
  askAboutPullRequest,
  explainPullRequest,
  canFixFindings,
  startFixFindings,
  handoffLabels,
  canWriteGuide,
  guideRunning,
  guideWritten,
  writeGuide,
  pickableEnvironments,
  actingEnvironmentId,
  onActingEnvironmentChange,
  can,
  mergeMenuActions,
  allowedMergeMethods,
  selectedMergeMethod,
  onSelectMergeMethod,
  showsDeleteBranch,
  environmentConnected,
  pendingAction,
  perform,
  openOnHostText,
  copyReference,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: Pick<
    PullRequestDetail,
    "url" | "state" | "isDraft" | "headBranch" | "headRepositoryNameWithOwner" | "repository"
  >;
  terminology: ChangeRequestTerminology;
  linkThreadRef: ScopedThreadRef | null;
  onThreadPickerOpenChange: (open: boolean) => void;
  refreshing: boolean;
  refreshFromHost: () => Promise<void>;
  handoff: string | null;
  attachesToComposer: boolean;
  askAboutPullRequest: () => void;
  explainPullRequest: () => void;
  canFixFindings: boolean;
  startFixFindings: () => void;
  handoffLabels: { readonly fixFindings: string };
  canWriteGuide: boolean;
  guideRunning: boolean;
  guideWritten: boolean;
  writeGuide: () => void;
  pickableEnvironments: ReadonlyArray<PickableEnvironment>;
  actingEnvironmentId: EnvironmentId;
  onActingEnvironmentChange: (environmentId: EnvironmentId) => void;
  can: (action: PullRequestAction) => boolean;
  mergeMenuActions: PullRequestMenuActions;
  allowedMergeMethods: ReadonlyArray<PullRequestMergeMethod>;
  selectedMergeMethod: PullRequestMergeMethod;
  onSelectMergeMethod: (method: PullRequestMergeMethod) => void;
  showsDeleteBranch: boolean;
  environmentConnected: boolean;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
  openOnHostText: string;
  copyReference: (value: string, label: string) => void;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirm = useInlineConfirm<"close" | "revert" | "delete-branch">();
  const actionPending = pendingAction !== null;
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  aria-label={
                    refreshing
                      ? `Refreshing ${terminology.singular}`
                      : `More ${terminology.singular} actions`
                  }
                  size="icon-xs"
                  variant="ghost-muted"
                />
              }
            >
              {refreshing ? (
                <RefreshIcon refreshing size="md" />
              ) : (
                <EllipsisIcon className="size-4" />
              )}
            </MenuTrigger>
          }
        />
        <TooltipPopup>
          {refreshing
            ? `Refreshing ${terminology.singular}`
            : `More ${terminology.singular} actions`}
        </TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom">
        <PullRequestThreadLinks
          display="menu-item"
          environmentId={environmentId}
          reference={reference}
          url={detail.url}
          threadRef={linkThreadRef}
          onPickerOpenChange={onThreadPickerOpenChange}
        />
        <MenuItem disabled={refreshing} onClick={() => void refreshFromHost()}>
          <RefreshIcon size="sm" refreshing={refreshing} />
          Refresh
        </MenuItem>
        <MenuItem disabled={handoff !== null} onClick={askAboutPullRequest}>
          <MessageCircleQuestionIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>{handoff === "ask" ? "Opening..." : "Ask a question"}</span>
            <span className="text-xs text-muted-foreground">
              {attachesToComposer
                ? `Adds the ${terminology.singular} to this thread's composer.`
                : `Opens a thread that knows which ${terminology.singular} you mean.`}
            </span>
          </span>
        </MenuItem>
        <MenuItem disabled={handoff !== null} onClick={explainPullRequest}>
          <BookOpenIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>
              {handoff === "explain" ? "Opening..." : `Explain this ${terminology.shortLabel}`}
            </span>
            <span className="text-xs text-muted-foreground">
              A walk through the diff and what to read closely.
            </span>
          </span>
        </MenuItem>
        <MenuItem disabled={handoff !== null || !canFixFindings} onClick={startFixFindings}>
          <HammerIcon className="size-3.5" />
          {handoff === "findings" ? "Preparing..." : handoffLabels.fixFindings}
        </MenuItem>
        {canWriteGuide ? (
          <MenuItem disabled={guideRunning} onClick={writeGuide}>
            <SparklesIcon className="size-3.5" />
            {guideRunning ? "Writing guide..." : !guideWritten ? "Write guide" : "Rewrite guide"}
          </MenuItem>
        ) : null}
        {pickableEnvironments.length > 0 ? (
          <ActOnEnvironmentPicker
            environments={pickableEnvironments}
            value={actingEnvironmentId}
            onChange={onActingEnvironmentChange}
            disabled={handoff !== null}
          />
        ) : null}
        <MenuSeparator />
        {detail.state === "open" ? (
          <PullRequestMergeMenuItems
            isDraft={detail.isDraft}
            actions={mergeMenuActions}
            allowedMergeMethods={allowedMergeMethods}
            selectedMergeMethod={selectedMergeMethod}
            onSelectMergeMethod={onSelectMergeMethod}
            actionPending={actionPending}
            perform={perform}
          />
        ) : null}
        <MenuItem onClick={() => void readLocalApi()?.shell.openExternal(detail.url)}>
          <ArrowUpRightIcon className="size-3.5" />
          {openOnHostText}
        </MenuItem>
        <MenuItem onClick={() => copyReference(detail.url, `${terminology.shortLabel} link`)}>
          <LinkIcon className="size-3.5" />
          Copy link
          <MenuShortcut>
            {shortcutLabelForCommand(keybindings, "thread.copyReference")}
          </MenuShortcut>
        </MenuItem>
        <MenuItem
          onClick={() => copyReference(`#${reference.number}`, `${terminology.shortLabel} number`)}
        >
          <CopyIcon className="size-3.5" />
          Copy {terminology.shortLabel} number
          <MenuShortcut>
            {shortcutLabelForCommand(keybindings, "pullRequest.copyNumber")}
          </MenuShortcut>
        </MenuItem>
        {detail.state === "open" && can("close") ? (
          <>
            <MenuSeparator />
            <MenuItem
              {...confirm.bind("close", () => void perform("close"))}
              variant="destructive"
              disabled={actionPending}
            >
              <PullRequestGlyph.closed className="size-3.5" />
              {confirm.armed === "close" ? "Confirm close" : `Close ${terminology.singular}`}
            </MenuItem>
          </>
        ) : detail.state === "closed" && can("reopen") ? (
          <>
            <MenuSeparator />
            <MenuItem disabled={actionPending} onClick={() => void perform("reopen")}>
              <PullRequestGlyph.reopen className="size-3.5" />
              Reopen {terminology.singular}
            </MenuItem>
          </>
        ) : detail.state === "merged" && can("revert") ? (
          <>
            <MenuSeparator />
            <MenuItem
              {...confirm.bind("revert", () => void perform("revert"))}
              disabled={actionPending}
            >
              <RotateCcwIcon className="size-3.5" />
              {confirm.armed === "revert" ? "Confirm revert" : "Revert changes"}
            </MenuItem>
          </>
        ) : null}
        {showsDeleteBranch ? (
          <>
            <MenuSeparator />
            <MenuItem
              {...confirm.bind("delete-branch", () => void perform("delete-branch"))}
              variant="destructive"
              disabled={actionPending || !environmentConnected}
            >
              <span className="mt-1 inline-flex shrink-0 self-start">
                <InlineConfirmIcon armed={confirm.armed === "delete-branch"}>
                  <TrashIcon className="size-3.5" />
                </InlineConfirmIcon>
              </span>
              <span className="flex min-w-0 flex-col items-start">
                {pendingAction === "delete-branch" ? (
                  "Deleting branch..."
                ) : (
                  <InlineConfirmLabel
                    armed={confirm.armed === "delete-branch"}
                    idle="Delete branch"
                    confirm="Confirm delete"
                  />
                )}
                <span className="max-w-full truncate text-xs text-muted-foreground">
                  {deleteBranchHint(detail, {
                    connected: environmentConnected,
                    armed: confirm.armed === "delete-branch",
                  })}
                </span>
              </span>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
