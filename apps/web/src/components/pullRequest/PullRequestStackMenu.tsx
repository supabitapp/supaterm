import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import type {
  EnvironmentId,
  PullRequestRef,
  PullRequestStack,
  PullRequestMergeMethod,
} from "@supaterm/contracts";
import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { RefreshCwIcon, TriangleAlertIcon } from "@supaterm/icons";
import { useState } from "react";
import { useInlineConfirm } from "~/hooks/useInlineConfirm";
import { useAtomCommand } from "~/state/use-atom-command";
import { pullRequestEnvironment } from "~/state/pullRequests";
import { Button } from "../ui/button";
import { Menu, MenuPopup, MenuTrigger, MenuItem, MenuGroup, MenuSeparator } from "../ui/menu";
import { toastManager } from "../ui/toast";
import { InlineConfirmIcon, InlineConfirmLabel, InlineConfirmTooltip } from "../InlineConfirm";
import { PullRequestStackLayers } from "./PullRequestStackLayers";
import { PullRequestStackHeader } from "./PullRequestStackHeader";
import { PullRequestGlyph } from "./pullRequestIcons";

export function PullRequestStackMenu({
  hostLabel,
  stack,
  reference,
  environmentId,
  canMerge,
  canRebase,
  mergeMethod,
  onSelect,
  onActed,
  notice,
  onRetry,
}: {
  hostLabel: string;
  notice?: string | null;
  onRetry?: (() => void) | undefined;
  stack: PullRequestStack;
  reference: PullRequestRef;
  environmentId: EnvironmentId;
  canMerge: boolean;
  canRebase: boolean;
  mergeMethod: PullRequestMergeMethod;
  onSelect?: ((reference: PullRequestRef) => void) | undefined;
  onActed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const confirm = useInlineConfirm<"merge" | "menu-merge" | "menu-rebase">();
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
    selectedLayer?.state !== "open" ||
    mergeLayers.some((layer) => !layer.headSha) ||
    mergeHasClosed ||
    mergeLayers.length === 0 ||
    mergeLayers.some((layer) => layer.isDraft);
  const rebaseDisabled = pending || hasUnknownHead || hasClosed || unmerged.length === 0;
  const run = async (action: "merge" | "update-branch") => {
    if (pending || (action === "merge" ? !canMerge || mergeDisabled : !canRebase || rebaseDisabled))
      return;
    const target = action === "merge" ? selectedLayer : top;
    if (!target?.headSha) return;
    const actionHeads = (action === "merge" ? mergeLayers : unmerged).flatMap((layer) =>
      layer.headSha ? [{ number: layer.number, headSha: layer.headSha }] : [],
    );
    setPending(true);
    const toastId = toastManager.add({
      type: "loading",
      title: action === "merge" ? "Merging stack..." : "Rebasing stack...",
    });
    const result = await runAction({
      environmentId,
      input: {
        ...reference,
        number: target.number,
        stackNumber: stack.number,
        expectedStackHeads: actionHeads,
        action,
        ...(action === "merge" ? { mergeMethod } : { updateMethod: "rebase" }),
      },
    });
    setPending(false);
    onActed();
    if (result._tag === "Failure") {
      toastManager.update(toastId, {
        type: "error",
        title: action === "merge" ? "Could not merge the stack" : "Could not rebase the stack",
        description: String(squashAtomCommandFailure(result)),
      });
    } else {
      toastManager.update(toastId, {
        type: "success",
        title: action === "merge" ? "Stack merge request completed" : "Stack rebased",
        description:
          action === "merge"
            ? `${hostLabel} merged the stack or added it to its merge queue.`
            : undefined,
      });
    }
  };
  const mergeCountLabel = `${mergeLayers.length} ${mergeLayers.length === 1 ? "pull request" : "pull requests"}`;
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
                    aria-label={`Stack ${stack.number}, layer ${position} of ${stack.layers.length}`}
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
            {onRetry ? <MenuItem onClick={onRetry}>Retry stack refresh</MenuItem> : null}
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
          {canMerge || canRebase ? (
            <>
              <MenuSeparator />
              {canMerge ? (
                <MenuItem
                  {...confirm.bind("menu-merge", () => void run("merge"))}
                  disabled={mergeDisabled}
                >
                  <PullRequestGlyph.merged aria-hidden />
                  {`${confirm.armed === "menu-merge" ? "Confirm merge" : "Merge stack"} (${mergeLayers.length})`}
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
              ) : confirm.armed === "menu-rebase" ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Rewrites each branch onto {stack.base}, bottom to top. Checks may restart.
                </p>
              ) : null}
              {mergeHasClosed || mergeLayers.some((layer) => layer.isDraft) ? (
                <p className="px-2 py-1 text-xs text-muted-foreground">
                  Every layer being merged must be open and ready for review.
                </p>
              ) : null}
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      {canMerge && selectedLayer?.state === "open" ? (
        <InlineConfirmTooltip
          armed={confirm.armed === "merge"}
          render={<span className="inline-flex" />}
          tip={`Merge stack through #${reference.number} into ${stack.base} (${mergeCountLabel})`}
          armedTip={`Click again to merge ${mergeCountLabel} into ${stack.base} using ${mergeMethod}`}
        >
          <Button
            {...confirm.bind("merge", () => void run("merge"))}
            variant="default"
            size="xs"
            disabled={mergeDisabled}
          >
            <InlineConfirmIcon armed={confirm.armed === "merge"}>
              <PullRequestGlyph.merged aria-hidden className="size-3.5" />
            </InlineConfirmIcon>
            <InlineConfirmLabel
              armed={confirm.armed === "merge"}
              idle={pending ? "Working…" : "Merge stack"}
              confirm="Confirm merge"
            />
          </Button>
        </InlineConfirmTooltip>
      ) : null}
    </>
  );
}
