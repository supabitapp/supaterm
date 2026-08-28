import GhosttyKit
import SwiftUI

struct GhosttySurfaceProgressOverlay: View {
  @Bindable var state: GhosttySurfaceState
  let themeColor: Color

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  init(state: GhosttySurfaceState, themeColor: Color) {
    self._state = Bindable(state)
    self.themeColor = themeColor
  }

  var body: some View {
    if state.progressStyleEnabled,
      let progressState = state.progressState,
      progressState != GHOSTTY_PROGRESS_STATE_REMOVE
    {
      GhosttySurfaceProgressBar(
        progressState: progressState,
        progressValue: state.progressValue,
        themeColor: themeColor
      )
      .terminalTransition(.opacity, reduceMotion: reduceMotion)
    }
  }
}
