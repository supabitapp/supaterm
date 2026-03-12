import AppKit
import ComposableArchitecture
import Foundation
import Sparkle

struct UpdatePresentationContext: Equatable, Sendable {
  var isFloatingSidebarVisible = false
  var isSidebarCollapsed = false

  func allowsInlinePresentation(hasVisibleWindow: Bool) -> Bool {
    hasVisibleWindow && (!isSidebarCollapsed || isFloatingSidebarVisible)
  }
}

struct UpdateInfo: Equatable, Sendable {
  var contentLength: UInt64?
  var publishedAt: Date?
  var releaseNotesURL: URL?
  var version: String
}

struct UpdateDownloadProgress: Equatable, Sendable {
  var expectedLength: UInt64?
  var receivedLength: UInt64

  var fractionCompleted: Double? {
    guard let expectedLength, expectedLength > 0 else { return nil }
    return min(1, max(0, Double(receivedLength) / Double(expectedLength)))
  }
}

struct UpdateInstallingState: Equatable, Sendable {
  var canInstallNow: Bool
}

enum UpdateBadge: Equatable, Sendable {
  case icon(name: String, spins: Bool)
  case progress(Double)
}

enum UpdatePillTone: Equatable, Sendable {
  case accent
  case warning
}

enum UpdatePhase: Equatable, Sendable {
  case idle
  case permissionRequest
  case checking
  case updateAvailable(UpdateInfo)
  case downloading(UpdateDownloadProgress)
  case extracting(Double)
  case installing(UpdateInstallingState)
  case notFound
  case error(String)

  var badge: UpdateBadge? {
    switch self {
    case .idle:
      return nil
    case .permissionRequest:
      return .icon(name: "questionmark.circle", spins: false)
    case .checking:
      return .icon(name: "arrow.triangle.2.circlepath", spins: true)
    case .updateAvailable:
      return .icon(name: "shippingbox.fill", spins: false)
    case .downloading(let progress):
      guard let fractionCompleted = progress.fractionCompleted else {
        return .icon(name: "arrow.down.circle", spins: false)
      }
      return .progress(fractionCompleted)
    case .extracting(let progress):
      return .progress(min(1, max(0, progress)))
    case .installing:
      return .icon(name: "power.circle", spins: false)
    case .notFound:
      return .icon(name: "info.circle", spins: false)
    case .error:
      return .icon(name: "exclamationmark.triangle.fill", spins: false)
    }
  }

  var detailMessage: String {
    switch self {
    case .idle:
      return ""
    case .permissionRequest:
      return "Supaterm can automatically check for updates in the background."
    case .checking:
      return "Please wait while Supaterm checks for available updates."
    case .updateAvailable:
      return "A new version of Supaterm is ready to download and install."
    case .downloading:
      return "Supaterm is downloading the update package."
    case .extracting:
      return "Supaterm is preparing the update for installation."
    case .installing:
      return "The update is ready. Restart Supaterm to complete installation."
    case .notFound:
      return "You're already running the latest version."
    case .error(let message):
      return message
    }
  }

  var isIdle: Bool {
    if case .idle = self {
      return true
    }
    return false
  }

  var allowsPopover: Bool {
    switch self {
    case .idle, .checking, .downloading, .extracting:
      return false
    default:
      return true
    }
  }

  var maxText: String {
    switch self {
    case .downloading:
      return "Downloading: 100%"
    case .extracting:
      return "Preparing: 100%"
    default:
      return text
    }
  }

  var pillTone: UpdatePillTone {
    switch self {
    case .error:
      return .warning
    case .idle:
      return .accent
    default:
      return .accent
    }
  }

  var releaseNotesURL: URL? {
    guard case .updateAvailable(let info) = self else { return nil }
    return info.releaseNotesURL
  }

  var text: String {
    switch self {
    case .idle:
      return ""
    case .permissionRequest:
      return "Enable Automatic Updates?"
    case .checking:
      return "Checking for Updates…"
    case .updateAvailable(let info):
      return info.version.isEmpty ? "Update Available" : "Update Available: \(info.version)"
    case .downloading(let progress):
      guard let fractionCompleted = progress.fractionCompleted else {
        return "Downloading…"
      }
      return String(format: "Downloading: %.0f%%", fractionCompleted * 100)
    case .extracting(let progress):
      return String(format: "Preparing: %.0f%%", min(1, max(0, progress)) * 100)
    case .installing:
      return "Restart to Complete Update"
    case .notFound:
      return "No Updates Available"
    case .error(let message):
      return message
    }
  }

  var title: String {
    switch self {
    case .idle:
      return ""
    case .permissionRequest:
      return "Enable Automatic Updates?"
    case .checking:
      return "Checking for Updates"
    case .updateAvailable:
      return "Update Available"
    case .downloading:
      return "Downloading Update"
    case .extracting:
      return "Preparing Update"
    case .installing:
      return "Restart Required"
    case .notFound:
      return "No Updates Found"
    case .error:
      return "Update Failed"
    }
  }
}

struct UpdateClient: Sendable {
  struct Snapshot: Equatable, Sendable {
    var canCheckForUpdates: Bool
    var phase: UpdatePhase
  }

  enum UserIntent: Equatable, Sendable {
    case allowAutomaticUpdates
    case declineAutomaticUpdates
    case dismiss
    case install
    case later
    case restartNow
    case retry
    case skip
  }

  var checkForUpdates: @Sendable () async -> Void
  var observe: @Sendable () async -> AsyncStream<Snapshot>
  var sendIntent: @Sendable (UserIntent) async -> Void
  var setPresentationContext: @Sendable (UpdatePresentationContext) async -> Void
  var start: @Sendable () async -> Void
}

extension UpdateClient: DependencyKey {
  static let liveValue: Self = {
    let runtime = UpdateRuntime.shared
    return Self(
      checkForUpdates: {
        await runtime.checkForUpdates()
      },
      observe: {
        await runtime.observe()
      },
      sendIntent: { intent in
        await runtime.send(intent: intent)
      },
      setPresentationContext: { context in
        await runtime.setPresentationContext(context)
      },
      start: {
        await runtime.start()
      }
    )
  }()

  static let testValue = Self(
    checkForUpdates: {},
    observe: {
      AsyncStream { continuation in
        continuation.finish()
      }
    },
    sendIntent: { _ in },
    setPresentationContext: { _ in },
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
final class UpdateRuntime: NSObject, SPUUpdaterDelegate, SPUUserDriver, @unchecked Sendable {
  static let shared = UpdateRuntime()

  private enum PendingResponse {
    case acknowledgement(() -> Void)
    case cancellation(() -> Void)
    case installNow(() -> Void)
    case permission((SUUpdatePermissionResponse) -> Void)
    case updateChoice((SPUUserUpdateChoice) -> Void)
  }

  private var continuations: [UUID: AsyncStream<UpdateClient.Snapshot>.Continuation] = [:]
  private var pendingResponse: PendingResponse?
  private var phase: UpdatePhase = .idle
  private var presentationContext = UpdatePresentationContext()
  private var started = false
  private let standardUserDriver: SPUStandardUserDriver?
  private let updater: SPUUpdater?

  private override init() {
    #if DEBUG
      standardUserDriver = nil
      updater = nil
      super.init()
    #else
      let hostBundle = Bundle.main
      standardUserDriver = SPUStandardUserDriver(hostBundle: hostBundle, delegate: nil)
      super.init()
      updater = SPUUpdater(
        hostBundle: hostBundle,
        applicationBundle: hostBundle,
        userDriver: self,
        delegate: self
      )
      updater?.updateCheckInterval = 900
    #endif
  }

  func checkForUpdates() {
    guard let updater else { return }
    start()
    if phase.isIdle {
      updater.checkForUpdates()
      return
    }
    dismissCurrentPhaseForManualCheck()
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(100))
      self?.updater?.checkForUpdates()
    }
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

  func send(intent: UpdateClient.UserIntent) {
    switch intent {
    case .allowAutomaticUpdates:
      guard case .permission(let reply) = pendingResponse else { return }
      pendingResponse = nil
      setPhase(.idle)
      reply(SUUpdatePermissionResponse(automaticUpdateChecks: true, sendSystemProfile: false))

    case .declineAutomaticUpdates:
      guard case .permission(let reply) = pendingResponse else { return }
      pendingResponse = nil
      setPhase(.idle)
      reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false))

    case .dismiss:
      dismissCurrentPhaseForManualCheck()

    case .install:
      guard case .updateChoice(let reply) = pendingResponse else { return }
      pendingResponse = nil
      reply(.install)

    case .later:
      guard case .updateChoice(let reply) = pendingResponse else { return }
      pendingResponse = nil
      setPhase(.idle)
      reply(.dismiss)

    case .restartNow:
      guard case .installNow(let installNow) = pendingResponse else { return }
      pendingResponse = nil
      installNow()

    case .retry:
      guard case .acknowledgement(let acknowledgement) = pendingResponse else { return }
      pendingResponse = nil
      setPhase(.idle)
      acknowledgement()
      Task { @MainActor [weak self] in
        try? await Task.sleep(for: .milliseconds(100))
        self?.updater?.checkForUpdates()
      }

    case .skip:
      guard case .updateChoice(let reply) = pendingResponse else { return }
      pendingResponse = nil
      setPhase(.idle)
      reply(.skip)
    }
  }

  func setPresentationContext(_ context: UpdatePresentationContext) {
    presentationContext = context
    guard allowsInlinePresentation else {
      guard !phase.isIdle else { return }
      dismissCurrentPhaseForManualCheck()
      return
    }
    publish()
  }

  func start() {
    guard !started else {
      publish()
      return
    }
    started = true
    guard let updater else {
      publish()
      return
    }
    do {
      try updater.start()
      if updater.automaticallyChecksForUpdates {
        updater.checkForUpdatesInBackground()
      }
      publish()
    } catch {
      pendingResponse = nil
      setPhase(.error(error.localizedDescription))
    }
  }

  private var allowsInlinePresentation: Bool {
    presentationContext.allowsInlinePresentation(hasVisibleWindow: hasVisibleWindow)
  }

  private var hasVisibleWindow: Bool {
    NSApp.windows.contains { $0.isVisible }
  }

  private var snapshot: UpdateClient.Snapshot {
    UpdateClient.Snapshot(
      canCheckForUpdates: updater?.canCheckForUpdates ?? false,
      phase: phase
    )
  }

  private func dismissCurrentPhaseForManualCheck() {
    let pendingResponse = pendingResponse
    self.pendingResponse = nil
    setPhase(.idle)
    switch pendingResponse {
    case .acknowledgement(let acknowledgement):
      acknowledgement()
    case .cancellation(let cancellation):
      cancellation()
    case .installNow:
      break
    case .permission(let reply):
      reply(SUUpdatePermissionResponse(automaticUpdateChecks: false, sendSystemProfile: false))
    case .updateChoice(let reply):
      reply(.dismiss)
    case nil:
      break
    }
  }

  private func publish() {
    let snapshot = snapshot
    for continuation in continuations.values {
      continuation.yield(snapshot)
    }
  }

  private func setPhase(_ phase: UpdatePhase) {
    self.phase = phase
    publish()
  }

  private func updateAvailableInfo(from appcastItem: SUAppcastItem) -> UpdateInfo {
    UpdateInfo(
      contentLength: appcastItem.contentLength > 0 ? appcastItem.contentLength : nil,
      publishedAt: appcastItem.date,
      releaseNotesURL: appcastItem.fullReleaseNotesURL ?? appcastItem.releaseNotesURL,
      version: appcastItem.displayVersionString
    )
  }

  func show(_ request: SPUUpdatePermissionRequest, reply: @escaping (SUUpdatePermissionResponse) -> Void) {
    guard allowsInlinePresentation else {
      standardUserDriver?.show(request, reply: reply)
      return
    }
    pendingResponse = .permission(reply)
    setPhase(.permissionRequest)
  }

  func showUserInitiatedUpdateCheck(cancellation: @escaping () -> Void) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showUserInitiatedUpdateCheck(cancellation: cancellation)
      return
    }
    pendingResponse = .cancellation(cancellation)
    setPhase(.checking)
  }

  func showUpdateFound(
    with appcastItem: SUAppcastItem,
    state: SPUUserUpdateState,
    reply: @escaping (SPUUserUpdateChoice) -> Void
  ) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showUpdateFound(with: appcastItem, state: state, reply: reply)
      return
    }
    pendingResponse = .updateChoice(reply)
    setPhase(.updateAvailable(updateAvailableInfo(from: appcastItem)))
  }

  func showUpdateReleaseNotes(with downloadData: SPUDownloadData) {}

  func showUpdateReleaseNotesFailedToDownloadWithError(_ error: Error) {}

  func showUpdateNotFoundWithError(_ error: Error, acknowledgement: @escaping () -> Void) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showUpdateNotFoundWithError(error, acknowledgement: acknowledgement)
      return
    }
    pendingResponse = .acknowledgement(acknowledgement)
    setPhase(.notFound)
  }

  func showUpdaterError(_ error: Error, acknowledgement: @escaping () -> Void) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showUpdaterError(error, acknowledgement: acknowledgement)
      return
    }
    pendingResponse = .acknowledgement(acknowledgement)
    setPhase(.error(error.localizedDescription))
  }

  func showDownloadInitiated(cancellation: @escaping () -> Void) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showDownloadInitiated(cancellation: cancellation)
      return
    }
    pendingResponse = .cancellation(cancellation)
    setPhase(.downloading(.init(expectedLength: nil, receivedLength: 0)))
  }

  func showDownloadDidReceiveExpectedContentLength(_ expectedContentLength: UInt64) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showDownloadDidReceiveExpectedContentLength(expectedContentLength)
      return
    }
    guard case .downloading(let progress) = phase else { return }
    setPhase(.downloading(.init(expectedLength: expectedContentLength, receivedLength: progress.receivedLength)))
  }

  func showDownloadDidReceiveData(ofLength length: UInt64) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showDownloadDidReceiveData(ofLength: length)
      return
    }
    guard case .downloading(let progress) = phase else { return }
    setPhase(
      .downloading(
        .init(
          expectedLength: progress.expectedLength,
          receivedLength: progress.receivedLength + length
        )
      )
    )
  }

  func showDownloadDidStartExtractingUpdate() {
    guard allowsInlinePresentation else {
      standardUserDriver?.showDownloadDidStartExtractingUpdate()
      return
    }
    pendingResponse = nil
    setPhase(.extracting(0))
  }

  func showExtractionReceivedProgress(_ progress: Double) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showExtractionReceivedProgress(progress)
      return
    }
    setPhase(.extracting(progress))
  }

  func showReady(toInstallAndRelaunch reply: @escaping (SPUUserUpdateChoice) -> Void) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showReady(toInstallAndRelaunch: reply)
      return
    }
    reply(.install)
  }

  func showInstallingUpdate(
    withApplicationTerminated applicationTerminated: Bool,
    retryTerminatingApplication: @escaping () -> Void
  ) {
    guard allowsInlinePresentation else {
      standardUserDriver?.showInstallingUpdate(
        withApplicationTerminated: applicationTerminated,
        retryTerminatingApplication: retryTerminatingApplication
      )
      return
    }
    pendingResponse = .installNow(retryTerminatingApplication)
    setPhase(.installing(.init(canInstallNow: true)))
  }

  func showUpdateInstalledAndRelaunched(_ relaunched: Bool, acknowledgement: @escaping () -> Void) {
    if !allowsInlinePresentation {
      standardUserDriver?.showUpdateInstalledAndRelaunched(relaunched, acknowledgement: acknowledgement)
      return
    }
    pendingResponse = nil
    setPhase(.idle)
    acknowledgement()
  }

  func showUpdateInFocus() {
    guard !allowsInlinePresentation else { return }
    standardUserDriver?.showUpdateInFocus()
  }

  func dismissUpdateInstallation() {
    pendingResponse = nil
    setPhase(.idle)
    standardUserDriver?.dismissUpdateInstallation()
  }

  func updater(
    _ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
    immediateInstallationBlock immediateInstallHandler: @escaping () -> Void
  ) -> Bool {
    guard allowsInlinePresentation else { return false }
    pendingResponse = .installNow(immediateInstallHandler)
    setPhase(.installing(.init(canInstallNow: true)))
    return true
  }

  func updaterWillRelaunchApplication(_ updater: SPUUpdater) {}
}
