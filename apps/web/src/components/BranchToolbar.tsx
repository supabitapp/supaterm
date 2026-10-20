import { scopeProjectRef, scopeThreadRef } from "@supaterm/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@supaterm/contracts";
import {
  type ReactNode,
  type Ref,
  memo,
  useImperativeHandle,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { useProject, useQuietThreadShell, useThreadShellsForProjectRefs } from "../state/entities";
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
  showGitControls: boolean;
  draftId?: DraftId;
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

function useLabelsOverflow(element: HTMLDivElement | null): boolean {
  const [overflows, setOverflows] = useState(false);
  const pendingLabelRectsRef = useRef<{
    readonly overflows: boolean;
    readonly rects: Map<HTMLElement, DOMRect>;
  } | null>(null);
  const labelAnimationsRef = useRef(new Map<HTMLElement, Animation>());
  const measure = useEffectEvent(() => {
    const current = element;
    const compact = overflows;
    if (!current) return;
    const available = current.clientWidth;
    if (available === 0) return;
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
    const stripGap = Number.parseFloat(getComputedStyle(current).columnGap) || 0;
    let needed = 0;
    let groups = 0;
    for (const child of current.children) {
      if (!(child instanceof HTMLElement)) continue;
      // Reserve the natural width of the controls inside it, blocks in overflow
      // included, so Git labels compact before squeezing out the model picker.
      // Reserving only the visible controls would let the labels expand into
      // room the composer just freed, shrink the host, and hide the controls
      // again.
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
    if (nextOverflows !== compact) {
      pendingLabelRectsRef.current = {
        overflows: nextOverflows,
        rects: new Map(
          Array.from(current.querySelectorAll<HTMLElement>(COMPOSER_CONTEXT_LABEL_SELECTOR)).map(
            (label) => [label, label.getBoundingClientRect()],
          ),
        ),
      };
    }
    setOverflows(nextOverflows);
  });

  useLayoutEffect(() => {
    const pending = pendingLabelRectsRef.current;
    if (pending?.overflows !== overflows) return;
    pendingLabelRectsRef.current = null;

    for (const animation of labelAnimationsRef.current.values()) {
      animation.cancel();
    }
    labelAnimationsRef.current.clear();

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    for (const [label, previousRect] of pending.rects) {
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
      labelAnimationsRef.current.set(label, animation);
      animation.addEventListener(
        "finish",
        () => {
          if (labelAnimationsRef.current.get(label) === animation) {
            labelAnimationsRef.current.delete(label);
          }
        },
        { once: true },
      );
    }
  }, [overflows]);

  useEffect(
    () => () => {
      for (const animation of labelAnimationsRef.current.values()) {
        animation.cancel();
      }
    },
    [],
  );

  useLayoutEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- The label mode comes from measuring the committed DOM, which render cannot read.
    measure();
  });

  useEffect(() => {
    if (!element) return;
    const stopObserving = observeResize(element, measure);
    document.fonts.addEventListener("loadingdone", measure);
    return () => {
      stopObserving();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [element]);

  return overflows;
}

export const BranchToolbar = memo(function BranchToolbar({
  layout = "composer",
  panelSection = "all",
  forceNewWorktree = false,
  ref,
  environmentId,
  threadId,
  showGitControls,
  draftId,
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
  projectPicker,
  contextStripPlacement = "bottom",
  usageMeter,
}: BranchToolbarProps) {
  const branchSelectorRef = useRef<BranchToolbarBranchSelectorHandle>(null);
  const threadRef = scopeThreadRef(environmentId, threadId);
  const draftThread = useComposerDraftStore((store) =>
    draftId ? store.getDraftSession(draftId) : store.getDraftThreadByRef(threadRef),
  );
  const serverThread = useQuietThreadShell(threadRef);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const activeProjectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const activeProject = useProject(activeProjectRef);
  const hasActiveThread = serverThread !== null || draftThread !== null;
  const activeWorktreePath = forceNewWorktree
    ? null
    : (serverThread?.worktreePath ?? draftThread?.worktreePath ?? null);
  const effectiveEnvMode = forceNewWorktree ? "worktree" : envMode;
  const envModeLocked = envLocked || serverThread !== null;
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
      activeThreadBranchOverride !== undefined
        ? activeThreadBranchOverride
        : (serverThread?.branch ?? draftThread?.branch ?? null),
    currentGitBranch: workspaceStatus.data?.refName ?? null,
  });

  const canUsePreviousWorktree = draftThread !== null && !envModeLocked && !forceNewWorktree;
  const projectRefsForWorktreeLookup =
    canUsePreviousWorktree && activeProjectRef ? [activeProjectRef] : [];
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
    if (!previousWorktreeSeed || !activeProjectRef) return;
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

  const hasMultipleEnvironments = (availableEnvironments?.length ?? 0) > 1;
  const showEnvironmentPicker = hasMultipleEnvironments && onEnvironmentChange !== undefined;
  const [stripElement, setStripElement] = useState<HTMLDivElement | null>(null);
  const labelsOverflow = useLabelsOverflow(stripElement);

  if (!hasActiveThread || !activeProject) {
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
          />
        ) : null}
        {panelSection !== "workspace" ? (
          <BranchToolbarBranchSelector
            displayMode="panel"
            className="w-full"
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
      </div>
    );
  }

  return (
    <ComposerSurface.ContextStrip
      ref={setStripElement}
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
          {...(showEnvironmentPicker ? { onEnvironmentChange } : {})}
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
