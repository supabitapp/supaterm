import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import Sparkle
import SupatermLicenseFeature
import SupatermSupport
import SupatermUI

typealias UpdateOwnershipEndedPresenter =
  @MainActor (
    UpdatePhase,
    [UpdateActionPresentation]
  ) -> UpdateUserAction?

@MainActor
final class UpdateDriver: NSObject, SPUUserDriver, SPUUpdaterDelegate {
  weak var runtime: UpdateRuntime?
  var updateChannel: UpdateChannel = .stable
  private var presentationMode: UpdatePresentationMode = .standard

  private var appcastContinuations: [UUID: AsyncStream<Void>.Continuation] = [:]
  private var appcastItems: [SUAppcastItem]?
  private var checkPreflight = UpdateCheckPreflight<SPUUpdateCheck>()
  private let currentVersion: String
  private let license: UpdateLicenseClient
  private let openURL: (URL) -> Void
  private let presentOwnershipEnded: UpdateOwnershipEndedPresenter
  private let standard: SPUStandardUserDriver

  init(
    hostBundle: Bundle,
    license: UpdateLicenseClient,
    currentVersion: String? = nil,
    openURL: @escaping (URL) -> Void = { _ = NSWorkspace.shared.open($0) },
    presentOwnershipEnded: UpdateOwnershipEndedPresenter? = nil
  ) {
    self.license = license
    self.currentVersion =
      currentVersion
      ?? hostBundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
      ?? "0"
    self.openURL = openURL
    self.presentOwnershipEnded = presentOwnershipEnded ?? Self.presentOwnershipEndedDialog
    standard = SPUStandardUserDriver(hostBundle: hostBundle, delegate: nil)
    super.init()
  }

  func allowUpdateCheck(_ updateCheck: SPUUpdateCheck) {
    checkPreflight.prepare(updateCheck)
  }

  func refreshLicenseBeforeUpdateCheck() async {
    await license.refresh()
  }

  var hasLoadedAppcast: Bool {
    appcastItems != nil
  }

  func observeAppcast() -> AsyncStream<Void> {
    AsyncStream { continuation in
      if hasLoadedAppcast {
        continuation.yield()
        continuation.finish()
        return
      }
      let id = UUID()
      appcastContinuations[id] = continuation
      continuation.onTermination = { [weak self] _ in
        Task { @MainActor in
          self?.appcastContinuations.removeValue(forKey: id)
        }
      }
    }
  }

  func bestValidUpdate<Value>(
    in releases: [UpdateRelease<Value>]
  ) -> UpdateOwnershipDecision<Value> {
    ownershipPolicy.decision(in: releases)
  }

  func newestOwnedReleaseURL(
    in releases: [UpdateRelease<URL>],
    through updatesThrough: LicenseDay
  ) -> URL? {
    ownershipPolicy.newestOwnedRelease(
      in: releases,
      through: updatesThrough
    )?.value
  }

  func newestOwnedReleaseURL(through updatesThrough: LicenseDay) -> URL? {
    guard let appcastItems else { return nil }
    return newestOwnedReleaseURL(
      in: appcastItems.compactMap { item in
        guard let fileURL = item.fileURL else { return nil }
        return UpdateRelease(
          value: fileURL,
          version: item.versionString,
          displayVersion: item.displayVersionString,
          releaseDay: item.date.map { LicenseDay.today(at: $0) },
          channel: item.channel
        )
      },
      through: updatesThrough
    )
  }

  func updater(_: SPUUpdater, didFinishLoading appcast: SUAppcast) {
    appcastItems = appcast.items
    for continuation in appcastContinuations.values {
      continuation.yield()
      continuation.finish()
    }
    appcastContinuations.removeAll()
  }

  func updater(
    _: SPUUpdater,
    mayPerform updateCheck: SPUUpdateCheck
  ) throws {
    guard license.refreshesBeforeChecks else { return }
    switch checkPreflight.request(updateCheck) {
    case .allow:
      return
    case .deny:
      break
    case .startRefresh:
      Task { @MainActor [weak self] in
        await self?.license.refresh()
        guard
          let self,
          let updateCheck = checkPreflight.refreshDidFinish()
        else { return }
        runtime?.retryUpdateCheck(updateCheck)
      }
    }
    throw NSError(
      domain: SUSparkleErrorDomain,
      code: Int(SUError.installationCanceledError.rawValue)
    )
  }

  func updater(
    _: SPUUpdater,
    didFinishUpdateCycleFor updateCheck: SPUUpdateCheck,
    error _: (any Error)?
  ) {
    guard let updateCheck = checkPreflight.cycleDidFinish(updateCheck) else {
      return
    }
    runtime?.retryUpdateCheck(updateCheck)
  }

  func bestValidUpdate(
    in appcast: SUAppcast,
    for _: SPUUpdater
  ) -> SUAppcastItem? {
    switch bestValidUpdate(in: appcast.items.map(Self.release)) {
    case .install(let item):
      return item
    case .none:
      return SUAppcastItem.empty()
    case .renew:
      return SUAppcastItem.empty()
    case .unfiltered:
      return nil
    }
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
    if let currentOwnershipEnded {
      presentationMode = UpdatePresentation.mode(
        hasUnobtrusiveTarget: runtime?.hasUnobtrusiveTarget ?? false
      )
      switch presentationMode {
      case .sidebar:
        runtime?.showOwnershipEnded(
          currentOwnershipEnded,
          acknowledgement: acknowledgement
        )
      case .standard:
        showStandardOwnershipEnded(
          currentOwnershipEnded,
          acknowledgement: acknowledgement
        )
      }
      return
    }
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

  private static func release(_ item: SUAppcastItem) -> UpdateRelease<SUAppcastItem> {
    UpdateRelease(
      value: item,
      version: item.versionString,
      displayVersion: item.displayVersionString,
      releaseDay: item.date.map { LicenseDay.today(at: $0) },
      channel: item.channel
    )
  }

  private var currentOwnershipEnded: UpdatePhase.OwnershipEnded? {
    guard let appcastItems else { return nil }
    return ownershipEnded(
      in: appcastItems.map(Self.release),
      releaseURL: \.fileURL
    )
  }

  func ownershipEnded<Value>(
    in releases: [UpdateRelease<Value>],
    releaseURL: (Value) -> URL?
  ) -> UpdatePhase.OwnershipEnded? {
    guard case .renew(let ownership) = ownershipPolicy.decision(in: releases) else {
      return nil
    }
    let releaseURL = ownershipPolicy.newestOwnedRelease(
      in: releases,
      through: ownership.updatesThrough
    ).flatMap { releaseURL($0.value) }
    return UpdatePhase.OwnershipEnded(
      licenseID: ownership.licenseID,
      latestIncludedReleaseURL: releaseURL,
      updatesThrough: ownership.updatesThrough,
      version: ownership.version
    )
  }

  private var licenseAccess: LicenseAccess {
    license.access()
  }

  private var ownershipPolicy: UpdateOwnershipPolicy {
    UpdateOwnershipPolicy(
      currentVersion: currentVersion,
      licenseAccess: licenseAccess,
      updateChannel: updateChannel
    )
  }

  func showStandardOwnershipEnded(
    _ ownership: UpdatePhase.OwnershipEnded,
    acknowledgement: @escaping () -> Void
  ) {
    let phase = UpdatePhase.ownershipEnded(ownership)
    let action = presentOwnershipEnded(
      phase,
      Self.standardPresentations(phase.actionPresentations)
    )
    acknowledgement()
    guard let action else { return }
    performOwnershipEndedAction(action, ownership: ownership)
  }

  func performOwnershipEndedAction(
    _ action: UpdateUserAction,
    ownership: UpdatePhase.OwnershipEnded
  ) {
    switch action {
    case .dismiss:
      return
    case .downloadLatestIncludedRelease:
      guard let url = ownership.latestIncludedReleaseURL else { return }
      openURL(url)
    case .renewUpdates:
      openURL(ownership.renewURL)
    case .allowAutomaticChecks, .cancel, .checkForUpdates, .declineAutomaticChecks,
      .install, .installAfterNextRestart, .restartLater, .restartNow, .retry,
      .skipVersion:
      return
    }
  }

  private static func standardPresentations(
    _ presentations: [UpdateActionPresentation]
  ) -> [UpdateActionPresentation] {
    let prominent = presentations.filter(\.isProminent)
    let dismiss = presentations.filter { $0.action == .dismiss }
    let others = presentations.filter { !$0.isProminent && $0.action != .dismiss }
    return prominent + others + dismiss
  }

  private static func presentOwnershipEndedDialog(
    _ phase: UpdatePhase,
    presentations: [UpdateActionPresentation]
  ) -> UpdateUserAction? {
    var selectedAction: UpdateUserAction?
    let presenter = DialogSurfacePresenter()
    _ = presenter.runModal(over: NSApp.keyWindow) {
      DialogSurface(
        title: phase.summaryText,
        message: phase.detailMessage,
        icon: .application,
        layout: DialogSurfaceLayout(width: 520),
        actions: presentations.reversed().map { presentation in
          DialogSurfaceAction(
            id: String(describing: presentation.action),
            title: presentation.title,
            role: presentation.isProminent ? .primary : .secondary,
            shortcut: presentation.isProminent
              ? .default
              : presentation.action == .dismiss ? .cancel : nil,
            accessibilityIdentifier: presentation.isProminent
              ? "dialog.confirm"
              : presentation.action == .dismiss ? "dialog.cancel" : nil
          ) {
            selectedAction = presentation.action
            presenter.finish(with: .OK)
          }
        },
        onDismiss: {
          presenter.finish(with: .cancel)
        }
      )
    }
    return selectedAction
  }

  private func fallbackAction(_ action: @escaping () -> Void) -> (() -> Void)? {
    runtime?.hasUnobtrusiveTarget == true ? nil : action
  }
}
