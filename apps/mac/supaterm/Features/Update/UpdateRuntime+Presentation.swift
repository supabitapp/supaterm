import AppKit
import Foundation
import Sparkle

extension UpdateRuntime {
  func showChecking(
    cancel: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    sessionOrigin = .interactive
    interaction = .checking(cancel)
    phase = .checking
    publish()
    fallback?()
  }

  func showDownloading(
    cancel: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    guard sessionOrigin == .interactive else { return }
    interaction = .downloading(cancel)
    phase = .downloading(UpdatePhase.Downloading(expectedLength: nil, progress: 0))
    publish()
    fallback?()
  }

  func showDownloadingExpectedLength(
    _ expectedLength: UInt64,
    fallback: (() -> Void)?
  ) {
    guard sessionOrigin == .interactive else { return }
    guard case .downloading(let cancel) = interaction else { return }
    interaction = .downloading(cancel)
    phase = .downloading(UpdatePhase.Downloading(expectedLength: expectedLength, progress: 0))
    publish()
    fallback?()
  }

  func showDownloadingProgress(
    _ length: UInt64,
    fallback: (() -> Void)?
  ) {
    guard sessionOrigin == .interactive else { return }
    guard case .downloading(let cancel) = interaction else { return }
    let expectedLength: UInt64?
    let progress: UInt64
    if case .downloading(let downloading) = phase {
      expectedLength = downloading.expectedLength
      progress = downloading.progress + length
    } else {
      expectedLength = nil
      progress = length
    }
    interaction = .downloading(cancel)
    phase = .downloading(UpdatePhase.Downloading(expectedLength: expectedLength, progress: progress))
    publish()
    fallback?()
  }

  func showError(
    _ message: String,
    retry: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .error(retry: retry)
    phase = .error(UpdatePhase.Failure(message: message))
    publish()
    fallback?()
  }

  func showExtracting(
    fallback: (() -> Void)?
  ) {
    guard sessionOrigin == .interactive else { return }
    interaction = .none
    phase = .extracting(UpdatePhase.Extracting(progress: 0))
    publish()
    fallback?()
  }

  func showExtractingProgress(
    _ progress: Double,
    fallback: (() -> Void)?
  ) {
    guard sessionOrigin == .interactive else { return }
    interaction = .none
    phase = .extracting(UpdatePhase.Extracting(progress: min(1, max(0, progress))))
    publish()
    fallback?()
  }

  func showInstalling(
    isAutoUpdate: Bool,
    buildVersion: String? = nil,
    restart: @escaping () -> Void,
    showsPrompt: Bool = true,
    version: String = "",
    fallback: (() -> Void)?
  ) {
    preparedInstallChoice = .relaunch
    hidesNextManualInstallPrompt = false
    sessionOrigin = .interactive
    interaction = .installing(restart)
    phase = .installing(
      UpdatePhase.Installing(
        buildVersion: buildVersion,
        isAutoUpdate: isAutoUpdate,
        showsPrompt: showsPrompt,
        version: version
      )
    )
    publish()
    if sessionOrigin == .interactive {
      fallback?()
    }
  }

  func showNotFound(
    acknowledgement: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    resetPreparedInstallChoice()
    sessionOrigin = .interactive
    interaction = .notFound(acknowledgement)
    phase = .notFound
    publish()
    fallback?()
  }

  func showPermissionRequest(
    reply: @escaping (SUUpdatePermissionResponse) -> Void,
    fallback: (() -> Void)?
  ) {
    resetPreparedInstallChoice()
    sessionOrigin = .interactive
    interaction = .permissionRequest(reply)
    phase = .permissionRequest
    publish()
    fallback?()
  }

  func showUpdateAvailable(
    _ available: UpdatePhase.Available,
    stage: SPUUserUpdateStage,
    reply: @escaping (SPUUserUpdateChoice) -> Void,
    fallback: (() -> Void)?
  ) {
    resetPreparedInstallChoice()
    updateAvailableStage = stage
    sessionOrigin = .interactive
    interaction = .updateAvailable(reply)
    phase = .updateAvailable(available)
    publish()
    fallback?()
  }

  func finishInstalledUpdate(
    _ acknowledgement: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    resetPreparedInstallChoice()
    sessionOrigin = .idle
    interaction = .none
    phase = .idle
    publish()
    fallback?()
    acknowledgement()
  }

  func dismissUpdateInstallation() {
    guard case .installing = interaction, case .installing(let installing) = phase else {
      resetPreparedInstallChoice()
      sessionOrigin = .idle
      interaction = .none
      phase = .idle
      publish()
      return
    }
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

  func showUpdateInFocus(
    fallback: (() -> Void)?
  ) {
    fallback?()
  }

  func showReadyToInstallAndRelaunch(
    reply: @escaping @Sendable (SPUUserUpdateChoice) -> Void,
    fallback: (() -> Void)?
  ) {
    guard hasUnobtrusiveTarget else {
      fallback?()
      return
    }

    switch preparedInstallChoice {
    case .nextRestart:
      resetPreparedInstallChoice()
      sessionOrigin = .idle
      interaction = .none
      phase = .idle
      publish()
      reply(.dismiss)
    case .relaunch:
      preparedInstallChoice = .relaunch
      updateAvailableStage = nil
      hidesNextManualInstallPrompt = true
      sessionOrigin = .interactive
      phase = .installing(UpdatePhase.Installing(isAutoUpdate: false, showsPrompt: false))
      publish()
      reply(.install)
    }
  }

  func showManualInstallingUpdate(
    restart: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    let showsPrompt = !hidesNextManualInstallPrompt
    hidesNextManualInstallPrompt = false
    showInstalling(
      isAutoUpdate: false,
      restart: restart,
      showsPrompt: showsPrompt,
      fallback: fallback
    )
  }

  var hasUnobtrusiveTarget: Bool {
    NSApp.windows.contains { window in
      guard window.isVisible else { return false }
      guard let identifier = window.identifier?.rawValue else { return false }
      let prefix = "\(Bundle.main.bundleIdentifier ?? "app.supabit.supaterm").window."
      guard identifier.hasPrefix(prefix) else { return false }
      let suffix = String(identifier.dropFirst(prefix.count))
      return UUID(uuidString: suffix) != nil
    }
  }
}
