import SupaTheme
import SupatermTerminalCore
import SwiftUI

extension LicenseTabLimitAction {
  fileprivate var title: String {
    switch self {
    case .activate: "Activate"
    case .buy: "Buy"
    }
  }
}

struct LicenseTabLimitCardView: View {
  static let message = TerminalCreateTabError.tabLimitMessage(limit: LicenseTabGate.tabLimit)

  let palette: Palette
  let action: (LicenseTabLimitAction) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(Self.message)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .fixedSize(horizontal: false, vertical: true)

      HStack(spacing: 12) {
        ForEach(LicenseTabLimitAction.allCases, id: \.self) { action in
          Button(action.title) {
            self.action(action)
          }
          .buttonStyle(.borderless)
        }
      }
      .font(.system(size: 12, weight: .semibold))
    }
    .terminalSidebarAnnouncementCard(palette: palette)
  }
}
