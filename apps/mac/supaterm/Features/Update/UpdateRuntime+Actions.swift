import AppKit
import Foundation
import Sparkle

extension UpdateRuntime {
  @objc func handleWindowWillClose() {
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(50))
      self?.clearUnobtrusiveStateForFallbackIfNeeded()
    }
  }

  func checkForUpdates() {
    guard let updater else { return }
    if phase.isIdle {
      updater.checkForUpdates()
      return
    }

    switch interaction {
    case .checking(let cancel), .downloading(let cancel):
      cancel()
    case .updateAvailable(let reply):
      reply(.dismiss)
    case .notFound(let acknowledgement):
      acknowledgement()
    case .error, .permissionRequest, .installing, .none:
      break
    }

    resetPreparedInstallChoice()
    interaction = .none
    phase = .idle
    publish()

    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(100))
      self?.updater?.checkForUpdates()
    }
  }

  func cancelInteraction() {
    switch interaction {
    case .checking(let cancel), .downloading(let cancel):
      resetPreparedInstallChoice()
      sessionOrigin = .idle
      interaction = .none
      phase = .idle
      publish()
      cancel()
    default:
      return
    }
  }

  func dismissInteraction() {
    switch interaction {
    case .updateAvailable(let reply):
      resetPreparedInstallChoice()
      sessionOrigin = .idle
      interaction = .none
      phase = .idle
      publish()
      reply(.dismiss)
    case .notFound(let acknowledgement):
      resetPreparedInstallChoice()
      sessionOrigin = .idle
      interaction = .none
      phase = .idle
      publish()
      acknowledgement()
    case .error:
      resetPreparedInstallChoice()
      sessionOrigin = .idle
      interaction = .none
      phase = .idle
      publish()
    default:
      return
    }
  }

  func installUpdate() {
    guard case .updateAvailable(let reply) = interaction else { return }
    preparedInstallChoice = .relaunch
    reply(.install)
  }

  func installAfterNextRestart() {
    guard case .updateAvailable(let reply) = interaction else { return }
    preparedInstallChoice = .nextRestart
    if updateAvailableStage == .installing {
      resetPreparedInstallChoice()
      sessionOrigin = .idle
      interaction = .none
      phase = .idle
      publish()
      reply(.dismiss)
      return
    }
    reply(.install)
  }

  func performCheckForUpdates() {
    guard updater?.canCheckForUpdates ?? false else { return }
    checkForUpdates()
  }

  func respondToPermissionRequest(automaticChecks: Bool) {
    guard case .permissionRequest(let reply) = interaction else { return }
    sessionOrigin = .idle
    interaction = .none
    phase = .idle
    publish()
    reply(
      SUUpdatePermissionResponse(
        automaticUpdateChecks: automaticChecks,
        sendSystemProfile: false
      )
    )
    if !automaticChecks {
      if let updater {
        updater.automaticallyDownloadsUpdates = false
      } else {
        stubAutomaticallyChecksForUpdates = false
        stubAutomaticallyDownloadsUpdates = false
        publish()
      }
    }
  }

  func restartLater() {
    guard case .installing = interaction, case .installing(let installing) = phase else { return }
    phase = .installing(
      UpdatePhase.Installing(
        buildVersion: installing.buildVersion,
        isAutoUpdate: installing.isAutoUpdate,
        showsPrompt: false,
        version: installing.version
      )
    )
    publish()
  }

  func restartNow() {
    guard case .installing(let restart) = interaction else { return }
    restart()
  }

  func retryUpdate() {
    guard case .error(let retry) = interaction else { return }
    sessionOrigin = .idle
    interaction = .none
    phase = .idle
    publish()
    retry()
  }

  func skipVersion() {
    guard case .updateAvailable(let reply) = interaction else { return }
    resetPreparedInstallChoice()
    sessionOrigin = .idle
    interaction = .none
    phase = .idle
    publish()
    reply(.skip)
  }

  func clearUnobtrusiveStateForFallbackIfNeeded() {
    guard !phase.isIdle, !hasUnobtrusiveTarget else { return }

    switch interaction {
    case .checking(let cancel), .downloading(let cancel):
      cancel()
    case .updateAvailable(let reply):
      reply(.dismiss)
    case .notFound(let acknowledgement):
      acknowledgement()
    case .error, .permissionRequest, .installing, .none:
      break
    }

    resetPreparedInstallChoice()
    sessionOrigin = .idle
    interaction = .none
    phase = .idle
    publish()
  }

  func resetPreparedInstallChoice() {
    preparedInstallChoice = .relaunch
    hidesNextManualInstallPrompt = false
    updateAvailableStage = nil
  }
}
