import AppKit
import ComposableArchitecture
import Foundation
import Sparkle

enum UpdateUserAction: Equatable, Sendable {
  case allowAutomaticChecks
  case cancel
  case checkForUpdates
  case declineAutomaticChecks
  case dismiss
  case install
  case restartLater
  case restartNow
  case retry
  case skipVersion
}

enum UpdatePhase: Equatable, Sendable {
  struct Available: Equatable, Sendable {
    var buildVersion: String?
    var contentLength: UInt64?
    var releaseDate: Date?
    var version: String

    init(
      buildVersion: String? = nil,
      contentLength: UInt64?,
      releaseDate: Date?,
      version: String
    ) {
      self.buildVersion = buildVersion
      self.contentLength = contentLength
      self.releaseDate = releaseDate
      self.version = version
    }

    var formattedVersion: String? {
      let version = self.version.trimmingCharacters(in: .whitespacesAndNewlines)
      let buildVersion = self.buildVersion?.trimmingCharacters(in: .whitespacesAndNewlines)

      if let buildVersion, !buildVersion.isEmpty, buildVersion != version {
        if version.isEmpty {
          return buildVersion
        }
        return "\(version) (\(buildVersion))"
      }

      return version.isEmpty ? nil : version
    }
  }

  struct Downloading: Equatable, Sendable {
    var expectedLength: UInt64?
    var progress: UInt64
  }

  struct Extracting: Equatable, Sendable {
    var progress: Double
  }

  struct Failure: Equatable, Sendable {
    var message: String
  }

  struct Installing: Equatable, Sendable {
    var isAutoUpdate: Bool
  }

  case idle
  case permissionRequest
  case checking
  case updateAvailable(Available)
  case downloading(Downloading)
  case extracting(Extracting)
  case installing(Installing)
  case notFound
  case error(Failure)

  var badgeText: String? {
    switch self {
    case .updateAvailable(let available):
      return available.formattedVersion
    case .downloading(let downloading):
      return Self.progressText(
        progress: Double(downloading.progress),
        total: downloading.expectedLength.map { Double($0) }
      )
    case .extracting(let extracting):
      return Self.percentText(Self.clampedProgress(extracting.progress))
    default:
      return nil
    }
  }

  var bypassesQuitConfirmation: Bool {
    switch self {
    case .installing:
      return true
    default:
      return false
    }
  }

  var detailMessage: String {
    switch self {
    case .idle:
      return ""
    case .permissionRequest:
      return "Allow Supaterm to automatically check for updates in the background."
    case .checking:
      return "Please wait while Supaterm checks for available updates."
    case .updateAvailable(let available):
      guard let version = available.formattedVersion else {
        return "A Supaterm update is ready to download and install."
      }
      return "Supaterm \(version) is ready to download and install."
    case .downloading:
      return "Supaterm is downloading the selected update."
    case .extracting:
      return "Supaterm is preparing the downloaded update."
    case .installing(let installing):
      if installing.isAutoUpdate {
        return "The update is ready. Restart Supaterm to complete installation."
      }
      return "Supaterm is installing the update and preparing to restart."
    case .notFound:
      return "You're already running the latest version."
    case .error(let failure):
      return failure.message
    }
  }

  var debugIdentifier: String {
    switch self {
    case .idle:
      return "idle"
    case .permissionRequest:
      return "permission_request"
    case .checking:
      return "checking"
    case .updateAvailable:
      return "update_available"
    case .downloading:
      return "downloading"
    case .extracting:
      return "extracting"
    case .installing:
      return "installing"
    case .notFound:
      return "not_found"
    case .error:
      return "error"
    }
  }

  var iconName: String {
    switch self {
    case .idle:
      return "circle"
    case .permissionRequest:
      return "questionmark.circle"
    case .checking:
      return "arrow.triangle.2.circlepath"
    case .updateAvailable:
      return "shippingbox.fill"
    case .downloading:
      return "arrow.down.circle"
    case .extracting:
      return "shippingbox"
    case .installing:
      return "power.circle"
    case .notFound:
      return "checkmark.circle"
    case .error:
      return "exclamationmark.triangle.fill"
    }
  }

  var isIdle: Bool {
    if case .idle = self {
      return true
    }
    return false
  }

  var menuItemAction: UpdateUserAction? {
    switch self {
    case .installing:
      return .restartNow
    default:
      return nil
    }
  }

  var menuItemTitle: String {
    switch self {
    case .installing:
      return "Restart to Update..."
    default:
      return "Check for Updates..."
    }
  }

  var progressValue: Double? {
    switch self {
    case .downloading(let downloading):
      guard let expectedLength = downloading.expectedLength, expectedLength > 0 else {
        return nil
      }
      return Self.clampedProgress(Double(downloading.progress) / Double(expectedLength))
    case .extracting(let extracting):
      return Self.clampedProgress(extracting.progress)
    default:
      return nil
    }
  }

  var summaryText: String {
    switch self {
    case .idle:
      return ""
    case .permissionRequest:
      return "Enable Automatic Updates?"
    case .checking:
      return "Checking for Updates…"
    case .updateAvailable:
      return "Update Available"
    case .downloading:
      return "Downloading Update"
    case .extracting:
      return "Preparing Update"
    case .installing(let installing):
      return installing.isAutoUpdate ? "Restart to Complete Update" : "Installing Update"
    case .notFound:
      return "No Updates Available"
    case .error:
      return "Update Failed"
    }
  }

  private static func clampedProgress(_ value: Double) -> Double {
    min(1, max(0, value))
  }

  private static func percentText(_ value: Double) -> String {
    String(format: "%.0f%%", clampedProgress(value) * 100)
  }

  private static func progressText(
    progress: Double,
    total: Double?
  ) -> String? {
    guard let total, total > 0 else { return nil }
    return percentText(progress / total)
  }
}

struct UpdateClient: Sendable {
  struct Snapshot: Equatable, Sendable {
    var canCheckForUpdates: Bool
    var phase: UpdatePhase
  }

  var observe: @Sendable () async -> AsyncStream<Snapshot>
  var perform: @Sendable (UpdateUserAction) async -> Void
  var start: @Sendable () async -> Void
}

extension UpdateClient: DependencyKey {
  static let liveValue: Self = {
    let runtime = UpdateRuntime.shared
    return Self(
      observe: {
        await runtime.observe()
      },
      perform: { action in
        await runtime.perform(action)
      },
      start: {
        await runtime.start()
      }
    )
  }()

  static let testValue = Self(
    observe: {
      AsyncStream { continuation in
        continuation.finish()
      }
    },
    perform: { _ in },
    start: {}
  )
}

extension DependencyValues {
  var updateClient: UpdateClient {
    get { self[UpdateClient.self] }
    set { self[UpdateClient.self] = newValue }
  }
}

@MainActor
final class UpdateRuntime: NSObject, @unchecked Sendable {
  static let shared = UpdateRuntime()

  private enum Interaction {
    case none
    case permissionRequest((SUUpdatePermissionResponse) -> Void)
    case checking(() -> Void)
    case updateAvailable((SPUUserUpdateChoice) -> Void)
    case notFound(() -> Void)
    case error(retry: () -> Void)
    case downloading(() -> Void)
    case installing(() -> Void)
  }

  private var canCheckForUpdatesObservation: NSKeyValueObservation?
  private var continuations: [UUID: AsyncStream<UpdateClient.Snapshot>.Continuation] = [:]
  private var interaction: Interaction = .none
  private var phase: UpdatePhase = .idle
  private var started = false
  private let updater: SPUUpdater?

  private override init() {
    #if DEBUG
      updater = nil
      super.init()
    #else
      let hostBundle = Bundle.main
      let userDriver = UpdateDriver(hostBundle: hostBundle)
      updater = SPUUpdater(
        hostBundle: hostBundle,
        applicationBundle: hostBundle,
        userDriver: userDriver,
        delegate: userDriver
      )
      super.init()
      userDriver.runtime = self
      updater?.updateCheckInterval = 900
      canCheckForUpdatesObservation = updater?.observe(
        \.canCheckForUpdates, options: [.new]
      ) { [weak self] _, _ in
        MainActor.assumeIsolated {
          self?.publish()
        }
      }
      NotificationCenter.default.addObserver(
        self,
        selector: #selector(handleWindowWillClose),
        name: NSWindow.willCloseNotification,
        object: nil
      )
    #endif
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  func observe() -> AsyncStream<UpdateClient.Snapshot> {
    AsyncStream { continuation in
      let id = UUID()
      continuations[id] = continuation
      continuation.yield(snapshot)
      continuation.onTermination = { [weak self] _ in
        Task { @MainActor in
          self?.continuations.removeValue(forKey: id)
        }
      }
    }
  }

  func perform(_ action: UpdateUserAction) {
    switch action {
    case .checkForUpdates:
      performCheckForUpdates()

    case .allowAutomaticChecks:
      respondToPermissionRequest(automaticChecks: true)

    case .declineAutomaticChecks:
      respondToPermissionRequest(automaticChecks: false)

    case .cancel:
      cancelInteraction()

    case .dismiss:
      dismissInteraction()

    case .install:
      installUpdate()

    case .restartLater:
      restartLater()

    case .restartNow:
      restartNow()

    case .retry:
      retryUpdate()

    case .skipVersion:
      skipVersion()
    }
  }

  func start() {
    guard !started else {
      publish()
      return
    }

    guard let updater else {
      started = true
      publish()
      return
    }

    do {
      try updater.start()
      started = true
      if updater.automaticallyChecksForUpdates && AppBuild.allowsBackgroundUpdateCheckOnLaunch {
        updater.checkForUpdatesInBackground()
      }
      publish()
    } catch {
      interaction = .error(retry: { [weak self] in
        Task { @MainActor in
          self?.start()
        }
      })
      phase = .error(.init(message: error.localizedDescription))
      publish()
    }
  }

  fileprivate func showChecking(
    cancel: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .checking(cancel)
    phase = .checking
    publish()
    fallback?()
  }

  fileprivate func showDownloading(
    cancel: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .downloading(cancel)
    phase = .downloading(.init(expectedLength: nil, progress: 0))
    publish()
    fallback?()
  }

  fileprivate func showDownloadingExpectedLength(
    _ expectedLength: UInt64,
    fallback: (() -> Void)?
  ) {
    guard case .downloading(let cancel) = interaction else { return }
    interaction = .downloading(cancel)
    phase = .downloading(.init(expectedLength: expectedLength, progress: 0))
    publish()
    fallback?()
  }

  fileprivate func showDownloadingProgress(
    _ length: UInt64,
    fallback: (() -> Void)?
  ) {
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
    phase = .downloading(.init(expectedLength: expectedLength, progress: progress))
    publish()
    fallback?()
  }

  fileprivate func showError(
    _ message: String,
    retry: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .error(retry: retry)
    phase = .error(.init(message: message))
    publish()
    fallback?()
  }

  fileprivate func showExtracting(
    fallback: (() -> Void)?
  ) {
    interaction = .none
    phase = .extracting(.init(progress: 0))
    publish()
    fallback?()
  }

  fileprivate func showExtractingProgress(
    _ progress: Double,
    fallback: (() -> Void)?
  ) {
    interaction = .none
    phase = .extracting(.init(progress: min(1, max(0, progress))))
    publish()
    fallback?()
  }

  fileprivate func showInstalling(
    isAutoUpdate: Bool,
    restart: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .installing(restart)
    phase = .installing(.init(isAutoUpdate: isAutoUpdate))
    publish()
    fallback?()
  }

  fileprivate func showNotFound(
    acknowledgement: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .notFound(acknowledgement)
    phase = .notFound
    publish()
    fallback?()
  }

  fileprivate func showPermissionRequest(
    reply: @escaping (SUUpdatePermissionResponse) -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .permissionRequest(reply)
    phase = .permissionRequest
    publish()
    fallback?()
  }

  fileprivate func showUpdateAvailable(
    _ available: UpdatePhase.Available,
    reply: @escaping (SPUUserUpdateChoice) -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .updateAvailable(reply)
    phase = .updateAvailable(available)
    publish()
    fallback?()
  }

  fileprivate func finishInstalledUpdate(
    _ acknowledgement: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .none
    phase = .idle
    publish()
    fallback?()
    acknowledgement()
  }

  fileprivate func dismissUpdateInstallation() {
    interaction = .none
    phase = .idle
    publish()
  }

  fileprivate func showUpdateInFocus(
    fallback: (() -> Void)?
  ) {
    fallback?()
  }

  fileprivate var hasUnobtrusiveTarget: Bool {
    NSApp.windows.contains { window in
      window.isVisible && window.windowController is TerminalWindowController
    }
  }

  @objc private func handleWindowWillClose() {
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(50))
      self?.clearUnobtrusiveStateForFallbackIfNeeded()
    }
  }

  private var snapshot: UpdateClient.Snapshot {
    UpdateClient.Snapshot(
      canCheckForUpdates: updater?.canCheckForUpdates ?? false,
      phase: phase
    )
  }

  private func checkForUpdates() {
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

    interaction = .none
    phase = .idle
    publish()

    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(100))
      self?.updater?.checkForUpdates()
    }
  }

  private func cancelInteraction() {
    switch interaction {
    case .checking(let cancel), .downloading(let cancel):
      interaction = .none
      phase = .idle
      publish()
      cancel()
    default:
      return
    }
  }

  private func dismissInteraction() {
    switch interaction {
    case .updateAvailable(let reply):
      interaction = .none
      phase = .idle
      publish()
      reply(.dismiss)
    case .notFound(let acknowledgement):
      interaction = .none
      phase = .idle
      publish()
      acknowledgement()
    case .error:
      interaction = .none
      phase = .idle
      publish()
    default:
      return
    }
  }

  private func installUpdate() {
    guard case .updateAvailable(let reply) = interaction else { return }
    reply(.install)
  }

  private func performCheckForUpdates() {
    guard updater?.canCheckForUpdates ?? false else { return }
    checkForUpdates()
  }

  private func respondToPermissionRequest(automaticChecks: Bool) {
    guard case .permissionRequest(let reply) = interaction else { return }
    interaction = .none
    phase = .idle
    publish()
    reply(
      SUUpdatePermissionResponse(
        automaticUpdateChecks: automaticChecks,
        sendSystemProfile: false
      )
    )
  }

  private func restartLater() {
    guard case .installing = interaction else { return }
    interaction = .none
    phase = .idle
    publish()
  }

  private func restartNow() {
    guard case .installing(let restart) = interaction else { return }
    restart()
  }

  private func retryUpdate() {
    guard case .error(let retry) = interaction else { return }
    interaction = .none
    phase = .idle
    publish()
    retry()
  }

  private func skipVersion() {
    guard case .updateAvailable(let reply) = interaction else { return }
    interaction = .none
    phase = .idle
    publish()
    reply(.skip)
  }

  private func clearUnobtrusiveStateForFallbackIfNeeded() {
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

    interaction = .none
    phase = .idle
    publish()
  }

  private func publish() {
    let snapshot = snapshot
    for continuation in continuations.values {
      continuation.yield(snapshot)
    }
  }
}

@MainActor
private final class UpdateDriver: NSObject, SPUUserDriver, SPUUpdaterDelegate {
  weak var runtime: UpdateRuntime?

  private let standard: SPUStandardUserDriver

  init(hostBundle: Bundle) {
    standard = SPUStandardUserDriver(hostBundle: hostBundle, delegate: nil)
    super.init()
  }

  func updater(
    _ updater: SPUUpdater,
    willInstallUpdateOnQuit item: SUAppcastItem,
    immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
  ) -> Bool {
    runtime?.showInstalling(
      isAutoUpdate: true,
      restart: immediateInstallHandler,
      fallback: nil
    )
    return true
  }

  func dismissUpdateInstallation() {
    runtime?.dismissUpdateInstallation()
    standard.dismissUpdateInstallation()
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
    runtime?.showDownloadingProgress(
      length,
      fallback: fallbackAction {
        self.standard.showDownloadDidReceiveData(ofLength: length)
      }
    )
  }

  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
    runtime?.showDownloadingExpectedLength(
      expectedContentLength,
      fallback: fallbackAction {
        self.standard.showDownloadDidReceiveExpectedContentLength(expectedContentLength)
      }
    )
  }

  func showDownloadDidStartExtractingUpdate() {
    runtime?.showExtracting(
      fallback: fallbackAction {
        self.standard.showDownloadDidStartExtractingUpdate()
      }
    )
  }

  func showDownloadInitiated(cancellation: @escaping () -> Void) {
    runtime?.showDownloading(
      cancel: cancellation,
      fallback: fallbackAction {
        self.standard.showDownloadInitiated(cancellation: cancellation)
      }
    )
  }

  func showExtractionReceivedProgress(_ progress: Double) {
    runtime?.showExtractingProgress(
      progress,
      fallback: fallbackAction {
        self.standard.showExtractionReceivedProgress(progress)
      }
    )
  }

  func showInstallingUpdate(
    withApplicationTerminated applicationTerminated: Bool,
    retryTerminatingApplication: @escaping () -> Void
  ) {
    runtime?.showInstalling(
      isAutoUpdate: false,
      restart: retryTerminatingApplication,
      fallback: fallbackAction {
        self.standard.showInstallingUpdate(
          withApplicationTerminated: applicationTerminated,
          retryTerminatingApplication: retryTerminatingApplication
        )
      }
    )
  }

  func showReady(toInstallAndRelaunch reply: @escaping @Sendable (SPUUserUpdateChoice) -> Void) {
    guard runtime?.hasUnobtrusiveTarget == true else {
      standard.showReady(toInstallAndRelaunch: reply)
      return
    }
    reply(.install)
  }

  func showUpdateFound(
    with appcastItem: SUAppcastItem,
    state: SPUUserUpdateState,
    reply: @escaping @Sendable (SPUUserUpdateChoice) -> Void
  ) {
    let contentLength = appcastItem.contentLength > 0 ? appcastItem.contentLength : nil
    runtime?.showUpdateAvailable(
      .init(
        buildVersion: appcastItem.versionString,
        contentLength: contentLength,
        releaseDate: appcastItem.date,
        version: appcastItem.displayVersionString
      ),
      reply: reply,
      fallback: fallbackAction {
        self.standard.showUpdateFound(with: appcastItem, state: state, reply: reply)
      }
    )
  }

  func showUpdateInFocus() {
    runtime?.showUpdateInFocus(
      fallback: fallbackAction {
        self.standard.showUpdateInFocus()
      }
    )
  }

  func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
    runtime?.finishInstalledUpdate(
      acknowledgement,
      fallback: {
        self.standard.showUpdateInstalledAndRelaunched(relaunched, acknowledgement: {})
      }
    )
  }

  func showUpdateNotFoundWithError(_ error: any Error, acknowledgement: @escaping () -> Void) {
    runtime?.showNotFound(
      acknowledgement: acknowledgement,
      fallback: fallbackAction {
        self.standard.showUpdateNotFoundWithError(error, acknowledgement: acknowledgement)
      }
    )
  }

  func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}

  func showUpdateReleaseNotesFailedToDownloadWithError(_ error: any Error) {}

  func showUpdaterError(_ error: any Error, acknowledgement: @escaping () -> Void) {
    let fallback = fallbackAction {
      self.standard.showUpdaterError(error, acknowledgement: acknowledgement)
    }
    runtime?.showError(
      error.localizedDescription,
      retry: { [weak runtime] in
        runtime?.perform(.checkForUpdates)
      },
      fallback: fallback
    )
    if runtime?.hasUnobtrusiveTarget == true {
      acknowledgement()
    }
  }

  func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
    runtime?.showChecking(
      cancel: cancellation,
      fallback: fallbackAction {
        self.standard.showUserInitiatedUpdateCheck(cancellation: cancellation)
      }
    )
  }

  private func fallbackAction(_ action: @escaping () -> Void) -> (() -> Void)? {
    runtime?.hasUnobtrusiveTarget == true ? nil : action
  }
}
