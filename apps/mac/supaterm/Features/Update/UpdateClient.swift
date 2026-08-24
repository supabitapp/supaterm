import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import Sparkle
import SupatermSupport

public enum UpdateUserAction: Equatable, Sendable {
  case allowAutomaticChecks
  case cancel
  case checkForUpdates
  case declineAutomaticChecks
  case dismiss
  case install
  case installAfterNextRestart
  case renewUpdates
  case restartLater
  case restartNow
  case retry
  case skipVersion
}

public enum UpdatePresentationMode: Equatable, Sendable {
  case sidebar
  case standard
}

public enum UpdatePresentation {
  public static func mode(
    hasUnobtrusiveTarget: Bool
  ) -> UpdatePresentationMode {
    return hasUnobtrusiveTarget ? .sidebar : .standard
  }
}

public enum UpdatePhase: Equatable, Sendable {
  public struct Available: Equatable, Sendable {
    public var buildVersion: String?
    public var contentLength: UInt64?
    public var releaseDate: Date?
    public var version: String

    public init(
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

    public var formattedVersion: String? {
      UpdatePhase.formattedVersion(version: version, buildVersion: buildVersion)
    }
  }

  public struct Downloading: Equatable, Sendable {
    public var expectedLength: UInt64?
    public var progress: UInt64

    public init(
      expectedLength: UInt64?,
      progress: UInt64
    ) {
      self.expectedLength = expectedLength
      self.progress = progress
    }
  }

  public struct Extracting: Equatable, Sendable {
    public var progress: Double

    public init(progress: Double) {
      self.progress = progress
    }
  }

  public struct Failure: Equatable, Sendable {
    public var message: String

    public init(message: String) {
      self.message = message
    }
  }

  public struct Installing: Equatable, Sendable {
    public var buildVersion: String?
    public var isAutoUpdate: Bool
    public var showsPrompt: Bool
    public var version: String

    public init(
      buildVersion: String? = nil,
      isAutoUpdate: Bool,
      showsPrompt: Bool? = nil,
      version: String = ""
    ) {
      self.buildVersion = buildVersion
      self.isAutoUpdate = isAutoUpdate
      self.showsPrompt = showsPrompt ?? true
      self.version = version
    }

    public var formattedVersion: String? {
      UpdatePhase.formattedVersion(version: version, buildVersion: buildVersion)
    }
  }

  public struct OwnershipEnded: Equatable, Sendable {
    public let licenseID: String
    public let updatesThrough: LicenseDay
    public let version: String

    public init(
      licenseID: String,
      updatesThrough: LicenseDay,
      version: String
    ) {
      self.licenseID = licenseID
      self.updatesThrough = updatesThrough
      self.version = version
    }

    public var renewURL: URL {
      LicensePortalURL.license(licenseID)
    }
  }

  case idle
  case permissionRequest
  case checking
  case updateAvailable(Available)
  case downloading(Downloading)
  case extracting(Extracting)
  case installing(Installing)
  case notFound
  case ownershipEnded(OwnershipEnded)
  case error(Failure)

  public var badgeText: String? {
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

  public var bypassesQuitConfirmation: Bool {
    switch self {
    case .installing:
      return true
    default:
      return false
    }
  }

  public var detailMessage: String {
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
      if let version = installing.formattedVersion {
        return "Updated to \(version). Restart Supaterm to complete installation."
      }
      if installing.isAutoUpdate {
        return "The update is ready. Restart Supaterm to complete installation."
      }
      return "Supaterm is installing the update and preparing to restart."
    case .notFound:
      return "You're already running the latest version."
    case .ownershipEnded(let ownership):
      let updatesThrough = ownership.updatesThrough.rawValue
      return "Supaterm \(ownership.version) is out. Your updates ended \(updatesThrough) — renew to update."
    case .error(let failure):
      return failure.message
    }
  }

  public var debugIdentifier: String {
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
    case .ownershipEnded:
      return "ownership_ended"
    case .error:
      return "error"
    }
  }

  public var iconName: String {
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
    case .ownershipEnded:
      return "lock.fill"
    case .error:
      return "exclamationmark.triangle.fill"
    }
  }

  public var isIdle: Bool {
    if case .idle = self {
      return true
    }
    return false
  }

  public var showsSidebarSection: Bool {
    switch self {
    case .idle:
      return false
    case .installing(let installing):
      return installing.showsPrompt
    default:
      return true
    }
  }

  public var menuItemAction: UpdateUserAction? {
    switch self {
    case .installing:
      return .restartNow
    default:
      return nil
    }
  }

  public var menuItemTitle: String {
    switch self {
    case .installing:
      return "Restart to Update..."
    default:
      return "Check for Updates..."
    }
  }

  public var progressValue: Double? {
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

  public var summaryText: String {
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
    case .ownershipEnded:
      return "Renew to Update"
    case .error:
      return "Update Failed"
    }
  }

  private static func clampedProgress(_ value: Double) -> Double {
    min(1, max(0, value))
  }

  private static func formattedVersion(
    version: String,
    buildVersion: String?
  ) -> String? {
    let version = version.trimmingCharacters(in: .whitespacesAndNewlines)
    let buildVersion = buildVersion?.trimmingCharacters(in: .whitespacesAndNewlines)

    if let buildVersion, !buildVersion.isEmpty, buildVersion != version {
      if version.isEmpty {
        return buildVersion
      }
      return "\(version) (\(buildVersion))"
    }

    return version.isEmpty ? nil : version
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
  public var newestOwnedReleaseURL: @Sendable (LicenseDay) async -> URL?
  public var perform: @Sendable (UpdateUserAction) async -> Void
  public var setAutomaticallyChecksForUpdates: @Sendable (Bool) async -> Void
  public var setAutomaticallyDownloadsUpdates: @Sendable (Bool) async -> Void
  public var setUpdateChannel: @Sendable (UpdateChannel) async -> Void
  public var start: @Sendable () async -> Void

  public init(
    newestOwnedReleaseURL: @escaping @Sendable (LicenseDay) async -> URL?,
    observe: @escaping @Sendable () async -> AsyncStream<Snapshot>,
    perform: @escaping @Sendable (UpdateUserAction) async -> Void,
    setAutomaticallyChecksForUpdates: @escaping @Sendable (Bool) async -> Void,
    setAutomaticallyDownloadsUpdates: @escaping @Sendable (Bool) async -> Void,
    setUpdateChannel: @escaping @Sendable (UpdateChannel) async -> Void,
    start: @escaping @Sendable () async -> Void
  ) {
    self.newestOwnedReleaseURL = newestOwnedReleaseURL
    self.observe = observe
    self.perform = perform
    self.setAutomaticallyChecksForUpdates = setAutomaticallyChecksForUpdates
    self.setAutomaticallyDownloadsUpdates = setAutomaticallyDownloadsUpdates
    self.setUpdateChannel = setUpdateChannel
    self.start = start
  }

  @MainActor
  public static func bindLicense(
    entitlement: Shared<LicenseEntitlement?>,
    refresh: @escaping @MainActor @Sendable () async -> Void
  ) {
    UpdateRuntime.shared.bindLicense(
      entitlement: entitlement,
      refresh: refresh
    )
  }
}

extension UpdateClient: DependencyKey {
  public static let liveValue: Self = {
    let runtime = UpdateRuntime.shared
    return Self(
      newestOwnedReleaseURL: { updatesThrough in
        await runtime.newestOwnedReleaseURL(through: updatesThrough)
      },
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
    newestOwnedReleaseURL: unimplemented(
      "UpdateClient.newestOwnedReleaseURL",
      placeholder: nil
    ),
    observe: unimplemented(
      "UpdateClient.observe",
      placeholder: AsyncStream { $0.finish() }
    ),
    perform: unimplemented("UpdateClient.perform"),
    setAutomaticallyChecksForUpdates: unimplemented("UpdateClient.setAutomaticallyChecksForUpdates"),
    setAutomaticallyDownloadsUpdates: unimplemented(
      "UpdateClient.setAutomaticallyDownloadsUpdates"
    ),
    setUpdateChannel: unimplemented("UpdateClient.setUpdateChannel"),
    start: unimplemented("UpdateClient.start")
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
    case ownershipEnded
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

  func bindLicense(
    entitlement: Shared<LicenseEntitlement?>,
    refresh: @escaping @MainActor @Sendable () async -> Void
  ) {
    userDriver?.bindLicense(
      entitlement: entitlement,
      refresh: refresh
    )
  }

  func newestOwnedReleaseURL(through updatesThrough: LicenseDay) async -> URL? {
    guard let userDriver else { return nil }
    if userDriver.hasLoadedAppcast {
      return userDriver.newestOwnedReleaseURL(through: updatesThrough)
    }
    guard let updater, started, updater.canCheckForUpdates, !updater.sessionInProgress else {
      return nil
    }
    await userDriver.refreshLicenseBeforeUpdateCheck()
    guard updater.canCheckForUpdates, !updater.sessionInProgress else { return nil }
    userDriver.allowUpdateCheck(.updateInformation)
    let appcast = userDriver.observeAppcast()
    updater.checkForUpdateInformation()
    await withTaskGroup(of: Void.self) { group in
      group.addTask {
        for await _ in appcast {
          return
        }
      }
      group.addTask {
        try? await Task.sleep(for: .seconds(15))
      }
      await group.next()
      group.cancelAll()
    }
    return userDriver.newestOwnedReleaseURL(through: updatesThrough)
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

    case .renewUpdates:
      renewUpdates()

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

  fileprivate func showOwnershipEnded(
    _ ownership: UpdatePhase.OwnershipEnded,
    acknowledgement: @escaping () -> Void
  ) {
    resetPreparedInstallChoice()
    sessionOrigin = .interactive
    interaction = .ownershipEnded
    phase = .ownershipEnded(ownership)
    publish()
    acknowledgement()
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
      userDriver?.allowUpdateCheck(.updates)
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
    case .error, .ownershipEnded, .permissionRequest, .installing, .none:
      break
    }

    resetPreparedInstallChoice()
    interaction = .none
    phase = .idle
    publish()

    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(100))
      self?.userDriver?.allowUpdateCheck(.updates)
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
    case .ownershipEnded:
      resetPreparedInstallChoice()
      sessionOrigin = .idle
      interaction = .none
      phase = .idle
      publish()
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
    guard updater?.canCheckForUpdates ?? false, userDriver != nil else { return }
    Task { @MainActor [weak self] in
      guard let self, let userDriver else { return }
      await userDriver.refreshLicenseBeforeUpdateCheck()
      guard updater?.canCheckForUpdates ?? false else { return }
      checkForUpdates()
    }
  }

  fileprivate func retryUpdateCheck(_ updateCheck: SPUUpdateCheck) {
    guard let updater, updater.canCheckForUpdates, !updater.sessionInProgress else {
      return
    }
    userDriver?.allowUpdateCheck(updateCheck)
    switch updateCheck {
    case .updates:
      updater.checkForUpdates()
    case .updatesInBackground:
      updater.checkForUpdatesInBackground()
    case .updateInformation:
      updater.checkForUpdateInformation()
    @unknown default:
      return
    }
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

  private func renewUpdates() {
    guard case .ownershipEnded(let ownership) = phase else { return }
    NSWorkspace.shared.open(ownership.renewURL)
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
    case .error, .ownershipEnded, .permissionRequest, .installing, .none:
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

struct UpdateRelease<Value> {
  let value: Value
  let version: String
  let displayVersion: String
  let releaseDay: LicenseDay?
  let channel: String?

  init(
    value: Value,
    version: String,
    displayVersion: String? = nil,
    releaseDay: LicenseDay?,
    channel: String?
  ) {
    self.value = value
    self.version = version
    self.displayVersion = displayVersion ?? version
    self.releaseDay = releaseDay
    self.channel = channel
  }
}

enum UpdateSelection<Value> {
  case none
  case release(Value)
  case unfiltered
}

extension UpdateSelection: Equatable where Value: Equatable {}

struct UpdateCheckPreflight<Check: Equatable> {
  enum Decision: Equatable {
    case allow
    case deny
    case startRefresh
  }

  private struct Pending {
    let check: Check
    var cycleFinished = false
    var refreshFinished = false
  }

  private var pending: Pending?
  private var prepared: Check?

  mutating func prepare(_ check: Check) {
    prepared = check
  }

  mutating func request(_ check: Check) -> Decision {
    if prepared == check {
      prepared = nil
      return .allow
    }
    guard pending == nil else { return .deny }
    pending = Pending(check: check)
    return .startRefresh
  }

  mutating func cycleDidFinish(_ check: Check) -> Check? {
    guard pending?.check == check else { return nil }
    pending?.cycleFinished = true
    return resumeIfReady()
  }

  mutating func refreshDidFinish() -> Check? {
    pending?.refreshFinished = true
    return resumeIfReady()
  }

  private mutating func resumeIfReady() -> Check? {
    guard
      let pending,
      pending.cycleFinished,
      pending.refreshFinished
    else { return nil }
    self.pending = nil
    return pending.check
  }
}

@MainActor
final class UpdateDriver: NSObject, SPUUserDriver, SPUUpdaterDelegate {
  weak var runtime: UpdateRuntime?
  var updateChannel: UpdateChannel = .stable
  private var presentationMode: UpdatePresentationMode = .standard

  @Shared private var licenseEntitlement: LicenseEntitlement?
  private var appcastContinuations: [UUID: AsyncStream<Void>.Continuation] = [:]
  private var appcastItems: [SUAppcastItem]?
  private var checkPreflight = UpdateCheckPreflight<SPUUpdateCheck>()
  private var refreshLicense: (@MainActor @Sendable () async -> Void)?
  private let currentVersion: String
  private let standard: SPUStandardUserDriver

  init(
    hostBundle: Bundle,
    licenseEntitlement: Shared<LicenseEntitlement?> = Shared(value: nil),
    currentVersion: String? = nil
  ) {
    self._licenseEntitlement = licenseEntitlement
    self.currentVersion =
      currentVersion
      ?? hostBundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
      ?? "0"
    standard = SPUStandardUserDriver(hostBundle: hostBundle, delegate: nil)
    super.init()
  }

  func bindLicense(
    entitlement: Shared<LicenseEntitlement?>,
    refresh: @escaping @MainActor @Sendable () async -> Void
  ) {
    self._licenseEntitlement = entitlement
    refreshLicense = refresh
  }

  func allowUpdateCheck(_ updateCheck: SPUUpdateCheck) {
    checkPreflight.prepare(updateCheck)
  }

  func refreshLicenseBeforeUpdateCheck() async {
    await refreshLicense?()
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
  ) -> UpdateSelection<Value> {
    guard
      let licenseEntitlement,
      licenseEntitlement.status == .active,
      let updatesThrough = licenseEntitlement.updatesThrough
    else { return .unfiltered }
    let releases = releases.filter { release in
      isAllowed(channel: release.channel) && isNewerThanCurrent(release.version)
    }
    guard let release = newestOwnedRelease(in: releases, through: updatesThrough) else {
      return .none
    }
    return .release(release.value)
  }

  func newestOwnedReleaseURL(
    in releases: [UpdateRelease<URL>],
    through updatesThrough: LicenseDay
  ) -> URL? {
    newestOwnedRelease(
      in: releases.filter { $0.channel == nil },
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
    guard let refreshLicense else { return }
    switch checkPreflight.request(updateCheck) {
    case .allow:
      return
    case .deny:
      break
    case .startRefresh:
      Task { @MainActor [weak self] in
        await refreshLicense()
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
    case .none:
      return SUAppcastItem.empty()
    case .release(let item):
      return item
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
    return ownershipEnded(in: appcastItems.map(Self.release))
  }

  func ownershipEnded<Value>(
    in releases: [UpdateRelease<Value>]
  ) -> UpdatePhase.OwnershipEnded? {
    guard
      let licenseEntitlement,
      licenseEntitlement.status == .active,
      let updatesThrough = licenseEntitlement.updatesThrough
    else { return nil }
    let releases = releases.filter { release in
      isAllowed(channel: release.channel) && isNewerThanCurrent(release.version)
    }
    guard
      let newest = newestRelease(in: releases),
      let releaseDay = newest.releaseDay,
      releaseDay > updatesThrough
    else { return nil }
    return UpdatePhase.OwnershipEnded(
      licenseID: licenseEntitlement.licenseID,
      updatesThrough: updatesThrough,
      version: newest.displayVersion
    )
  }

  private func newestOwnedRelease<Value>(
    in releases: [UpdateRelease<Value>],
    through updatesThrough: LicenseDay
  ) -> UpdateRelease<Value>? {
    let comparator = SUStandardVersionComparator.default
    return
      releases
      .filter { release in
        guard let releaseDay = release.releaseDay else { return false }
        return releaseDay <= updatesThrough
      }
      .max { lhs, rhs in
        comparator.compareVersion(lhs.version, toVersion: rhs.version) == .orderedAscending
      }
  }

  private func newestRelease<Value>(
    in releases: [UpdateRelease<Value>]
  ) -> UpdateRelease<Value>? {
    let comparator = SUStandardVersionComparator.default
    return releases.max { lhs, rhs in
      comparator.compareVersion(lhs.version, toVersion: rhs.version) == .orderedAscending
    }
  }

  private func isAllowed(channel: String?) -> Bool {
    guard let channel else { return true }
    return updateChannel.sparkleChannels.contains(channel)
  }

  private func isNewerThanCurrent(_ version: String) -> Bool {
    SUStandardVersionComparator.default.compareVersion(
      version,
      toVersion: currentVersion
    ) == .orderedDescending
  }

  private func showStandardOwnershipEnded(
    _ ownership: UpdatePhase.OwnershipEnded,
    acknowledgement: @escaping () -> Void
  ) {
    let alert = NSAlert()
    let phase = UpdatePhase.ownershipEnded(ownership)
    alert.messageText = phase.summaryText
    alert.informativeText = phase.detailMessage
    alert.addButton(withTitle: "Renew Updates")
    alert.addButton(withTitle: "Not Now")
    let response = alert.runModal()
    acknowledgement()
    if response == .alertFirstButtonReturn {
      NSWorkspace.shared.open(ownership.renewURL)
    }
  }

  private func fallbackAction(_ action: @escaping () -> Void) -> (() -> Void)? {
    runtime?.hasUnobtrusiveTarget == true ? nil : action
  }
}
