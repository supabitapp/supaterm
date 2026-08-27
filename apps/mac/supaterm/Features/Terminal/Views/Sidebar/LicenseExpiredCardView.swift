import ComposableArchitecture
import SupaTheme
import SupatermLicenseFeature
import SupatermSupport
import SwiftUI

struct LicenseExpiredCardView: View {
  let palette: Palette
  let store: StoreOf<LicenseFeature>
  let ownership: LicenseOwnership

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Your update entitlement ended \(ownership.updatesThrough.rawValue).")
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(palette.secondaryText)
        .fixedSize(horizontal: false, vertical: true)

      HStack(spacing: 12) {
        Button("Renew Updates") {
          store.send(.renewButtonTapped)
        }
        Button("Download Your Latest Release") {
          store.send(.ownedReleaseButtonTapped)
        }
      }
      .buttonStyle(.borderless)
      .font(.system(size: 12, weight: .semibold))
    }
    .terminalSidebarAnnouncementCard(palette: palette)
  }

}
