import { scopeProjectRef, scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentId, ProjectId, ScopedThreadRef, ThreadId } from "@supaterm/contracts";
import { type ReactNode, type Ref, memo, useImperativeHandle, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useProject, useThreadShellsForProjectRefs } from "../state/entities";
import { useEnvironmentQuery } from "../state/query";
import { vcsEnvironment } from "../state/vcs";
import {
  type EnvMode,
  type EnvironmentOption,
  resolveContextStripLabelsCompact,
  resolveBranchToolbarValue,
  resolvePreviousWorktreeLabel,
  resolvePreviousWorktreeSeed,
} from "./BranchToolbar.logic";
import {
  BranchToolbarBranchSelector,
  type BranchToolbarBranchSelectorHandle,
} from "./BranchToolbarBranchSelector";
import { BranchToolbarEnvironmentSelector } from "./BranchToolbarEnvironmentSelector";
import { openAddProjectToMachine } from "./AddProjectToMachineDialog";
import { BranchToolbarEnvModeSelector } from "./BranchToolbarEnvModeSelector";
import { ComposerSurface } from "./chat/ComposerSurface";
import { measureRestingComposerControls } from "./chat/restingComposerControlsMeasurement";
import { resolveRestingComposerControlsNaturalWidth } from "./composerFooterLayout";
import { EASE_DRAWER } from "~/lib/motion";
import { cn } from "~/lib/utils";
import { observeResize } from "~/lib/observeResize";

export interface BranchToolbarHandle {
  openBranchPicker: () => void;
  usePreviousWorktree: () => void;
}

interface BranchToolbarProps {
  layout?: "composer" | "panel";
  panelSection?: "all" | "workspace" | "branch";
  forceNewWorktree?: boolean;
  ref?: Ref<BranchToolbarHandle>;
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
  worktreePath: string | null;
  isServerThread: boolean;
  showGitControls: boolean;
  draftId?: DraftId;
  composerDraftTarget?: ScopedThreadRef | DraftId;
  onEnvModeChange: (mode: EnvMode) => void;
  envMode: EnvMode;
  activeThreadBranchOverride?: string | null;
  startFromOrigin: boolean;
  onStartFromOriginChange: (startFromOrigin: boolean) => void;
  autoEnvironmentLabel?: string | undefined;
  onAutoEnvironment?: (() => void) | undefined;
  envLocked: boolean;
  onCheckoutPullRequestRequest?: (reference: string) => void;
  onComposerFocusRequest?: () => void;
  availableEnvironments?: readonly EnvironmentOption[];
  onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  composerControlsHostRef?: (element: HTMLDivElement | null) => void;
  contextStripVisible?: boolean;
  showEnvironmentIndicator?: boolean;
  canAddToMachine?: boolean;
  /**
   * Leads the composer strip, ahead of the branch and host controls. A draft
   * without a project yet still gets a strip holding just this control.
   */
  projectPicker?: ReactNode;
  contextStripPlacement?: "top" | "bottom";
  usageMeter?: ReactNode;
}

const COMPOSER_CONTEXT_MOTION_DURATION_MS = 180;
const CONTEXT_STRIP_CLASS = "gap-1 text-xs font-normal text-muted-foreground/70";
const COMPOSER_CONTEXT_LABEL_SELECTOR = "[data-composer-label]";

/**
 * Reading one element's scrollWidth drops the tail when the label is hidden or
 * squeezed, and the strip then flips between labels and icons on every measure.
 */
function labelTextWidth(label: HTMLElement, range: Range): number {
  const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
  let width = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    range.selectNodeContents(node);
    width += range.getBoundingClientRect().width;
  }
  const motion = label.querySelector<HTMLElement>("[data-composer-label-motion]");
  const maxWidth = motion ? Number.parseFloat(getComputedStyle(motion).maxWidth) : Number.NaN;
  return Number.isFinite(maxWidth) ? Math.min(width, maxWidth) : width;
}

function animateLabelWidths(
  previousRects: ReadonlyMap<HTMLElement, DOMRect>,
  animations: Map<HTMLElement, Animation>,
) {
  for (const animation of animations.values()) animation.cancel();
  animations.clear();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  for (const [label, previousRect] of previousRects) {
    if (!label.isConnected) continue;
    const nextWidth = label.getBoundingClientRect().width;
    if (Math.abs(previousRect.width - nextWidth) < 0.5) continue;

    const animation = label.animate(
      [
        { width: `${previousRect.width}px`, maxWidth: `${previousRect.width}px` },
        { width: `${nextWidth}px`, maxWidth: `${nextWidth}px` },
      ],
      {
        duration: COMPOSER_CONTEXT_MOTION_DURATION_MS,
        easing: EASE_DRAWER,
        fill: "backwards",
      },
    );
    animations.set(label, animation);
    animation.addEventListener(
      "finish",
      () => {
        if (animations.get(label) === animation) animations.delete(label);
      },
      { once: true },
    );
  }
}

/**
 * Whether the strip's labels must collapse to icons. The strip is measured when
 * it, a control group or a hosted control resizes, when its text or children
 * change, and when fonts load, which covers everything the widths depend on.
 */
function useLabelsOverflow(): readonly [
  attach: (element: HTMLDivElement | null) => (() => void) | undefined,
  overflows: boolean,
] {
  const [overflows, setOverflows] = useState(false);

  const attach = (current: HTMLDivElement | null) => {
    if (!current) return;
    const labelAnimations = new Map<HTMLElement, Animation>();

    const measure = () => {
      // The committed attribute, not render state, so a stale closure cannot misread it.
      const compact = current.hasAttribute("data-compact");
      const stripWidth = current.clientWidth;
      if (stripWidth === 0) return;
      const stripStyle = getComputedStyle(current);
      const available =
        stripWidth -
        (Number.parseFloat(stripStyle.paddingInlineStart) || 0) -
        (Number.parseFloat(stripStyle.paddingInlineEnd) || 0);
      const contentWidth = (parent: Element): number => {
        const gap = Number.parseFloat(getComputedStyle(parent).columnGap) || 0;
        let width = 0;
        let counted = 0;
        for (const child of parent.children) {
          if (!(child instanceof HTMLElement)) continue;
          if (child.offsetWidth === 0) continue;
          const style = getComputedStyle(child);
          const position = style.position;
          if (position === "absolute" || position === "fixed") continue;
          width +=
            child.offsetWidth +
            (Number.parseFloat(style.marginInlineStart) || 0) +
            (Number.parseFloat(style.marginInlineEnd) || 0);
          counted += 1;
        }
        return width + gap * Math.max(0, counted - 1);
      };
      const stripGap = Number.parseFloat(stripStyle.columnGap) || 0;
      let needed = 0;
      let groups = 0;
      for (const child of current.children) {
        if (!(child instanceof HTMLElement)) continue;
        // Reserve the natural width of the hosted controls, overflowed ones included, so Git labels
        // compact first. Reserving only visible controls lets the labels re-expand and hide them.
        const hostedControls = child.matches('[data-chat-resting-composer-controls-host="true"]')
          ? child.querySelector<HTMLElement>('[data-chat-composer-resting-controls="true"]')
          : null;
        const hostedMeasurement = hostedControls
          ? measureRestingComposerControls(hostedControls)
          : null;
        const width = hostedMeasurement
          ? resolveRestingComposerControlsNaturalWidth(hostedMeasurement)
          : contentWidth(hostedControls ?? child);
        if (width <= 1) continue;
        groups += 1;
        needed += width;
      }
      needed += stripGap * Math.max(0, groups - 1);
      const range = document.createRange();
      for (const label of current.querySelectorAll<HTMLElement>("[data-composer-label]")) {
        needed += Math.max(0, labelTextWidth(label, range) - label.getBoundingClientRect().width);
      }
      const nextOverflows = resolveContextStripLabelsCompact({
        compact,
        neededWidth: needed,
        availableWidth: available,
      });
      if (nextOverflows === compact) return;
      const previousRects = new Map(
        Array.from(current.querySelectorAll<HTMLElement>(COMPOSER_CONTEXT_LABEL_SELECTOR)).map(
          (label) => [label, label.getBoundingClientRect()] as const,
        ),
      );
      flushSync(() => setOverflows(nextOverflows));
      animateLabelWidths(previousRects, labelAnimations);
    };

    let stopResize = () => {};
    const observeSizes = () => {
      stopResize();
      stopResize = observeResize(
        [
          current,
          ...Array.from(current.children),
          ...Array.from(current.querySelectorAll("[data-chat-composer-resting-controls='true']")),
          ...Array.from(current.querySelectorAll(COMPOSER_CONTEXT_LABEL_SELECTOR)),
        ],
        measure,
      );
    };
    observeSizes();
    // Text and control changes alter natural widths without resizing a hidden
    // or squeezed label, so they re-measure too. Only added or removed elements
    // can change the observed set; re-subscribing delivers a measure itself.
    const mutations = new MutationObserver((records) => {
      const elementsChanged = records.some((record) =>
        [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element),
      );
      if (elementsChanged) observeSizes();
      else measure();
    });
    mutations.observe(current, { childList: true, characterData: true, subtree: true });
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      stopResize();
      mutations.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
      for (const animation of labelAnimations.values()) animation.cancel();
    };
  };

  return [attach, overflows] as const;
}

export const BranchToolbar = memo(function BranchToolbar({
  layout = "composer",
  panelSection = "all",
  forceNewWorktree = false,
  ref,
  environmentId,
  threadId,
  projectId,
  worktreePath,
  isServerThread,
  showGitControls,
  draftId,
  composerDraftTarget,
  onEnvModeChange,
  envMode,
  activeThreadBranchOverride,
  startFromOrigin,
  onStartFromOriginChange,
  autoEnvironmentLabel,
  onAutoEnvironment,
  envLocked,
  onCheckoutPullRequestRequest,
  onComposerFocusRequest,
  availableEnvironments,
  onEnvironmentChange,
  composerControlsHostRef,
  contextStripVisible = true,
  showEnvironmentIndicator = false,
  canAddToMachine = false,
  projectPicker,
  contextStripPlacement = "bottom",
  usageMeter,
}: BranchToolbarProps) {
  const branchSelectorRef = useRef<BranchToolbarBranchSelectorHandle>(null);
  const threadRef = scopeThreadRef(environmentId, threadId);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  // The composer retains resolved thread details while bootstrap cleanup can remove its shell.
  const activeProjectRef = scopeProjectRef(environmentId, projectId);
  const activeProject = useProject(activeProjectRef);
  const activeWorktreePath = forceNewWorktree ? null : worktreePath;
  const effectiveEnvMode = forceNewWorktree ? "worktree" : envMode;
  const envModeLocked = envLocked || isServerThread;
  const workspaceCwd = activeWorktreePath ?? activeProject?.workspaceRoot ?? null;
  const workspaceStatus = useEnvironmentQuery(
    layout === "panel" &&
      panelSection !== "branch" &&
      showGitControls &&
      envModeLocked &&
      (effectiveEnvMode === "local" || activeWorktreePath !== null) &&
      !forceNewWorktree &&
      workspaceCwd
      ? vcsEnvironment.status({ environmentId, input: { cwd: workspaceCwd } })
      : null,
  );
  const activeBranch = resolveBranchToolbarValue({
    envMode: effectiveEnvMode,
    activeWorktreePath,
    activeThreadBranch:
      activeThreadBranchOverride !== undefined ? activeThreadBranchOverride : null,
    currentGitBranch: workspaceStatus.data?.refName ?? null,
  });

  const canUsePreviousWorktree = !isServerThread && !envModeLocked && !forceNewWorktree;
  const projectRefsForWorktreeLookup = canUsePreviousWorktree ? [activeProjectRef] : [];
  const projectThreads = useThreadShellsForProjectRefs(projectRefsForWorktreeLookup);
  const previousWorktreeSeed = canUsePreviousWorktree
    ? resolvePreviousWorktreeSeed({
        threads: projectThreads,
        currentWorktreePath: activeWorktreePath,
      })
    : null;
  const previousWorktreeLabel = previousWorktreeSeed
    ? resolvePreviousWorktreeLabel(previousWorktreeSeed)
    : null;
  const onUsePreviousWorktree = () => {
    if (!previousWorktreeSeed) return;
    setDraftThreadContext(draftId ?? threadRef, {
      branch: previousWorktreeSeed.branch,
      worktreePath: previousWorktreeSeed.worktreePath,
      envMode: "worktree",
      projectRef: activeProjectRef,
    });
  };

  useImperativeHandle(
    ref,
    () => ({
      openBranchPicker: () => branchSelectorRef.current?.open(),
      usePreviousWorktree: () => {
        if (!showGitControls || !canUsePreviousWorktree || !previousWorktreeSeed) return;
        onUsePreviousWorktree();
        onComposerFocusRequest?.();
      },
    }),
    [
      canUsePreviousWorktree,
      onComposerFocusRequest,
      onUsePreviousWorktree,
      previousWorktreeSeed,
      showGitControls,
    ],
  );

  const onAddToMachine = () =>
    openAddProjectToMachine({ projectRef: activeProjectRef, targetEnvironmentId: null });
  const [attachStrip, labelsOverflow] = useLabelsOverflow();

  if (!activeProject) {
    return layout === "composer" && projectPicker ? (
      <ComposerSurface.ContextStrip
        placement={contextStripPlacement}
        className={CONTEXT_STRIP_CLASS}
      >
        {projectPicker}
      </ComposerSurface.ContextStrip>
    ) : null;
  }

  if (layout === "panel") {
    return (
      <div className="flex w-full flex-col" data-thread-panel-run-context>
        {panelSection !== "branch" ? (
          <BranchToolbarEnvModeSelector
            displayMode="panel"
            envLocked={envModeLocked}
            effectiveEnvMode={effectiveEnvMode}
            activeWorktreePath={activeWorktreePath}
            activeBranch={showGitControls ? activeBranch : null}
            workspaceRoot={activeProject.workspaceRoot}
            onEnvModeChange={onEnvModeChange}
            previousWorktreeLabel={previousWorktreeLabel}
            previousWorktreeBranch={previousWorktreeSeed?.branch ?? null}
            onUsePreviousWorktree={onUsePreviousWorktree}
          />
        ) : null}
        {panelSection !== "workspace" ? (
          <BranchToolbarBranchSelector
            displayMode="panel"
            className="w-full"
            environmentId={environmentId}
            threadId={threadId}
            {...(draftId ? { draftId } : {})}
            {...(composerDraftTarget ? { composerDraftTarget } : {})}
            envLocked={envLocked}
            effectiveEnvModeOverride={effectiveEnvMode}
            {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
            startFromOrigin={startFromOrigin}
            onStartFromOriginChange={onStartFromOriginChange}
            {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
            {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
          />
        ) : null}
      </div>
    );
  }

  return (
    <ComposerSurface.ContextStrip
      ref={attachStrip}
      placement={contextStripPlacement}
      data-compact={labelsOverflow ? "" : undefined}
      className={cn(
        CONTEXT_STRIP_CLASS,
        // A non-Git strip with no visible composer controls should occupy no
        // space, but its host must retain a prospective width so controls can
        // become visible again when the chat view grows.
        !contextStripVisible && "pointer-events-none invisible absolute inset-x-0 top-full",
      )}
    >
      {projectPicker}
      {showEnvironmentIndicator && availableEnvironments ? (
        <BranchToolbarEnvironmentSelector
          autoEnvironmentLabel={autoEnvironmentLabel}
          onAutoEnvironment={onAutoEnvironment}
          envLocked={envLocked}
          environmentId={environmentId}
          availableEnvironments={availableEnvironments}
          {...(onEnvironmentChange ? { onEnvironmentChange } : {})}
          {...(canAddToMachine ? { onAddToMachine } : {})}
        />
      ) : null}
      {showGitControls ? (
        <BranchToolbarBranchSelector
          forceNewWorktree={forceNewWorktree}
          ref={branchSelectorRef}
          className="min-w-0 flex-initial"
          environmentId={environmentId}
          threadId={threadId}
          {...(draftId ? { draftId } : {})}
          envLocked={envLocked}
          effectiveEnvModeOverride={effectiveEnvMode}
          {...(activeThreadBranchOverride !== undefined ? { activeThreadBranchOverride } : {})}
          startFromOrigin={startFromOrigin}
          onStartFromOriginChange={onStartFromOriginChange}
          {...(onCheckoutPullRequestRequest ? { onCheckoutPullRequestRequest } : {})}
          {...(onComposerFocusRequest ? { onComposerFocusRequest } : {})}
        />
      ) : null}
      {showGitControls ? (
        <BranchToolbarEnvModeSelector
          forceNewWorktree={forceNewWorktree}
          envLocked={envModeLocked}
          effectiveEnvMode={effectiveEnvMode}
          activeWorktreePath={activeWorktreePath}
          onEnvModeChange={onEnvModeChange}
          previousWorktreeLabel={previousWorktreeLabel}
          previousWorktreeBranch={previousWorktreeSeed?.branch ?? null}
          onUsePreviousWorktree={onUsePreviousWorktree}
        />
      ) : null}

      {composerControlsHostRef ? (
        // The host takes whatever the workspace and branch controls leave
        // over, in both strip layouts, so a collapsed phone composer can show
        // its model and mode controls wherever they fit.
        <div
          ref={composerControlsHostRef}
          data-composer-context-control
          data-chat-resting-composer-controls-host="true"
          className="flex min-w-0 flex-1 items-center justify-start overflow-x-clip overflow-y-visible"
        />
      ) : null}
      {usageMeter}
    </ComposerSurface.ContextStrip>
  );
});
