import Foundation
import Sparkle
import SupatermCLIShared

@MainActor
final class UpdateDriver: NSObject, SPUUserDriver, SPUUpdaterDelegate {
  weak var runtime: UpdateRuntime?
  var updateChannel: UpdateChannel = .stable
  private var presentationMode: UpdatePresentationMode = .standard

  private let standard: SPUStandardUserDriver

  init(hostBundle: Bundle) {
    standard = SPUStandardUserDriver(hostBundle: hostBundle, delegate: nil)
    super.init()
  }

  nonisolated func allowedChannels(for updater: SPUUpdater) -> Set<String> {
    MainActor.assumeIsolated {
      updateChannel.sparkleChannels
    }
  }

  func updater(
    _ updater: SPUUpdater,
    willInstallUpdateOnQuit item: SUAppcastItem,
    immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
  ) -> Bool {
    runtime?.showInstalling(
      isAutoUpdate: true,
      buildVersion: item.versionString,
      restart: immediateInstallHandler,
      version: item.displayVersionString,
      fallback: nil
    )
    return true
  }

  func dismissUpdateInstallation() {
    switch presentationMode {
    case .sidebar:
      runtime?.dismissUpdateInstallation()
    case .standard:
      standard.dismissUpdateInstallation()
    }
  }

  func show(_ request: SPUUpdatePermissionRequest, reply: @escaping @Sendable (SUUpdatePermissionResponse) -> Void) {
    runtime?.showPermissionRequest(
      reply: reply,
      fallback: fallbackAction {
        self.standard.show(request, reply: reply)
      }
    )
  }

  func showDownloadDidReceiveData(ofLength length: UInt64) {
    switch presentationMode {
    case .sidebar:
      runtime?.showDownloadingProgress(length, fallback: nil)
    case .standard:
      standard.showDownloadDidReceiveData(ofLength: length)
    }
  }

  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
    switch presentationMode {
    case .sidebar:
      runtime?.showDownloadingExpectedLength(expectedContentLength, fallback: nil)
    case .standard:
      standard.showDownloadDidReceiveExpectedContentLength(expectedContentLength)
    }
  }

  func showDownloadDidStartExtractingUpdate() {
    switch presentationMode {
    case .sidebar:
      runtime?.showExtracting(fallback: nil)
    case .standard:
      standard.showDownloadDidStartExtractingUpdate()
    }
  }

  func showDownloadInitiated(cancellation: @escaping () -> Void) {
    switch presentationMode {
    case .sidebar:
      runtime?.showDownloading(cancel: cancellation, fallback: nil)
    case .standard:
      standard.showDownloadInitiated(cancellation: cancellation)
    }
  }

  func showExtractionReceivedProgress(_ progress: Double) {
    switch presentationMode {
    case .sidebar:
      runtime?.showExtractingProgress(progress, fallback: nil)
    case .standard:
      standard.showExtractionReceivedProgress(progress)
    }
  }

  func showInstallingUpdate(
    withApplicationTerminated applicationTerminated: Bool,
    retryTerminatingApplication: @escaping () -> Void
  ) {
    switch presentationMode {
    case .sidebar:
      runtime?.showManualInstallingUpdate(
        restart: retryTerminatingApplication,
        fallback: nil
      )
    case .standard:
      standard.showInstallingUpdate(
        withApplicationTerminated: applicationTerminated,
        retryTerminatingApplication: retryTerminatingApplication
      )
    }
  }

  func showReady(toInstallAndRelaunch reply: @escaping @Sendable (SPUUserUpdateChoice) -> Void) {
    switch presentationMode {
    case .standard:
      standard.showReady(toInstallAndRelaunch: reply)
    case .sidebar:
      guard let runtime else {
        standard.showReady(toInstallAndRelaunch: reply)
        return
      }
      runtime.showReadyToInstallAndRelaunch(
        reply: reply,
        fallback: {
          self.standard.showReady(toInstallAndRelaunch: reply)
        }
      )
    }
  }

  func showUpdateFound(
    with appcastItem: SUAppcastItem,
    state: SPUUserUpdateState,
    reply: @escaping @Sendable (SPUUserUpdateChoice) -> Void
  ) {
    presentationMode = UpdatePresentation.mode(
      hasUnobtrusiveTarget: runtime?.hasUnobtrusiveTarget ?? false
    )
    let contentLength = appcastItem.contentLength > 0 ? appcastItem.contentLength : nil
    switch presentationMode {
    case .sidebar:
      runtime?.showUpdateAvailable(
        UpdatePhase.Available(
          buildVersion: appcastItem.versionString,
          contentLength: contentLength,
          releaseDate: appcastItem.date,
          version: appcastItem.displayVersionString
        ),
        stage: state.stage,
        reply: reply,
        fallback: nil
      )
    case .standard:
      standard.showUpdateFound(with: appcastItem, state: state, reply: reply)
    }
  }

  func showUpdateInFocus() {
    switch presentationMode {
    case .sidebar:
      runtime?.showUpdateInFocus(fallback: nil)
    case .standard:
      standard.showUpdateInFocus()
    }
  }

  func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
    switch presentationMode {
    case .sidebar:
      runtime?.finishInstalledUpdate(acknowledgement, fallback: nil)
    case .standard:
      standard.showUpdateInstalledAndRelaunched(relaunched, acknowledgement: acknowledgement)
    }
  }

  func showUpdateNotFoundWithError(_ error: any Error, acknowledgement: @escaping () -> Void) {
    switch presentationMode {
    case .sidebar:
      runtime?.showNotFound(acknowledgement: acknowledgement, fallback: nil)
    case .standard:
      standard.showUpdateNotFoundWithError(error, acknowledgement: acknowledgement)
    }
  }

  func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}

  func showUpdateReleaseNotesFailedToDownloadWithError(_ error: any Error) {}

  func showUpdaterError(_ error: any Error, acknowledgement: @escaping () -> Void) {
    switch presentationMode {
    case .sidebar:
      runtime?.showError(
        error.localizedDescription,
        retry: { [weak runtime] in
          runtime?.perform(.checkForUpdates)
        },
        fallback: nil
      )
      if runtime?.hasUnobtrusiveTarget == true {
        acknowledgement()
      }
    case .standard:
      standard.showUpdaterError(error, acknowledgement: acknowledgement)
    }
  }

  func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
    presentationMode = UpdatePresentation.mode(
      hasUnobtrusiveTarget: runtime?.hasUnobtrusiveTarget ?? false
    )
    switch presentationMode {
    case .sidebar:
      runtime?.showChecking(cancel: cancellation, fallback: nil)
    case .standard:
      standard.showUserInitiatedUpdateCheck(cancellation: cancellation)
    }
  }

  private func fallbackAction(_ action: @escaping () -> Void) -> (() -> Void)? {
    runtime?.hasUnobtrusiveTarget == true ? nil : action
  }
}
