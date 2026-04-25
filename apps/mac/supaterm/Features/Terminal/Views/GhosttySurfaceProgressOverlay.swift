import GhosttyKit
import SwiftUI

struct GhosttySurfaceProgressOverlay: View {
  @Bindable var state: GhosttySurfaceState

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  init(state: GhosttySurfaceState) {
    self._state = Bindable(state)
  }

  var body: some View {
    if state.progressStyleEnabled,
      let progressState = state.progressState,
      progressState != GHOSTTY_PROGRESS_STATE_REMOVE
    {
      GhosttySurfaceProgressBar(
        progressState: progressState,
        progressValue: state.progressValue
      )
      .terminalTransition(.opacity, reduceMotion: reduceMotion)
    }
  }
}
