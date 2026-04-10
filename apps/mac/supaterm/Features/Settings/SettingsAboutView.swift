import AppKit
import ComposableArchitecture
import SupatermCLIShared
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

struct SettingsAboutView: View {
  let store: StoreOf<SettingsFeature>

  private var updateChannel: Binding<UpdateChannel> {
    Binding(
      get: { store.updateChannel },
      set: { newValue in
        _ = store.send(.updateChannelSelected(newValue))
      }
    )
  }

  private var updatesAutomaticallyCheckForUpdates: Binding<Bool> {
    Binding(
      get: { store.updatesAutomaticallyCheckForUpdates },
      set: { newValue in
        _ = store.send(.updatesAutomaticallyCheckForUpdatesChanged(newValue))
      }
    )
  }

  private var updatesAutomaticallyDownloadUpdates: Binding<Bool> {
    Binding(
      get: { store.updatesAutomaticallyDownloadUpdates },
      set: { newValue in
        _ = store.send(.updatesAutomaticallyDownloadUpdatesChanged(newValue))
      }
    )
  }

  private var analyticsEnabled: Binding<Bool> {
    Binding(
      get: { store.analyticsEnabled },
      set: { newValue in
        _ = store.send(.analyticsEnabledChanged(newValue))
      }
    )
  }

  private var crashReportsEnabled: Binding<Bool> {
    Binding(
      get: { store.crashReportsEnabled },
      set: { newValue in
        _ = store.send(.crashReportsEnabledChanged(newValue))
      }
    )
  }

  private var appName: String {
    Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
      ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String
      ?? "Supaterm"
  }

  private var versionText: String {
    switch (AppBuild.version, AppBuild.buildNumber) {
    case (let version, let buildNumber) where !version.isEmpty && !buildNumber.isEmpty:
      return "\(version) (\(buildNumber))"
    case (let version, _) where !version.isEmpty:
      return version
    case (_, let buildNumber) where !buildNumber.isEmpty:
      return buildNumber
    default:
      return "Unknown Version"
    }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        SettingsSurfaceCard {
          HStack(alignment: .center, spacing: 20) {
            Image(nsImage: NSApplication.shared.applicationIconImage ?? NSImage())
              .resizable()
              .interpolation(.high)
              .frame(width: 84, height: 84)
              .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 6) {
              Text(appName)
                .font(.system(size: 28, weight: .semibold))

              Text(versionText)
                .font(.headline)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)

              HStack(spacing: 12) {
                Button("Check for Updates") {
                  _ = store.send(.checkForUpdatesButtonTapped)
                }
                .buttonStyle(.bordered)
                .controlSize(.regular)

                Picker("Updates", selection: updateChannel) {
                  ForEach(UpdateChannel.allCases) { channel in
                    Text(channel.title).tag(channel)
                  }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .frame(width: 150, alignment: .leading)
                .controlSize(.regular)
              }

              VStack(alignment: .leading, spacing: 8) {
                SettingsCompactToggleRow(
                  title: "Automatically check for updates",
                  isOn: updatesAutomaticallyCheckForUpdates
                )

                SettingsCompactToggleRow(
                  title: "Automatically download and install updates",
                  isOn: updatesAutomaticallyDownloadUpdates
                )
                .disabled(!store.updatesAutomaticallyCheckForUpdates)
              }
            }

            Spacer(minLength: 0)
          }
        }

        SettingsSurfaceCard {
          VStack(alignment: .leading, spacing: 12) {
            Text("Diagnostics")
              .font(.subheadline.weight(.semibold))

            VStack(alignment: .leading, spacing: 10) {
              SettingsCompactToggleRow(
                title: "Share analytics with Supaterm",
                isOn: analyticsEnabled
              )

              SettingsCompactToggleRow(
                title: "Share crash reports with Supaterm",
                isOn: crashReportsEnabled
              )
            }

            Text("Help us improve Supaterm by allowing us to collect completely anonymous usage data.")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
        }
      }
      .padding(24)
      .frame(maxWidth: 760, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .center)
    }
    .navigationTitle("About")
  }
}
