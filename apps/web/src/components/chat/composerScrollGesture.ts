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
}) {
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

export function createComposerScrollGestureState() {
  return {
    accumulatedDeltaPx: 0,
    collapseSuppressed: false,
    lastEventAt: Number.NEGATIVE_INFINITY,
  };
}

export function resetComposerScrollGesture(state: ComposerScrollGestureState) {
  state.accumulatedDeltaPx = 0;
  state.collapseSuppressed = false;
  state.lastEventAt = Number.NEGATIVE_INFINITY;
}

export function suppressActiveComposerScrollGesture(
  state: ComposerScrollGestureState,
  now: number,
  gestureResetMs: number,
) {
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
) {
  state.lastEventAt = input.now;
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
