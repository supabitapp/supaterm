type ComposerScrollGestureState = {
  accumulatedDeltaPx: number;
  collapseSuppressed: boolean;
  lastEventAt: number;
};

export function shouldCollapseComposerForScrollKey(input: {
  key: string;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  isAtLogicalEnd: boolean;
}): boolean {
  switch (input.key) {
    case "PageUp":
    case "Home":
      return input.scrollTop > 1;
    case "PageDown":
    case "End":
      return !input.isAtLogicalEnd && input.scrollTop < input.scrollHeight - input.clientHeight - 1;
    default:
      return false;
  }
}

export function createComposerScrollGestureState(): ComposerScrollGestureState {
  return {
    accumulatedDeltaPx: 0,
    collapseSuppressed: false,
    lastEventAt: Number.NEGATIVE_INFINITY,
  };
}

export function resetComposerScrollGesture(state: ComposerScrollGestureState): void {
  state.accumulatedDeltaPx = 0;
  state.collapseSuppressed = false;
  state.lastEventAt = Number.NEGATIVE_INFINITY;
}

export function suppressActiveComposerScrollGesture(
  state: ComposerScrollGestureState,
  now: number,
  gestureResetMs: number,
): void {
  if (now - state.lastEventAt <= gestureResetMs) {
    state.collapseSuppressed = true;
  }
}

export function recordComposerScrollGestureEvent(
  state: ComposerScrollGestureState,
  input: {
    now: number;
    deltaPx: number;
    collapseThresholdPx: number;
    collapseEligible: boolean;
    canScrollInGestureDirection: boolean;
    atLogicalEnd: boolean;
  },
): boolean {
  state.lastEventAt = input.now;
  // Any wheel-down inside the end band restores the composer, so collapsing there would undo itself.
  if (
    state.collapseSuppressed ||
    !input.collapseEligible ||
    !input.canScrollInGestureDirection ||
    input.atLogicalEnd
  ) {
    state.accumulatedDeltaPx = 0;
    return false;
  }

  state.accumulatedDeltaPx += input.deltaPx;
  if (state.accumulatedDeltaPx < input.collapseThresholdPx) {
    return false;
  }

  state.accumulatedDeltaPx = 0;
  return true;
}
