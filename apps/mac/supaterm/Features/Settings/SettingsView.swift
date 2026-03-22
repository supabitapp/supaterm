import SwiftUI

struct SettingsTabContentView: View {
  let tab: SettingsFeature.Tab

  var body: some View {
    VStack(spacing: 12) {
      Text(tab.title)
        .font(.title2.weight(.semibold))

      Text(tab.detail)
        .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .padding(24)
  }
}
