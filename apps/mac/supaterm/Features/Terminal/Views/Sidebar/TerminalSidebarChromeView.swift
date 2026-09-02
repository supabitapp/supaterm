import ComposableArchitecture
import SupaTheme
import SupatermLicenseFeature
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

struct TerminalSidebarChromeView: View {
  enum AuxiliarySection: Equatable {
    case licenseExpired
    case update
  }

  let store: StoreOf<TerminalWindowFeature>
  let licenseStore: StoreOf<LicenseFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let isPagingActive: Bool
  let sidebarControllerCache: TerminalSidebarControllerCache
  let fixedHoveredGroupID: TerminalTabGroupID?
  let shouldPlayTabMoveHaptics: Bool
  let dismissReleaseAnnouncement: () -> Void

  @State private var pagingPosition: Double?

  private var updatePresentation: UpdateSidebarPresentation {
    updateStore.phase.sidebarPresentation
  }

  var body: some View {
    VStack(spacing: 10) {
      SpaceSidebarPagerView(
        terminal: terminal,
        palette: palette,
        isActive: isPagingActive,
        sidebarControllerCache: sidebarControllerCache,
        fixedHoveredGroupID: fixedHoveredGroupID,
        shouldPlayTabMoveHaptics: shouldPlayTabMoveHaptics,
        position: $pagingPosition
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      VStack(spacing: 10) {
        switch Self.auxiliarySection(
          isLicenseExpired: {
            if case .expired = licenseStore.access { return true }
            return false
          }(),
          showsUpdate: updatePresentation == .card
        ) {
        case .licenseExpired:
          if case .expired(let ownership) = licenseStore.access {
            LicenseExpiredCardView(
              palette: palette,
              store: licenseStore,
              ownership: ownership
            )
          }
        case .update:
          TerminalSidebarUpdateSection(
            store: updateStore,
            palette: palette
          )
        case nil:
          EmptyView()
        }
        if let releaseAnnouncement {
          ReleaseAnnouncementCardView(
            announcement: releaseAnnouncement,
            palette: palette,
            dismiss: dismissReleaseAnnouncement
          )
        }
        ZStack {
          SpacePageDotsView(
            store: store,
            terminal: terminal,
            palette: palette,
            position: pagingPosition
          )

          if updatePresentation == .compact {
            TerminalSidebarCompactUpdateButton(
              store: updateStore,
              palette: palette
            )
            .frame(maxWidth: .infinity, alignment: .trailing)
          }
        }
      }
      .padding(.leading, TerminalSidebarLayout.cardHorizontalInsets.leading)
      .padding(.trailing, TerminalSidebarLayout.cardHorizontalInsets.trailing)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(.trailing, -TerminalChromeMetrics.paneInset)
  }

  static func auxiliarySection(
    isLicenseExpired: Bool,
    showsUpdate: Bool
  ) -> AuxiliarySection? {
    if isLicenseExpired {
      return .licenseExpired
    }
    return showsUpdate ? .update : nil
  }
}
