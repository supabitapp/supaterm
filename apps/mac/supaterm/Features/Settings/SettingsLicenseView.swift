import ComposableArchitecture
import SupatermSupport
import SwiftUI

struct SettingsLicenseView: View {
  @Bindable var store: StoreOf<LicenseFeature>

  private var key: Binding<String> {
    Binding(
      get: { store.key },
      set: { _ = store.send(.keyChanged($0)) }
    )
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        SettingsSurfaceCard {
          VStack(alignment: .leading, spacing: 16) {
            Text(title)
              .font(.title2.weight(.semibold))

            Text(store.settingsStatus)
              .foregroundStyle(.secondary)
              .textSelection(.enabled)

            content

            if let errorMessage = store.errorMessage {
              Text(errorMessage)
                .font(.callout)
                .foregroundStyle(.red)
                .textSelection(.enabled)
                .accessibilityIdentifier("settings.license.error")
            }
          }
        }
      }
      .padding(24)
      .frame(maxWidth: 760, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .center)
    }
    .navigationTitle("License")
  }

  private var title: String {
    switch store.mode {
    case .free:
      "Activate Supaterm"
    case .paid:
      "Licensed"
    case .expiredOnNewerRelease:
      "Updates Ended"
    }
  }

  @ViewBuilder
  private var content: some View {
    switch store.mode {
    case .free:
      VStack(alignment: .leading, spacing: 12) {
        TextField("SUPATERM-…", text: key)
          .textFieldStyle(.roundedBorder)
          .accessibilityIdentifier("settings.license.key")
          .onSubmit {
            _ = store.send(.activationButtonTapped)
          }

        HStack(spacing: 10) {
          Button("Activate") {
            _ = store.send(.activationButtonTapped)
          }
          .buttonStyle(.borderedProminent)
          .disabled(store.key.isEmpty || store.phase != .idle)
          .accessibilityIdentifier("settings.license.activate")

          Button("Buy Supaterm") {
            _ = store.send(.buyButtonTapped)
          }
          .buttonStyle(.bordered)
          .disabled(store.phase != .idle)
          .accessibilityIdentifier("settings.license.buy")

          if store.hasLicenseKey {
            Button("Remove License") {
              _ = store.send(.deactivationButtonTapped)
            }
            .buttonStyle(.bordered)
            .disabled(store.phase != .idle)
          }
        }
      }

    case .paid:
      VStack(alignment: .leading, spacing: 12) {
        if let updatesThrough = store.entitlement?.updatesThrough {
          Text("Updates through \(updatesThrough.rawValue)")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        HStack(spacing: 10) {
          Button("Renew Updates") {
            _ = store.send(.renewButtonTapped)
          }
          .buttonStyle(.borderedProminent)
          .disabled(store.phase != .idle)

          Button("Deactivate This Mac") {
            _ = store.send(.deactivationButtonTapped)
          }
          .buttonStyle(.bordered)
          .disabled(store.phase != .idle)
          .accessibilityIdentifier("settings.license.deactivate")
        }
      }

    case .expiredOnNewerRelease:
      HStack(spacing: 10) {
        Button("Renew Updates") {
          _ = store.send(.renewButtonTapped)
        }
        .buttonStyle(.borderedProminent)
        .disabled(store.phase != .idle)

        Button("Get Your Owned Release") {
          _ = store.send(.ownedReleaseButtonTapped)
        }
        .buttonStyle(.bordered)
        .disabled(store.phase != .idle)

        Button("Deactivate This Mac") {
          _ = store.send(.deactivationButtonTapped)
        }
        .buttonStyle(.bordered)
        .disabled(store.phase != .idle)
      }
    }
  }
}
