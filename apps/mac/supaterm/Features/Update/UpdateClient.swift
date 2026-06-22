import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import Sparkle
import SupatermCLIShared
import SupatermSupport

public struct UpdateClient: Sendable {
  public struct Snapshot: Equatable, Sendable {
    public var automaticallyChecksForUpdates: Bool
    public var automaticallyDownloadsUpdates: Bool
    public var canCheckForUpdates: Bool
    public var phase: UpdatePhase

    public init(
      automaticallyChecksForUpdates: Bool,
      automaticallyDownloadsUpdates: Bool,
      canCheckForUpdates: Bool,
      phase: UpdatePhase
    ) {
      self.automaticallyChecksForUpdates = automaticallyChecksForUpdates
      self.automaticallyDownloadsUpdates = automaticallyDownloadsUpdates
      self.canCheckForUpdates = canCheckForUpdates
      self.phase = phase
    }
  }

  public var observe: @Sendable () async -> AsyncStream<Snapshot>
  public var perform: @Sendable (UpdateUserAction) async -> Void
  public var setAutomaticallyChecksForUpdates: @Sendable (Bool) async -> Void
  public var setAutomaticallyDownloadsUpdates: @Sendable (Bool) async -> Void
  public var setUpdateChannel: @Sendable (UpdateChannel) async -> Void
  public var start: @Sendable () async -> Void

  public init(
    observe: @escaping @Sendable () async -> AsyncStream<Snapshot>,
    perform: @escaping @Sendable (UpdateUserAction) async -> Void,
    setAutomaticallyChecksForUpdates: @escaping @Sendable (Bool) async -> Void,
    setAutomaticallyDownloadsUpdates: @escaping @Sendable (Bool) async -> Void,
    setUpdateChannel: @escaping @Sendable (UpdateChannel) async -> Void,
    start: @escaping @Sendable () async -> Void
  ) {
    self.observe = observe
    self.perform = perform
    self.setAutomaticallyChecksForUpdates = setAutomaticallyChecksForUpdates
    self.setAutomaticallyDownloadsUpdates = setAutomaticallyDownloadsUpdates
    self.setUpdateChannel = setUpdateChannel
    self.start = start
  }
}

extension UpdateClient: DependencyKey {
  public static let liveValue: Self = {
    let runtime = UpdateRuntime.shared
    return Self(
      observe: {
        await runtime.observe()
      },
      perform: { action in
        await runtime.perform(action)
      },
      setAutomaticallyChecksForUpdates: { isEnabled in
        await runtime.setAutomaticallyChecksForUpdates(isEnabled)
      },
      setAutomaticallyDownloadsUpdates: { isEnabled in
        await runtime.setAutomaticallyDownloadsUpdates(isEnabled)
      },
      setUpdateChannel: { updateChannel in
        await runtime.setUpdateChannel(updateChannel)
      },
      start: {
        let updateChannel = await MainActor.run {
          @Shared(.supatermSettings) var supatermSettings = .default
          return supatermSettings.updateChannel
        }
        await runtime.start(updateChannel: updateChannel)
      }
    )
  }()

  public static let testValue = Self(
    observe: {
      AsyncStream { continuation in
        continuation.finish()
      }
    },
    perform: { _ in },
    setAutomaticallyChecksForUpdates: { _ in },
    setAutomaticallyDownloadsUpdates: { _ in },
    setUpdateChannel: { _ in },
    start: {}
  )
}

extension DependencyValues {
  public var updateClient: UpdateClient {
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

  private enum SessionOrigin {
    case idle
    case interactive
  }

  private enum PreparedInstallChoice {
    case nextRestart
    case relaunch
  }

  #if !DEBUG
    private var automaticallyChecksForUpdatesObservation: NSKeyValueObservation?
    private var automaticallyDownloadsUpdatesObservation: NSKeyValueObservation?
    private var canCheckForUpdatesObservation: NSKeyValueObservation?
  #endif
  private var continuations: [UUID: AsyncStream<UpdateClient.Snapshot>.Continuation] = [:]
  private var hidesNextManualInstallPrompt = false
  private var interaction: Interaction = .none
  private var phase: UpdatePhase = .idle
  private var preparedInstallChoice: PreparedInstallChoice = .relaunch
  private var sessionOrigin: SessionOrigin = .idle
  private var started = false
  private var stubAutomaticallyChecksForUpdates = true
  private var stubAutomaticallyDownloadsUpdates = true
  private var updateAvailableStage: SPUUserUpdateStage?
  private let userDriver: UpdateDriver?
  private let updater: SPUUpdater?

  private override init() {
    #if DEBUG
      userDriver = UpdateDriver(hostBundle: Bundle.main)
      updater = nil
      super.init()
    #else
      let hostBundle = Bundle.main
      let userDriver = UpdateDriver(hostBundle: hostBundle)
      self.userDriver = userDriver
      updater = SPUUpdater(
        hostBundle: hostBundle,
        applicationBundle: hostBundle,
        userDriver: userDriver,
        delegate: userDriver
      )
      super.init()
      userDriver.runtime = self
      canCheckForUpdatesObservation = updater?.observe(
        \.canCheckForUpdates, options: [.new]
      ) { [weak self] _, _ in
        MainActor.assumeIsolated {
          self?.publish()
        }
      }
      automaticallyChecksForUpdatesObservation = updater?.observe(
        \.automaticallyChecksForUpdates, options: [.new]
      ) { [weak self] _, _ in
        MainActor.assumeIsolated {
          self?.publish()
        }
      }
      automaticallyDownloadsUpdatesObservation = updater?.observe(
        \.automaticallyDownloadsUpdates, options: [.new]
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

    case .installAfterNextRestart:
      installAfterNextRestart()

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

  func setAutomaticallyChecksForUpdates(_ isEnabled: Bool) {
    if let updater {
      updater.automaticallyChecksForUpdates = isEnabled
      if !isEnabled {
        updater.automaticallyDownloadsUpdates = false
      }
    } else {
      stubAutomaticallyChecksForUpdates = isEnabled
      if !isEnabled {
        stubAutomaticallyDownloadsUpdates = false
      }
    }
    publish()
  }

  func setAutomaticallyDownloadsUpdates(_ isEnabled: Bool) {
    if let updater {
      updater.automaticallyDownloadsUpdates =
        updater.automaticallyChecksForUpdates && isEnabled
    } else {
      stubAutomaticallyDownloadsUpdates =
        stubAutomaticallyChecksForUpdates && isEnabled
    }
    publish()
  }

  func setUpdateChannel(_ updateChannel: UpdateChannel) {
    configureUpdater(updateChannel: updateChannel)
  }

  func start(updateChannel: UpdateChannel) {
    configureUpdater(updateChannel: updateChannel)
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
      publish()
    } catch {
      interaction = .error(retry: { [weak self] in
        Task { @MainActor in
          self?.start(updateChannel: updateChannel)
        }
      })
      phase = .error(UpdatePhase.Failure(message: error.localizedDescription))
      publish()
    }
  }

  fileprivate func showChecking(
    cancel: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    sessionOrigin = .interactive
    interaction = .checking(cancel)
    phase = .checking
    publish()
    fallback?()
  }

  fileprivate func showDownloading(
    cancel: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    guard sessionOrigin == .interactive else { return }
    interaction = .downloading(cancel)
    phase = .downloading(UpdatePhase.Downloading(expectedLength: nil, progress: 0))
    publish()
    fallback?()
  }

  fileprivate func showDownloadingExpectedLength(
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

  fileprivate func showDownloadingProgress(
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

  fileprivate func showError(
    _ message: String,
    retry: @escaping () -> Void,
    fallback: (() -> Void)?
  ) {
    interaction = .error(retry: retry)
    phase = .error(UpdatePhase.Failure(message: message))
    publish()
    fallback?()
  }

  fileprivate func showExtracting(
    fallback: (() -> Void)?
  ) {
    guard sessionOrigin == .interactive else { return }
    interaction = .none
    phase = .extracting(UpdatePhase.Extracting(progress: 0))
    publish()
    fallback?()
  }

  fileprivate func showExtractingProgress(
    _ progress: Double,
    fallback: (() -> Void)?
  ) {
    guard sessionOrigin == .interactive else { return }
    interaction = .none
    phase = .extracting(UpdatePhase.Extracting(progress: min(1, max(0, progress))))
    publish()
    fallback?()
  }

  fileprivate func showInstalling(
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

  fileprivate func showNotFound(
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

  fileprivate func showPermissionRequest(
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

  fileprivate func showUpdateAvailable(
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

  fileprivate func finishInstalledUpdate(
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

  fileprivate func dismissUpdateInstallation() {
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

  fileprivate func showUpdateInFocus(
    fallback: (() -> Void)?
  ) {
    fallback?()
  }

  fileprivate func showReadyToInstallAndRelaunch(
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

  fileprivate func showManualInstallingUpdate(
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

  fileprivate var hasUnobtrusiveTarget: Bool {
    NSApp.windows.contains { window in
      guard window.isVisible else { return false }
      guard let identifier = window.identifier?.rawValue else { return false }
      let prefix = "\(Bundle.main.bundleIdentifier ?? "app.supabit.supaterm").window."
      guard identifier.hasPrefix(prefix) else { return false }
      let suffix = String(identifier.dropFirst(prefix.count))
      return UUID(uuidString: suffix) != nil
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
      automaticallyChecksForUpdates: updater?.automaticallyChecksForUpdates ?? stubAutomaticallyChecksForUpdates,
      automaticallyDownloadsUpdates: updater?.automaticallyDownloadsUpdates ?? stubAutomaticallyDownloadsUpdates,
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

    resetPreparedInstallChoice()
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

  private func dismissInteraction() {
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

  private func installUpdate() {
    guard case .updateAvailable(let reply) = interaction else { return }
    preparedInstallChoice = .relaunch
    reply(.install)
  }

  private func installAfterNextRestart() {
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

  private func performCheckForUpdates() {
    guard updater?.canCheckForUpdates ?? false else { return }
    checkForUpdates()
  }

  private func respondToPermissionRequest(automaticChecks: Bool) {
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

  private func restartLater() {
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

  private func restartNow() {
    guard case .installing(let restart) = interaction else { return }
    restart()
  }

  private func retryUpdate() {
    guard case .error(let retry) = interaction else { return }
    sessionOrigin = .idle
    interaction = .none
    phase = .idle
    publish()
    retry()
  }

  private func skipVersion() {
    guard case .updateAvailable(let reply) = interaction else { return }
    resetPreparedInstallChoice()
    sessionOrigin = .idle
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

    resetPreparedInstallChoice()
    sessionOrigin = .idle
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

  private func resetPreparedInstallChoice() {
    preparedInstallChoice = .relaunch
    hidesNextManualInstallPrompt = false
    updateAvailableStage = nil
  }

  private func configureUpdater(updateChannel: UpdateChannel) {
    userDriver?.updateChannel = updateChannel
    updater?.updateCheckInterval = updateChannel.updateCheckInterval
    publish()
  }
}

@MainActor
private final class UpdateDriver: NSObject, SPUUserDriver, SPUUpdaterDelegate {
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
