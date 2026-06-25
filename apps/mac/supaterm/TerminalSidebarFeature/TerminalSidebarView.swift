import ComposableArchitecture
import SupatermTerminalFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SupatermTerminalWindowFeature
import SupatermUpdateFeature
import SwiftUI

public struct TerminalSidebarView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: TerminalPalette
  let terminal: TerminalHostState
  let dismissReleaseAnnouncement: () -> Void

  public init(
    store: StoreOf<TerminalWindowFeature>,
    updateStore: StoreOf<UpdateFeature>,
    releaseAnnouncement: ReleaseAnnouncement?,
    palette: TerminalPalette,
    terminal: TerminalHostState,
    dismissReleaseAnnouncement: @escaping () -> Void
  ) {
    self.store = store
    self.updateStore = updateStore
    self.releaseAnnouncement = releaseAnnouncement
    self.palette = palette
    self.terminal = terminal
    self.dismissReleaseAnnouncement = dismissReleaseAnnouncement
  }

  public var body: some View {
    ZStack(alignment: .topLeading) {
      TerminalSidebarChromeView(
        store: store,
        updateStore: updateStore,
        releaseAnnouncement: releaseAnnouncement,
        palette: palette,
        terminal: terminal,
        dismissReleaseAnnouncement: dismissReleaseAnnouncement
      )
      WindowTrafficLights()
        .padding(.top, TerminalSidebarLayout.trafficLightTopPadding)
    }
    .padding(.bottom, sidebarBottomPadding)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

private let sidebarBottomPadding: CGFloat = 8
