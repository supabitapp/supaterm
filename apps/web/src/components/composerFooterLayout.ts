const COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX = 620;
const COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX = 780;
const RESTING_COMPOSER_IMAGE_THUMBNAIL_LIMIT = 3;

export function getRestingComposerImagePreviewCounts(imageCount: number): {
  visibleCount: number;
  overflowCount: number;
} {
  const visibleCount = Math.min(imageCount, RESTING_COMPOSER_IMAGE_THUMBNAIL_LIMIT);
  return {
    visibleCount,
    overflowCount: Math.max(0, imageCount - visibleCount),
  };
}

export function shouldUseCompactComposerFooter(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  const breakpoint = options?.hasWideActions
    ? COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX
    : COMPOSER_FOOTER_COMPACT_BREAKPOINT_PX;
  return width !== null && width < breakpoint;
}

export function shouldUseRestingComposerLayout(input: {
  isExistingThread: boolean;
  isMobileViewport: boolean;
  isScrollCollapsed: boolean;
  hasExpandedChrome: boolean;
  hasMultilinePrompt: boolean;
  timelineOverflows: boolean;
}): boolean {
  // Multiline drafts stay readable. Resting only clamps a single prompt
  // line and overlays its actions; non-image attachment and context
  // rows keep their natural height above it while image previews move inline.
  // Banners and the tasks badge dock above the surface, so they are absent
  // too, and resting hides them along with the model controls and the strip
  // below.
  //
  // Only a timeline scroll rests the composer: the user asked for it with the
  // gesture, and it lifts on the next composer interaction. Losing focus never
  // rests it, so clicking a message, copying output, or selecting text for a
  // citation leaves the composer where it was.
  //
  // Resting exists to give reading space back to the timeline. A thread that
  // fits above the composer has nothing to reclaim, so it stays expanded and
  // never shows the collapsed row that a fresh thread would otherwise open on.
  return (
    input.isExistingThread &&
    !input.isMobileViewport &&
    input.timelineOverflows &&
    input.isScrollCollapsed &&
    !input.hasMultilinePrompt &&
    !input.hasExpandedChrome
  );
}

/**
 * How much taller the empty expanded composer is than its resting row on
 * desktop widths, from the layout classes in ChatComposer: the body loses
 * 8px of top padding, the prompt clamps from min-h-17.5 (70px) to 32px, and
 * the 48px footer leaves flow.
 */
const COMPOSER_RESTING_EXPANSION_MIN_PX = 94;

/** Reserve expansion height because the timeline does not move when footer growth covers its last rows. */
export function resolveComposerTimelineInset(input: {
  currentInset: number;
  overlayHeight: number;
  isResting: boolean;
  restingOnlyHeight?: number;
  expandedNoticesHeight?: number;
}): number {
  // Expanded notices temporarily cover the timeline. Remove their growth before
  // rounding so fractional measurements reserve exactly the collapsed height.
  const overlayHeight = Math.ceil(input.overlayHeight - (input.expandedNoticesHeight ?? 0));
  return input.isResting
    ? Math.max(
        input.currentInset,
        overlayHeight + (input.currentInset === 0 ? COMPOSER_RESTING_EXPANSION_MIN_PX : 0),
      )
    : overlayHeight;
}

type ComposerUsageMeterSlot = "row" | "context-strip";

/**
 * Where the usage meter goes. A new thread shows it in a row under the composer; a started
 * thread shows it in the context strip, so it stays hidden whenever that strip is not mounted.
 */
export function resolveComposerUsageMeterSlot(input: {
  hasUsageWindows: boolean;
  isMobileViewport: boolean;
  isDraftHero: boolean;
  contextStripMounted: boolean;
}): ComposerUsageMeterSlot | null {
  if (!input.hasUsageWindows || input.isMobileViewport || !input.contextStripMounted) return null;
  if (input.isDraftHero) return "row";
  return "context-strip";
}

export function overlayComposerIsResting(input: {
  composerMounted: boolean;
  composerReportedResting: boolean;
}): boolean {
  return input.composerMounted && input.composerReportedResting;
}

export function shouldAnimateComposerRestingTransition(input: {
  hasCompletedInitialLayout: boolean;
  stateChanged: boolean;
  hasInterruptedAnimation: boolean;
}): boolean {
  return input.hasCompletedInitialLayout && (input.stateChanged || input.hasInterruptedAnimation);
}

export function shouldUseCompactComposerPrimaryActions(
  width: number | null,
  options?: { hasWideActions?: boolean },
): boolean {
  if (!options?.hasWideActions) {
    return false;
  }
  return width !== null && width < COMPOSER_FOOTER_WIDE_ACTIONS_COMPACT_BREAKPOINT_PX;
}

export interface RestingComposerControlsMeasurement {
  gap: number;
  naturalFixedWidth: number;
  minimumFixedWidth: number;
  blockWidths: readonly number[];
  overflowWidth: number;
  iconOnlyBlockWidths?: readonly number[];
}

function restingComposerControlsWidth(
  input: RestingComposerControlsMeasurement,
  hiddenCount: number,
  fixedWidth = input.naturalFixedWidth,
  iconOnlyCount = 0,
): number {
  const { blockWidths, gap } = input;
  const visibleCount = blockWidths.length - hiddenCount;
  return (
    fixedWidth +
    blockWidths
      .slice(0, visibleCount)
      .reduce(
        (sum, width, index) =>
          sum +
          (index >= blockWidths.length - iconOnlyCount
            ? (input.iconOnlyBlockWidths?.[index] ?? width)
            : width),
        0,
      ) +
    (hiddenCount > 0 ? input.overflowWidth : 0) +
    gap * (visibleCount + (hiddenCount > 0 ? 1 : 0))
  );
}

/** Reserve natural composer width to prevent strip labels from repeatedly expanding into space vacated by
 * hidden controls. */
export function resolveRestingComposerControlsNaturalWidth(
  input: RestingComposerControlsMeasurement,
): number {
  return restingComposerControlsWidth(input, 0);
}

const RESTING_CONTROLS_SLACK_PX = 1;

export function resolveRestingComposerControlsLayout(
  input: RestingComposerControlsMeasurement & {
    hostWidth: number;
    previous?: { hiddenCount: number; iconOnlyCount?: number; visible: boolean };
  },
): { hiddenCount: number; iconOnlyCount?: number; visible: boolean } {
  const { blockWidths, hostWidth, previous } = input;
  const iconSteps = input.iconOnlyBlockWidths ? blockWidths.length : 0;
  const previousStep = previous
    ? previous.hiddenCount > 0
      ? iconSteps + Math.min(previous.hiddenCount, blockWidths.length)
      : Math.min(previous.iconOnlyCount ?? 0, iconSteps)
    : 0;
  let step = 0;
  const widthAtStep = (candidate: number, fixedWidth = input.naturalFixedWidth) =>
    restingComposerControlsWidth(
      input,
      Math.max(0, candidate - iconSteps),
      fixedWidth,
      Math.min(candidate, iconSteps),
    );
  // Use 1px slack for natural-width jitter on promotion; demote immediately to avoid clipping or layout
  // flapping.
  while (
    step < iconSteps + blockWidths.length &&
    widthAtStep(step) > hostWidth - (step < previousStep ? RESTING_CONTROLS_SLACK_PX : 0)
  ) {
    step += 1;
  }
  const hiddenCount = Math.max(0, step - iconSteps);
  const iconOnlyCount = Math.min(step, iconSteps);
  const minimumWidth = widthAtStep(step, input.minimumFixedWidth);
  const visible =
    previous && !previous.visible
      ? minimumWidth <= hostWidth - RESTING_CONTROLS_SLACK_PX
      : minimumWidth <= hostWidth;
  return { hiddenCount, ...(input.iconOnlyBlockWidths ? { iconOnlyCount } : {}), visible };
}

export function resolveScrollToEndClearance(input: {
  overlayHeight: number;
  mainSurfaceTop: number;
  button: { left: number; right: number };
  attachments: ReadonlyArray<{ top: number; left: number; right: number }>;
}): number {
  let contentTop = input.mainSurfaceTop;
  let top = contentTop;
  for (const attachment of input.attachments) {
    contentTop = Math.min(contentTop, attachment.top);
    if (attachment.left < input.button.right && attachment.right > input.button.left) {
      top = Math.min(top, attachment.top);
    }
  }
  return Math.ceil(input.overlayHeight - (top - contentTop));
}
