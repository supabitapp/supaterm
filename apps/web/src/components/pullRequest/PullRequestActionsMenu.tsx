import { useAtomValue } from "@effect/atom-react";
import {
  canEditPullRequestMaintainerEdits,
  maintainerEditsChoiceInForce,
  type MaintainerEditsChoice,
} from "@supaterm/client-runtime/pull-request-editing";
import type { ChangeRequestTerminology } from "@supaterm/client-runtime/source-control-clients";
import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
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
  ScrollTextIcon,
  TrashIcon,
} from "@supaterm/icons";
import { useId, useState } from "react";

import { useOpenLink } from "~/browser/useOpenLink";
import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { shortcutLabelForCommand } from "~/keybindings";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { InlineConfirmIcon, InlineConfirmLabel } from "../InlineConfirm";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ActOnEnvironmentPicker, type PerformPullRequestAction } from "./PullRequestDetailActions";
import {
  PULL_REQUEST_MERGE_METHOD_LABELS,
  type PullRequestMenuActions,
  readableFailure,
} from "./pullRequestDetail.logic";
import { PullRequestGlyph } from "./pullRequestIcons";
import type { PickableEnvironment } from "./pullRequestProjectAssignment.logic";
import { PullRequestThreadLinks } from "./PullRequestThreadLinks";
import { changeRequestTermKind } from "./changeRequestTerm";
import { Branch, msg, T, useGT, useMessages } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";

function deleteBranchHint(
  detail: Pick<PullRequestDetail, "headBranch" | "headRepositoryNameWithOwner" | "repository">,
  { connected, armed }: { readonly connected: boolean; readonly armed: boolean },
  resolve: MessageResolver = m,
): string {
  if (!connected) return resolve(msg("Reconnect to delete this branch"));
  if (armed) return resolve(msg("Local branches and worktrees are not changed"));
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
  const gt = useGT();
  const resolve = useMessages();
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
          {isDraft ? gt("Ready for review") : gt("Convert to draft")}
        </MenuItem>
      ) : null}
      {actions.showsMergeNow ? (
        <MenuItem
          {...confirm.bind("merge", () => void perform("merge", selectedMergeMethod))}
          disabled={actionPending}
        >
          <PullRequestGlyph.merged className="size-3.5" />
          {confirm.armed === "merge" ? gt("Confirm merge") : gt("Merge now")}
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
          {confirm.armed === "enable-auto-merge"
            ? gt("Confirm auto-merge")
            : gt("Enable auto-merge")}
        </MenuItem>
      ) : null}
      {actions.showsDisableAutoMerge ? (
        <MenuItem disabled={actionPending} onClick={() => void perform("disable-auto-merge")}>
          <PullRequestGlyph.merged className="size-3.5" />
          <T>Disable auto-merge</T>
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
                  <span>{resolve(PULL_REQUEST_MERGE_METHOD_LABELS[method])}</span>
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
  threadRef,
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
  canWriteSourceControl,
  onMaintainerEditsSaved,
  pendingAction,
  perform,
  openOnHostText,
  copyReference,
}: {
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  detail: Pick<
    PullRequestDetail,
    | "url"
    | "state"
    | "isDraft"
    | "headBranch"
    | "headRepositoryNameWithOwner"
    | "repository"
    | "capabilities"
    | "viewerPermissions"
    | "maintainerCanModify"
    | "observedAt"
  >;
  terminology: ChangeRequestTerminology;
  threadRef: ScopedThreadRef | null;
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
  canWriteSourceControl: boolean;
  onMaintainerEditsSaved: () => void;
  pendingAction: PullRequestAction | null;
  perform: PerformPullRequestAction;
  openOnHostText: string;
  copyReference: (value: string, label: string) => void;
}) {
  const gt = useGT();
  const resolve = useMessages();
  const openLink = useOpenLink(threadRef);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const confirm = useInlineConfirm<"close" | "revert" | "delete-branch">();
  const actionPending = pendingAction !== null;
  const pullRequestKey = `${environmentId}:${reference.repository}#${reference.number}`;
  const maintainerEditsHintId = useId();
  const updatePullRequest = useAtomCommand(pullRequestEnvironment.update, {
    reportFailure: false,
  });
  const [maintainerEditsChoice, setMaintainerEditsChoice] = useState<MaintainerEditsChoice | null>(
    null,
  );
  const [maintainerEditsSaving, setMaintainerEditsSaving] = useState(false);
  const maintainerEditsChoiceKept = maintainerEditsChoiceInForce(
    maintainerEditsChoice,
    pullRequestKey,
    detail.observedAt,
    maintainerEditsSaving,
  );
  if (maintainerEditsChoiceKept !== maintainerEditsChoice) {
    setMaintainerEditsChoice(maintainerEditsChoiceKept);
  }
  const maintainerCanModify = maintainerEditsChoiceKept?.value ?? detail.maintainerCanModify;
  const canSaveMaintainerEdits =
    canWriteSourceControl && environmentConnected && !maintainerEditsSaving;
  const saveMaintainerEdits = async (value: boolean) => {
    if (!canSaveMaintainerEdits) return;
    const previousChoice = maintainerEditsChoice;
    setMaintainerEditsChoice({ key: pullRequestKey, observedAt: detail.observedAt, value });
    setMaintainerEditsSaving(true);
    const result = await updatePullRequest({
      environmentId,
      input: { ...reference, maintainerCanModify: value },
    });
    setMaintainerEditsSaving(false);
    if (result._tag === "Failure") {
      setMaintainerEditsChoice(previousChoice);
      toastManager.add({
        type: "error",
        title: m(msg("Could not save maintainer access")),
        description: readableFailure(squashAtomCommandFailure(result), m(msg("Try again."))),
      });
      return;
    }
    onMaintainerEditsSaved();
  };
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
                      ? gt(
                          "Refreshing {term, select, mr {merge request} cr {change request} other {pull request}}",
                          { term: changeRequestTermKind(terminology) },
                        )
                      : gt(
                          "More {term, select, mr {merge request} cr {change request} other {pull request}} actions",
                          { term: changeRequestTermKind(terminology) },
                        )
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
            ? gt(
                "Refreshing {term, select, mr {merge request} cr {change request} other {pull request}}",
                { term: changeRequestTermKind(terminology) },
              )
            : gt(
                "More {term, select, mr {merge request} cr {change request} other {pull request}} actions",
                { term: changeRequestTermKind(terminology) },
              )}
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
          <T context="verb, menu item">Refresh</T>
        </MenuItem>
        <MenuItem disabled={handoff !== null} onClick={askAboutPullRequest}>
          <MessageCircleQuestionIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>{handoff === "ask" ? gt("Opening...") : gt("Ask a question")}</span>
            <span className="text-xs text-muted-foreground">
              {attachesToComposer
                ? gt(
                    "Adds the {term, select, mr {merge request} cr {change request} other {pull request}} to this thread's composer.",
                    { term: changeRequestTermKind(terminology) },
                  )
                : gt(
                    "Opens a thread that knows which {term, select, mr {merge request} cr {change request} other {pull request}} you mean.",
                    {
                      term: changeRequestTermKind(terminology),
                    },
                  )}
            </span>
          </span>
        </MenuItem>
        <MenuItem disabled={handoff !== null} onClick={explainPullRequest}>
          <BookOpenIcon className="mt-1 size-3.5 shrink-0 self-start" />
          <span className="flex min-w-0 flex-col">
            <span>
              {handoff === "explain"
                ? gt("Opening...")
                : gt("Explain this {term, select, mr {MR} cr {change request} other {PR}}", {
                    term: changeRequestTermKind(terminology),
                  })}
            </span>
            <span className="text-xs text-muted-foreground">
              <T>A walk through the diff and what to read closely.</T>
            </span>
          </span>
        </MenuItem>
        <MenuItem disabled={handoff !== null || !canFixFindings} onClick={startFixFindings}>
          <HammerIcon className="size-3.5" />
          {handoff === "findings" ? gt("Preparing...") : handoffLabels.fixFindings}
        </MenuItem>
        {canWriteGuide ? (
          <MenuItem disabled={guideRunning} onClick={writeGuide}>
            <ScrollTextIcon className="size-3.5" />
            {guideRunning
              ? gt("Writing guide...")
              : !guideWritten
                ? gt("Write guide")
                : gt("Rewrite guide")}
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
        {canEditPullRequestMaintainerEdits(detail) ? (
          <>
            <MenuCheckboxItem
              variant="icon"
              checked={maintainerCanModify === true}
              disabled={!canSaveMaintainerEdits}
              closeOnClick={false}
              aria-label={gt("Allow edits from maintainers")}
              aria-describedby={maintainerEditsHintId}
              onCheckedChange={(value) => void saveMaintainerEdits(value)}
            >
              <span className="flex max-w-xs flex-col gap-0.5">
                <span>
                  <T>Allow edits from maintainers</T>
                </span>
                <span id={maintainerEditsHintId} className="text-xs text-muted-foreground">
                  <T>
                    Maintainers can push to this branch. If your fork has workflows, this can also
                    give access to its secrets.
                  </T>
                </span>
                {maintainerEditsSaving ? (
                  <span role="status" className="text-xs text-muted-foreground">
                    <T>Saving…</T>
                  </span>
                ) : null}
              </span>
            </MenuCheckboxItem>
            <MenuSeparator />
          </>
        ) : null}
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
        <MenuItem onClick={(event) => void openLink(detail.url, { event }).catch(console.error)}>
          <ArrowUpRightIcon className="size-3.5" />
          {openOnHostText}
        </MenuItem>
        <MenuItem
          onClick={() =>
            copyReference(
              detail.url,
              resolve(
                msg("Failed to copy {term, select, mr {MR} cr {change request} other {PR}} link", {
                  term: changeRequestTermKind(terminology),
                }),
              ),
            )
          }
        >
          <LinkIcon className="size-3.5" />
          <T>Copy link</T>
          <MenuShortcut>
            {shortcutLabelForCommand(keybindings, "thread.copyReference")}
          </MenuShortcut>
        </MenuItem>
        <MenuItem
          onClick={() =>
            copyReference(
              `#${reference.number}`,
              resolve(
                msg(
                  "Failed to copy {term, select, mr {MR} cr {change request} other {PR}} number",
                  { term: changeRequestTermKind(terminology) },
                ),
              ),
            )
          }
        >
          <CopyIcon className="size-3.5" />
          <T>
            Copy{" "}
            <Branch branch={changeRequestTermKind(terminology)} mr="MR" cr="change request">
              PR
            </Branch>{" "}
            number
          </T>
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
              {confirm.armed === "close"
                ? gt("Confirm close")
                : gt(
                    "Close {term, select, mr {merge request} cr {change request} other {pull request}}",
                    { term: changeRequestTermKind(terminology) },
                  )}
            </MenuItem>
          </>
        ) : detail.state === "closed" && can("reopen") ? (
          <>
            <MenuSeparator />
            <MenuItem disabled={actionPending} onClick={() => void perform("reopen")}>
              <PullRequestGlyph.reopen className="size-3.5" />
              <T>
                Reopen{" "}
                <Branch
                  branch={changeRequestTermKind(terminology)}
                  mr="merge request"
                  cr="change request"
                >
                  pull request
                </Branch>
              </T>
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
              {confirm.armed === "revert" ? gt("Confirm revert") : gt("Revert changes")}
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
                  gt("Deleting branch...")
                ) : (
                  <InlineConfirmLabel
                    armed={confirm.armed === "delete-branch"}
                    idle={gt("Delete branch")}
                    confirm={gt("Confirm delete")}
                  />
                )}
                <span className="max-w-full truncate text-xs text-muted-foreground">
                  {deleteBranchHint(
                    detail,
                    {
                      connected: environmentConnected,
                      armed: confirm.armed === "delete-branch",
                    },
                    resolve,
                  )}
                </span>
              </span>
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
