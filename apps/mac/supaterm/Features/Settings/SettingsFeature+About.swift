import ComposableArchitecture
import SupatermSupport
import SupatermUpdateFeature

extension SettingsFeature {
  func reduceAbout(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .checkForUpdatesButtonTapped:
      analyticsClient.capture("update_checked")
      return .run { [updateClient] _ in
        await updateClient.perform(.checkForUpdates)
      }

    case .updateChannelSelected(let updateChannel):
      state.about.updateChannel = updateChannel
      return .merge(
        persist(state),
        .run { [updateClient] _ in
          await updateClient.setUpdateChannel(updateChannel)
        }
      )

    case .updatesAutomaticallyCheckForUpdatesChanged(let isEnabled):
      state.about.updatesAutomaticallyCheckForUpdates = isEnabled
      if !isEnabled {
        state.about.updatesAutomaticallyDownloadUpdates = false
      }
      return .run { [updateClient] _ in
        await updateClient.setAutomaticallyChecksForUpdates(isEnabled)
      }

    case .updatesAutomaticallyDownloadUpdatesChanged(let isEnabled):
      guard state.about.updatesAutomaticallyCheckForUpdates else {
        return .none
      }
      state.about.updatesAutomaticallyDownloadUpdates = isEnabled
      return .run { [updateClient] _ in
        await updateClient.setAutomaticallyDownloadsUpdates(isEnabled)
      }

    default:
      return .none
    }
  }
}
