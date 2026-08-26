import ComposableArchitecture
import SupaTheme
import SupatermLicenseFeature
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

struct TerminalSidebarChromeView: View {
  enum AuxiliarySection: Equatable {
    case licenseExpired
    case tabLimit
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
  let fixedHoveredProjectID: TerminalProjectID?
  let dismissReleaseAnnouncement: () -> Void

  @State private var pagingPosition: Double?

  var body: some View {
    VStack(spacing: 10) {
      SpaceSidebarPagerView(
        terminal: terminal,
        palette: palette,
        isActive: isPagingActive,
        sidebarControllerCache: sidebarControllerCache,
        fixedHoveredProjectID: fixedHoveredProjectID,
        position: $pagingPosition
      )
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      VStack(spacing: 10) {
        switch Self.auxiliarySection(
          isLicenseExpired: {
            if case .expired = licenseStore.access { return true }
            return false
          }(),
          hasTabLimitRefusal: terminal.showsLicenseTabLimitRefusal,
          showsUpdate: updateStore.phase.showsSidebarSection
        ) {
        case .licenseExpired:
          if case .expired(let ownership) = licenseStore.access {
            LicenseExpiredCardView(
              palette: palette,
              store: licenseStore,
              ownership: ownership
            )
          }
        case .tabLimit:
          LicenseTabLimitCardView(
            palette: palette,
            action: terminal.onLicenseTabLimitAction
          )
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
        footer
      }
      .padding(.leading, TerminalSidebarLayout.cardHorizontalInsets.leading)
      .padding(.trailing, TerminalSidebarLayout.cardHorizontalInsets.trailing)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .padding(.trailing, -TerminalChromeMetrics.paneInset)
  }

  private var footer: some View {
    ZStack {
      SpacePageDotsView(
        store: store,
        terminal: terminal,
        palette: palette,
        position: pagingPosition
      )
      HStack {
        Button(action: createProject) {
          Image(systemName: "folder.badge.plus")
            .font(.system(size: 14, weight: .medium))
            .accessibilityHidden(true)
        }
        .buttonStyle(TerminalSidebarButtonStyle(palette: palette, layout: .icon))
        .controlSize(.small)
        .foregroundStyle(palette.secondaryText)
        .accessibilityIdentifier(TerminalSidebarAccessibilityIdentifier.newProject)
        .accessibilityLabel("New Project")
        .help("New Project")
        Spacer(minLength: 0)
      }
    }
    .frame(maxWidth: .infinity)
  }

  private func createProject() {
    createSidebarProject(
      terminal: terminal,
      tabIDs: [],
      renameState: sidebarControllerCache.controller(for: terminal.displayedSpaceID).renameState
    )
  }
}
