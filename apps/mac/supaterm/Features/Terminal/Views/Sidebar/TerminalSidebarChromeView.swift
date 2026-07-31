import ComposableArchitecture
import SupaTheme
import SupatermUpdateFeature
import SwiftUI

struct TerminalSidebarChromeView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let isPagingActive: Bool
  let fixedHoveredGroupID: TerminalTabGroupID?
  let dismissReleaseAnnouncement: () -> Void

  var body: some View {
    VStack(spacing: 10) {
      SpaceSidebarPagerView(
        store: store,
        terminal: terminal,
        palette: palette,
        isActive: isPagingActive,
        fixedHoveredGroupID: fixedHoveredGroupID
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      VStack(spacing: 10) {
        if updateStore.phase.showsSidebarSection {
          TerminalSidebarUpdateSection(
            store: updateStore,
            palette: palette
          )
        }
        if let releaseAnnouncement {
          ReleaseAnnouncementCardView(
            announcement: releaseAnnouncement,
            palette: palette,
            dismiss: dismissReleaseAnnouncement
          )
        }
      }
      .padding(.leading, TerminalSidebarLayout.cardHorizontalInsets.leading)
      .padding(.trailing, TerminalSidebarLayout.cardHorizontalInsets.trailing)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(.trailing, -TerminalChromeMetrics.paneInset)
  }
}
