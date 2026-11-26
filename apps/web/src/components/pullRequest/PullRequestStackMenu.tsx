import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import type {
  EnvironmentId,
  PullRequestRef,
  PullRequestStack,
  PullRequestMergeMethod,
} from "@supaterm/contracts";
import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { ClockIcon, RefreshCwIcon, TriangleAlertIcon, XIcon } from "@supaterm/icons";
import { useState } from "react";
import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { useAtomCommand } from "~/state/use-atom-command";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger, MenuItem, MenuGroup, MenuSeparator } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { InlineConfirmIcon, InlineConfirmLabel, InlineConfirmTooltip } from "../InlineConfirm";
import type { ChangeRequestTerminology } from "~/sourceControlPresentation";
import { PullRequestStackLayers } from "./PullRequestStackLayers";
import { PullRequestStackHeader } from "./PullRequestStackHeader";
import { PullRequestGlyph } from "./pullRequestIcons";
import { mergeHeadPin, readableFailure } from "./pullRequestDetail.logic";
import { msg, T, useGT } from "gt-react";
import { m } from "~/i18n/messages";

export function PullRequestStackMenu({
  hostLabel,
  terminology,
  stack,
  reference,
  environmentId,
  shownHeadSha,
  stale,
  canMerge,
  canRebase,
  canAutoMerge,
  preferAutoMerge,
  autoMergeArmed,
  canCancelAutoMerge,
  mergeMethod,
  onSelect,
  onActed,
  notice,
  onRetry,
}: {
  hostLabel: string;
  terminology: ChangeRequestTerminology;
  notice?: string | null;
  onRetry?: (() => void) | undefined;
  stack: PullRequestStack;
  reference: PullRequestRef;
  environmentId: EnvironmentId;
  /** The head of `reference` the reader was shown; the stack read can run ahead of it. */
  shownHeadSha: string | undefined;
  stale: boolean;
  canMerge: boolean;
  canRebase: boolean;
  /** The host can arm auto-merge for this layer and the open layers below it. */
  canAutoMerge: boolean;
  /** Checks are still running, so arming auto-merge leads over merging now. */
  preferAutoMerge: boolean;
  /** This layer carries a stack auto-merge request, which covers the layers below it. */
  autoMergeArmed: boolean;
  canCancelAutoMerge: boolean;
  mergeMethod: PullRequestMergeMethod;
  onSelect?: ((reference: PullRequestRef) => void) | undefined;
  onActed: () => void;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const confirm = useInlineConfirm<
    "merge" | "auto-merge" | "menu-merge" | "menu-auto-merge" | "menu-rebase"
  >();
  const [pending, setPending] = useState(false);
  const runAction = useAtomCommand(pullRequestEnvironment.runAction, { reportFailure: false });
  const top = stack.layers.at(-1);
  const unmerged = stack.layers.filter((layer) => layer.state !== "merged");
  const hasClosed = unmerged.some((layer) => layer.state !== "open");
  const position = stack.layers.findIndex((layer) => layer.number === reference.number) + 1;
  const mergeLayers = stack.layers.slice(0, position).filter((layer) => layer.state !== "merged");
  const selectedLayer = stack.layers[position - 1];
  const mergeHasClosed = mergeLayers.some((layer) => layer.state !== "open");
  const expectedStackHeads = unmerged.flatMap((layer) =>
    layer.headSha ? [{ number: layer.number, headSha: layer.headSha }] : [],
  );
  const hasUnknownHead = expectedStackHeads.length !== unmerged.length;
  const mergeDisabled =
    pending ||
    stale ||
    selectedLayer?.state !== "open" ||
    mergeLayers.some((layer) => !layer.headSha) ||
    mergeHasClosed ||
    mergeLayers.length === 0 ||
    mergeLayers.some((layer) => layer.isDraft);
  const staleReason = notice ?? gt("Checking the stack with the host…");
  const rebaseDisabled = pending || stale || hasUnknownHead || hasClosed || unmerged.length === 0;
  const run = async (action: "merge" | "enable-auto-merge" | "update-branch") => {
    if (
      pending ||
      (action === "merge"
        ? !canMerge || mergeDisabled
        : action === "enable-auto-merge"
          ? !canAutoMerge || autoMergeArmed || mergeDisabled
          : !canRebase || rebaseDisabled)
    )
      return;
    const merging = action !== "update-branch";
    const target = merging ? selectedLayer : top;
    if (!target?.headSha) return;
    const actionHeads = (merging ? mergeLayers : unmerged).flatMap((layer) =>
      layer.headSha ? [{ number: layer.number, headSha: layer.headSha }] : [],
    );
    setPending(true);
    const toastId = toastManager.add({
      type: "loading",
      title:
        action === "merge"
          ? m(msg("Merging stack..."))
          : action === "enable-auto-merge"
            ? m(msg("Enabling stack auto-merge..."))
            : m(msg("Rebasing stack...")),
    });
    const result = await runAction({
      environmentId,
      input: {
        ...reference,
        number: target.number,
        stackNumber: stack.number,
        expectedStackHeads: actionHeads,
        ...mergeHeadPin(action, shownHeadSha),
        action,
        ...(merging ? { mergeMethod } : { updateMethod: "rebase" }),
      },
    });
    setPending(false);
    onActed();
    if (result._tag === "Failure") {
      toastManager.update(toastId, {
        type: "error",
        title:
          action === "merge"
            ? m(msg("Could not merge the stack"))
            : action === "enable-auto-merge"
              ? m(msg("Could not enable stack auto-merge"))
              : m(msg("Could not rebase the stack")),
        description: readableFailure(
          squashAtomCommandFailure(result),
          merging
            ? "The host refused the merge. Check that you have write access, that the checks it requires have passed, and that the branch is not conflicting."
            : "The host refused the rebase. A rebase stops at the first commit that does not apply cleanly.",
        ),
      });
    } else {
      toastManager.update(toastId, {
        type: "success",
        title:
          action === "merge"
            ? m(msg("Stack merge request completed"))
            : action === "enable-auto-merge"
              ? m(msg("Stack auto-merge enabled"))
              : m(msg("Stack rebased")),
        description:
          action === "merge"
            ? m(msg("{host} merged the stack or added it to its merge queue.", { host: hostLabel }))
            : action === "enable-auto-merge"
              ? `${hostLabel} merges the stack through #${reference.number} once its requirements are met.`
              : undefined,
      });
    }
  };
  const cancelAutoMerge = async () => {
    if (pending || !canCancelAutoMerge) return;
    setPending(true);
    const result = await runAction({
      environmentId,
      input: { ...reference, stackNumber: stack.number, action: "disable-auto-merge" },
    });
    setPending(false);
    onActed();
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: m(msg("Could not cancel stack auto-merge")),
        description: readableFailure(
          squashAtomCommandFailure(result),
          m(msg("The host refused to cancel auto-merge. Refresh and try again.")),
        ),
      });
    }
  };
  const leadsWithAutoMerge = canAutoMerge && preferAutoMerge;
  const buttonAction = leadsWithAutoMerge ? "enable-auto-merge" : "merge";
  const buttonKey = leadsWithAutoMerge ? "auto-merge" : "merge";
  const buttonArmed = confirm.armed === buttonKey;
  const mergeCountLabel = `${mergeLayers.length} ${mergeLayers.length === 1 ? terminology.singular : terminology.plural}`;
  return (
    <>
      <Menu open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-label={gt("Stack {number}, layer {position} of {size}", {
                      number: stack.number,
                      position,
                      size: stack.layers.length,
                    })}
                  />
                }
              >
                <PullRequestGlyph.stack aria-hidden className="size-3.5" /> {position}/
                {stack.layers.length}
                {onRetry ? <TriangleAlertIcon aria-hidden className="size-3 text-warning" /> : null}
              </MenuTrigger>
            }
          />
          <TooltipPopup>
            View stack #{stack.number}, layer {position} of {stack.layers.length}
            {notice ? ` · ${notice}` : null}
          </TooltipPopup>
        </Tooltip>
        <MenuPopup align="start">
          <MenuGroup>
            <PullRequestStackHeader number={stack.number} notice={notice} stale={!!onRetry} />
            {onRetry ? (
              <MenuItem onClick={onRetry}>
                <T>Retry stack refresh</T>
              </MenuItem>
            ) : null}
            <PullRequestStackLayers
              stack={stack}
              reference={reference}
              pending={pending}
              onSelect={
                onSelect
                  ? (target) => {
                      setOpen(false);
                      onSelect(target);
                    }
                  : undefined
              }
            />
          </MenuGroup>
          {canMerge || canRebase || canAutoMerge || canCancelAutoMerge ? (
            <>
              <MenuSeparator />
              {canMerge && !autoMergeArmed ? (
                <MenuItem
                  {...confirm.bind("menu-merge", () => void run("merge"))}
                  disabled={mergeDisabled}
                >
                  <PullRequestGlyph.merged aria-hidden />
                  {`${confirm.armed === "menu-merge" ? "Confirm merge" : "Merge stack"} (${mergeLayers.length})`}
                </MenuItem>
              ) : null}
              {canAutoMerge && !autoMergeArmed ? (
                <MenuItem
                  {...confirm.bind("menu-auto-merge", () => void run("enable-auto-merge"))}
                  disabled={mergeDisabled}
                >
                  <ClockIcon aria-hidden />
                  {`${confirm.armed === "menu-auto-merge" ? "Confirm auto-merge" : "Auto-merge stack"} (${mergeLayers.length})`}
                </MenuItem>
              ) : null}
              {autoMergeArmed && canCancelAutoMerge ? (
                <MenuItem disabled={pending} onClick={() => void cancelAutoMerge()}>
                  <XIcon aria-hidden />
                  <T>Cancel stack auto-merge</T>
                </MenuItem>
              ) : null}
              {canRebase ? (
                <MenuItem
                  {...confirm.bind("menu-rebase", () => void run("update-branch"))}
                  disabled={rebaseDisabled}
                >
                  <RefreshCwIcon aria-hidden />
                  {confirm.armed === "menu-rebase" ? "Confirm rebase" : "Rebase stack"}
                </MenuItem>
              ) : null}
              {confirm.armed === "menu-merge" ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Merges {mergeCountLabel} into {stack.base} using {mergeMethod}.
                </p>
              ) : confirm.armed === "menu-auto-merge" ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Merges {mergeCountLabel} into {stack.base} using {mergeMethod} once each meets the
                  requirements on {hostLabel}. This may happen immediately.
                </p>
              ) : confirm.armed === "menu-rebase" ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Rewrites each branch onto {stack.base}, bottom to top. Checks may restart.
                </p>
              ) : null}
              {mergeHasClosed || mergeLayers.some((layer) => layer.isDraft) ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  <T>Every layer being merged must be open and ready for review.</T>
                </p>
              ) : null}
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      {(leadsWithAutoMerge || canMerge) && !autoMergeArmed && selectedLayer?.state === "open" ? (
        <InlineConfirmTooltip
          armed={buttonArmed}
          render={<span className="inline-flex" />}
          tip={
            stale
              ? staleReason
              : leadsWithAutoMerge
                ? `Auto-merge stack through #${reference.number} into ${stack.base} (${mergeCountLabel}) once its requirements are met`
                : `Merge stack through #${reference.number} into ${stack.base} (${mergeCountLabel})`
          }
          armedTip={
            leadsWithAutoMerge
              ? `Click again to auto-merge ${mergeCountLabel} into ${stack.base} using ${mergeMethod}. This may happen immediately.`
              : `Click again to merge ${mergeCountLabel} into ${stack.base} using ${mergeMethod}`
          }
        >
          <Button
            {...(mergeDisabled ? {} : confirm.bind(buttonKey, () => void run(buttonAction)))}
            variant="default"
            size="xs"
            disabled={mergeDisabled && !stale}
            aria-disabled={mergeDisabled || undefined}
            aria-description={stale ? staleReason : undefined}
          >
            <InlineConfirmIcon armed={buttonArmed}>
              {leadsWithAutoMerge ? (
                <ClockIcon aria-hidden className="size-3.5" />
              ) : (
                <PullRequestGlyph.merged aria-hidden className="size-3.5" />
              )}
            </InlineConfirmIcon>
            <InlineConfirmLabel
              armed={buttonArmed}
              idle={pending ? "Working…" : leadsWithAutoMerge ? "Auto-merge stack" : "Merge stack"}
              confirm={leadsWithAutoMerge ? "Confirm auto-merge" : "Confirm merge"}
            />
          </Button>
        </InlineConfirmTooltip>
      ) : null}
    </>
  );
}
